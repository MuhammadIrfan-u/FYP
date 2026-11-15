import base64

import cv2
import numpy as np

from app.services.team_possession import TeamPossessionTracker, extract_player_jersey_color
from tests.conftest import MockBox, MockYOLOResult


def _make_pitch_frame(
    players: list[tuple[float, float, float, float, tuple[int, int, int]]],
    width: int = 640,
    height: int = 360,
) -> np.ndarray:
    """Create a synthetic green football pitch image with colored player jerseys.

    Each tuple in `players` is (x_pct, y_pct, w_pct, h_pct, bgr_color).
    """
    # Typical grass green BGR
    frame = np.full((height, width, 3), (45, 130, 45), dtype=np.uint8)
    for x_pct, y_pct, w_pct, h_pct, bgr in players:
        x1 = int((x_pct / 100.0) * width)
        y1 = int((y_pct / 100.0) * height)
        x2 = int(((x_pct + w_pct) / 100.0) * width)
        y2 = int(((y_pct + h_pct) / 100.0) * height)
        cv2.rectangle(frame, (x1, y1), (x2, y2), bgr, -1)
    return frame


def _det(
    det_id: str,
    cls_name: str,
    x: float,
    y: float,
    w: float = 6.0,
    h: float = 16.0,
    conf: float = 0.85,
) -> dict:
    return {
        "id": det_id,
        "class": cls_name,
        "label": cls_name.capitalize(),
        "confidence": conf,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
    }


def test_extract_player_jersey_color_ignores_turf_edges():
    """Jersey extraction should return the player's jersey color even with green turf margins."""
    # Draw small red shirt inside a larger bounding box surrounded by green pitch
    frame = np.full((360, 640, 3), (45, 135, 45), dtype=np.uint8)
    # Player box at 10%..20% x, 20%..45% y -> torso center around 13%..17% x, 25%..35% y
    cv2.rectangle(frame, (80, 88), (112, 130), (20, 20, 220), -1)  # BGR Red
    det = _det("p1", "player", 10.0, 20.0, 10.0, 25.0)

    extracted = extract_player_jersey_color(frame, det)
    assert extracted is not None
    _, bgr, hex_str = extracted
    # Red channel (bgr[2]) should dominate blue and green
    assert bgr[2] > 180
    assert bgr[1] < 60
    assert bgr[0] < 60
    assert hex_str.startswith("#")


def test_group_two_teams_with_outlier_goalkeeper():
    """Players should cluster into 2 main teams (Red vs Blue) even with a yellow GK outlier."""
    red = (25, 25, 215)
    blue = (215, 45, 25)
    yellow = (20, 225, 230)

    player_specs = [
        (10, 30, 5, 14, red),
        (18, 40, 5, 14, red),
        (26, 35, 5, 14, red),
        (34, 45, 5, 14, red),
        (55, 30, 5, 14, blue),
        (63, 42, 5, 14, blue),
        (71, 36, 5, 14, blue),
        (79, 44, 5, 14, blue),
        (90, 48, 5, 14, yellow),  # Goalkeeper outlier
    ]
    frame = _make_pitch_frame(player_specs)
    dets = [_det(f"p{i}", "player", x, y, w, h) for i, (x, y, w, h, _) in enumerate(player_specs)]

    tracker = TeamPossessionTracker()
    result = tracker.process_frame(frame, dets, timestamp=0.0)

    red_teams = {d["team"] for d in dets[:4]}
    blue_teams = {d["team"] for d in dets[4:8]}
    assert len(red_teams) == 1
    assert len(blue_teams) == 1
    assert red_teams != blue_teams
    assert set(result["teams"].keys()) == {"1", "2"}


def test_possession_same_team_pass_not_lost_and_team_change_is_lost():
    """Changing player with ball within same team is NOT lost; changing team IS lost."""
    red = (25, 25, 215)
    blue = (215, 45, 25)

    # Frame 1: Red player A (x=15) has the ball; Red B (x=35) and Blue C (x=65) do not
    f1 = _make_pitch_frame([(15, 40, 6, 16, red), (35, 42, 6, 16, red), (65, 45, 6, 16, blue)])
    d1 = [
        _det("a", "player with ball", 15, 40),
        _det("b", "player", 35, 42),
        _det("c", "player", 65, 45),
    ]

    tracker = TeamPossessionTracker()
    r1 = tracker.process_frame(f1, d1, timestamp=0.5)
    team_red = d1[0]["team"]
    team_blue = d1[2]["team"]
    assert team_red != team_blue
    assert r1["possession_status"] == "acquired"
    assert r1["possession_lost"] is False
    assert r1["current_team"] == team_red

    # Frame 2: Same Red player A still has the ball (slight movement)
    f2 = _make_pitch_frame([(16, 40, 6, 16, red), (36, 42, 6, 16, red), (64, 45, 6, 16, blue)])
    d2 = [
        _det("a", "player with ball", 16, 40),
        _det("b", "player", 36, 42),
        _det("c", "player", 64, 45),
    ]
    r2 = tracker.process_frame(f2, d2, timestamp=1.0)
    assert r2["possession_status"] == "holding"
    assert r2["player_changed"] is False
    assert r2["team_changed"] is False
    assert r2["possession_lost"] is False

    # Frame 3: Pass to Red player B -> player with ball changed, team is SAME -> NOT lost!
    f3 = _make_pitch_frame([(16, 40, 6, 16, red), (37, 42, 6, 16, red), (63, 45, 6, 16, blue)])
    d3 = [
        _det("a", "player", 16, 40),
        _det("b", "player with ball", 37, 42),
        _det("c", "player", 63, 45),
    ]
    r3 = tracker.process_frame(f3, d3, timestamp=1.5)
    assert r3["player_changed"] is True
    assert r3["team_changed"] is False
    assert r3["possession_lost"] is False
    assert r3["possession_status"] == "not_lost"
    assert r3["total_same_team_passes"] == 1
    assert r3["total_possession_losses"] == 0

    # Frame 4: Blue player C intercepts -> player with ball changed TEAM -> Possession LOST!
    f4 = _make_pitch_frame([(16, 40, 6, 16, red), (37, 42, 6, 16, red), (62, 45, 6, 16, blue)])
    d4 = [
        _det("a", "player", 16, 40),
        _det("b", "player", 37, 42),
        _det("c", "player with ball", 62, 45),
    ]
    r4 = tracker.process_frame(f4, d4, timestamp=2.0)
    assert r4["player_changed"] is True
    assert r4["team_changed"] is True
    assert r4["possession_lost"] is True
    assert r4["possession_status"] == "lost"
    assert r4["current_team"] == team_blue
    assert r4["previous_team"] == team_red
    assert r4["total_possession_losses"] == 1


def test_possession_across_in_transit_gap_frame():
    """A gap frame without `player with ball` preserves last carrier for next transition."""
    red = (25, 25, 215)
    blue = (215, 45, 25)
    tracker = TeamPossessionTracker()

    f1 = _make_pitch_frame([(20, 40, 6, 16, red), (70, 40, 6, 16, blue)])
    d1 = [_det("p1", "player with ball", 20, 40), _det("p2", "player", 70, 40)]
    tracker.process_frame(f1, d1, timestamp=0.0)
    team_red = d1[0]["team"]

    # Gap frame (ball mid-pass, no carrier detected)
    f2 = _make_pitch_frame([(21, 40, 6, 16, red), (69, 40, 6, 16, blue)])
    d2 = [_det("p1", "player", 21, 40), _det("p2", "player", 69, 40)]
    r2 = tracker.process_frame(f2, d2, timestamp=0.5)
    assert r2["possession_status"] == "in_transit"
    assert r2["possession_lost"] is False
    assert r2["current_team"] == team_red

    # Next frame: Blue picks up ball -> Possession Lost!
    f3 = _make_pitch_frame([(21, 40, 6, 16, red), (68, 40, 6, 16, blue)])
    d3 = [_det("p1", "player", 21, 40), _det("p2", "player with ball", 68, 40)]
    r3 = tracker.process_frame(f3, d3, timestamp=1.0)
    assert r3["possession_lost"] is True
    assert r3["possession_status"] == "lost"


def test_analyze_frame_endpoint_stateful_possession(client, monkeypatch):
    """Verify /api/analyze-frame groups players into 2 teams and tracks possession transitions."""
    from app import main

    red = (25, 25, 215)
    blue = (215, 45, 25)

    # Frame 1 image & mock detections (Red has ball)
    img1 = _make_pitch_frame([(20, 40, 8, 20, red), (70, 40, 8, 20, blue)])
    _, buf1 = cv2.imencode(".jpg", img1)
    b64_1 = base64.b64encode(buf1).decode()

    # Frame 2 image & mock detections (Blue has ball -> possession lost)
    img2 = _make_pitch_frame([(20, 40, 8, 20, red), (70, 40, 8, 20, blue)])
    _, buf2 = cv2.imencode(".jpg", img2)
    b64_2 = base64.b64encode(buf2).decode()

    boxes_frame1 = [
        MockBox(cls_id=3, conf=0.90, xywhn=[0.24, 0.50, 0.08, 0.20]),  # player with ball (Red)
        MockBox(cls_id=2, conf=0.88, xywhn=[0.74, 0.50, 0.08, 0.20]),  # player (Blue)
    ]
    boxes_frame2 = [
        MockBox(cls_id=2, conf=0.89, xywhn=[0.24, 0.50, 0.08, 0.20]),  # player (Red)
        MockBox(cls_id=3, conf=0.91, xywhn=[0.74, 0.50, 0.08, 0.20]),  # player with ball (Blue)
    ]

    responses = [[MockYOLOResult(boxes_frame1)], [MockYOLOResult(boxes_frame2)]]

    def fake_model(*args, **kwargs):
        return responses.pop(0)

    fake_model.names = {
        0: "football",
        1: "football goal",
        2: "player",
        3: "player with ball",
    }
    monkeypatch.setattr(main, "model", fake_model)
    monkeypatch.setattr(main, "MODEL_LOADED", True)

    res1 = client.post(
        "/api/analyze-frame",
        json={
            "image": b64_1,
            "session_id": "test-poss-sess",
            "timestamp": 0.5,
            "reset_session": True,
        },
    )
    assert res1.status_code == 200
    d1 = res1.json()
    assert "possession" in d1
    assert d1["possession"]["possession_lost"] is False
    assert d1["possession"]["possession_status"] == "acquired"
    assert len(d1["possession"]["teams"]) == 2
    assert d1["detections"][0]["team"] != d1["detections"][1]["team"]

    res2 = client.post(
        "/api/analyze-frame",
        json={
            "image": b64_2,
            "session_id": "test-poss-sess",
            "timestamp": 1.0,
        },
    )
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["possession"]["possession_lost"] is True
    assert d2["possession"]["possession_status"] == "lost"
    assert d2["possession"]["total_possession_losses"] == 1


def test_group_green_jerseys_on_sage_pitch_not_erased():
    """Green-shirt players on a faded sage turf pitch must separate cleanly from White kits."""
    sage_pitch = (130, 145, 130)  # Low-saturation sage turf like indoor/futsal pitches
    green_kit = (70, 165, 55)     # Emerald green jersey
    white_kit = (225, 225, 225)   # White jersey

    frame = np.full((360, 640, 3), sage_pitch, dtype=np.uint8)
    player_specs = [
        (12, 35, 6, 16, green_kit),
        (25, 42, 6, 16, green_kit),
        (40, 38, 6, 16, green_kit),
        (60, 40, 6, 16, white_kit),
        (72, 44, 6, 16, white_kit),
        (82, 36, 6, 16, white_kit),
    ]
    for x_pct, y_pct, w_pct, h_pct, bgr in player_specs:
        cv2.rectangle(
            frame,
            (int(x_pct / 100 * 640), int(y_pct / 100 * 360)),
            (int((x_pct + w_pct) / 100 * 640), int((y_pct + h_pct) / 100 * 360)),
            bgr,
            -1,
        )

    dets = [
        _det(f"g{i}", "player" if i != 0 else "player with ball", x, y, w, h)
        for i, (x, y, w, h, _) in enumerate(player_specs)
    ]
    tracker = TeamPossessionTracker()
    res = tracker.process_frame(frame, dets, timestamp=0.0)

    green_teams = {d["team"] for d in dets[:3]}
    white_teams = {d["team"] for d in dets[3:]}
    assert len(green_teams) == 1
    assert len(white_teams) == 1
    assert green_teams != white_teams
    green_tid = str(next(iter(green_teams)))
    assert res["teams"][green_tid]["color_name"] == "Green"

