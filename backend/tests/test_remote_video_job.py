"""Starting a job must never wait on the session video download.

Sessions stored in Supabase have no local copy, so the video has to be fetched.
Doing that inside the request handler holds the HTTP response open for the whole
transfer - tens of megabytes - and the browser drops the connection first, which
reaches the user as "Failed to fetch". It only ever broke for accounts whose
sessions had no local file, which is why it looked account-specific.
"""

import threading
import time
from pathlib import Path

import pytest

from app.services import video_annotator


def test_download_runs_in_the_worker_not_the_request(monkeypatch, tmp_path):
    started = threading.Event()
    release = threading.Event()
    downloaded = {}

    def slow_download(url, dest):
        started.set()
        release.wait(timeout=5)  # stand in for a large, slow transfer
        downloaded["url"] = url
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"video")
        return dest

    monkeypatch.setattr(video_annotator, "download_remote_video", slow_download)
    monkeypatch.setattr(
        video_annotator, "run_chunked_annotation_worker", _worker_stub(slow_download)
    )

    t0 = time.monotonic()
    job = video_annotator.create_annotation_job(
        video_source_path=None,
        remote_video_url="https://example.supabase.co/signed/session.mp4",
        uploads_dir=tmp_path,
    )
    elapsed = time.monotonic() - t0

    try:
        # The caller gets a job id immediately, while the transfer is still going.
        assert job["job_id"]
        assert job["status"] == "processing"
        assert elapsed < 1.0, f"creating the job blocked for {elapsed:.1f}s"
        assert started.wait(timeout=5), "the worker never started the download"
        release.set()
        for _ in range(50):
            if downloaded:
                break
            time.sleep(0.05)
        assert downloaded["url"].endswith("session.mp4")
    finally:
        release.set()
        video_annotator.JOBS.pop(job["job_id"], None)


def _worker_stub(download):
    """Minimal worker: just the download step this test cares about."""

    def worker(job_id, video_source_path, output_dir, remote_video_url=None, **_kw):
        if remote_video_url and (
            video_source_path is None or not video_source_path.exists()
        ):
            with video_annotator.JOBS_LOCK:
                if job_id in video_annotator.JOBS:
                    video_annotator.JOBS[job_id]["stage"] = "downloading"
            download(remote_video_url, output_dir / "source.mp4")

    return worker


def test_worker_reports_a_failed_download_instead_of_silently_using_another_video(
    monkeypatch, tmp_path
):
    """A session whose video cannot be fetched must say so. Quietly analysing
    whichever file happens to be newest in uploads/ reports numbers for the
    wrong match."""

    def boom(url, dest):
        raise OSError("403 Forbidden: signed URL expired")

    monkeypatch.setattr(video_annotator, "download_remote_video", boom)

    job_id = "job_remote_fail"
    video_annotator.JOBS[job_id] = {
        "job_id": job_id,
        "status": "processing",
        "chunks": [],
        "total_passes": 0,
    }
    try:
        video_annotator.run_chunked_annotation_worker(
            job_id=job_id,
            video_source_path=None,
            output_dir=tmp_path / "out",
            chunk_duration_sec=5.0,
            confidence_threshold=0.25,
            class_confidences={"player": 0.25},
            burn_boxes=False,
            parse_detections_fn=None,
            model_obj=None,
            remote_video_url="https://example.supabase.co/signed/gone.mp4",
        )
        job = video_annotator.get_job_status(job_id)
        assert job["status"] == "failed"
        assert "download" in (job["error"] or "").lower()
        assert "expired" in (job["error"] or "").lower()
    finally:
        video_annotator.JOBS.pop(job_id, None)


def test_missing_source_and_no_url_fails_clearly(tmp_path):
    job_id = "job_no_source"
    video_annotator.JOBS[job_id] = {
        "job_id": job_id,
        "status": "processing",
        "chunks": [],
        "total_passes": 0,
    }
    try:
        video_annotator.run_chunked_annotation_worker(
            job_id=job_id,
            video_source_path=None,
            output_dir=tmp_path / "out",
            chunk_duration_sec=5.0,
            confidence_threshold=0.25,
            class_confidences={"player": 0.25},
            burn_boxes=False,
            parse_detections_fn=None,
            model_obj=None,
        )
        job = video_annotator.get_job_status(job_id)
        assert job["status"] == "failed"
        assert "video source" in (job["error"] or "").lower()
    finally:
        video_annotator.JOBS.pop(job_id, None)


@pytest.mark.parametrize("size", [1, 1024, 1024 * 64])
def test_download_helper_writes_the_file(monkeypatch, tmp_path, size):
    import io

    payload = b"x" * size

    class FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    import urllib.request

    monkeypatch.setattr(
        urllib.request, "urlopen", lambda *a, **k: FakeResponse(payload)
    )

    dest = tmp_path / "nested" / "source.mp4"
    out = video_annotator.download_remote_video("https://example.com/v.mp4", dest)
    assert out == dest
    assert dest.read_bytes() == payload


def test_download_helper_rejects_an_empty_file(monkeypatch, tmp_path):
    import io
    import urllib.request

    class FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: FakeResponse(b""))
    with pytest.raises(RuntimeError, match="empty"):
        video_annotator.download_remote_video(
            "https://example.com/v.mp4", Path(tmp_path) / "source.mp4"
        )
