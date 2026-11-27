"""Pitch homography, tiled inference and match analytics on synthetic data (no video)."""

import itertools
import json

import numpy as np
import pytest

from app.services.match_analytics import MatchAnalytics
from app.services.pitch_homography import (
    PitchMapper,
    build_mapper_from_landmarks,
    landmark_definitions,
    load_calibration,
    save_calibration,
)
from app.services.tiled_inference import tile_windows

IMG_W, IMG_H = 1050, 680  # 10 px per metre, identity-like camera


def _scale_points(ids, sx=10.0, sy=10.0, ox=0.0, oy=0.0):
    defs = {d["id"]: d for d in landmark_definitions()}
    return [
        {"id": i, "x": defs[i]["x"] * sx + ox, "y": defs[i]["y"] * sy + oy} for i in ids
    ]


FOUR = ["corner_tl", "corner_tr", "corner_bl", "corner_br"]
EIGHT = [*FOUR, "center_spot", "left_penalty_spot", "right_penalty_spot", "half_top"]


# ---------------------------------------------------------------------------
# Homography
# ---------------------------------------------------------------------------


def test_landmark_definitions_are_unique_and_inside_pitch():
    defs = landmark_definitions()
    ids = [d["id"] for d in defs]
    assert len(ids) == len(set(ids))
    for d in defs:
        assert 0 <= d["x"] <= 105 and 0 <= d["y"] <= 68


def test_four_point_homography_round_trip():
    m = build_mapper_from_landmarks(_scale_points(FOUR), IMG_W, IMG_H)
    assert m.use_tps is False
    pitch = m.image_to_pitch([[525, 340], [100, 50]])
    np.testing.assert_allclose(pitch, [[52.5, 34.0], [10.0, 5.0]], atol=1e-6)
    back = m.pitch_to_image(pitch)
    np.testing.assert_allclose(back, [[525, 340], [100, 50]], atol=1e-6)


def test_perspective_homography_recovers_pitch_points():
    # A real perspective warp: pitch -> image through a known H.
    H = np.array([[8.0, 2.0, 100.0], [0.0, 6.0, 80.0], [0.0, 0.002, 1.0]])
    defs = {d["id"]: d for d in landmark_definitions()}
    pts = []
    for i in EIGHT:
        p = H @ np.array([defs[i]["x"], defs[i]["y"], 1.0])
        pts.append({"id": i, "x": p[0] / p[2], "y": p[1] / p[2]})
    m = build_mapper_from_landmarks(pts, 2000, 900)
    probe = H @ np.array([30.0, 20.0, 1.0])
    xy = m.image_to_pitch([[probe[0] / probe[2], probe[1] / probe[2]]])[0]
    np.testing.assert_allclose(xy, [30.0, 20.0], atol=0.05)
    assert m.quality()["homography_rmse_m"] < 0.01


def test_tps_corrects_curved_panorama():
    # Barrel-like bend that a single homography cannot model.
    def warp(x, y):
        u = x * 10.0
        v = y * 10.0 + 0.012 * (x - 52.5) ** 2 * 10.0
        return u, v

    defs = landmark_definitions()
    pts = [
        {"id": d["id"], "x": warp(d["x"], d["y"])[0], "y": warp(d["x"], d["y"])[1]}
        for d in defs
    ]
    m = build_mapper_from_landmarks(pts, IMG_W, 900)
    assert m.use_tps is True
    q = m.quality()
    assert q["homography_rmse_m"] > 1.0  # plain homography is off...
    u, v = warp(30.0, 50.0)
    xy = m.image_to_pitch([[u, v]])[0]
    assert np.linalg.norm(xy - [30.0, 50.0]) < 0.5  # ...the TPS correction is not
    img = m.pitch_to_image([[30.0, 50.0]])[0]
    assert np.linalg.norm(img - [u, v]) < 5.0


def test_collinear_and_too_few_landmarks_rejected():
    with pytest.raises(ValueError):
        build_mapper_from_landmarks(_scale_points(FOUR[:3]), IMG_W, IMG_H)
    with pytest.raises(ValueError):  # duplicate landmark
        build_mapper_from_landmarks(_scale_points([*FOUR, "corner_tl"]), IMG_W, IMG_H)
    with pytest.raises(ValueError):  # all on the far touchline
        build_mapper_from_landmarks(
            [
                {"id": "corner_tl", "x": 0, "y": 0},
                {"id": "half_top", "x": 525, "y": 0},
                {"id": "corner_tr", "x": 1050, "y": 0},
                {"id": "custom", "x": 300, "y": 0.1, "pitch_x": 30, "pitch_y": 0.0},
            ],
            IMG_W,
            IMG_H,
        )


def test_calibration_save_load_and_scale(tmp_path):
    m = build_mapper_from_landmarks(_scale_points(EIGHT), IMG_W, IMG_H)
    save_calibration(tmp_path, "match video.mp4", m)
    loaded = load_calibration(tmp_path, "match video.mp4")
    assert loaded is not None
    np.testing.assert_allclose(
        loaded.image_to_pitch([[400, 300]]), m.image_to_pitch([[400, 300]]), atol=1e-6
    )
    half = loaded.scaled_to(IMG_W // 2, IMG_H // 2)
    np.testing.assert_allclose(
        half.image_to_pitch([[200, 150]]), [[40.0, 30.0]], atol=0.05
    )
    assert m.overlay_lines_pct()  # projected pitch markings for the UI preview


# ---------------------------------------------------------------------------
# Tiled inference
# ---------------------------------------------------------------------------


def test_tile_windows_cover_wide_frame_with_overlap():
    wins = tile_windows(4096, 1080)
    assert len(wins) >= 4
    assert wins[0][0] == 0 and wins[-1][1] == 4096
    for (a0, a1), (b0, _b1) in itertools.pairwise(wins):
        assert b0 < a1  # overlapping
    assert tile_windows(1280, 720) == [(0, 1280)]


# ---------------------------------------------------------------------------
# Match analytics (synthetic detections, pitch == image / 10)
# ---------------------------------------------------------------------------


def _mapper():
    return PitchMapper(
        [[0, 0], [1050, 0], [0, 680], [1050, 680]],
        [[0, 0], [105, 0], [0, 68], [105, 68]],
        (IMG_W, IMG_H),
    )


def _player(track, team, x_m, y_m, cls="player"):
    # Box 1 m wide, 2 m tall; feet at (x_m, y_m).
    return {
        "class": cls,
        "confidence": 0.9,
        "track_id": track,
        "team_id": team,
        "x": (x_m - 0.5) * 10 / IMG_W * 100,
        "y": (y_m - 2.0) * 10 / IMG_H * 100,
        "w": 10 / IMG_W * 100,
        "h": 20 / IMG_H * 100,
    }


def _ball(x_m, y_m):
    return {
        "class": "football",
        "confidence": 0.8,
        "x": (x_m - 0.15) * 10 / IMG_W * 100,
        "y": (y_m - 0.3) * 10 / IMG_H * 100,
        "w": 3 / IMG_W * 100,
        "h": 3 / IMG_H * 100,
    }


def _run(a, frames, dt=0.2):
    out = []
    for i, dets in enumerate(frames):
        out.append(a.process(dets, i * dt, i, IMG_W, IMG_H))
    return out


BASE = [
    _player(1, 1, 30, 30),
    _player(2, 1, 45, 40),
    _player(3, 1, 20, 20),
    _player(11, 2, 70, 30),
    _player(12, 2, 80, 40),
    _player(13, 2, 90, 34),
]


def _frame(ball, moves=None):
    moves = moves or {}
    dets = []
    for d in BASE:
        tid = d["track_id"]
        if tid in moves:
            dets.append(_player(tid, d["team_id"], *moves[tid]))
        else:
            dets.append(dict(d))
    if ball is not None:
        dets.append(_ball(*ball))
    return dets


def test_completed_pass_and_possession(tmp_path):
    a = MatchAnalytics(_mapper(), log_dir=tmp_path)
    frames = [_frame((30.5, 30)) for _ in range(5)]  # #1 holds
    frames += [_frame((37, 35)), _frame((42, 38))]  # ball travelling
    frames += [_frame((45.3, 40)) for _ in range(5)]  # #2 receives
    _run(a, frames)
    s = a.summary(min_player_samples=1)
    passes = [e for e in s["events"] if e["type"] == "pass"]
    assert len(passes) == 1
    assert passes[0]["from_player"] == 1 and passes[0]["to_player"] == 2
    assert passes[0]["distance_m"] > 10
    assert s["teams"]["team_1"]["passes_completed"] == 1
    assert s["teams"]["team_1"]["pass_accuracy"] == 100.0
    assert s["possession_percent"]["team_1"] == 100.0
    assert s["pass_network"] == [{"from": 1, "to": 2, "count": 1}]
    a.close()
    players_csv = (tmp_path / "players_log.csv").read_text().splitlines()
    ball_csv = (tmp_path / "ball_log.csv").read_text().splitlines()
    assert players_csv[0].startswith("timestamp,frame,track_id")
    assert len(players_csv) == 1 + 6 * len(frames)
    assert len(ball_csv) == 1 + len(frames)


def test_interception_vs_tackle():
    a = MatchAnalytics(_mapper())
    frames = [_frame((30.5, 30)) for _ in range(4)]
    frames += [_frame((x, 30)) for x in range(35, 66, 5)]  # ~25 m/s through the air
    frames += [_frame((69.7, 30)) for _ in range(4)]  # team 2 #11 intercepts
    _run(a, frames)
    s = a.summary()
    assert s["event_counts"].get("interception") == 1
    assert s["teams"]["team_2"]["interceptions"] == 1
    assert s["teams"]["team_1"]["turnovers"] == 1
    assert s["teams"]["team_1"]["passes_attempted"] == 1
    assert s["teams"]["team_1"]["pass_accuracy"] == 0.0

    b = MatchAnalytics(_mapper())
    close = [_frame((30.5, 30)) for _ in range(4)]
    close += [_frame((31.5, 30), moves={11: (32.0, 30)}) for _ in range(4)]
    _run(b, close)
    assert b.summary()["event_counts"].get("tackle") == 1


def test_carrier_flicker_and_short_reid_are_not_passes():
    a = MatchAnalytics(_mapper())
    frames = [_frame((30.5, 30)) for _ in range(4)]
    # Single-sample flicker to #2's vicinity then back: not confirmed.
    frames += [_frame((45.2, 40))]
    frames += [_frame((30.5, 30)) for _ in range(4)]
    _run(a, frames)
    assert a.summary()["event_counts"].get("pass") is None


def _run_with_goal(a, frames, goal_at, goal_event, dt=0.2):
    """Like ``_run`` but passes the landmark goal event on sample ``goal_at``."""
    for i, dets in enumerate(frames):
        a.process(
            dets,
            i * dt,
            i,
            IMG_W,
            IMG_H,
            goal_event=goal_event if i == goal_at else None,
        )


LANDMARK_GOAL = {"type": "goal", "goal_side": "right", "goal_id": "goal_r", "team": 1}


def test_landmark_goal_credited_to_attacking_team():
    a = MatchAnalytics(_mapper())
    # Team 1 lives on the left (mean x ~32), team 2 on the right (~80) -> team 2
    # defends the right goal. #2 (team 1) dribbles in and shoots into the right goal;
    # the goal-landmark detector confirms it once the ball is in the net.
    frames = [_frame((45.3, 40)) for _ in range(6)]
    frames += [_frame((100.3, 34), moves={2: (100.0, 34)}) for _ in range(3)]
    frames += [_frame((106.0, 34.5), moves={2: (100.0, 34)}) for _ in range(3)]
    _run_with_goal(a, frames, goal_at=10, goal_event=LANDMARK_GOAL)
    s = a.summary()
    assert s["score"] == {"team_1": 1, "team_2": 0}
    goal = s["goals"][0]
    assert goal["scorer"] == 2 and goal["team"] == 1 and goal["own_goal"] is False
    assert goal["goal_side"] == "right" and goal["goal_id"] == "goal_r"
    # Ball still in the net afterwards: no goal kick, no second goal.
    _run(a, [_frame((106.0, 34.5))] * 3)
    s = a.summary()
    assert s["score"]["team_1"] == 1
    assert not [e for e in s["events"] if e["type"] == "out"]


def test_ball_in_net_without_landmark_goal_is_not_a_goal():
    """Goals come only from the goal landmarks; the homography alone never scores."""
    a = MatchAnalytics(_mapper())
    frames = [_frame((45.3, 40)) for _ in range(6)]
    frames += [_frame((106.0, 34.5), moves={2: (100.0, 34)}) for _ in range(5)]
    _run(a, frames)
    s = a.summary()
    assert s["score"] == {"team_1": 0, "team_2": 0}
    assert not [e for e in s["events"] if e["type"] == "out"]


def test_landmark_goal_own_goal():
    a = MatchAnalytics(_mapper())
    # #12 (team 2, defends the right goal) has the ball and it goes into the right goal.
    frames = [_frame((80.3, 40)) for _ in range(6)]
    frames += [_frame((106.0, 34.5)) for _ in range(2)]
    _run_with_goal(a, frames, goal_at=7, goal_event=LANDMARK_GOAL)
    goal = a.summary()["goals"][0]
    assert goal["own_goal"] is True
    assert goal["team"] == 1  # credited to the attacking team


def test_ball_wide_of_post_is_out_not_goal():
    a = MatchAnalytics(_mapper())
    frames = [_frame((45.3, 40)) for _ in range(6)]
    frames += [_frame((x, 50.0)) for x in (50, 56, 62, 68, 74, 80, 86, 92, 98, 103)]
    frames += [_frame((106.0, 50.0)) for _ in range(3)]  # behind goal line, wide
    _run(a, frames)
    s = a.summary()
    assert s["score"] == {"team_1": 0, "team_2": 0}
    outs = [e for e in s["events"] if e["type"] == "out"]
    assert outs and outs[0]["restart"] == "goal_kick"
    assert s["ball"]["in_play"] is False


def test_off_pitch_people_ignored_and_stats_shape():
    a = MatchAnalytics(_mapper())
    bench = _player(99, 1, 50, 80)  # 12 m outside the near touchline
    _run(a, [[*_frame((30.5, 30)), bench] for _ in range(6)])
    s = a.summary(min_player_samples=1)
    assert 99 not in {p["track_id"] for p in s["players"]}
    json.dumps(s)  # JSON-serialisable
    assert set(s["teams"]["team_1"]) >= {
        "possession_percent",
        "passes_completed",
        "pass_accuracy",
        "goals",
        "distance_km",
        "shape",
    }


def test_tactical_heatmaps_per_team_phase_ball_and_player():
    a = MatchAnalytics(_mapper())
    # Team 1 (#1) keeps the ball at (30.5, 30) for the whole clip.
    _run(a, [_frame((30.5, 30)) for _ in range(12)])
    h = a.heatmaps_payload(min_player_samples=1)
    assert h["cell_m"] == 2.0 and h["nx"] == 53 and h["ny"] == 34
    t1, t2 = h["teams"]["team_1"], h["teams"]["team_2"]
    assert np.array(t1["all"]).shape == (34, 53)
    # 3 team-1 players x 12 samples on the pitch.
    assert np.array(t1["all"]).sum() == 36
    # Possession is only known after the first confirmed control, then every
    # team-1 sample is "in possession" and every team-2 sample "out of possession".
    assert np.array(t1["in_possession"]).sum() > 0
    assert np.array(t1["out_of_possession"]).sum() == 0
    assert np.array(t2["out_of_possession"]).sum() > 0
    assert np.array(t2["in_possession"]).sum() == 0
    assert np.array(h["ball"]).sum() == 12
    # Player #1 stands still at (30, 30): one cell (on the 2 m grid boundary) x 12.
    p1 = h["players"]["1"]
    assert p1["team"] == 1 and len(p1["cells"]) == 1
    bx, by, count = p1["cells"][0]
    assert count == 12 and abs(bx - 15) <= 1 and abs(by - 15) <= 1
    assert np.array(t1["all"])[by, bx] == 12
    shape = h["shape"]["team_1"] is None  # only 3 team-1 players (< 4)
    assert shape
    json.dumps(h)


def test_team_shape_metrics():
    a = MatchAnalytics(_mapper())
    extra = [_player(4, 1, 10, 34), _player(14, 2, 100, 34)]
    _run(a, [[*_frame((30.5, 30)), *extra] for _ in range(8)])
    s = a.summary()["teams"]
    shape1 = s["team_1"]["shape"]
    # Team 1 x: 10, 20, 30, 45 -> drop extremes -> depth 10, width 34-20 = 20.
    assert shape1["avg_depth_m"] == 10.0
    assert shape1["avg_width_m"] == 20.0
    # Team 1 sits left, so it defends the left goal: line height = 2nd-lowest x.
    assert shape1["defending_side"] == "left"
    assert shape1["attacking_direction"] == "right"
    assert shape1["defensive_line_height_m"] == 20.0
    shape2 = s["team_2"]["shape"]
    assert shape2["defending_side"] == "right"
    assert shape2["defensive_line_height_m"] == round(105 - 90.0, 1)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def test_calibration_api_flow(client, temp_uploads_dir, sample_video_path):
    target = temp_uploads_dir / "clip.mp4"
    target.write_bytes(sample_video_path.read_bytes())

    lm = client.get("/api/pitch/landmarks").json()
    assert lm["min_points"] == 4 and len(lm["landmarks"]) > 20

    frame = client.get(
        "/api/video-frame", params={"video_filename": "clip.mp4", "t": 0.5}
    )
    if frame.status_code == 200:  # codec availability differs on CI
        assert frame.headers["content-type"] == "image/jpeg"
        assert frame.headers["x-video-width"] == "160"

    assert (
        client.get("/api/homography", params={"video_filename": "clip.mp4"}).status_code
        == 404
    )

    pts = [
        {"id": p["id"], "x": p["x"] / 105 * 160, "y": p["y"] / 68 * 120}
        for p in _scale_points(EIGHT, 1, 1)
    ]
    res = client.post(
        "/api/homography",
        json={
            "video_filename": "clip.mp4",
            "image_width": 160,
            "image_height": 120,
            "points": pts,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["saved"] is True and body["overlay_lines"]
    assert body["quality"]["model"] == "homography+tps"

    got = client.get("/api/homography", params={"video_filename": "clip.mp4"})
    assert got.status_code == 200

    bad = client.post(
        "/api/homography",
        json={
            "video_filename": "clip.mp4",
            "image_width": 160,
            "image_height": 120,
            "points": pts[:3],
        },
    )
    assert bad.status_code == 422


def test_worker_writes_match_logs_with_fake_detector(tmp_path, sample_video_path):
    """Worker on the generated 160x120 fixture clip with a fake detector + calibration."""
    from app.services import video_annotator as va

    mapper = PitchMapper(
        [[0, 0], [160, 0], [0, 120], [160, 120]],
        [[0, 0], [105, 0], [0, 68], [105, 68]],
        (160, 120),
    )

    def fake_detect(frame):
        dets = [
            {"class": "player", "confidence": 0.9, "x": 20, "y": 30, "w": 5, "h": 15},
            {"class": "player", "confidence": 0.9, "x": 70, "y": 40, "w": 5, "h": 15},
            {"class": "football", "confidence": 0.8, "x": 21, "y": 44, "w": 2, "h": 2},
        ]
        return {"detections": dets, "class_counts": {"player": 2, "football": 1}}

    job_id = "job_test_logs"
    va.JOBS[job_id] = {"job_id": job_id, "chunks": [], "status": "processing"}
    va.run_chunked_annotation_worker(
        job_id=job_id,
        video_source_path=sample_video_path,
        output_dir=tmp_path,
        chunk_duration_sec=1.0,
        confidence_threshold=0.25,
        class_confidences={"player": 0.25},
        burn_boxes=True,
        parse_detections_fn=None,
        model_obj=None,
        infer_fps=5.0,
        detect_fn=fake_detect,
        pitch_mapper=mapper,
    )
    job = va.JOBS.pop(job_id)
    if job["status"] == "failed" and "open input video" in (job.get("error") or ""):
        pytest.skip("No video codec available to read the fixture clip")
    assert job["status"] == "completed", job.get("error")
    assert job["calibrated"] is True and job["match_stats"]["calibrated"] is True
    for name in (
        "players_log.csv",
        "ball_log.csv",
        "events.json",
        "match_stats.json",
        "heatmaps.json",
    ):
        assert (tmp_path / name).exists(), name
    assert len((tmp_path / "players_log.csv").read_text().splitlines()) > 1


def test_background_annotate_requires_calibration(
    client, temp_uploads_dir, sample_video_path
):
    (temp_uploads_dir / "nocal.mp4").write_bytes(sample_video_path.read_bytes())
    res = client.post(
        "/api/background-annotate",
        data={"video_filename": "nocal.mp4", "require_calibration": "true"},
    )
    assert res.status_code == 409
