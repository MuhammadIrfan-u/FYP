"""Tests for jersey-colour team clustering, tracking and the possession state machine."""

import io

import cv2
import numpy as np
import pytest

from app import main
from app.services import team_possession as tp
from app.services.team_possession import (
    TeamPossessionTracker,
    bgr_to_lab,
    cluster_two_teams_from_colors,
    estimate_pitch_profile,
    extract_player_jersey_color,
    get_or_create_session_tracker,
    kmeans_lab,
    lab_distance,
)
from tests.conftest import MockBox, MockYOLOResult

FRAME_W, FRAME_H = 640, 360

SAGE_TURF = (140, 175, 156)  # BGR, desaturated sage / futsal green
GRASS_TURF = (40, 130, 50)  # BGR, saturated grass
GREEN_KIT = (40, 165, 30)
RED_KIT = (40, 40, 200)
BLUE_KIT = (200, 70, 30)
WHITE_KIT = (235, 235, 235)
YELLOW_GK = (20, 220, 235)

# Player box positions (x, y, w, h in percent of frame).
POS_A = (10.0, 10.0, 6.0, 22.0)
POS_B = (30.0, 12.0, 6.0, 22.0)
POS_C = (55.0, 10.0, 6.0, 22.0)
POS_D = (75.0, 12.0, 6.0, 22.0)


def make_frame(turf_bgr, players):
    """Draw a synthetic frame: uniform turf + simple player figures.

    ``players`` is a list of ``(box_pct, kit_bgr)``. Each figure fills the central
    40% width of its box with the kit over the torso, leaving turf at the box edges so
    the torso crop contains turf pixels that must be masked out.
    """
    frame = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
    frame[:] = turf_bgr
    for (x, y, w, h), kit in players:
        x1 = int(x / 100 * FRAME_W)
        y1 = int(y / 100 * FRAME_H)
        bw = int(w / 100 * FRAME_W)
        bh = int(h / 100 * FRAME_H)
        body_x1, body_x2 = x1 + int(bw * 0.30), x1 + int(bw * 0.70)
        frame[y1 : y1 + int(bh * 0.15), body_x1:body_x2] = (120, 160, 210)  # head
        frame[y1 + int(bh * 0.15) : y1 + int(bh * 0.55), body_x1:body_x2] = kit
        frame[y1 + int(bh * 0.55) : y1 + bh, body_x1:body_x2] = (25, 25, 25)  # shorts
    return frame


def det(box, cls="player", conf=0.9, det_id=None):
    x, y, w, h = box
    return {
        "id": det_id or f"d-{x}-{y}",
        "class": cls,
        "label": cls.capitalize(),
        "confidence": conf,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
    }


def four_player_frame(carrier_pos=None):
    """Team red at A/B, team blue at C/D; ``carrier_pos`` is labelled player with ball."""
    players = [(POS_A, RED_KIT), (POS_B, RED_KIT), (POS_C, BLUE_KIT), (POS_D, BLUE_KIT)]
    frame = make_frame(GRASS_TURF, players)
    dets = [
        det(pos, cls="player with ball" if pos == carrier_pos else "player")
        for pos, _kit in players
    ]
    return frame, dets


def team_of_kit(state, kit_bgr):
    """Return the team id whose centroid is nearest to a kit colour."""
    kit_lab = bgr_to_lab(np.asarray(kit_bgr, dtype=np.uint8))[0]
    teams = state["teams"]
    return min(teams, key=lambda t: lab_distance(kit_lab, t["lab"]))["team_id"]


# ---------------------------------------------------------------------------
# Colour extraction
# ---------------------------------------------------------------------------


def test_green_kit_on_sage_turf_is_not_erased():
    frame = make_frame(SAGE_TURF, [(POS_A, GREEN_KIT)])
    player = det(POS_A)
    profile = estimate_pitch_profile(frame, [player])
    assert profile is not None

    color = extract_player_jersey_color(frame, player, profile)
    assert color is not None
    assert color["name"] == "Green"
    # Median colour should be the kit, not the turf.
    assert all(abs(a - b) <= 20 for a, b in zip(color["bgr"], GREEN_KIT, strict=True))
    # Turf at the box edges was masked out.
    assert 0.0 < color["pitch_masked_ratio"] < 0.9
    assert color["hex"].startswith("#") and len(color["hex"]) == 7


@pytest.mark.parametrize(
    ("kit", "expected"),
    [(WHITE_KIT, "White"), (RED_KIT, "Red"), (BLUE_KIT, "Blue")],
)
def test_kit_color_names_on_grass(kit, expected):
    frame = make_frame(GRASS_TURF, [(POS_A, kit)])
    player = det(POS_A)
    color = extract_player_jersey_color(
        frame, player, estimate_pitch_profile(frame, [player])
    )
    assert color["name"] == expected


def test_kit_matching_turf_falls_back_instead_of_empty():
    """A kit identical to the turf still yields a colour (most turf-distant pixels)."""
    frame = make_frame(GRASS_TURF, [(POS_A, GRASS_TURF)])
    player = det(POS_A)
    color = extract_player_jersey_color(
        frame, player, estimate_pitch_profile(frame, [player])
    )
    assert color is not None
    assert color["pixel_count"] > 0


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------


def _labs(*kits_with_counts):
    out = []
    rng = np.random.default_rng(0)
    for kit, n in kits_with_counts:
        base = bgr_to_lab(np.asarray(kit, dtype=np.uint8))[0]
        out.extend(base + rng.normal(0, 1.5, size=3) for _ in range(n))
    return np.asarray(out)


def test_kmeans_lab_is_deterministic():
    labs = _labs((RED_KIT, 5), (BLUE_KIT, 5))
    c1, l1 = kmeans_lab(labs, 2)
    c2, l2 = kmeans_lab(labs, 2)
    assert np.allclose(c1, c2)
    assert np.array_equal(l1, l2)


def test_goalkeeper_is_isolated_as_outlier():
    labs = _labs((RED_KIT, 5), (BLUE_KIT, 5), (YELLOW_GK, 1))
    result = cluster_two_teams_from_colors(labs)

    assert result["outlier_indices"] == [10]
    assert result["labels"][10] == -1
    # Remaining players split 5/5 into two teams.
    team_labels = result["labels"][:10]
    assert sorted(team_labels.count(t) for t in (0, 1)) == [5, 5]
    assert len(set(team_labels[:5])) == 1
    assert len(set(team_labels[5:])) == 1


def test_shadowed_kit_does_not_split_into_extra_team():
    """Same red kit in light and shadow should stay one team (chroma weighting)."""
    lit = _labs((RED_KIT, 4))
    shadow = lit.copy()
    shadow[:, 0] -= 18  # darker L*, same chroma
    labs = np.vstack([lit, shadow, _labs((BLUE_KIT, 4))])
    result = cluster_two_teams_from_colors(labs)

    assert result["outlier_indices"] == []
    red_labels = set(result["labels"][:8])
    blue_labels = set(result["labels"][8:])
    assert len(red_labels) == 1
    assert len(blue_labels) == 1
    assert red_labels != blue_labels


def test_team_identity_is_stable_across_frames():
    tracker = TeamPossessionTracker()
    frame, dets = four_player_frame(carrier_pos=POS_A)
    first = tracker.process_frame(frame, dets, 0.0)
    red_team = team_of_kit(first, RED_KIT)

    for i in range(1, 6):
        frame, dets = four_player_frame(carrier_pos=POS_A)
        state = tracker.process_frame(frame, dets, i * 0.1)
        assert team_of_kit(state, RED_KIT) == red_team
        red_dets = [d for d in dets if d["x"] in (POS_A[0], POS_B[0])]
        assert all(d["team_id"] == red_team for d in red_dets)


# ---------------------------------------------------------------------------
# Possession state machine
# ---------------------------------------------------------------------------


def test_same_team_pass_is_not_lost():
    tracker = TeamPossessionTracker()
    frame, dets = four_player_frame(carrier_pos=POS_A)
    s1 = tracker.process_frame(frame, dets, 0.0)
    assert s1["status"] == "holding"
    holder_id = s1["carrier"]["track_id"]

    frame, dets = four_player_frame(carrier_pos=POS_A)
    assert tracker.process_frame(frame, dets, 0.1)["status"] == "holding"

    frame, dets = four_player_frame(carrier_pos=POS_B)
    s3 = tracker.process_frame(frame, dets, 0.2)
    assert s3["status"] == "not_lost"
    assert s3["possession_lost"] is False
    assert s3["prev_player_id"] == holder_id
    assert s3["curr_player_id"] != holder_id
    assert s3["curr_team"] == s3["prev_team"]
    assert s3["total_passes"] == 1
    assert s3["total_losses"] == 0
    assert s3["event"]["status"] == "not_lost"


def test_interception_is_possession_lost():
    tracker = TeamPossessionTracker()
    frame, dets = four_player_frame(carrier_pos=POS_A)
    s1 = tracker.process_frame(frame, dets, 0.0)
    red_team = s1["carrier"]["team_id"]

    frame, dets = four_player_frame(carrier_pos=POS_C)
    s2 = tracker.process_frame(frame, dets, 0.1)
    assert s2["status"] == "lost"
    assert s2["possession_lost"] is True
    assert s2["prev_team"] == red_team
    assert s2["curr_team"] != red_team
    assert s2["total_losses"] == 1
    losing = next(t for t in s2["teams"] if t["team_id"] == red_team)
    assert losing["losses"] == 1
    assert s2["event"]["from_team"] == red_team


def test_gap_frames_preserve_previous_carrier():
    tracker = TeamPossessionTracker()
    frame, dets = four_player_frame(carrier_pos=POS_A)
    s1 = tracker.process_frame(frame, dets, 0.0)
    holder, team = s1["carrier"]["track_id"], s1["carrier"]["team_id"]

    for i in range(3):  # ball in flight: no "player with ball"
        frame, dets = four_player_frame(carrier_pos=None)
        gap = tracker.process_frame(frame, dets, 0.1 * (i + 1))
        assert gap["status"] == "in_transit"
        assert gap["carrier"] is None
        assert gap["curr_player_id"] == holder
        assert gap["curr_team"] == team

    frame, dets = four_player_frame(carrier_pos=POS_B)
    caught = tracker.process_frame(frame, dets, 0.5)
    assert caught["status"] == "not_lost"
    assert caught["prev_player_id"] == holder


def test_gap_then_opponent_catch_is_lost():
    tracker = TeamPossessionTracker()
    frame, dets = four_player_frame(carrier_pos=POS_A)
    tracker.process_frame(frame, dets, 0.0)
    frame, dets = four_player_frame(carrier_pos=None)
    tracker.process_frame(frame, dets, 0.1)
    frame, dets = four_player_frame(carrier_pos=POS_D)
    assert tracker.process_frame(frame, dets, 0.2)["status"] == "lost"


def test_possession_percent_and_summary():
    tracker = TeamPossessionTracker()
    for i, pos in enumerate([POS_A, POS_A, POS_A, POS_C]):
        frame, dets = four_player_frame(carrier_pos=pos)
        tracker.process_frame(frame, dets, i * 0.1)

    summary = tracker.get_summary()
    pct = summary["possession_percent"]
    assert pct["team_1"] + pct["team_2"] == pytest.approx(100.0)
    assert sorted([pct["team_1"], pct["team_2"]]) == [25.0, 75.0]
    assert summary["total_losses"] == 1
    assert len(summary["events"]) == 1
    assert summary["teams_ready"] is True
    assert {t["color_name"] for t in summary["teams"]} == {"Red", "Blue"}


def test_track_ids_persist_across_frames():
    tracker = TeamPossessionTracker()
    frame, dets1 = four_player_frame()
    tracker.process_frame(frame, dets1, 0.0)
    frame, dets2 = four_player_frame()
    tracker.process_frame(frame, dets2, 0.1)
    assert [d["track_id"] for d in dets1] == [d["track_id"] for d in dets2]
    assert len({d["track_id"] for d in dets1}) == 4


def test_multiple_carriers_tie_broken_by_ball_proximity():
    tracker = TeamPossessionTracker()
    frame, dets = four_player_frame()
    dets[0]["class"] = "player with ball"
    dets[2]["class"] = "player with ball"
    dets[0]["confidence"] = 0.99  # higher confidence but far from ball
    # Ball at the feet of the player at POS_C.
    ball = det((POS_C[0] + 2, POS_C[1] + POS_C[3] - 2, 2.0, 3.0), cls="football")
    state = tracker.process_frame(frame, [*dets, ball], 0.0)
    assert state["carrier"]["detection_id"] == dets[2]["id"]
    assert dets[2]["has_ball"] is True
    assert dets[0]["has_ball"] is False


# ---------------------------------------------------------------------------
# API integration
# ---------------------------------------------------------------------------


@pytest.fixture
def team_frame_model(configured_mock_model):
    """Mock model returning four players (two kits) with one carrier."""
    boxes = []
    for i, (x, y, w, h) in enumerate([POS_A, POS_B, POS_C, POS_D]):
        cls_id = 3 if i == 0 else 2
        boxes.append(
            MockBox(
                cls_id=cls_id,
                conf=0.9,
                xywhn=[(x + w / 2) / 100, (y + h / 2) / 100, w / 100, h / 100],
            )
        )
    configured_mock_model.return_value = [MockYOLOResult(boxes)]
    return configured_mock_model


@pytest.fixture
def team_frame_jpeg():
    frame, _ = four_player_frame()
    ok, encoded = cv2.imencode(".png", frame)
    assert ok
    return encoded.tobytes()


@pytest.fixture(autouse=True)
def _clear_sessions():
    tp.clear_all_sessions()
    yield
    tp.clear_all_sessions()


def test_analyze_frame_stateful_session(client, team_frame_model, team_frame_jpeg):
    import base64

    image = base64.b64encode(team_frame_jpeg).decode()
    payload = {"image": image, "session_id": "sess-1", "timestamp": 0.0}

    r1 = client.post("/api/analyze-frame", json=payload).json()
    assert r1["possession"]["frame_index"] == 1
    assert r1["possession"]["teams_ready"] is True
    assert r1["possession"]["carrier"] is not None
    players = [d for d in r1["detections"] if d["class"] in tp.PLAYER_CLASSES]
    assert all(d["team_id"] in (1, 2) for d in players)
    assert all(d["track_id"] is not None for d in players)
    assert sum(1 for d in players if d["has_ball"]) == 1

    r2 = client.post("/api/analyze-frame", json={**payload, "timestamp": 0.1}).json()
    assert r2["possession"]["frame_index"] == 2
    assert r2["possession"]["status"] == "holding"

    r3 = client.post(
        "/api/analyze-frame", json={**payload, "reset_session": True}
    ).json()
    assert r3["possession"]["frame_index"] == 1


def test_analyze_frame_multipart_session(client, team_frame_model, team_frame_jpeg):
    files = {"file": ("frame.png", io.BytesIO(team_frame_jpeg), "image/png")}
    data = {"session_id": "sess-mp", "timestamp": "1.5"}
    res = client.post("/api/analyze-frame", files=files, data=data).json()
    assert res["session_id"] == "sess-mp"
    assert res["possession"]["timestamp"] == 1.5


def test_analyze_frame_without_session_still_labels_teams(
    client, team_frame_model, team_frame_jpeg
):
    import base64

    image = base64.b64encode(team_frame_jpeg).decode()
    res = client.post("/api/analyze-frame", json={"image": image}).json()
    assert res["session_id"] is None
    assert res["possession"]["frame_index"] == 1


def test_possession_reset_endpoint(client, team_frame_model, team_frame_jpeg):
    tracker = get_or_create_session_tracker("sess-reset")
    frame, dets = four_player_frame(carrier_pos=POS_A)
    tracker.process_frame(frame, dets, 0.0)
    assert tracker.frame_index == 1

    res = client.post("/api/possession/reset", json={"session_id": "sess-reset"})
    assert res.status_code == 200
    assert res.json() == {"success": True, "session_id": "sess-reset", "existed": True}
    assert get_or_create_session_tracker("sess-reset").frame_index == 0

    res = client.post("/api/possession/reset", json={"session_id": "unknown"})
    assert res.json()["existed"] is False


def test_analyze_video_includes_possession(client, sample_video_path):
    with open(sample_video_path, "rb") as f:
        files = {"file": ("match.mp4", f, "video/mp4")}
        res = client.post("/api/analyze-video", files=files).json()

    assert res["sample_fps"] == 10.0
    assert "possession_summary" in res
    assert res["possession_summary"]["frames_processed"] == res["frames_analyzed"]
    for entry in res["timeline"].values():
        assert "possession" in entry
        assert entry["possession"]["status"] in (
            "idle",
            "holding",
            "not_lost",
            "lost",
            "in_transit",
        )


def test_background_annotate_accepts_infer_fps(client):
    payload = {
        "video_filename": "football_match_demo.mp4",
        "infer_fps": "15.0",
        "burn_boxes": "false",
    }
    res = client.post("/api/background-annotate", data=payload)
    assert res.status_code == 200
    assert res.json()["infer_fps"] == 15.0
    job = client.get(f"/api/background-jobs/{res.json()['job_id']}").json()
    assert "possession_summary" in job


def test_main_exposes_possession_helpers():
    assert main._parse_bool("true") is True
    assert main._parse_bool("0") is False
    assert main._parse_optional_float("") is None
    assert main._parse_optional_float("2.5") == 2.5
