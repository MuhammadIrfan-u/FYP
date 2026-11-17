"""Pitch-space match analytics: player/ball logs, possession, passes, goals.

Consumes detections that ``TeamPossessionTracker.process_frame`` has already enriched
(``track_id``, ``team_id``, ``has_ball`` ...) and projects them onto the pitch with a
``PitchMapper`` (user landmark calibration). Everything below is in metres / seconds.

Logic
-----
* Player position = bottom-centre of the box (feet). People more than
  ``OFF_PITCH_MARGIN_M`` outside the pitch (bench, coaches, spectators) are ignored.
* Ball position = bottom-centre of the best on-pitch ``football`` box, gated against
  impossible jumps from the previous ball position.
* Carrier candidate = nearest player within ``carrier_radius_m`` of the ball; a
  ``player with ball`` detection near the ball (or with no ball visible) also counts.
  A candidate only becomes the *confirmed* carrier after ``confirm_sec`` of continuous
  control, so tracker flicker does not create fake passes.
* Confirmed carrier change A -> B:
    - same team, ball travelled >= ``min_pass_m``  -> completed pass
    - other team, ball travelled >= ``interception_m`` -> interception
      (A's team: failed pass attempt)
    - other team, short distance -> tackle / duel won
    - more than ``max_pass_gap_sec`` without control -> new possession, no pass
* Possession time goes to the team of the last confirmed carrier while the ball is in
  play (paused after the ball goes out or a goal is scored, until the next touch).
* Goal: the ball, after being in play, is seen behind a goal line between the posts
  (within net depth) for ``goal_confirm_samples`` samples. Scorer = last carrier; when
  the scorer's team defends that goal it is logged as an own goal.
* Out of play: ball seen outside the touchline/goal line (not in the goal) ->
  throw-in / corner / goal kick based on the line and the last team in control.
"""

from __future__ import annotations

import csv
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from app.services.pitch_homography import GOAL_HALF_WIDTH, PitchMapper

PLAYER_CLASSES = ("player", "player with ball")
BALL_CLASS = "football"
GOAL_CLASS = "football goal"
TEAM_IDS = (1, 2)

OFF_PITCH_MARGIN_M = 3.0
BALL_MAX_SPEED_MS = 40.0
PLAYER_MAX_SPEED_MS = 11.0
POSITION_EMA = 0.5
HEATMAP_CELL_M = 2.0  # tactical heatmap resolution (metres per cell)
HEATMAP_PHASES = ("all", "in_possession", "out_of_possession")
PLAYER_HEATMAP_MIN_SAMPLES = 10
SHAPE_MIN_PLAYERS = 4


def _feet_px(det: dict[str, Any], w: int, h: int) -> tuple[float, float]:
    x = (float(det.get("x", 0.0)) + float(det.get("w", 0.0)) / 2.0) / 100.0 * w
    y = (float(det.get("y", 0.0)) + float(det.get("h", 0.0))) / 100.0 * h
    return x, y


def _cls(det: dict[str, Any]) -> str:
    return str(det.get("class", "")).lower().strip()


class _PlayerStats:
    __slots__ = (
        "distance_m",
        "goals",
        "last_t",
        "last_xy",
        "max_speed_ms",
        "passes_completed",
        "passes_received",
        "possession_sec",
        "samples",
        "sum_x",
        "sum_y",
        "team_votes",
        "touches",
        "track_id",
        "turnovers",
    )

    def __init__(self, track_id: int):
        self.track_id = track_id
        self.distance_m = 0.0
        self.max_speed_ms = 0.0
        self.last_xy: np.ndarray | None = None
        self.last_t: float | None = None
        self.samples = 0
        self.sum_x = 0.0
        self.sum_y = 0.0
        self.team_votes: dict[int, int] = defaultdict(int)
        self.passes_completed = 0
        self.passes_received = 0
        self.touches = 0
        self.possession_sec = 0.0
        self.turnovers = 0
        self.goals = 0

    @property
    def team(self) -> int | None:
        votes = {t: v for t, v in self.team_votes.items() if t in TEAM_IDS}
        return max(votes, key=votes.get) if votes else None


class MatchAnalytics:
    def __init__(
        self,
        mapper: PitchMapper,
        carrier_radius_m: float = 2.0,
        confirm_sec: float = 0.2,
        min_pass_m: float = 3.0,
        interception_m: float = 5.0,
        max_pass_gap_sec: float = 8.0,
        goal_confirm_samples: int = 2,
        goal_cooldown_sec: float = 10.0,
        net_depth_m: float = 2.5,
        goal_post_tolerance_m: float = 1.0,
        log_dir: Path | None = None,
    ):
        self.mapper = mapper
        self.L = mapper.pitch_length
        self.W = mapper.pitch_width
        self.carrier_radius_m = carrier_radius_m
        self.confirm_sec = confirm_sec
        self.min_pass_m = min_pass_m
        self.interception_m = interception_m
        self.max_pass_gap_sec = max_pass_gap_sec
        self.goal_confirm_samples = goal_confirm_samples
        self.goal_cooldown_sec = goal_cooldown_sec
        self.net_depth_m = net_depth_m
        self.goal_post_tolerance_m = goal_post_tolerance_m

        self.players: dict[int, _PlayerStats] = {}
        self.team_possession_sec = dict.fromkeys(TEAM_IDS, 0.0)
        self.team_control_sec = dict.fromkeys(TEAM_IDS, 0.0)
        self.passes_completed = dict.fromkeys(TEAM_IDS, 0)
        self.passes_attempted = dict.fromkeys(TEAM_IDS, 0)
        self.interceptions = dict.fromkeys(TEAM_IDS, 0)  # won by team
        self.tackles = dict.fromkeys(TEAM_IDS, 0)  # won by team
        self.turnovers = dict.fromkeys(TEAM_IDS, 0)  # lost by team
        self.score = dict.fromkeys(TEAM_IDS, 0)
        self.team_x_sum = dict.fromkeys(TEAM_IDS, 0.0)
        self.team_x_n = dict.fromkeys(TEAM_IDS, 0)
        # Tactical heatmaps on a HEATMAP_CELL_M grid: [row = y cell, col = x cell].
        self.heat_nx = max(1, math.ceil(self.L / HEATMAP_CELL_M))
        self.heat_ny = max(1, math.ceil(self.W / HEATMAP_CELL_M))
        self.heatmaps = {
            t: {ph: self._new_grid() for ph in HEATMAP_PHASES} for t in TEAM_IDS
        }
        self.ball_heatmap = self._new_grid()
        self.player_heatmaps: dict[int, dict[tuple[int, int], int]] = defaultdict(
            lambda: defaultdict(int)
        )
        # Team shape accumulators (per sample with >= SHAPE_MIN_PLAYERS on the pitch).
        self.shape = {
            t: {
                "n": 0,
                "width": 0.0,
                "depth": 0.0,
                "cx": 0.0,
                "cy": 0.0,
                "low_x": 0.0,
                "high_x": 0.0,
            }
            for t in TEAM_IDS
        }
        self.pass_network: dict[tuple[int, int], int] = defaultdict(int)
        self.events: list[dict[str, Any]] = []
        self.event_counter = 0

        self.ball_xy: np.ndarray | None = None
        self.ball_t: float | None = None
        self.ball_samples = 0
        self.ball_seen = 0
        self.ball_distance_m = 0.0
        self.ball_in_play = True

        self.candidate: dict[str, Any] | None = None  # {"track_id", "team", "since"}
        self.carrier: dict[str, Any] | None = None  # confirmed
        self.last_control: dict[str, Any] | None = (
            None  # last confirmed carrier + where/when
        )
        self.possession_team: int | None = None

        self.goal_streak = 0
        self.goal_side: str | None = None
        self.last_goal_t = -math.inf
        self.out_streak = 0

        self.last_t: float | None = None
        self.samples = 0
        self.first_t: float | None = None

        self._players_csv = None
        self._ball_csv = None
        self._players_writer = None
        self._ball_writer = None
        if log_dir is not None:
            log_dir.mkdir(parents=True, exist_ok=True)
            self._players_csv = open(  # noqa: SIM115
                log_dir / "players_log.csv", "w", newline="", encoding="utf-8"
            )
            self._ball_csv = open(  # noqa: SIM115
                log_dir / "ball_log.csv", "w", newline="", encoding="utf-8"
            )
            self._players_writer = csv.writer(self._players_csv)
            self._ball_writer = csv.writer(self._ball_csv)
            self._players_writer.writerow(
                [
                    "timestamp",
                    "frame",
                    "track_id",
                    "team",
                    "class",
                    "confidence",
                    "img_x",
                    "img_y",
                    "pitch_x_m",
                    "pitch_y_m",
                    "speed_kmh",
                    "has_ball",
                ]
            )
            self._ball_writer.writerow(
                [
                    "timestamp",
                    "frame",
                    "detected",
                    "img_x",
                    "img_y",
                    "pitch_x_m",
                    "pitch_y_m",
                    "in_play",
                    "carrier_track_id",
                    "carrier_team",
                ]
            )

    # ------------------------------------------------------------------
    # Per-sample update
    # ------------------------------------------------------------------

    def process(
        self,
        detections: list[dict[str, Any]],
        timestamp: float,
        frame_index: int,
        image_width: int,
        image_height: int,
    ) -> dict[str, Any]:
        t = float(timestamp)
        dt = 0.0 if self.last_t is None else max(0.0, min(t - self.last_t, 2.0))
        self.last_t = t
        if self.first_t is None:
            self.first_t = t
        self.samples += 1
        new_events: list[dict[str, Any]] = []

        # ---- players ---------------------------------------------------
        players = []
        dets = [d for d in detections if _cls(d) in PLAYER_CLASSES]
        if dets:
            px = np.array([_feet_px(d, image_width, image_height) for d in dets])
            pitch = self.mapper.image_to_pitch(px)
            for d, (ix, iy), (mx, my) in zip(dets, px, pitch, strict=False):
                if not (np.isfinite(mx) and np.isfinite(my)):
                    continue
                if not self.mapper.is_on_pitch((mx, my), OFF_PITCH_MARGIN_M):
                    continue
                team = d.get("team_id")
                if team not in TEAM_IDS:
                    team = d.get("nearest_team_id")
                players.append(
                    {
                        "det": d,
                        "track_id": d.get("track_id"),
                        "team": team if team in TEAM_IDS else None,
                        "img": (float(ix), float(iy)),
                        "xy": np.array([mx, my], dtype=np.float64),
                    }
                )

        for p in players:
            speed = self._update_player(p, t)
            p["speed_ms"] = speed
        self._update_shape(players)

        # ---- ball ------------------------------------------------------
        ball_img, ball_xy = self._locate_ball(detections, image_width, image_height, t)
        ball_detected = ball_xy is not None
        self.ball_samples += 1
        if ball_detected:
            self.ball_seen += 1
            if self.mapper.is_on_pitch(ball_xy):
                bx, by = self._cell(ball_xy)
                self.ball_heatmap[by, bx] += 1
            if self.ball_xy is not None:
                self.ball_distance_m += float(np.linalg.norm(ball_xy - self.ball_xy))
            self.ball_xy, self.ball_t = ball_xy, t

        # ---- goal / out of play ------------------------------------------
        goal_event = self._check_goal(
            ball_xy, t, detections, ball_img, image_width, image_height
        )
        if goal_event:
            new_events.append(goal_event)
        else:
            out_event = self._check_out(ball_xy, t)
            if out_event:
                new_events.append(out_event)

        # ---- carrier -----------------------------------------------------
        cand = self._pick_candidate(players, ball_xy)
        confirmed_event = self._update_carrier(cand, t, ball_xy, players)
        if confirmed_event:
            new_events.append(confirmed_event)

        # ---- possession time ---------------------------------------------
        if self.ball_in_play and self.possession_team in TEAM_IDS:
            self.team_possession_sec[self.possession_team] += dt
        if self.carrier is not None and self.carrier["team"] in TEAM_IDS:
            self.team_control_sec[self.carrier["team"]] += dt
            ps = self.players.get(self.carrier["track_id"])
            if ps is not None:
                ps.possession_sec += dt

        carrier_id = self.carrier["track_id"] if self.carrier else None
        carrier_team = self.carrier["team"] if self.carrier else None

        # ---- logs ----------------------------------------------------------
        if self._players_writer is not None:
            for p in players:
                d = p["det"]
                self._players_writer.writerow(
                    [
                        round(t, 3),
                        frame_index,
                        p["track_id"],
                        p["team"] or "",
                        _cls(d),
                        d.get("confidence"),
                        round(p["img"][0], 1),
                        round(p["img"][1], 1),
                        round(float(p["xy"][0]), 2),
                        round(float(p["xy"][1]), 2),
                        "" if p["speed_ms"] is None else round(p["speed_ms"] * 3.6, 1),
                        int(p["track_id"] is not None and p["track_id"] == carrier_id),
                    ]
                )
        if self._ball_writer is not None:
            self._ball_writer.writerow(
                [
                    round(t, 3),
                    frame_index,
                    int(ball_detected),
                    "" if ball_img is None else round(ball_img[0], 1),
                    "" if ball_img is None else round(ball_img[1], 1),
                    "" if ball_xy is None else round(float(ball_xy[0]), 2),
                    "" if ball_xy is None else round(float(ball_xy[1]), 2),
                    int(self.ball_in_play),
                    carrier_id or "",
                    carrier_team or "",
                ]
            )

        return {
            "timestamp": round(t, 3),
            "ball": None
            if self.ball_xy is None
            else [round(float(v), 2) for v in self.ball_xy],
            "ball_detected": ball_detected,
            "ball_in_play": self.ball_in_play,
            "players": [
                {
                    "track_id": p["track_id"],
                    "team": p["team"],
                    "x": round(float(p["xy"][0]), 2),
                    "y": round(float(p["xy"][1]), 2),
                    "has_ball": p["track_id"] is not None
                    and p["track_id"] == carrier_id,
                }
                for p in players
            ],
            "carrier": None if self.carrier is None else dict(self.carrier),
            "possession_team": self.possession_team,
            "possession_percent": self.possession_percent(),
            "score": {"team_1": self.score[1], "team_2": self.score[2]},
            "passes": {
                "team_1": self.passes_completed[1],
                "team_2": self.passes_completed[2],
            },
            "events": new_events,
        }

    # ------------------------------------------------------------------

    def _update_player(self, p: dict[str, Any], t: float) -> float | None:
        tid = p["track_id"]
        if tid is None:
            return None
        ps = self.players.get(tid)
        if ps is None:
            ps = self.players[tid] = _PlayerStats(tid)
        if p["team"] in TEAM_IDS:
            ps.team_votes[p["team"]] += 1
        xy = p["xy"]
        speed = None
        if ps.last_xy is not None and ps.last_t is not None and t > ps.last_t:
            smoothed = POSITION_EMA * xy + (1 - POSITION_EMA) * ps.last_xy
            step = float(np.linalg.norm(smoothed - ps.last_xy))
            gap = t - ps.last_t
            speed = step / gap
            if speed <= PLAYER_MAX_SPEED_MS and gap <= 2.0:
                ps.distance_m += step
                ps.max_speed_ms = max(ps.max_speed_ms, speed)
                ps.last_xy = smoothed
            else:  # identity switch / long gap: restart from the new point
                speed = None
                ps.last_xy = xy
        else:
            ps.last_xy = xy
        ps.last_t = t
        ps.samples += 1
        ps.sum_x += float(xy[0])
        ps.sum_y += float(xy[1])

        team = p["team"]
        if team in TEAM_IDS and self.mapper.is_on_pitch(xy):
            self.team_x_sum[team] += float(xy[0])
            self.team_x_n[team] += 1
            bx, by = self._cell(xy)
            grids = self.heatmaps[team]
            grids["all"][by, bx] += 1
            # Phase relative to the team in possession going into this sample.
            if self.possession_team in TEAM_IDS:
                phase = (
                    "in_possession"
                    if self.possession_team == team
                    else "out_of_possession"
                )
                grids[phase][by, bx] += 1
            self.player_heatmaps[tid][(bx, by)] += 1
        return speed

    def _new_grid(self) -> np.ndarray:
        return np.zeros((self.heat_ny, self.heat_nx), dtype=np.int64)

    def _cell(self, xy: np.ndarray) -> tuple[int, int]:
        bx = min(self.heat_nx - 1, max(0, int(float(xy[0]) / HEATMAP_CELL_M)))
        by = min(self.heat_ny - 1, max(0, int(float(xy[1]) / HEATMAP_CELL_M)))
        return bx, by

    def _update_shape(self, players: list[dict[str, Any]]) -> None:
        """Team width/depth/centroid and last-line positions for this sample."""
        for team in TEAM_IDS:
            pts = np.array(
                [
                    p["xy"]
                    for p in players
                    if p["team"] == team and self.mapper.is_on_pitch(p["xy"])
                ]
            )
            if len(pts) < SHAPE_MIN_PLAYERS:
                continue
            xs = np.sort(pts[:, 0])
            # Skip the extreme player at each end (usually the goalkeeper) so depth
            # and the defensive line describe the outfield block.
            s = self.shape[team]
            s["n"] += 1
            s["width"] += float(pts[:, 1].max() - pts[:, 1].min())
            s["depth"] += float(xs[-2] - xs[1])
            s["cx"] += float(pts[:, 0].mean())
            s["cy"] += float(pts[:, 1].mean())
            s["low_x"] += float(xs[1])
            s["high_x"] += float(xs[-2])

    def _shape_summary(self, team: int) -> dict[str, Any] | None:
        s = self.shape[team]
        if not s["n"]:
            return None
        n = s["n"]
        low, high = s["low_x"] / n, s["high_x"] / n
        defending = (
            "left"
            if self.defending_team("left") == team
            else "right"
            if self.defending_team("right") == team
            else None
        )
        if defending == "left":
            line_height = low
        elif defending == "right":
            line_height = self.L - high
        else:
            line_height = None
        return {
            "samples": n,
            "avg_width_m": round(s["width"] / n, 1),
            "avg_depth_m": round(s["depth"] / n, 1),
            "avg_centroid": [round(s["cx"] / n, 1), round(s["cy"] / n, 1)],
            "defending_side": defending,
            "attacking_direction": None
            if defending is None
            else ("right" if defending == "left" else "left"),
            "defensive_line_height_m": None
            if line_height is None
            else round(line_height, 1),
        }

    def heatmaps_payload(
        self, min_player_samples: int = PLAYER_HEATMAP_MIN_SAMPLES
    ) -> dict[str, Any]:
        """Tactical heatmaps (team x phase, ball, per player) for heatmaps.json."""
        players = {}
        for tid, cells in self.player_heatmaps.items():
            ps = self.players.get(tid)
            if ps is None or ps.samples < min_player_samples:
                continue
            players[str(tid)] = {
                "track_id": tid,
                "team": ps.team,
                "samples": ps.samples,
                "avg_position": [
                    round(ps.sum_x / ps.samples, 1),
                    round(ps.sum_y / ps.samples, 1),
                ],
                "cells": [[bx, by, c] for (bx, by), c in cells.items()],
            }
        return {
            "cell_m": HEATMAP_CELL_M,
            "nx": self.heat_nx,
            "ny": self.heat_ny,
            "pitch": {"length": self.L, "width": self.W},
            "teams": {
                f"team_{t}": {ph: g.tolist() for ph, g in self.heatmaps[t].items()}
                for t in TEAM_IDS
            },
            "ball": self.ball_heatmap.tolist(),
            "players": players,
            "shape": {f"team_{t}": self._shape_summary(t) for t in TEAM_IDS},
        }

    def _locate_ball(
        self, detections: list[dict[str, Any]], w: int, h: int, t: float
    ) -> tuple[tuple[float, float] | None, np.ndarray | None]:
        balls = [d for d in detections if _cls(d) == BALL_CLASS]
        if not balls:
            return None, None
        px = np.array([_feet_px(d, w, h) for d in balls])
        pitch = self.mapper.image_to_pitch(px)
        best = None
        for d, img, xy in zip(balls, px, pitch, strict=False):
            if not np.all(np.isfinite(xy)):
                continue
            # Allow the ball inside the goal nets (behind the goal line).
            if not self.mapper.is_on_pitch(xy, self.net_depth_m + 0.5):
                continue
            if self.ball_xy is not None and self.ball_t is not None:
                gap = max(1e-3, t - self.ball_t)
                jump = float(np.linalg.norm(xy - self.ball_xy))
                if gap < 1.0 and jump > BALL_MAX_SPEED_MS * gap + 3.0:
                    continue
                score = float(d.get("confidence", 0.0)) - jump / 100.0
            else:
                score = float(d.get("confidence", 0.0))
            if best is None or score > best[0]:
                best = (
                    score,
                    (float(img[0]), float(img[1])),
                    np.asarray(xy, dtype=np.float64),
                )
        if best is None:
            return None, None
        return best[1], best[2]

    def _pick_candidate(
        self, players: list[dict[str, Any]], ball_xy: np.ndarray | None
    ) -> dict[str, Any] | None:
        tracked = [p for p in players if p["track_id"] is not None]
        if not tracked:
            return None
        flagged = [p for p in tracked if p["det"].get("has_ball")]
        if ball_xy is not None:
            dists = [float(np.linalg.norm(p["xy"] - ball_xy)) for p in tracked]
            i = int(np.argmin(dists))
            if dists[i] <= self.carrier_radius_m:
                return tracked[i]
            for p in flagged:
                if (
                    float(np.linalg.norm(p["xy"] - ball_xy))
                    <= 2.0 * self.carrier_radius_m
                ):
                    return p
            return None
        return flagged[0] if flagged else None

    def _update_carrier(
        self,
        cand: dict[str, Any] | None,
        t: float,
        ball_xy: np.ndarray | None,
        players: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        if cand is None or cand["team"] not in TEAM_IDS:
            self.candidate = None
            # Control is released once the confirmed carrier no longer has the ball.
            self.carrier = None
            return None

        tid, team = cand["track_id"], cand["team"]
        if self.candidate is None or self.candidate["track_id"] != tid:
            self.candidate = {"track_id": tid, "team": team, "since": t}
        if t - self.candidate["since"] < self.confirm_sec and self.samples > 1:
            # Not yet confirmed; keep the previous carrier only if it is still this player.
            if self.carrier is not None and self.carrier["track_id"] != tid:
                self.carrier = None
            return None

        position = cand["xy"] if ball_xy is None else ball_xy
        event = None
        prev = self.last_control
        is_new = self.carrier is None or self.carrier["track_id"] != tid
        self.carrier = {"track_id": tid, "team": team}

        if is_new:
            ps = self.players.get(tid)
            if ps is not None:
                ps.touches += 1
            if prev is not None and self.ball_in_play and prev["track_id"] != tid:
                gap = t - prev["t"]
                travel = float(np.linalg.norm(position - prev["xy"]))
                if gap <= self.max_pass_gap_sec:
                    event = self._classify_transfer(
                        prev, tid, team, travel, t, position
                    )
            if not self.ball_in_play:
                self.ball_in_play = True  # restart (throw-in / kick-off / ...)
            self.possession_team = team

        self.last_control = {
            "track_id": tid,
            "team": team,
            "t": t,
            "xy": np.array(position),
        }
        return event

    def _classify_transfer(
        self,
        prev: dict[str, Any],
        tid: int,
        team: int,
        travel: float,
        t: float,
        pos: np.ndarray,
    ) -> dict[str, Any] | None:
        from_id, from_team = prev["track_id"], prev["team"]
        if from_team == team:
            if travel < self.min_pass_m:
                return None  # Likely a re-identified track of the same player.
            self.passes_completed[team] += 1
            self.passes_attempted[team] += 1
            self.pass_network[(from_id, tid)] += 1
            if from_id in self.players:
                self.players[from_id].passes_completed += 1
            if tid in self.players:
                self.players[tid].passes_received += 1
            return self._log(
                "pass",
                t,
                team=team,
                from_player=from_id,
                to_player=tid,
                distance_m=travel,
                start=prev["xy"],
                end=pos,
                description=f"Team {team} pass #{from_id} -> #{tid} ({travel:.1f} m)",
            )
        self.turnovers[from_team] += 1
        if from_id in self.players:
            self.players[from_id].turnovers += 1
        if travel >= self.interception_m:
            self.passes_attempted[from_team] += 1
            self.interceptions[team] += 1
            kind, verb = "interception", "intercepted"
        else:
            self.tackles[team] += 1
            kind, verb = "tackle", "won the ball from"
        return self._log(
            kind,
            t,
            team=team,
            from_player=from_id,
            to_player=tid,
            from_team=from_team,
            distance_m=travel,
            start=prev["xy"],
            end=pos,
            description=f"Team {team} #{tid} {verb} Team {from_team} #{from_id}",
        )

    def _check_goal(
        self,
        ball_xy: np.ndarray | None,
        t: float,
        detections: list[dict[str, Any]],
        ball_img: tuple[float, float] | None,
        w: int,
        h: int,
    ) -> dict[str, Any] | None:
        if ball_xy is None or t - self.last_goal_t < self.goal_cooldown_sec:
            return None
        bx, by = float(ball_xy[0]), float(ball_xy[1])
        cy = self.W / 2.0
        between_posts = abs(by - cy) <= GOAL_HALF_WIDTH + self.goal_post_tolerance_m
        side = None
        if between_posts and -self.net_depth_m <= bx < -0.2:
            side = "left"
        elif between_posts and self.L + 0.2 < bx <= self.L + self.net_depth_m:
            side = "right"
        if side is None or not self.ball_in_play:
            self.goal_streak = 0
            self.goal_side = None
            return None

        self.goal_streak = self.goal_streak + 1 if self.goal_side == side else 1
        self.goal_side = side
        in_goal_box = ball_img is not None and any(
            _cls(d) == GOAL_CLASS
            and d["x"] / 100 * w <= ball_img[0] <= (d["x"] + d["w"]) / 100 * w
            and d["y"] / 100 * h <= ball_img[1] <= (d["y"] + d["h"]) / 100 * h
            for d in detections
        )
        if self.goal_streak < self.goal_confirm_samples and not in_goal_box:
            return None

        # Goal confirmed.
        self.goal_streak = 0
        self.last_goal_t = t
        self.ball_in_play = False
        last = self.last_control
        scorer = last["track_id"] if last and t - last["t"] <= 6.0 else None
        scorer_team = last["team"] if last and t - last["t"] <= 6.0 else None
        defending = self.defending_team(side)
        own_goal = (
            scorer_team is not None
            and defending is not None
            and scorer_team == defending
        )
        if defending in TEAM_IDS:
            credited = 3 - defending
        else:
            credited = scorer_team
        if credited in TEAM_IDS:
            self.score[credited] += 1
        if scorer is not None and scorer in self.players and not own_goal:
            self.players[scorer].goals += 1
        self.carrier = None
        self.candidate = None
        self.possession_team = None
        desc = (
            f"GOAL! Team {credited}"
            + (
                f" (own goal by #{scorer})"
                if own_goal
                else (f" scored by #{scorer}" if scorer else "")
            )
            if credited
            else "GOAL!"
        )
        return self._log(
            "goal",
            t,
            team=credited,
            scorer=scorer,
            own_goal=own_goal,
            goal_side=side,
            confirmed_by_goal_detection=in_goal_box,
            score={"team_1": self.score[1], "team_2": self.score[2]},
            end=ball_xy,
            description=desc,
        )

    def _check_out(self, ball_xy: np.ndarray | None, t: float) -> dict[str, Any] | None:
        if ball_xy is None or not self.ball_in_play:
            self.out_streak = 0 if ball_xy is not None else self.out_streak
            return None
        bx, by = float(ball_xy[0]), float(ball_xy[1])
        margin = 0.5
        out_side = by < -margin or by > self.W + margin
        out_end = bx < -margin or bx > self.L + margin
        if not (out_side or out_end):
            self.out_streak = 0
            return None
        self.out_streak += 1
        if self.out_streak < 2:
            return None
        self.out_streak = 0
        self.ball_in_play = False
        last_team = self.last_control["team"] if self.last_control else None
        if out_side:
            restart = "throw_in"
            restart_team = (3 - last_team) if last_team in TEAM_IDS else None
        else:
            side = "left" if bx < 0 else "right"
            defending = self.defending_team(side)
            if (
                last_team is not None
                and defending is not None
                and last_team == defending
            ):
                restart, restart_team = "corner", 3 - defending
            else:
                restart, restart_team = "goal_kick", defending
        self.carrier = None
        self.candidate = None
        return self._log(
            "out",
            t,
            team=restart_team,
            restart=restart,
            last_touch_team=last_team,
            end=ball_xy,
            description=f"Ball out — {restart.replace('_', ' ')}"
            + (f" for Team {restart_team}" if restart_team else ""),
        )

    # ------------------------------------------------------------------

    def defending_team(self, side: str) -> int | None:
        """Team defending the left/right goal, from each team's mean x position."""
        if any(self.team_x_n[t] < 5 for t in TEAM_IDS):
            return None
        mean = {t: self.team_x_sum[t] / self.team_x_n[t] for t in TEAM_IDS}
        left_team = 1 if mean[1] < mean[2] else 2
        return left_team if side == "left" else 3 - left_team

    def possession_percent(self) -> dict[str, float]:
        total = sum(self.team_possession_sec.values())
        if total <= 0:
            return {"team_1": 0.0, "team_2": 0.0}
        return {
            "team_1": round(100.0 * self.team_possession_sec[1] / total, 1),
            "team_2": round(100.0 * self.team_possession_sec[2] / total, 1),
        }

    def _log(self, kind: str, t: float, **kw: Any) -> dict[str, Any]:
        self.event_counter += 1
        evt: dict[str, Any] = {
            "id": f"m-{self.event_counter}",
            "type": kind,
            "timestamp": round(t, 2),
        }
        for k, v in kw.items():
            if isinstance(v, np.ndarray):
                v = [round(float(a), 2) for a in v]
            elif isinstance(v, float):
                v = round(v, 2)
            evt[k] = v
        self.events.append(evt)
        return evt

    # ------------------------------------------------------------------
    # Summary / persistence
    # ------------------------------------------------------------------

    def summary(
        self, max_events: int = 500, min_player_samples: int = 5
    ) -> dict[str, Any]:
        duration = (
            0.0
            if self.first_t is None or self.last_t is None
            else self.last_t - self.first_t
        )
        pct = self.possession_percent()
        teams = {}
        for t in TEAM_IDS:
            att = self.passes_attempted[t]
            dist = sum(p.distance_m for p in self.players.values() if p.team == t)
            teams[f"team_{t}"] = {
                "team_id": t,
                "possession_percent": pct[f"team_{t}"],
                "possession_sec": round(self.team_possession_sec[t], 1),
                "control_sec": round(self.team_control_sec[t], 1),
                "passes_completed": self.passes_completed[t],
                "passes_attempted": att,
                "pass_accuracy": round(100.0 * self.passes_completed[t] / att, 1)
                if att
                else None,
                "interceptions": self.interceptions[t],
                "tackles": self.tackles[t],
                "turnovers": self.turnovers[t],
                "goals": self.score[t],
                "distance_km": round(dist / 1000.0, 2),
                "mean_x_m": round(self.team_x_sum[t] / self.team_x_n[t], 1)
                if self.team_x_n[t]
                else None,
                "shape": self._shape_summary(t),
            }
        players = []
        for ps in self.players.values():
            if ps.samples < min_player_samples:
                continue
            players.append(
                {
                    "track_id": ps.track_id,
                    "team": ps.team,
                    "samples": ps.samples,
                    "distance_m": round(ps.distance_m, 1),
                    "max_speed_kmh": round(ps.max_speed_ms * 3.6, 1),
                    "avg_x_m": round(ps.sum_x / ps.samples, 1),
                    "avg_y_m": round(ps.sum_y / ps.samples, 1),
                    "touches": ps.touches,
                    "passes_completed": ps.passes_completed,
                    "passes_received": ps.passes_received,
                    "turnovers": ps.turnovers,
                    "possession_sec": round(ps.possession_sec, 1),
                    "goals": ps.goals,
                }
            )
        players.sort(key=lambda p: (-p["samples"], p["track_id"]))
        counts: dict[str, int] = defaultdict(int)
        for e in self.events:
            counts[e["type"]] += 1
        return {
            "calibrated": True,
            "pitch": {"length": self.L, "width": self.W},
            "duration_analyzed_sec": round(duration, 1),
            "samples": self.samples,
            "score": {"team_1": self.score[1], "team_2": self.score[2]},
            "possession_percent": pct,
            "teams": teams,
            "attacking": {
                "team_defending_left_goal": self.defending_team("left"),
                "team_defending_right_goal": self.defending_team("right"),
            },
            "ball": {
                "samples": self.ball_samples,
                "detected_percent": round(100.0 * self.ball_seen / self.ball_samples, 1)
                if self.ball_samples
                else 0.0,
                "distance_m": round(self.ball_distance_m, 1),
                "in_play": self.ball_in_play,
                "last_position": None
                if self.ball_xy is None
                else [round(float(v), 2) for v in self.ball_xy],
            },
            "event_counts": dict(counts),
            "goals": [e for e in self.events if e["type"] == "goal"],
            "events": self.events[-max_events:],
            "players": players,
            "pass_network": [
                {"from": a, "to": b, "count": c}
                for (a, b), c in sorted(
                    self.pass_network.items(), key=lambda kv: -kv[1]
                )
            ],
        }

    def flush(self) -> None:
        for f in (self._players_csv, self._ball_csv):
            if f is not None:
                f.flush()

    def close(self) -> None:
        for f in (self._players_csv, self._ball_csv):
            if f is not None and not f.closed:
                f.close()
