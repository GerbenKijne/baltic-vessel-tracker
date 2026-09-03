"""Mandatory pre-build capture spike (PRD SS12.1).

Runs a timed capture against the real AISStream feed for whatever boxes
`worker.config.DEFAULT_BOUNDING_BOXES` currently defines (originally
Stockholm/Gothenburg/Öresund; since 2026-09-03, a single wider box
covering the Stockholm archipelago, Gotland, Åland, and the southern
Finnish coast) and reports exactly what the PRD asks for before any live
AISStream data may be persisted in production: unique MMSIs,
position-messages/minute, update intervals, disconnects, and field
completeness -- plus a rough 90-day storage estimate.

This is a standalone diagnostic tool, not part of the running worker.
It uses the same adapter and parser the real pipeline uses, so a
successful capture also exercises that code end-to-end.

Usage:
    export AISSTREAM_API_KEY=...          # from https://aisstream.io
    python -m scripts.aisstream_capture                 # default: 60 minutes, all configured boxes
    python -m scripts.aisstream_capture --minutes 5      # shorter smoke test
    python -m scripts.aisstream_capture --box stockholm  # one box only

Paste the printed summary into docs/data-source-register.md when done --
that file is what gates enabling this adapter in production (PRD SS12.1,
SS21 "Provider storage/licence terms").
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "workers/ingest"))
sys.path.insert(0, str(_REPO_ROOT / "packages/contracts/python"))

from canonical import Source  # noqa: E402

from worker.adapters.aisstream import AISStreamAdapter  # noqa: E402
from worker.config import DEFAULT_BOUNDING_BOXES  # noqa: E402
from worker.normalize import IgnorableMessage, parse_and_normalize  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("aisstream_capture")

_BOX_NAMES = ["stockholm", "gothenburg", "oresund"]


class _ReconnectCounter(logging.Handler):
    """Counts the adapter's own reconnect/retry log lines, since the
    adapter doesn't expose that count via its public interface."""

    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.count = 0

    def emit(self, record: logging.LogRecord) -> None:
        if record.name == "worker.adapters.aisstream":
            self.count += 1


@dataclass
class _BoxStats:
    name: str
    mmsi_last_seen: dict = field(default_factory=dict)
    update_intervals_seconds: list = field(default_factory=list)
    position_messages: int = 0
    static_messages: int = 0
    field_present_counts: dict = field(default_factory=lambda: defaultdict(int))
    field_total_counts: dict = field(default_factory=lambda: defaultdict(int))

    @property
    def unique_mmsi_count(self) -> int:
        return len(self.mmsi_last_seen)


def _box_for(lon: float, lat: float, boxes: list) -> int | None:
    for i, box in enumerate(boxes):
        (lat1, lon1), (lat2, lon2) = box
        if min(lat1, lat2) <= lat <= max(lat1, lat2) and min(lon1, lon2) <= lon <= max(lon1, lon2):
            return i
    return None


def _track_field_completeness(stats: _BoxStats, obs) -> None:
    for field_name in ("sog_kn", "cog_deg", "heading_deg", "nav_status", "name"):
        stats.field_total_counts[field_name] += 1
        if getattr(obs, field_name) is not None:
            stats.field_present_counts[field_name] += 1


async def run_capture(minutes: int, boxes: list, box_names: list) -> None:
    api_key = os.environ.get("AISSTREAM_API_KEY")
    if not api_key:
        print("Set AISSTREAM_API_KEY first (sign up at https://aisstream.io).", file=sys.stderr)
        sys.exit(1)

    adapter = AISStreamAdapter(api_key=api_key, bounding_boxes=boxes)
    box_stats = [_BoxStats(name=name) for name in box_names]
    unmatched_count = 0
    error_count = 0
    started_at = datetime.now(timezone.utc)
    deadline = asyncio.get_event_loop().time() + minutes * 60

    reconnect_counter = _ReconnectCounter()
    logging.getLogger("worker.adapters.aisstream").addHandler(reconnect_counter)

    logger.info("Starting %d-minute capture across %d boxes", minutes, len(boxes))

    stream = adapter.stream()
    try:
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(
                    stream.__anext__(), timeout=deadline - asyncio.get_event_loop().time()
                )
            except asyncio.TimeoutError:
                break

            try:
                obs = parse_and_normalize(raw, Source.AISSTREAM)
            except IgnorableMessage:
                continue
            except Exception as exc:  # noqa: BLE001
                error_count += 1
                logger.debug("Quarantined message: %s", exc)
                continue

            if obs.position is None:
                # Static data isn't geofenced by AISStream's BoundingBoxes
                # the same way position reports are; count it globally
                # against box 0 for a rough static-message-rate signal.
                box_stats[0].static_messages += 1
                continue

            box_index = _box_for(obs.position.lon, obs.position.lat, boxes)
            if box_index is None:
                unmatched_count += 1
                continue

            stats = box_stats[box_index]
            stats.position_messages += 1
            _track_field_completeness(stats, obs)

            now = datetime.now(timezone.utc)
            last_seen = stats.mmsi_last_seen.get(obs.mmsi)
            if last_seen is not None:
                stats.update_intervals_seconds.append((now - last_seen).total_seconds())
            stats.mmsi_last_seen[obs.mmsi] = now
    except KeyboardInterrupt:
        logger.info("Interrupted, reporting partial results")
    finally:
        await stream.aclose()

    elapsed_minutes = max((datetime.now(timezone.utc) - started_at).total_seconds() / 60, 1 / 60)

    report = {
        "captured_at": started_at.isoformat(),
        "requested_minutes": minutes,
        "actual_minutes": round(elapsed_minutes, 2),
        "parse_errors": error_count,
        "reconnects": reconnect_counter.count,
        "positions_outside_any_box": unmatched_count,
        "boxes": [],
    }
    for stats in box_stats:
        intervals = stats.update_intervals_seconds
        report["boxes"].append(
            {
                "name": stats.name,
                "unique_mmsi": stats.unique_mmsi_count,
                "position_messages": stats.position_messages,
                "position_messages_per_minute": round(
                    stats.position_messages / elapsed_minutes, 2
                ),
                "static_messages": stats.static_messages,
                "median_update_interval_seconds": (
                    round(statistics.median(intervals), 1) if intervals else None
                ),
                "field_completeness": {
                    name: round(
                        stats.field_present_counts[name] / stats.field_total_counts[name], 3
                    )
                    for name in stats.field_total_counts
                },
            }
        )

    total_positions = sum(b["position_messages"] for b in report["boxes"])
    # Rough per-row size: uuid + geography point + timestamps + small text.
    bytes_per_row_estimate = 200
    rows_per_90_days = total_positions * (90 * 24 * 60 / elapsed_minutes)
    report["storage_estimate_90_days_mb"] = round(
        rows_per_90_days * bytes_per_row_estimate / (1024 * 1024), 1
    )

    print("\n" + "=" * 70)
    print("AISSTREAM CAPTURE REPORT -- paste this into docs/data-source-register.md")
    print("=" * 70)
    print(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minutes", type=int, default=60)
    parser.add_argument(
        "--box",
        choices=_BOX_NAMES,
        help="Capture a single box instead of all three (still labeled correctly in the report).",
    )
    args = parser.parse_args()

    if args.box:
        index = _BOX_NAMES.index(args.box)
        boxes = [DEFAULT_BOUNDING_BOXES[index]]
        box_names = [args.box]
    else:
        boxes = DEFAULT_BOUNDING_BOXES
        box_names = _BOX_NAMES

    asyncio.run(run_capture(args.minutes, boxes, box_names))


if __name__ == "__main__":
    main()
