"""Parse + normalize a raw provider message into a CanonicalAisObservation.

PRD SS8.1 event flow, steps 2-3. Every field is defensively bounded; a
malformed message raises ValueError so the caller can quarantine it into
raw_messages instead of crashing the worker (PRD success metric: "no process
crash from malformed provider messages").

Each source has its own wire format, so extraction is source-specific
(`_extract_simulator`, `_extract_aisstream`); everything after extraction
(bounds checking, sentinel handling, dedupe key, building the canonical
object) is shared, so adding a source means adding one extractor, not
duplicating the validation logic.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from canonical import CanonicalAisObservation, NavStatus, Position, QualityFlag, Source

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class IgnorableMessage(ValueError):
    """A provider message that is valid and expected but isn't AIS data
    (e.g. a subscription acknowledgment) -- distinct from a malformed
    message, so callers can skip it without counting it as an error or
    quarantining it. Subclasses ValueError so code that only catches
    Exception broadly still behaves safely if it doesn't check for this
    specifically.
    """

_NAV_STATUS_MAP = {
    0: NavStatus.UNDER_WAY_USING_ENGINE,
    1: NavStatus.AT_ANCHOR,
    2: NavStatus.NOT_UNDER_COMMAND,
    3: NavStatus.RESTRICTED_MANOEUVRABILITY,
    4: NavStatus.CONSTRAINED_BY_DRAUGHT,
    5: NavStatus.MOORED,
    6: NavStatus.AGROUND,
    7: NavStatus.FISHING,
    8: NavStatus.UNDER_WAY_SAILING,
}

# ITU-R M.1371 AIS message type numbers, used so `message_type` stays the
# integer the canonical contract (and PRD Appendix B's example event)
# expects, regardless of how a given provider names things over the wire.
_AIS_MSG_TYPE_POSITION_REPORT_CLASS_A = 1
_AIS_MSG_TYPE_STATIC_AND_VOYAGE_DATA = 5


@dataclass
class _ExtractedFields:
    mmsi: str
    message_type: Optional[int]
    lon: Optional[float] = None
    lat: Optional[float] = None
    sog: Optional[float] = None
    cog: Optional[float] = None
    heading: Optional[int] = None
    nav_status_code: Optional[int] = None
    observed_at: Optional[datetime] = None
    name: Optional[str] = None
    callsign: Optional[str] = None
    destination: Optional[str] = None
    quality_flags: list[QualityFlag] = field(default_factory=list)


def _clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = _CONTROL_CHARS.sub("", value).strip()
    return cleaned or None


def compute_dedupe_key(
    source: str, mmsi: str, observed_at: datetime, lon: float, lat: float
) -> str:
    bucket = observed_at.replace(microsecond=0).isoformat()
    raw = f"{source}:{mmsi}:{bucket}:{round(lon, 4)}:{round(lat, 4)}"
    return hashlib.sha256(raw.encode()).hexdigest()


def compute_identity_dedupe_key(source: str, mmsi: str, bucket_start: datetime) -> str:
    """Dedupe basis for messages with no position (e.g. static/voyage data),
    which repeat far less often than position reports -- bucketed by minute
    rather than second."""
    bucket = bucket_start.replace(microsecond=0, second=0).isoformat()
    raw = f"{source}:{mmsi}:identity:{bucket}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _extract_simulator(raw: dict) -> _ExtractedFields:
    observed_at = datetime.fromisoformat(str(raw["timestamp"]).replace("Z", "+00:00"))
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)

    return _ExtractedFields(
        mmsi=str(raw["mmsi"]).strip(),
        message_type=raw.get("message_type"),
        lon=float(raw["lon"]),
        lat=float(raw["lat"]),
        sog=raw.get("sog"),
        cog=raw.get("cog"),
        heading=raw.get("heading"),
        nav_status_code=raw.get("nav_status"),
        observed_at=observed_at,
        name=_clean_text(raw.get("name")),
        callsign=_clean_text(raw.get("callsign")),
        destination=_clean_text(raw.get("destination")),
    )


def _extract_aisstream(raw: dict) -> _ExtractedFields:
    """See https://github.com/aisstream/ais-message-models for the wire
    schema. Only PositionReport and ShipStaticData are handled -- the
    only two message types this adapter subscribes to.
    """
    message_type = raw["MessageType"]

    # Not an AIS data message: sent once per connection, right after a
    # subscription is accepted, and does NOT follow the Message[MessageType]
    # nesting every actual data message uses (it's just
    # {"MessageType": "SubscriptionConfirmation", "Message": {"CompressionEnabled": true}}).
    # Confirmed live 2026-09-02 -- indexing into it like a data message
    # raises KeyError, which is not a malformed-message situation.
    if message_type == "SubscriptionConfirmation":
        raise IgnorableMessage("AISStream subscription acknowledged")

    body = raw["Message"][message_type]
    mmsi = str(body["UserID"]).strip().zfill(9)

    if message_type == "PositionReport":
        if body.get("Valid") is False:
            raise ValueError("AISStream flagged this position report as invalid")

        sog = body.get("Sog")
        # 102.3 is the AIS "speed not available" sentinel.
        if sog is not None and sog >= 102.3:
            sog = None

        cog = body.get("Cog")
        # 360.0 is the AIS "course not available" sentinel.
        if cog is not None and cog >= 360.0:
            cog = None

        return _ExtractedFields(
            mmsi=mmsi,
            message_type=_AIS_MSG_TYPE_POSITION_REPORT_CLASS_A,
            lon=float(body["Longitude"]),
            lat=float(body["Latitude"]),
            sog=sog,
            cog=cog,
            heading=body.get("TrueHeading"),
            nav_status_code=body.get("NavigationalStatus"),
            # AIS's PositionReport.Timestamp is only the UTC *second* the
            # report was generated (0-59), not a usable full timestamp --
            # reconstructing one from that alone would be inventing data
            # the provider doesn't actually give us. received_at is used
            # as the effective time instead (PRD SS9.2: "fall back to
            # received_at when provider time is absent or flagged").
            observed_at=None,
            quality_flags=[QualityFlag.DERIVED_TIME],
        )

    if message_type == "ShipStaticData":
        # Identity only; no position. Deliberately not extracting
        # IMO/callsign/destination/dimensions/ETA yet -- vessel detail
        # richness is Phase 3 scope (PRD SS19), and extending
        # upsert_vessel_identity to store them is a bigger, separate
        # change (see docs/data-source-register.md).
        return _ExtractedFields(
            mmsi=mmsi,
            message_type=_AIS_MSG_TYPE_STATIC_AND_VOYAGE_DATA,
            name=_clean_text(body.get("Name")),
        )

    raise ValueError(f"Unsupported AISStream message type: {message_type!r}")


_EXTRACTORS = {
    Source.SIMULATOR: _extract_simulator,
    Source.AISSTREAM: _extract_aisstream,
}


def parse_and_normalize(
    raw: dict, source: Source, raw_ref: Optional[UUID] = None
) -> CanonicalAisObservation:
    """Raises ValueError (or pydantic.ValidationError) on a malformed message."""
    extractor = _EXTRACTORS.get(source)
    if extractor is None:
        raise ValueError(f"No parser registered for source: {source!r}")
    fields = extractor(raw)

    mmsi = fields.mmsi
    if not mmsi.isdigit() or len(mmsi) != 9:
        raise ValueError(f"invalid mmsi: {mmsi!r}")

    position: Optional[Position] = None
    if fields.lon is not None and fields.lat is not None:
        if not (-180 <= fields.lon <= 180 and -90 <= fields.lat <= 90):
            raise ValueError(f"position out of bounds: {fields.lon}, {fields.lat}")
        position = Position(lon=fields.lon, lat=fields.lat)

    heading = fields.heading
    # AIS uses 511 as the "not available" sentinel for heading.
    if heading is not None and int(heading) == 511:
        heading = None

    nav_status = (
        _NAV_STATUS_MAP.get(int(fields.nav_status_code), NavStatus.UNKNOWN)
        if fields.nav_status_code is not None
        else None
    )

    received_at = datetime.now(timezone.utc)
    observed_at = fields.observed_at

    if position is not None:
        dedupe_key = compute_dedupe_key(
            source.value, mmsi, observed_at or received_at, position.lon, position.lat
        )
    else:
        dedupe_key = compute_identity_dedupe_key(source.value, mmsi, received_at)

    return CanonicalAisObservation(
        dedupe_key=dedupe_key,
        source=source,
        received_at=received_at,
        observed_at=observed_at,
        mmsi=mmsi,
        message_type=fields.message_type,
        position=position,
        sog_kn=fields.sog,
        cog_deg=fields.cog,
        heading_deg=heading,
        nav_status=nav_status,
        name=fields.name,
        callsign=fields.callsign,
        destination=fields.destination,
        quality_flags=fields.quality_flags,
        raw_ref=raw_ref,
    )
