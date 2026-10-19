import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

try:
    import imageio_ffmpeg

    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # noqa: BLE001
    FFMPEG_EXE = shutil.which("ffmpeg") or "ffmpeg"


def extract_mono_audio(
    video_path: Path, sample_rate: int = 16000
) -> tuple[np.ndarray, float]:
    """Extracts 16-bit mono PCM audio from video using FFmpeg.

    Returns (audio_samples_float32, duration_seconds).
    """
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    cmd = [
        FFMPEG_EXE,
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-f",
        "s16le",
        "-",
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        raw_pcm, _ = proc.communicate(timeout=45)
        if not raw_pcm:
            return np.zeros(0, dtype=np.float32), 0.0

        samples = np.frombuffer(raw_pcm, dtype=np.int16).astype(np.float32)
        duration = len(samples) / float(sample_rate)
        return samples, duration
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Audio extraction failed for {video_path}: {e}")
        return np.zeros(0, dtype=np.float32), 0.0


def compute_waveform_envelope(
    audio: np.ndarray, sample_rate: int = 16000, points_count: int = 120
) -> list[float]:
    """Computes a normalized downsampled waveform envelope (0.0 to 1.0) for UI display."""
    if len(audio) == 0:
        return [0.0] * points_count

    chunk_size = max(1, len(audio) // points_count)
    envelope = []
    for i in range(0, len(audio), chunk_size):
        chunk = audio[i : i + chunk_size]
        if len(chunk) > 0:
            rms = float(np.sqrt(np.mean(chunk**2)))
            envelope.append(rms)

    if not envelope:
        return [0.0] * points_count

    max_val = max(envelope) or 1.0
    normalized = [round(v / max_val, 3) for v in envelope[:points_count]]
    while len(normalized) < points_count:
        normalized.append(0.0)
    return normalized


def detect_clap_transient(
    audio: np.ndarray, sample_rate: int = 16000
) -> dict[str, Any]:
    """Detects sharp audio transient clap spike in the audio track.

    A clap is characterized by a high sudden jump in energy and peak loudness
    within a short 10-20ms window.
    Rule: 'the claps will always be the loudest sound from the beginning of video.the first loudest.'
    """
    if len(audio) < sample_rate * 0.5:
        return {
            "has_clap": False,
            "clap_time": 0.0,
            "confidence": 0.0,
            "max_jump": 0.0,
        }

    # Normalize audio to [-1.0, 1.0] if provided as 16-bit PCM float
    max_val = float(np.max(np.abs(audio))) if len(audio) > 0 else 0.0
    if max_val > 2.0:
        audio = audio / 32768.0

    # Short-time window: 10ms hop (160 samples), 20ms window (320 samples)
    hop_len = int(sample_rate * 0.01)
    win_len = int(sample_rate * 0.02)

    num_hops = len(audio) // hop_len
    rms_values = np.zeros(num_hops, dtype=np.float32)
    peak_amps = np.zeros(num_hops, dtype=np.float32)

    for i in range(num_hops):
        start = i * hop_len
        end = min(len(audio), start + win_len)
        segment = audio[start:end]
        if len(segment) > 0:
            rms_values[i] = np.sqrt(np.mean(segment**2))
            peak_amps[i] = np.max(np.abs(segment))

    # Compute onset attack slope: positive energy differential
    diff = np.diff(rms_values, prepend=rms_values[0])
    diff = np.maximum(0, diff)  # only positive onsets (attacks)

    # Combined instantaneous loudness metric: peak amplitude + RMS energy + onset attack jump
    loudness = peak_amps * 0.4 + rms_values * 0.3 + diff * 0.3

    # Search window: focus on the first 40 seconds (intro setup period where sync clap is performed)
    search_limit = min(len(loudness), int(40.0 * (sample_rate / hop_len)))
    search_loudness = loudness[:search_limit] if search_limit > 0 else loudness
    search_diff = diff[:search_limit] if search_limit > 0 else diff

    if len(search_loudness) == 0:
        return {
            "has_clap": False,
            "clap_time": 0.0,
            "confidence": 0.0,
            "max_jump": 0.0,
        }

    max_intro_loudness = float(np.max(search_loudness))
    mean_loudness = float(np.mean(search_loudness)) + 1e-6
    contrast_ratio = max_intro_loudness / mean_loudness

    # If the sound is too faint or has no dynamic contrast, no clap
    if max_intro_loudness < 0.04 or contrast_ratio < 2.0:
        return {
            "has_clap": False,
            "clap_time": 0.0,
            "confidence": 0.0,
            "max_jump": 0.0,
        }

    # "The claps will always be the loudest sound from the beginning of video. The first loudest."
    # Define candidate threshold as 60% of the maximum loudness in the intro region
    loud_threshold = max(0.03, 0.60 * max_intro_loudness)

    # Scan from the very beginning of the video (t = 0) to find the FIRST loudest sound event
    # with a sharp attack transient
    candidate_indices = np.where(
        (search_loudness >= loud_threshold) & (search_diff > 0.015)
    )[0]

    if len(candidate_indices) > 0:
        first_hop = int(candidate_indices[0])
        # Refine to exact transient onset (seek backwards up to 30ms to find where the rise began)
        onset_hop = first_hop
        for back in range(1, 4):
            prev_idx = first_hop - back
            if prev_idx >= 0 and search_diff[prev_idx] > 0.01:
                onset_hop = prev_idx
            else:
                break

        clap_time = round((onset_hop * hop_len) / float(sample_rate), 3)
        max_jump = float(search_diff[first_hop])
        confidence = min(1.0, round(contrast_ratio / 6.0, 2))
        has_clap = True
    else:
        # Fallback to peak jump index if candidates were border-case
        peak_idx = int(np.argmax(search_diff))
        max_jump = float(search_diff[peak_idx])
        clap_time = round((peak_idx * hop_len) / float(sample_rate), 3)
        has_clap = bool(max_jump > 0.02 and contrast_ratio > 2.5)
        confidence = min(1.0, round(contrast_ratio / 8.0, 2))

    return {
        "has_clap": has_clap,
        "clap_time": clap_time,
        "confidence": confidence,
        "max_jump": round(max_jump, 3),
    }


def compute_cross_correlation_offset(
    audio_a: np.ndarray,
    audio_b: np.ndarray,
    sample_rate: int = 16000,
    max_offset_sec: float = 15.0,
) -> float:
    """Computes cross-correlation between energy envelopes to find temporal offset.

    Returns offset in seconds (t_b - t_a).
    """
    if len(audio_a) == 0 or len(audio_b) == 0:
        return 0.0

    # Downsample envelope to 100 Hz (10ms steps)
    hop = int(sample_rate * 0.01)
    env_a = np.array(
        [np.mean(np.abs(audio_a[i : i + hop])) for i in range(0, len(audio_a), hop)]
    )
    env_b = np.array(
        [np.mean(np.abs(audio_b[i : i + hop])) for i in range(0, len(audio_b), hop)]
    )

    # Normalize
    env_a = env_a - np.mean(env_a)
    env_b = env_b - np.mean(env_b)
    std_a = np.std(env_a) or 1.0
    std_b = np.std(env_b) or 1.0
    env_a = env_a / std_a
    env_b = env_b / std_b

    # Cross-correlate
    corr = np.correlate(env_b, env_a, mode="full")
    max_lags = int(max_offset_sec * 100)
    center = len(env_a) - 1
    start_lag = max(0, center - max_lags)
    end_lag = min(len(corr), center + max_lags)

    trimmed_corr = corr[start_lag:end_lag]
    best_idx = int(np.argmax(trimmed_corr))
    lag = (start_lag + best_idx) - center

    offset_sec = round(lag * 0.01, 3)
    return offset_sec


def synchronize_two_videos(
    video_a_path: Path,
    video_b_path: Path,
) -> dict[str, Any]:
    """Analyzes audio from two training videos, detects the first loudest sync claps,
    and calculates the exact temporal alignment offset taking into account differing
    start times and differing video lengths.
    """
    logger.info(f"Synchronizing videos: A={video_a_path.name}, B={video_b_path.name}")

    audio_a, duration_a = extract_mono_audio(video_a_path)
    audio_b, duration_b = extract_mono_audio(video_b_path)

    clap_res_a = detect_clap_transient(audio_a)
    clap_res_b = detect_clap_transient(audio_b)

    clap_a = clap_res_a["clap_time"] if clap_res_a["has_clap"] else 0.0
    clap_b = clap_res_b["clap_time"] if clap_res_b["has_clap"] else 0.0

    # Determine which camera started first:
    # Camera recording started at t = 0 of its file.
    # The sync clap occurred at clap_a in Video A and clap_b in Video B.
    # If clap_a > clap_b: Camera A was recording for longer before the clap,
    # meaning Camera A started (clap_a - clap_b) seconds BEFORE Camera B!
    if clap_res_a["has_clap"] and clap_res_b["has_clap"]:
        offset_seconds = round(clap_b - clap_a, 3)
        sync_method = "first_loudest_clap"
        confidence = min(clap_res_a["confidence"], clap_res_b["confidence"])
    elif len(audio_a) > 0 and len(audio_b) > 0:
        offset_seconds = compute_cross_correlation_offset(audio_a, audio_b)
        sync_method = "cross_correlation"
        confidence = 0.75
        clap_a = 0.0
        clap_b = max(0.0, offset_seconds)
    else:
        offset_seconds = 0.0
        sync_method = "default"
        confidence = 0.50

    start_diff = round(clap_a - clap_b, 3)
    if start_diff > 0:
        # Camera A started earlier by start_diff seconds
        started_first = "video_a"
        start_delay_a = 0.0
        start_delay_b = start_diff
        master_clap_time = clap_a
    elif start_diff < 0:
        # Camera B started earlier by abs(start_diff) seconds
        started_first = "video_b"
        start_delay_a = abs(start_diff)
        start_delay_b = 0.0
        master_clap_time = clap_b
    else:
        started_first = "same_time"
        start_delay_a = 0.0
        start_delay_b = 0.0
        master_clap_time = clap_a

    # Effective durations on synced master timeline
    synced_duration_a = round(start_delay_a + duration_a, 2)
    synced_duration_b = round(start_delay_b + duration_b, 2)
    total_master_duration = max(synced_duration_a, synced_duration_b)

    waveform_a = compute_waveform_envelope(audio_a, points_count=100)
    waveform_b = compute_waveform_envelope(audio_b, points_count=100)

    start_desc = (
        f"Camera A started {start_delay_b:.2f}s earlier than Camera B"
        if started_first == "video_a"
        else f"Camera B started {start_delay_a:.2f}s earlier than Camera A"
        if started_first == "video_b"
        else "Both cameras started at the same time"
    )

    return {
        "success": True,
        "video_a": {
            "name": video_a_path.name,
            "duration": round(duration_a, 2),
            "clap_time": clap_a,
            "has_clap": clap_res_a["has_clap"],
            "start_delay": start_delay_a,
            "waveform": waveform_a,
        },
        "video_b": {
            "name": video_b_path.name,
            "duration": round(duration_b, 2),
            "clap_time": clap_b,
            "has_clap": clap_res_b["has_clap"],
            "start_delay": start_delay_b,
            "waveform": waveform_b,
        },
        "started_first": started_first,
        "start_difference": abs(start_diff),
        "master_clap_time": round(master_clap_time, 2),
        "total_master_duration": round(total_master_duration, 2),
        "offset_seconds": offset_seconds,
        "sync_method": sync_method,
        "confidence": confidence,
        "message": (
            f"Clap aligned: Angle A clap at {clap_a:.2f}s, Angle B clap at {clap_b:.2f}s. "
            f"{start_desc}. Feeds differ in length ({duration_a:.1f}s vs {duration_b:.1f}s)."
        ),
    }


def render_side_by_side_video(
    video_a_path: Path,
    video_b_path: Path,
    offset_seconds: float,
    output_path: Path,
    start_delay_a: float = 0.0,
    start_delay_b: float = 0.0,
    width: int = 1280,
    height: int = 720,
) -> bool:
    """Renders a combined side-by-side synchronized video using FFmpeg.

    - Video A on the left, Video B on the right.
    - Handles differing start times via tpad and audio delay so the claps coincide.
    - Handles differing video lengths cleanly.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    half_width = width // 2

    # If start delays not explicitly given, compute from offset:
    # offset_seconds = clap_b - clap_a
    # If offset_seconds < 0 (clap_a > clap_b): Camera A started earlier, Camera B needs delay
    if start_delay_a == 0.0 and start_delay_b == 0.0:
        if offset_seconds < 0:
            start_delay_b = abs(offset_seconds)
        elif offset_seconds > 0:
            start_delay_a = offset_seconds

    # Construct FFmpeg filter complex:
    # Scale both inputs to half_width x height
    # Apply tpad to whichever video started later
    pad_a = (
        f",tpad=start_duration={start_delay_a}:start_mode=add:color=black"
        if start_delay_a > 0.02
        else ""
    )
    pad_b = (
        f",tpad=start_duration={start_delay_b}:start_mode=add:color=black"
        if start_delay_b > 0.02
        else ""
    )

    filter_complex = (
        f"[0:v]scale={half_width}:{height}:force_original_aspect_ratio=decrease,pad={half_width}:{height}:(ow-iw)/2:(oh-ih)/2{pad_a}[v0];"
        f"[1:v]scale={half_width}:{height}:force_original_aspect_ratio=decrease,pad={half_width}:{height}:(ow-iw)/2:(oh-ih)/2{pad_b}[v1];"
        f"[v0][v1]hstack=inputs=2[vout]"
    )

    cmd = [
        FFMPEG_EXE,
        "-y",
        "-i",
        str(video_a_path),
        "-i",
        str(video_b_path),
        "-filter_complex",
        filter_complex,
        "-map",
        "[vout]",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-t",
        "60",  # preview render duration
        str(output_path),
    ]

    try:
        res = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=60,
        )
        return (
            res.returncode == 0
            and output_path.exists()
            and output_path.stat().st_size > 0
        )
    except Exception as e:  # noqa: BLE001
        logger.error(f"Failed to render side-by-side video: {e}")
        return False
