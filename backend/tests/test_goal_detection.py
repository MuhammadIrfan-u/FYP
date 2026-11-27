"""Goal detection: marked goal landmarks, or automatic from detected goal boxes."""

import json

import numpy as np
import pytest

from app import main
from app.services import team_possession as tp
from app.services.goal_detection import GoalDetector
from app.services.goal_landmarks import (
    GoalMouth,
    goals_from_pixels,
    load_goal_mouths,
    save_goal_landmarks,
)
from app.services.team_possession import TeamPossessionTracker

# Goal mouth on screen (percent): goal line y=60 between x=70 and x=90, crossbar y=40.
# Post height 20 % -> a ball at the goal is ~1.8 % tall (0.22 m / 2.44 m).
MOUTH = GoalMouth.from_points(
    "goal_r",
    {
        "post_left_bottom": (70.0, 60.0),
        "post_right_bottom": (90.0, 60.0),
        "post_right_top": (90.0, 40.0),
        "post_left_top": (70.0, 40.0),
    },
    side="right",
    label="Right goal",
)
DT = 0.1
CARRIER_T1 = {"track_id": 9, "team_id": 1}


def ball(cx, cy, h=1.6, conf=0.7):
    """Ball box centred at (cx, cy) percent; ``h`` is its height in percent."""
    return {
        "class": "football",
        "confidence": conf,
        "x": cx - h * 0.3,
        "y": cy - h / 2.0,
        "w": h * 0.6,
        "h": h,
    }


def player(feet_x, feet_y, height=20.0):
    return {
        "class": "player",
        "confidence": 0.9,
        "x": feet_x - 4.0,
        "y": feet_y - height,
        "w": 8.0,
        "h": height,
    }


def run(det, frames, carrier=None, t0=0.0):
    events = []
    for i, dets in enumerate(frames):
        ev = det.update(dets, timestamp=t0 + i * DT, frame_index=i, carrier=carrier)
        if ev:
            events.append(ev)
    return events


def approach():
    """Ball travelling along the ground from the field towards the goal mouth."""
    return [[ball(x, 55.0)] for x in (40, 50, 60, 66)]


IN_NET = [ball(80, 55)]


def goal_box(dx=0.0, conf=0.8, x=70.0, y=38.3, w=20.0, h=21.7):
    """YOLO "football goal" box; as a mouth: posts x 71.2-88.8, bar y ~40, line y 60."""
    return {
        "class": "football goal",
        "confidence": conf,
        "x": x + dx,
        "y": y,
        "w": w,
        "h": h,
    }


def with_goal(frames, **kw):
    return [[*f, goal_box(**kw)] for f in frames]


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def test_goal_mouth_geometry():
    assert MOUTH.contains((80, 50))
    assert not MOUTH.contains((95, 50))
    assert MOUTH.behind_goal_line((80, 55))  # ground point inside the net
    assert not MOUTH.behind_goal_line((80, 62))  # ground point in front of the goal
    assert MOUTH.over_crossbar((80, 35))
    assert not MOUTH.over_crossbar((95, 35))  # wide, not over the bar
    assert MOUTH.expected_ball_height() == pytest.approx(20 * 0.22 / 2.44)


def test_goal_mouth_validation():
    with pytest.raises(ValueError, match="missing"):
        GoalMouth.from_points("g", {"post_left_bottom": (1, 1)})
    with pytest.raises(ValueError, match="above"):
        GoalMouth.from_points(
            "g",
            {
                "post_left_bottom": (70, 40),
                "post_right_bottom": (90, 40),
                "post_right_top": (90, 60),
                "post_left_top": (70, 60),
            },
        )


def test_pixels_to_percent_and_storage_round_trip(tmp_path):
    goals = [
        {
            "id": "goal_r",
            "side": "right",
            "points": [
                {"id": "post_left_bottom", "x": 700, "y": 300},
                {"id": "post_right_bottom", "x": 900, "y": 300},
                {"id": "post_right_top", "x": 900, "y": 200},
                {"id": "post_left_top", "x": 700, "y": 200},
            ],
        }
    ]
    mouths = goals_from_pixels(goals, 1000, 500)
    assert mouths[0].post_left_bottom == pytest.approx((70.0, 60.0))
    save_goal_landmarks(tmp_path, "match 1.mp4", mouths, 1000, 500)
    loaded = load_goal_mouths(tmp_path, "match 1.mp4")
    assert loaded[0].to_dict() == mouths[0].to_dict()
    assert load_goal_mouths(tmp_path, "other.mp4") == []


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------


def test_without_landmarks_goal_detection_falls_back_to_auto_mode():
    det = GoalDetector()
    assert det.enabled and det.mode == "auto"
    assert det.summary()["goal_detection_mode"] == "auto"
    assert det.summary()["goals_marked"] == 0
    # No goal detected by the model either: nothing to score against.
    assert run(det, approach() + [IN_NET] * 10) == []


def test_auto_mode_can_be_switched_off():
    det = GoalDetector(auto_mode=False)
    assert not det.enabled and det.mode == "off"
    assert run(det, with_goal(approach() + [IN_NET] * 10)) == []


def dribble(det, carrier, x0=28.0, samples=3):
    """Player dribbles the ball slowly (in control) before shooting."""
    for i in range(samples):
        det.update([ball(x0 + 0.5 * i, 55)], timestamp=i * DT, carrier=carrier)
    return samples * DT


def test_goal_confirmed_after_entry_and_dwell():
    det = GoalDetector([MOUTH])
    t0 = dribble(det, CARRIER_T1)
    events = run(det, approach() + [IN_NET] * 6, t0=t0)
    assert len(events) == 1
    goal = events[0]
    assert goal["team"] == 1 and goal["scorer"] == 9
    assert goal["goal_id"] == "goal_r" and goal["goal_side"] == "right"
    assert goal["confirmation"] == "dwell"
    assert goal["score"] == {"team_1": 1, "team_2": 0}
    json.dumps(det.summary())


def test_shot_flying_past_a_defender_keeps_the_shooter_as_scorer():
    """Nearest-player carrier flickers to a defender as the shot passes his feet."""
    det = GoalDetector([MOUTH])
    t0 = dribble(det, CARRIER_T1)
    defender = {"track_id": 4, "team_id": 2}
    # Fast shot (~100 % of the frame per second): passes the defender for 2 samples.
    shot = [[ball(x, 55.0)] for x in (40, 50, 60, 66)]
    events = []
    for i, dets in enumerate(shot + [IN_NET] * 6):
        carrier = defender if i in (1, 2) else None
        ev = det.update(dets, timestamp=t0 + i * DT, frame_index=i, carrier=carrier)
        if ev:
            events.append(ev)
    assert len(events) == 1
    assert events[0]["team"] == 1 and events[0]["scorer"] == 9


def test_ball_on_goal_line_in_front_is_not_a_goal():
    """Centre inside the mouth on screen, but its ground point is in front of the line."""
    det = GoalDetector([MOUTH])
    assert run(det, approach() + [[ball(80, 59.4)]] * 8) == []
    assert det.summary()["in_front_rejections"] == 1


def test_ball_close_to_camera_is_in_front_of_goal():
    """A ball far bigger than a ball at the goal would be is between camera and goal."""
    det = GoalDetector([MOUTH])
    assert run(det, approach() + [[ball(80, 52, h=6.0)]] * 8) == []
    assert det.summary()["in_front_rejections"] == 1


def test_ball_crossing_in_front_of_goal_is_not_a_goal():
    """Airborne ball passing in front of the mouth: inside on screen only briefly."""
    det = GoalDetector([MOUTH])
    frames = [[ball(x, 50.0)] for x in (55, 62, 68, 80, 95, 100)]
    assert run(det, frames) == []


def test_shot_over_the_bar_dropping_behind_goal_is_not_a_goal():
    det = GoalDetector([MOUTH])
    frames = [[ball(60, 30)], [ball(75, 34)], [ball(80, 37)], *[IN_NET] * 8]
    assert run(det, frames) == []
    assert det.summary()["over_bar"] == 1


def test_ball_in_roof_of_net_does_not_cancel_goal():
    det = GoalDetector([MOUTH])
    frames = approach() + [IN_NET, [ball(80, 39)], IN_NET, IN_NET, IN_NET]
    assert len(run(det, frames)) == 1


def test_keeper_holding_ball_in_front_of_line_is_a_save():
    det = GoalDetector([MOUTH])
    keeper = player(80, 64)  # feet in front of the goal line, ball in his box
    frames = approach() + [IN_NET] + [[ball(80, 55), keeper]] * 6
    assert run(det, frames) == []
    assert det.summary()["saves"] == 1


def test_keeper_lying_in_net_does_not_block_goal():
    det = GoalDetector([MOUTH])
    keeper = player(80, 58, height=8.0)  # feet behind the goal line (in the net)
    frames = approach() + [[ball(80, 55), keeper]] * 6
    assert len(run(det, frames)) == 1


def test_ball_hidden_in_net_confirms_goal():
    det = GoalDetector([MOUTH])
    frames = approach() + [IN_NET] * 2 + [[]] * 10
    events = run(det, frames, carrier=CARRIER_T1)
    assert len(events) == 1 and events[0]["confirmation"] == "hidden_in_net"


def test_ball_resting_in_net_from_start_is_ignored():
    det = GoalDetector([MOUTH])
    assert run(det, [IN_NET] * 10) == []


def test_cooldown_prevents_double_counting():
    det = GoalDetector([MOUTH])
    assert len(run(det, approach() + [IN_NET] * 40)) == 1


# Angled side-view goal (like a diagonal touchline camera): net extends to the right.
ANGLED_MOUTH = GoalMouth.from_points(
    "goal_angled",
    {
        "post_left_bottom": (69.1, 30.0),
        "post_right_bottom": (78.9, 35.1),
        "post_right_top": (81.5, 9.1),
        "post_left_top": (70.7, 9.1),
    },
    side="right",
    label="Angled right goal",
)


def test_angled_camera_ball_in_back_net_confirms_goal():
    """Ball crosses the 2D mouth in 0.2s and continues into the back net past the right post."""
    det = GoalDetector([ANGLED_MOUTH])
    frames = [
        [ball(54.5, 28.6, h=2.0)],
        [ball(60.3, 25.9, h=2.0)],
        [ball(66.0, 25.3, h=2.0)],
        # Brief crossing inside the front mouth quad
        [ball(71.6, 26.7, h=2.0)],
        [ball(76.5, 29.0, h=2.0)],
        # Back of net: past the right post (x > 81.5) but behind the goal line
        [ball(82.5, 27.5, h=2.0)],
        [ball(85.0, 25.5, h=2.0)],
        [ball(86.0, 23.0, h=2.0)],
    ]
    events = run(det, frames)
    assert len(events) == 1
    assert events[0]["confirmation"] == "dwell"


def test_angled_camera_rebound_back_to_field_cancels():
    """Ball enters the mouth briefly then rebounds back onto the field side."""
    det = GoalDetector([ANGLED_MOUTH])
    frames = [
        [ball(58.0, 28.0, h=2.0)],
        [ball(65.0, 28.0, h=2.0)],
        [ball(72.0, 28.0, h=2.0)],
        [ball(66.0, 32.0, h=2.0)],
        [ball(60.0, 34.0, h=2.0)],
        [ball(54.0, 36.0, h=2.0)],
    ]
    assert run(det, frames) == []


def test_shoe_false_positive_on_pitch_does_not_cancel_pending_goal():
    """A high-confidence shoe FP back on the pitch must not wipe a pending goal."""
    det = GoalDetector([ANGLED_MOUTH])
    p_midfield = player(58.5, 31.0, height=18.0)  # feet around (58.5, 31.0)
    shoe_fp = ball(58.9, 29.5, h=2.0, conf=0.55)
    frames = [
        [ball(54.5, 28.6, h=2.0), p_midfield],
        [ball(62.0, 27.0, h=2.0), p_midfield],
        [ball(71.6, 26.7, h=2.0), p_midfield],
        [ball(75.5, 28.5, h=2.0), p_midfield],
        # Ball disappears into net; YOLO hallucinates the player's white shoe
        *[[shoe_fp, p_midfield]] * 10,
    ]
    events = run(det, frames)
    assert len(events) == 1
    assert events[0]["confirmation"] == "hidden_in_net"


def test_ultra_low_confidence_ball_ignored_by_goal_detector():
    """5% confidence hallucinations should not open or cancel a goal."""
    det = GoalDetector([MOUTH])
    frames = approach() + [[ball(80, 55, conf=0.05)]] * 10
    assert run(det, frames) == []


def test_goal_roi_motion_rescues_ball_when_yolo_misses():
    """Static-camera motion tracker tracks a moving ball into the net without YOLO ball boxes."""
    import cv2

    h, w = 360, 640
    bg = np.full((h, w, 3), (60, 120, 60), dtype=np.uint8)
    det = GoalDetector([ANGLED_MOUTH])

    # Warm up background on 4 quiet frames while ball approaches via YOLO.
    events = []
    for i, bx in enumerate((50.0, 56.0, 61.0, 66.0)):
        ev = det.update(
            [ball(bx, 28.0, h=2.0)], timestamp=i * DT, frame_index=i, frame_bgr=bg
        )
        if ev:
            events.append(ev)

    # Now YOLO returns NO ball boxes, while a white ball moves through the mouth into the net.
    path = [
        (71.5, 26.5),
        (74.5, 28.0),
        (77.5, 29.0),
        (81.5, 27.5),
        (84.5, 25.5),
        (86.0, 23.0),
    ]
    for j, (bx, by) in enumerate(path):
        fr = bg.copy()
        cv2.circle(
            fr, (round(bx / 100 * w), round(by / 100 * h)), 5, (240, 240, 240), -1
        )
        ev = det.update([], timestamp=(4 + j) * DT, frame_index=4 + j, frame_bgr=fr)
        if ev:
            events.append(ev)
    assert len(events) == 1
    assert events[0]["confirmation"] == "dwell"


def test_tracker_uses_goal_landmarks():
    tracker = TeamPossessionTracker(goal_mouths=[MOUTH])
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    frame[:] = (40, 130, 50)
    goals = []
    for i, dets in enumerate(approach() + [IN_NET] * 6):
        state = tracker.process_frame(frame, [dict(d) for d in dets], timestamp=i * DT)
        assert state["goals_enabled"] is True
        if state["goal_event"]:
            goals.append(state["goal_event"])
    assert len(goals) == 1
    assert tracker.get_summary()["goals"]["total_goals"] == 1


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

GOAL_PAYLOAD = {
    "video_filename": "landmark_match.mp4",
    "image_width": 1000,
    "image_height": 500,
    "goals": [
        {
            "id": "goal_r",
            "side": "right",
            "label": "Right goal",
            "points": [
                {"id": "post_left_bottom", "x": 700, "y": 300},
                {"id": "post_right_bottom", "x": 900, "y": 300},
                {"id": "post_right_top", "x": 900, "y": 200},
                {"id": "post_left_top", "x": 700, "y": 200},
            ],
        }
    ],
}


@pytest.fixture(autouse=True)
def _clear_sessions():
    tp.clear_all_sessions()
    yield
    tp.clear_all_sessions()


def test_goal_landmarks_endpoints(client):
    assert client.get("/api/goal-landmarks/points").json()["points"][0]["id"] == (
        "post_left_bottom"
    )
    assert (
        client.get(
            "/api/goal-landmarks", params={"video_filename": "landmark_match.mp4"}
        ).status_code
        == 404
    )
    res = client.post("/api/goal-landmarks", json=GOAL_PAYLOAD)
    assert res.status_code == 200
    assert res.json()["goals"][0]["points"]["post_left_bottom"] == [70.0, 60.0]

    got = client.get(
        "/api/goal-landmarks", params={"video_filename": "landmark_match.mp4"}
    )
    assert got.status_code == 200 and got.json()["goals"][0]["side"] == "right"

    deleted = client.delete(
        "/api/goal-landmarks", params={"video_filename": "landmark_match.mp4"}
    )
    assert deleted.json()["deleted"] is True


def test_goal_landmarks_rejects_bad_points(client):
    bad = json.loads(json.dumps(GOAL_PAYLOAD))
    bad["goals"][0]["points"] = bad["goals"][0]["points"][:3]
    res = client.post("/api/goal-landmarks", json=bad)
    assert res.status_code == 422
    assert "missing" in res.json()["detail"]


def test_analyze_frame_loads_goal_landmarks_for_session(client, sample_base64_image):
    client.post("/api/goal-landmarks", json=GOAL_PAYLOAD)
    payload = {
        "image": sample_base64_image,
        "session_id": "goal-sess",
        "video_filename": "landmark_match.mp4",
    }
    res = client.post("/api/analyze-frame", json=payload).json()
    assert res["possession"]["goals_enabled"] is True
    tracker = tp.get_or_create_session_tracker("goal-sess")
    assert tracker.goal_source_video == "landmark_match.mp4"

    assert res["possession"]["goal_detection_mode"] == "landmarks"
    assert res["possession"]["goals_marked"] == 1

    # Without landmarks for the video, goals are still detected automatically.
    res = client.post(
        "/api/analyze-frame",
        json={**payload, "session_id": "other", "video_filename": "nothing.mp4"},
    ).json()
    assert res["possession"]["goals_enabled"] is True
    assert res["possession"]["goal_detection_mode"] == "auto"
    assert res["possession"]["goals_marked"] == 0


def test_background_job_reports_marked_goals(client):
    client.post(
        "/api/goal-landmarks",
        json={**GOAL_PAYLOAD, "video_filename": "football_match_demo.mp4"},
    )
    res = client.post(
        "/api/background-annotate",
        data={"video_filename": "football_match_demo.mp4", "burn_boxes": "false"},
    )
    assert res.status_code == 200
    assert res.json()["goals_marked"] == 1
    assert main.calibrations_dir().exists()


# ---------------------------------------------------------------------------
# Automatic mode: goal mouths from YOLO "football goal" boxes (no landmarks)
# ---------------------------------------------------------------------------


def test_mouth_from_detection_box_margins():
    m = GoalMouth.from_detection_box("g", (70.0, 38.3, 20.0, 21.7))
    assert m.is_auto
    assert m.post_left_bottom == pytest.approx((71.2, 60.0))
    assert m.post_right_top == pytest.approx((88.8, 38.3 + 0.08 * 21.7))
    assert m.extra["box"] == [70.0, 38.3, 20.0, 21.7]


def test_auto_goal_confirmed_after_entry_and_dwell():
    det = GoalDetector()
    t0 = dribble(det, CARRIER_T1)
    events = run(det, with_goal(approach() + [IN_NET] * 6), t0=t0)
    assert len(events) == 1
    goal = events[0]
    assert goal["detection_mode"] == "auto"
    assert goal["team"] == 1 and goal["scorer"] == 9
    assert goal["goal_box"] == [70.0, 38.3, 20.0, 21.7]
    assert goal["goal_side"] is None and goal["screen_side"] == "right"
    assert goal["goal_id"].startswith("auto_goal_")


def test_auto_goal_box_below_confidence_is_ignored():
    det = GoalDetector()
    assert run(det, with_goal(approach() + [IN_NET] * 8, conf=0.2)) == []


def test_auto_goal_follows_camera_pan():
    """Goal box and ball drift left together (pan): one candidate, one goal."""
    det = GoalDetector()
    frames = []
    for i, f in enumerate(approach() + [IN_NET] * 6):
        dx = -1.5 * i
        moved = [{**b, "x": b["x"] + dx} for b in f]
        frames.append([*moved, goal_box(dx=dx)])
    events = run(det, frames)
    assert len(events) == 1
    assert events[0]["goal_id"] == "auto_goal_1"  # same tracked goal throughout


def test_auto_goal_survives_a_missed_goal_box():
    det = GoalDetector()
    frames = with_goal(approach() + [IN_NET] * 2)
    frames += [IN_NET]  # model missed the goal box for one frame
    frames += with_goal([IN_NET] * 3)
    assert len(run(det, frames)) == 1


def test_auto_shot_over_the_bar_is_not_a_goal():
    det = GoalDetector()
    frames = [[ball(60, 30)], [ball(75, 34)], [ball(80, 37)], *[IN_NET] * 8]
    assert run(det, with_goal(frames)) == []
    assert det.summary()["over_bar"] == 1


def test_auto_ball_resting_in_goal_from_start_is_ignored():
    det = GoalDetector()
    assert run(det, with_goal([IN_NET] * 10)) == []


def test_auto_keeper_holding_ball_in_goal_is_a_save():
    det = GoalDetector()
    keeper = {**player(80, 58, height=8.0), "class": "player with ball"}
    frames = approach() + [IN_NET] + [[ball(80, 55), keeper]] * 6
    assert run(det, with_goal(frames)) == []
    assert det.summary()["saves"] == 1


def test_auto_ball_crossing_in_front_of_goal_is_not_a_goal():
    det = GoalDetector()
    frames = [[ball(x, 50.0)] for x in (55, 62, 68, 80, 95, 100)]
    assert run(det, with_goal(frames)) == []


def test_auto_ball_in_front_of_goal_line_is_not_a_goal():
    det = GoalDetector()
    assert run(det, with_goal(approach() + [[ball(80, 59.4)]] * 8)) == []


def test_landmarks_take_priority_over_detected_goal_boxes():
    det = GoalDetector([MOUTH])
    assert det.mode == "landmarks"
    # A model goal box elsewhere on screen is ignored...
    elsewhere = [[ball(x, 55.0)] for x in (40, 30, 22)] + [[ball(10, 55.0)]] * 8
    assert run(det, with_goal(elsewhere, x=2.0)) == []
    # ...while the marked goal still scores (even with that box present).
    det2 = GoalDetector([MOUTH])
    events = run(det2, with_goal(approach() + [IN_NET] * 6, x=2.0))
    assert len(events) == 1
    assert events[0]["goal_id"] == "goal_r"
    assert events[0]["detection_mode"] == "landmarks"


def test_motion_rescue_only_for_a_stationary_auto_goal():
    det = GoalDetector()
    assert not det.roi_step_useful()
    for i in range(3):  # moving camera: box shifts each sample
        det.update([goal_box(dx=-2.0 * i)], timestamp=i * DT)
    assert not det.roi_step_useful()
    for i in range(3, 10):  # camera stops: same box
        det.update([goal_box(dx=-4.0)], timestamp=i * DT)
    assert det.roi_step_useful()
    assert det._roi_mouths()[0].is_auto
    # Landmarks: always.
    assert GoalDetector([MOUTH]).roi_step_useful()


def test_roi_only_samples_do_not_retrack_stale_goal_boxes():
    det = GoalDetector()
    for i in range(3):
        det.update([goal_box()], timestamp=i * DT)
    stationary = det._auto_tracks[0]["stationary"]
    det.update([goal_box()], timestamp=0.35, roi_only=True)
    assert det._auto_tracks[0]["stationary"] == stationary


def test_tracker_state_reports_auto_mode():
    tracker = TeamPossessionTracker()
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    frame[:] = (40, 130, 50)
    goals = []
    for i, dets in enumerate(with_goal(approach() + [IN_NET] * 6)):
        state = tracker.process_frame(frame, [dict(d) for d in dets], timestamp=i * DT)
        assert state["goals_enabled"] is True
        assert state["goal_detection_mode"] == "auto"
        assert state["goals_marked"] == 0
        if state["goal_event"]:
            goals.append(state["goal_event"])
    assert len(goals) == 1
    summary = tracker.get_summary()["goals"]
    assert summary["goal_detection_mode"] == "auto" and summary["total_goals"] == 1


def test_match_analytics_infers_side_from_auto_goal_box():
    from app.services.match_analytics import MatchAnalytics
    from tests.test_pitch_analytics import _mapper

    a = MatchAnalytics(_mapper())
    event = {
        "type": "goal",
        "goal_side": None,
        "goal_box": [70.0, 38.3, 20.0, 21.7],
        "detection_mode": "auto",
        "team": 1,
        "scorer": 9,
    }
    applied = a._apply_goal(event, 5.0, None)
    assert applied["goal_side"] == "right"
    assert applied["detection_mode"] == "auto"
    assert a.summary()["score"]["team_1"] + a.summary()["score"]["team_2"] == 1


def test_auto_ignores_close_up_goal_boxes():
    """Replay / close-up angle: the goal fills most of the screen height."""
    det = GoalDetector()
    frames = with_goal(approach() + [IN_NET] * 8, x=40.0, y=1.0, w=50.0, h=96.0)
    assert run(det, frames) == []
    assert det.display_mouths() == []
