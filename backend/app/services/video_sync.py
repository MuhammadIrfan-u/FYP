import logging
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import cv2
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


def onset_envelope(
    audio: np.ndarray, sample_rate: int = 16000, hop_ms: float = 1.0
) -> np.ndarray:
    """Positive-difference energy envelope at millisecond resolution.

    Emphasises attacks (claps, kicks, whistles) rather than loudness, which is what
    makes two recordings of the same scene line up even when the microphones are at
    very different distances.
    """
    if len(audio) == 0:
        return np.zeros(0, dtype=np.float32)

    if float(np.max(np.abs(audio))) > 2.0:
        audio = audio / 32768.0

    hop = max(1, int(sample_rate * hop_ms / 1000.0))
    win = hop * 4
    count = len(audio) // hop
    if count < 2:
        return np.zeros(0, dtype=np.float32)

    # Cumulative sums give a windowed RMS in one pass instead of a Python loop.
    squared = np.concatenate(([0.0], np.cumsum(audio.astype(np.float64) ** 2)))
    starts = np.arange(count) * hop
    ends = np.minimum(starts + win, len(audio))
    rms = np.sqrt(
        (squared[ends] - squared[starts]) / np.maximum(1, ends - starts) + 1e-12
    ).astype(np.float32)
    return np.maximum(0.0, np.diff(rms, prepend=rms[0]))


def _normalize_envelope(env: np.ndarray) -> np.ndarray:
    if len(env) == 0:
        return env
    std = float(env.std()) or 1.0
    return (env - float(env.mean())) / std


def correlate_onsets(
    env_a: np.ndarray,
    env_b: np.ndarray,
    max_offset_sec: float = 20.0,
    hop_ms: float = 1.0,
) -> tuple[np.ndarray, int, float]:
    """Normalized onset cross-correlation. Returns (scores, zero_lag_index, hop_ms)."""
    if len(env_a) == 0 or len(env_b) == 0:
        return np.zeros(0, dtype=np.float32), 0, hop_ms

    norm_a = _normalize_envelope(env_a)
    norm_b = _normalize_envelope(env_b)
    scores = np.correlate(norm_b, norm_a, mode="full") / max(len(norm_a), len(norm_b))
    center = len(norm_a) - 1

    # Blank out lags beyond the plausible range so a spurious tail peak cannot win.
    limit = int(max_offset_sec * 1000.0 / hop_ms)
    if limit < len(scores):
        scores = scores.copy()
        scores[: max(0, center - limit)] = -np.inf
        scores[min(len(scores), center + limit + 1) :] = -np.inf

    return scores, center, hop_ms


def _score_at(scores: np.ndarray, center: int, offset_sec: float, hop_ms: float) -> float:
    """Best correlation score within +-20ms of a candidate offset."""
    if len(scores) == 0:
        return 0.0
    idx = center + round(offset_sec * 1000.0 / hop_ms)
    lo = max(0, idx - int(20.0 / hop_ms))
    hi = min(len(scores), idx + int(20.0 / hop_ms) + 1)
    if lo >= hi:
        return 0.0
    window = scores[lo:hi]
    best = float(np.max(window))
    return 0.0 if not np.isfinite(best) else best


def align_audio_offset(
    audio_a: np.ndarray,
    audio_b: np.ndarray,
    clap_offset: float | None,
    sample_rate: int = 16000,
) -> dict[str, Any]:
    """Finds the true temporal offset (t_b - t_a) between two recordings.

    The clap times are only a hypothesis: each camera hears a different sound as its
    loudest, so detecting "the first loudest" independently in both feeds can pick two
    unrelated events and produce a badly wrong offset. This scores the clap hypothesis
    against the strongest audio-correlation peak and keeps whichever actually explains
    both soundtracks, then locks it in at millisecond resolution.
    """
    result: dict[str, Any] = {
        "offset": 0.0,
        "clap_offset": clap_offset,
        "clap_score": 0.0,
        "audio_offset": None,
        "audio_score": 0.0,
        "method": "default",
        "clap_trusted": False,
        "score": 0.0,
    }
    if len(audio_a) == 0 or len(audio_b) == 0:
        if clap_offset is not None:
            result.update(offset=clap_offset, method="clap_only", clap_trusted=True)
        return result

    env_a = onset_envelope(audio_a, sample_rate)
    env_b = onset_envelope(audio_b, sample_rate)
    scores, center, hop_ms = correlate_onsets(env_a, env_b)
    if len(scores) == 0:
        if clap_offset is not None:
            result.update(offset=clap_offset, method="clap_only", clap_trusted=True)
        return result

    peak_idx = int(np.argmax(scores))
    audio_offset = round((peak_idx - center) * hop_ms / 1000.0, 3)
    audio_score = _score_at(scores, center, audio_offset, hop_ms)
    result["audio_offset"] = audio_offset
    result["audio_score"] = round(audio_score, 4)

    clap_score = (
        _score_at(scores, center, clap_offset, hop_ms) if clap_offset is not None else 0.0
    )
    result["clap_score"] = round(clap_score, 4)

    # Too little shared sound to judge: keep the clap if we have one.
    if audio_score < 0.02:
        if clap_offset is not None:
            result.update(
                offset=clap_offset,
                method="clap_unverified",
                clap_trusted=True,
                score=round(clap_score, 4),
            )
        else:
            result.update(offset=audio_offset, method="audio_correlation", score=round(audio_score, 4))
        return result

    # The clap pairing only stands if the audio agrees it explains both tracks.
    if clap_offset is not None and clap_score >= audio_score * 0.6:
        result.update(
            offset=clap_offset,
            method="clap_confirmed",
            clap_trusted=True,
            score=round(clap_score, 4),
        )
    else:
        result.update(
            offset=audio_offset,
            method="audio_correlation",
            clap_trusted=False,
            score=round(audio_score, 4),
        )
    return result


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

    # The clap times give a hypothesis for the offset (t_b - t_a), but only if BOTH
    # feeds really latched onto the same sound. Verify it against the soundtracks
    # before trusting it, because each camera hears a different sound as its loudest.
    both_clapped = bool(clap_res_a["has_clap"] and clap_res_b["has_clap"])
    clap_offset = round(clap_b - clap_a, 3) if both_clapped else None

    alignment = align_audio_offset(audio_a, audio_b, clap_offset)
    offset_seconds = round(float(alignment["offset"]), 3)
    clap_corrected = both_clapped and not alignment["clap_trusted"]

    if alignment["method"] == "clap_confirmed":
        sync_method = "first_loudest_clap"
        confidence = min(clap_res_a["confidence"], clap_res_b["confidence"])
    elif alignment["method"] == "clap_unverified":
        sync_method = "first_loudest_clap"
        confidence = min(0.6, min(clap_res_a["confidence"], clap_res_b["confidence"]))
    elif alignment["method"] == "audio_correlation":
        sync_method = "cross_correlation"
        # A decisive correlation peak means a trustworthy offset.
        confidence = round(min(0.95, 0.6 + float(alignment["score"]) * 1.5), 2)
    elif alignment["method"] == "clap_only":
        sync_method = "first_loudest_clap"
        confidence = min(clap_res_a["confidence"], clap_res_b["confidence"])
    else:
        sync_method = "default"
        confidence = 0.50

    # Re-anchor the clap markers so that clap_b - clap_a == offset_seconds. The merge
    # cuts each feed at its own marker, so the two markers must name the SAME instant.
    if clap_corrected or not both_clapped:
        if clap_res_a["has_clap"] and (
            not clap_res_b["has_clap"]
            or clap_res_a["max_jump"] >= clap_res_b["max_jump"]
        ):
            # Keep Camera A's transient, derive Camera B's from the verified offset.
            clap_a = clap_res_a["clap_time"] if clap_res_a["has_clap"] else 0.0
            clap_b = round(clap_a + offset_seconds, 3)
        elif clap_res_b["has_clap"]:
            clap_b = clap_res_b["clap_time"]
            clap_a = round(clap_b - offset_seconds, 3)
        else:
            clap_a = 0.0
            clap_b = offset_seconds

        # Neither marker can sit before its own recording started.
        if clap_a < 0:
            clap_b = round(clap_b - clap_a, 3)
            clap_a = 0.0
        if clap_b < 0:
            clap_a = round(clap_a - clap_b, 3)
            clap_b = 0.0
        clap_a = round(min(clap_a, max(0.0, duration_a - 0.1)), 3)
        clap_b = round(min(clap_b, max(0.0, duration_b - 0.1)), 3)

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
        "alignment": {
            "method": alignment["method"],
            "clap_trusted": bool(alignment["clap_trusted"]),
            "clap_corrected": clap_corrected,
            "clap_offset": alignment["clap_offset"],
            "clap_score": alignment["clap_score"],
            "audio_offset": alignment["audio_offset"],
            "audio_score": alignment["audio_score"],
        },
        "clap_corrected": clap_corrected,
        "message": (
            (
                f"Audio-verified alignment: the two detected claps disagreed with the "
                f"soundtracks, so the markers were corrected to Angle A {clap_a:.2f}s / "
                f"Angle B {clap_b:.2f}s (offset {offset_seconds:+.2f}s). "
            )
            if clap_corrected
            else (
                f"Clap aligned: Angle A clap at {clap_a:.2f}s, Angle B clap at "
                f"{clap_b:.2f}s. "
            )
        )
        + f"{start_desc}. Feeds differ in length ({duration_a:.1f}s vs {duration_b:.1f}s).",
    }


def probe_video_info(video_path: Path) -> dict[str, Any]:
    """Reads width/height/fps/duration with OpenCV and detects an audio track with FFmpeg."""
    info: dict[str, Any] = {
        "width": 0,
        "height": 0,
        "fps": 30.0,
        "duration": 0.0,
        "has_audio": False,
    }
    if not video_path.exists():
        return info

    cap = cv2.VideoCapture(str(video_path))
    if cap.isOpened():
        info["width"] = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        info["height"] = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
        if fps > 0:
            info["fps"] = round(float(fps), 3)
            info["duration"] = (
                round(float(frames) / float(fps), 3) if frames > 0 else 0.0
            )
    cap.release()

    # FFmpeg prints the stream layout on stderr for a plain "-i" probe.
    try:
        probe = subprocess.run(
            [FFMPEG_EXE, "-hide_banner", "-i", str(video_path)],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=30,
        )
        stderr_text = probe.stderr.decode("utf-8", errors="ignore")
        info["has_audio"] = ": Audio:" in stderr_text
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Could not probe audio streams for {video_path.name}: {e}")

    return info


def _even(value: float, minimum: int = 2) -> int:
    """Rounds to the nearest even integer (H.264 with yuv420p needs even dimensions)."""
    v = round(value / 2.0) * 2
    return max(minimum, v)


def build_merge_plan(
    video_a_path: Path,
    video_b_path: Path,
    start_delay_a: float = 0.0,
    start_delay_b: float = 0.0,
    trim_start_a: float = 0.0,
    trim_start_b: float = 0.0,
    trim_to_overlap: bool = True,
    target_height: int | None = 1080,
) -> dict[str, Any]:
    """Works out the merged geometry and timeline for a side-by-side composite.

    Both panes are scaled to one shared height and each pane keeps its own source
    aspect ratio (no stretching, no letterboxing).

    `trim_start_a` / `trim_start_b` cut each source at its sync point (the clap), so
    merged time 0:00 is the same real-world instant in both feeds. With
    `trim_to_overlap` the merge also stops when the first feed runs out, so every
    frame of the output has real footage in both halves and the two panes share one
    clock for the whole file. Head/tail padding is only used when the panes are NOT
    trimmed to the overlap, to keep both halves the same length as the output.
    """
    info_a = probe_video_info(video_a_path)
    info_b = probe_video_info(video_b_path)

    h_a = info_a["height"] or 720
    h_b = info_b["height"] or 720
    w_a = info_a["width"] or 1280
    w_b = info_b["width"] or 1280

    height = min(h_a, h_b)
    if target_height and target_height > 0:
        height = min(height, int(target_height))
    height = _even(height or 720, minimum=120)

    pane_w_a = _even(w_a * (height / float(h_a)), minimum=120)
    pane_w_b = _even(w_b * (height / float(h_b)), minimum=120)

    fps = min(info_a["fps"] or 30.0, info_b["fps"] or 30.0)
    fps = round(max(10.0, min(60.0, fps)), 3)

    delay_a = max(0.0, round(float(start_delay_a), 3))
    delay_b = max(0.0, round(float(start_delay_b), 3))

    dur_a = info_a["duration"] or 0.0
    dur_b = info_b["duration"] or 0.0

    # Clamp each trim point inside its own feed, then work out what is left of it.
    trim_a = min(max(0.0, round(float(trim_start_a), 3)), max(0.0, dur_a - 0.1))
    trim_b = min(max(0.0, round(float(trim_start_b), 3)), max(0.0, dur_b - 0.1))
    avail_a = max(0.0, round(dur_a - trim_a, 3))
    avail_b = max(0.0, round(dur_b - trim_b, 3))

    end_a = delay_a + avail_a
    end_b = delay_b + avail_b
    if trim_to_overlap:
        # Only the stretch both cameras actually recorded: no black filler anywhere.
        master_duration = round(min(end_a, end_b), 3)
    else:
        master_duration = round(max(end_a, end_b), 3)

    return {
        "video_a": info_a,
        "video_b": info_b,
        "height": height,
        "pane_width_a": pane_w_a,
        "pane_width_b": pane_w_b,
        "output_width": pane_w_a + pane_w_b,
        "output_height": height,
        "fps": fps,
        "start_delay_a": delay_a,
        "start_delay_b": delay_b,
        "trim_start_a": trim_a,
        "trim_start_b": trim_b,
        "available_a": avail_a,
        "available_b": avail_b,
        "trim_to_overlap": trim_to_overlap,
        "tail_pad_a": max(0.0, round(master_duration - end_a, 3)),
        "tail_pad_b": max(0.0, round(master_duration - end_b, 3)),
        "master_duration": master_duration,
    }


def _pane_filter(
    index: int,
    pane_width: int,
    height: int,
    fps: float,
    head_pad: float,
    tail_pad: float,
    label: str,
) -> str:
    chain = f"[{index}:v]scale={pane_width}:{height}:flags=bicubic,setsar=1,fps={fps}"
    if head_pad > 0.01:
        chain += f",tpad=start_duration={head_pad:.3f}:start_mode=add:color=black"
    if tail_pad > 0.01:
        chain += f",tpad=stop_duration={tail_pad:.3f}:stop_mode=add:color=black"
    return f"{chain}[{label}]"


def build_merge_command(
    video_a_path: Path,
    video_b_path: Path,
    output_path: Path,
    plan: dict[str, Any],
    max_duration: float | None = None,
    crf: int = 23,
    preset: str = "veryfast",
    with_progress: bool = False,
) -> list[str]:
    """Builds the FFmpeg command that hstacks Camera 1 (left) and Camera 2 (right)."""
    duration = plan["master_duration"]
    if max_duration and max_duration > 0:
        duration = min(duration, float(max_duration))

    filters = [
        _pane_filter(
            0,
            plan["pane_width_a"],
            plan["height"],
            plan["fps"],
            plan["start_delay_a"],
            plan["tail_pad_a"],
            "v0",
        ),
        _pane_filter(
            1,
            plan["pane_width_b"],
            plan["height"],
            plan["fps"],
            plan["start_delay_b"],
            plan["tail_pad_b"],
            "v1",
        ),
        "[v0][v1]hstack=inputs=2[vout]",
    ]

    # Audio: delay each track onto the shared timeline, then mix whatever exists.
    has_a = bool(plan["video_a"]["has_audio"])
    has_b = bool(plan["video_b"]["has_audio"])
    audio_label: str | None = None

    def delayed(stream: str, delay: float, label: str) -> str:
        chain = f"[{stream}]"
        if delay > 0.01:
            chain += f"adelay=delays={int(delay * 1000)}:all=1,"
        chain += "apad"
        return f"{chain}[{label}]"

    if has_a and has_b:
        filters.append(delayed("0:a", plan["start_delay_a"], "a0"))
        filters.append(delayed("1:a", plan["start_delay_b"], "a1"))
        filters.append(
            "[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]"
        )
        audio_label = "[aout]"
    elif has_a:
        filters.append(delayed("0:a", plan["start_delay_a"], "aout"))
        audio_label = "[aout]"
    elif has_b:
        filters.append(delayed("1:a", plan["start_delay_b"], "aout"))
        audio_label = "[aout]"

    cmd = [FFMPEG_EXE, "-y", "-hide_banner"]
    if with_progress:
        cmd += ["-nostats", "-progress", "pipe:1"]
    # Input seeking: start each feed at its own sync point so merged 0:00 is the
    # same instant in both. Output timestamps restart at zero for both panes.
    if plan.get("trim_start_a", 0.0) > 0.01:
        cmd += ["-ss", f"{plan['trim_start_a']:.3f}"]
    cmd += ["-i", str(video_a_path)]
    if plan.get("trim_start_b", 0.0) > 0.01:
        cmd += ["-ss", f"{plan['trim_start_b']:.3f}"]
    cmd += [
        "-i",
        str(video_b_path),
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[vout]",
    ]
    if audio_label:
        cmd += ["-map", audio_label, "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    else:
        cmd += ["-an"]
    cmd += [
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(crf),
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(plan["fps"]),
        "-movflags",
        "+faststart",
        "-t",
        f"{duration:.3f}",
        str(output_path),
    ]
    return cmd


def merge_side_by_side_video(
    video_a_path: Path,
    video_b_path: Path,
    output_path: Path,
    start_delay_a: float = 0.0,
    start_delay_b: float = 0.0,
    trim_start_a: float = 0.0,
    trim_start_b: float = 0.0,
    trim_to_overlap: bool = True,
    target_height: int | None = 1080,
    max_duration: float | None = None,
    progress_cb: Any = None,
) -> dict[str, Any]:
    """Merges two clap-synchronized feeds into one horizontal side-by-side MP4.

    Camera 1 goes on the left, Camera 2 on the right. Each pane keeps its original
    aspect ratio, both panes share one timeline, and the result is an ordinary MP4
    that can be fed straight into the detection pipeline as a single video.

    Pass each feed's sync point as `trim_start_a` / `trim_start_b` to merge from the
    synchronized moment onward: the merge then starts at that instant in both feeds
    and (with `trim_to_overlap`) ends when the first feed runs out.

    progress_cb(percent, seconds_done) is called while FFmpeg encodes.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    plan = build_merge_plan(
        video_a_path,
        video_b_path,
        start_delay_a=start_delay_a,
        start_delay_b=start_delay_b,
        trim_start_a=trim_start_a,
        trim_start_b=trim_start_b,
        trim_to_overlap=trim_to_overlap,
        target_height=target_height,
    )
    total_duration = plan["master_duration"]
    if max_duration and max_duration > 0:
        total_duration = min(total_duration, float(max_duration))

    cmd = build_merge_command(
        video_a_path,
        video_b_path,
        output_path,
        plan,
        max_duration=max_duration,
        with_progress=progress_cb is not None,
    )

    logger.info(
        "Merging side-by-side video: %sx%s @ %sfps, %.2fs -> %s",
        plan["output_width"],
        plan["output_height"],
        plan["fps"],
        total_duration,
        output_path.name,
    )

    try:
        if progress_cb is None:
            res = subprocess.run(
                cmd,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return_code = res.returncode
        else:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )
            if proc.stdout is not None:
                for line in proc.stdout:
                    line = line.strip()
                    if not line.startswith("out_time_ms="):
                        continue
                    raw = line.split("=", 1)[1]
                    try:
                        seconds = max(0.0, int(raw) / 1_000_000.0)
                    except ValueError:
                        continue
                    percent = (
                        min(99.0, round(seconds / total_duration * 100.0, 1))
                        if total_duration > 0
                        else 0.0
                    )
                    progress_cb(percent, round(seconds, 2))
            proc.wait()
            return_code = proc.returncode
    except Exception as e:  # noqa: BLE001
        logger.error(f"Side-by-side merge failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "plan": plan,
            "duration": total_duration,
        }

    ok = return_code == 0 and output_path.exists() and output_path.stat().st_size > 0
    if not ok:
        return {
            "success": False,
            "error": f"FFmpeg exited with code {return_code}.",
            "plan": plan,
            "duration": total_duration,
        }

    return {
        "success": True,
        "plan": plan,
        "duration": total_duration,
        "width": plan["output_width"],
        "height": plan["output_height"],
        "fps": plan["fps"],
        "size_bytes": output_path.stat().st_size,
        "has_audio": bool(plan["video_a"]["has_audio"] or plan["video_b"]["has_audio"]),
    }


def render_side_by_side_video(
    video_a_path: Path,
    video_b_path: Path,
    offset_seconds: float,
    output_path: Path,
    start_delay_a: float = 0.0,
    start_delay_b: float = 0.0,
    preview_duration: float | None = 60.0,
    target_height: int | None = 720,
) -> bool:
    """Renders a short side-by-side preview clip (used by the quick preview endpoint)."""
    # If start delays are not given explicitly, derive them from the clap offset:
    # offset_seconds = clap_b - clap_a, so a negative offset means Camera A started first.
    if start_delay_a == 0.0 and start_delay_b == 0.0:
        if offset_seconds < 0:
            start_delay_b = abs(offset_seconds)
        elif offset_seconds > 0:
            start_delay_a = offset_seconds

    result = merge_side_by_side_video(
        video_a_path,
        video_b_path,
        output_path,
        start_delay_a=start_delay_a,
        start_delay_b=start_delay_b,
        trim_to_overlap=False,  # preview keeps both feeds from their own 0:00
        target_height=target_height,
        max_duration=preview_duration,
    )
    return bool(result.get("success"))


# ---------------------------------------------------------------------------
# Background merge jobs (full-length merges take minutes, so they run detached)
# ---------------------------------------------------------------------------

MERGE_JOBS: dict[str, dict[str, Any]] = {}
MERGE_JOBS_LOCK = threading.Lock()


def _update_merge_job(job_id: str, **fields: Any) -> None:
    with MERGE_JOBS_LOCK:
        job = MERGE_JOBS.get(job_id)
        if job is not None:
            job.update(fields)


def get_merge_job(job_id: str) -> dict[str, Any] | None:
    with MERGE_JOBS_LOCK:
        job = MERGE_JOBS.get(job_id)
        return dict(job) if job else None


def _run_merge_worker(
    job_id: str,
    video_a_path: Path,
    video_b_path: Path,
    output_path: Path,
    start_delay_a: float,
    start_delay_b: float,
    trim_start_a: float,
    trim_start_b: float,
    trim_to_overlap: bool,
    target_height: int | None,
    relative_url: str,
) -> None:
    def on_progress(percent: float, seconds: float) -> None:
        _update_merge_job(
            job_id,
            progress_percent=percent,
            processed_seconds=seconds,
            status="processing",
        )

    result = merge_side_by_side_video(
        video_a_path,
        video_b_path,
        output_path,
        start_delay_a=start_delay_a,
        start_delay_b=start_delay_b,
        trim_start_a=trim_start_a,
        trim_start_b=trim_start_b,
        trim_to_overlap=trim_to_overlap,
        target_height=target_height,
        progress_cb=on_progress,
    )

    if not result.get("success"):
        _update_merge_job(
            job_id,
            status="failed",
            error=result.get("error") or "Merge failed.",
            progress_percent=0.0,
        )
        return

    _update_merge_job(
        job_id,
        status="completed",
        progress_percent=100.0,
        processed_seconds=result["duration"],
        duration=result["duration"],
        width=result["width"],
        height=result["height"],
        fps=result["fps"],
        size_bytes=result["size_bytes"],
        has_audio=result["has_audio"],
        merged_filename=output_path.name,
        relative_url=relative_url,
        merged_video_url=f"http://127.0.0.1:8000{relative_url}",
    )


def create_merge_job(
    video_a_path: Path,
    video_b_path: Path,
    output_path: Path,
    relative_url: str,
    start_delay_a: float = 0.0,
    start_delay_b: float = 0.0,
    trim_start_a: float = 0.0,
    trim_start_b: float = 0.0,
    trim_to_overlap: bool = True,
    target_height: int | None = 1080,
) -> dict[str, Any]:
    """Starts a background side-by-side merge and returns the initial job record."""
    job_id = f"merge_{uuid.uuid4().hex[:10]}"
    plan = build_merge_plan(
        video_a_path,
        video_b_path,
        start_delay_a=start_delay_a,
        start_delay_b=start_delay_b,
        trim_start_a=trim_start_a,
        trim_start_b=trim_start_b,
        trim_to_overlap=trim_to_overlap,
        target_height=target_height,
    )

    job: dict[str, Any] = {
        "job_id": job_id,
        "status": "processing",
        "progress_percent": 0.0,
        "processed_seconds": 0.0,
        "duration": plan["master_duration"],
        "width": plan["output_width"],
        "height": plan["output_height"],
        "fps": plan["fps"],
        "size_bytes": 0,
        "has_audio": bool(plan["video_a"]["has_audio"] or plan["video_b"]["has_audio"]),
        "source_a": video_a_path.name,
        "source_b": video_b_path.name,
        "start_delay_a": plan["start_delay_a"],
        "start_delay_b": plan["start_delay_b"],
        "trim_start_a": plan["trim_start_a"],
        "trim_start_b": plan["trim_start_b"],
        "trim_to_overlap": plan["trim_to_overlap"],
        "merged_filename": output_path.name,
        "relative_url": None,
        "merged_video_url": None,
        "error": None,
        "created_at": time.time(),
    }

    with MERGE_JOBS_LOCK:
        MERGE_JOBS[job_id] = job

    threading.Thread(
        target=_run_merge_worker,
        kwargs={
            "job_id": job_id,
            "video_a_path": video_a_path,
            "video_b_path": video_b_path,
            "output_path": output_path,
            "start_delay_a": start_delay_a,
            "start_delay_b": start_delay_b,
            "trim_start_a": trim_start_a,
            "trim_start_b": trim_start_b,
            "trim_to_overlap": trim_to_overlap,
            "target_height": target_height,
            "relative_url": relative_url,
        },
        daemon=True,
    ).start()

    return dict(job)
