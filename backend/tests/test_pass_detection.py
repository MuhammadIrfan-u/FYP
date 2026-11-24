import cv2
import numpy as np

from app.services import video_annotator
from app.services.pass_detection import PassDetector

W, H = 1000, 500


def _player(x, y, cls="player"):
    # Percentage box 4% wide, 16% tall with top-left at (x, y)
    return {"class": cls, "confidence": 0.9, "x": x, "y": y, "w": 4.0, "h": 16.0}


def _ball(x, y):
    return {"class": "football", "confidence": 0.8, "x": x, "y": y, "w": 1.0, "h": 2.0}


A = (20.0, 40.0)  # player A: feet at (22%, 56%)
B = (60.0, 40.0)  # player B: feet at (62%, 56%)


def _frame(ball_at):
    dets = [_player(*A), _player(*B)]
    if ball_at == "A":
        dets.append(_ball(21.5, 55.0))
    elif ball_at == "B":
        dets.append(_ball(61.5, 55.0))
    elif ball_at == "mid":
        dets.append(_ball(41.0, 55.0))
    return dets


def _feed(detector, sequence, t0=0.0, dt=0.1):
    events = []
    for i, ball_at in enumerate(sequence):
        ev = detector.process(_frame(ball_at), t0 + i * dt, W, H)
        if ev:
            events.append(ev)
    return events


def test_single_pass_between_two_players():
    det = PassDetector(sample_fps=10)
    events = _feed(det, ["A"] * 5 + ["mid"] * 4 + ["B"] * 5)
    assert len(events) == 1
    assert events[0]["from_player"] != events[0]["to_player"]


def test_back_and_forth_counts_each_pass():
    det = PassDetector(sample_fps=10)
    seq = (["A"] * 4 + ["mid"] * 3 + ["B"] * 4 + ["mid"] * 3) * 2 + ["A"] * 4
    assert len(_feed(det, seq)) == 4


def test_single_frame_flicker_is_not_a_pass():
    det = PassDetector(sample_fps=10)
    # One noisy frame of B "holding" the ball must not be confirmed (debounce).
    events = _feed(det, ["A"] * 5 + ["B"] + ["A"] * 5)
    assert events == []


def test_long_loose_ball_gap_is_not_a_pass():
    det = PassDetector(sample_fps=10, max_pass_gap_sec=3.0)
    events = _feed(det, ["A"] * 5 + ["mid"] * 40 + ["B"] * 5)
    assert events == []


def test_track_id_switch_without_ball_travel_is_not_a_pass():
    det = PassDetector(sample_fps=10)
    _feed(det, ["A"] * 5)
    # Same spot, but the tracker loses the player for long enough to issue a new id.
    for _ in range(det.tracker.max_age_frames + 2):
        det.process([], 0.0, W, H)
    events = _feed(det, ["A"] * 5, t0=0.6)
    assert events == []


def _write_video(path, n_frames, fps=10.0):
    writer = None
    for codec in ("mp4v", "MJPG", "XVID"):
        w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*codec), fps, (160, 80))
        if w.isOpened():
            writer = w
            break
    assert writer is not None
    for _ in range(n_frames):
        writer.write(np.zeros((80, 160, 3), dtype=np.uint8))
    writer.release()


def test_5s_worker_counts_passes_per_chunk_without_double_counting(
    tmp_path, monkeypatch
):
    """The chunked annotation worker feeds the pass detector; a pass that leaves
    player A at the end of chunk 1 and reaches B in chunk 2 is counted once."""
    video = tmp_path / "s.avi"
    # 50 frames @ 10 fps with 1 s chunks -> 5 chunks of 10 frames.
    seq = ["A"] * 8 + ["mid"] * 4 + ["B"] * 18 + ["mid"] * 3 + ["A"] * 17
    _write_video(video, len(seq))

    def no_team_classification(*_a, **_k):
        raise AssertionError("passes-only mode must not build the team tracker")

    monkeypatch.setattr(
        video_annotator, "TeamPossessionTracker", no_team_classification
    )

    calls = {"i": 0}

    def detect(_img):
        i = min(calls["i"], len(seq) - 1)
        calls["i"] += 1
        return {"detections": _frame(seq[i]), "class_counts": {}}

    job_id = "job_pass_test"
    video_annotator.JOBS[job_id] = {
        "job_id": job_id,
        "status": "processing",
        "chunks": [],
        "total_passes": 0,
    }
    try:
        video_annotator.run_chunked_annotation_worker(
            job_id=job_id,
            video_source_path=video,
            output_dir=tmp_path / "out",
            chunk_duration_sec=1.0,
            confidence_threshold=0.25,
            class_confidences={"player": 0.25},
            burn_boxes=True,
            parse_detections_fn=None,
            model_obj=None,
            infer_fps=10.0,
            detect_fn=detect,
            passes_only=True,
        )
        job = video_annotator.get_job_status(job_id)
    finally:
        video_annotator.JOBS.pop(job_id, None)

    assert job["status"] == "completed", job.get("error")
    assert len(job["chunks"]) == 5
    per_chunk = [c["passes"] for c in job["chunks"]]
    assert per_chunk == [0, 1, 0, 1, 0]  # A->B completes in chunk 2, B->A in chunk 4
    assert job["total_passes"] == 2 == sum(per_chunk)
    assert all(len(c["pass_events"]) == c["passes"] for c in job["chunks"])
    assert all(c["possession"] is None for c in job["chunks"])
    first = job["chunks"][1]["pass_events"][0]
    assert 0 <= first["from_xy"][0] < first["to_xy"][0] <= 1  # 2D: A (left) -> B


def test_in_flight_line_and_pass_positions():
    det = PassDetector(sample_fps=10)
    _feed(det, ["A"] * 5)
    assert det.in_flight_line() is None  # A is holding the ball
    _feed(det, ["mid"], t0=0.5)
    line = det.in_flight_line()
    assert line is not None
    (px, _py), (bx, _by) = line
    assert px < bx  # from passer A towards the ball in the middle
    events = _feed(det, ["B"] * 5, t0=0.6)
    assert len(events) == 1
    ev = events[0]
    assert ev["from_pos"][0] < ev["to_pos"][0]  # A (left) -> B (right)
    assert det.in_flight_line() is None  # B now holds the ball


def test_draw_pass_lines_marks_frame():
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    video_annotator.draw_pass_lines(
        frame,
        in_flight=((50.0, 300.0), (300.0, 300.0)),
        last_pass={"from_pos": [100.0, 200.0], "to_pos": [500.0, 200.0]},
        pass_number=3,
        progress=0.2,
    )
    assert frame[200, 300].any()  # solid pass arrow
    assert frame[300, 60:300].any()  # dashed in-flight line
    faded = np.zeros_like(frame)
    video_annotator.draw_pass_lines(
        faded, None, {"from_pos": [100.0, 200.0], "to_pos": [500.0, 200.0]}, 1, 1.0
    )
    assert not faded.any()  # display window over
