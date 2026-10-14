import numpy as np
import pytest
from fastapi.testclient import TestClient
from pathlib import Path

from app.main import app
from app.services.video_sync import (
    compute_waveform_envelope,
    detect_clap_transient,
    compute_cross_correlation_offset,
    synchronize_two_videos,
)

client = TestClient(app)


def test_compute_waveform_envelope_empty():
    wf = compute_waveform_envelope(np.array([], dtype=np.float32), points_count=50)
    assert len(wf) == 50
    assert all(p == 0.0 for p in wf)


def test_compute_waveform_envelope_values():
    audio = np.zeros(16000, dtype=np.float32)
    audio[7500:8500] = 1.0  # spike
    wf = compute_waveform_envelope(audio, points_count=100)
    assert len(wf) == 100
    assert max(wf) == 1.0
    peak_idx = int(np.argmax(wf))
    assert 45 <= peak_idx <= 55


def test_detect_clap_transient_synthetic_burst():
    sample_rate = 16000
    audio = np.zeros(sample_rate * 2, dtype=np.float32)
    spike_idx = int(0.5 * sample_rate)
    audio[spike_idx : spike_idx + 200] = 0.95  # sharp clap burst

    result = detect_clap_transient(audio, sample_rate=sample_rate)
    assert result["has_clap"] is True
    assert abs(result["clap_time"] - 0.5) < 0.05
    assert result["confidence"] > 0.8


def test_detect_clap_transient_first_loudest_from_beginning():
    # Audio with 3 events:
    # 1) Quiet tap at 0.3s (0.15 amp)
    # 2) Sync clap at 1.2s (0.90 amp) -> FIRST LOUDEST SOUND
    # 3) Another loud kick/whistle at 4.5s (0.85 amp)
    sample_rate = 16000
    audio = np.zeros(sample_rate * 6, dtype=np.float32)

    # Quiet tap at 0.3s
    audio[int(0.3 * sample_rate) : int(0.3 * sample_rate) + 100] = 0.15

    # Sync clap at 1.2s
    audio[int(1.2 * sample_rate) : int(1.2 * sample_rate) + 200] = 0.90

    # Whistle/kick at 4.5s
    audio[int(4.5 * sample_rate) : int(4.5 * sample_rate) + 300] = 0.85

    result = detect_clap_transient(audio, sample_rate=sample_rate)
    assert result["has_clap"] is True
    # Must lock onto the first loudest sound at 1.2s, not 0.3s (too quiet) or 4.5s (later sound)
    assert abs(result["clap_time"] - 1.2) < 0.08


def test_detect_clap_transient_silence():
    audio = np.zeros(16000, dtype=np.float32)
    result = detect_clap_transient(audio)
    assert result["has_clap"] is False
    assert result["clap_time"] == 0.0


def test_compute_cross_correlation_offset():
    sample_rate = 16000
    a = np.zeros(sample_rate * 3, dtype=np.float32)
    b = np.zeros(sample_rate * 3, dtype=np.float32)
    a[int(1.0 * sample_rate) : int(1.0 * sample_rate) + 300] = 1.0
    b[int(1.5 * sample_rate) : int(1.5 * sample_rate) + 300] = 1.0

    offset = compute_cross_correlation_offset(a, b, sample_rate=sample_rate)
    assert abs(offset - 0.5) < 0.15


def test_sync_training_videos_endpoint_sample_files():
    res = client.post(
        "/api/sync-training-videos",
        data={
            "video_a_filename": "football_match_demo.mp4",
            "video_b_filename": "football_match_demo.mp4",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "sync_id" in data
    assert "video_a" in data
    assert "video_b" in data
    assert "offset_seconds" in data
    assert "started_first" in data
    assert "start_difference" in data
    assert "master_clap_time" in data
    assert "total_master_duration" in data
    assert "waveform" in data["video_a"]
    assert len(data["video_a"]["waveform"]) == 100
