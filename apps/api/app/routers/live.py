import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_X, ST_Y, ST_MakeEnvelope, ST_Within
from sqlalchemy import cast, select

from ..db import SessionLocal
from ..models import Vessel, VesselLatest
from ..realtime.manager import Bbox, manager, server_time
from ..redis_client import get_redis
from ..routers.vessels import freshness_for
from ..security import SessionStore

router = APIRouter(tags=["realtime"])


async def _authenticate(websocket: WebSocket) -> bool:
    session_id = websocket.cookies.get("bvt_session")
    if session_id is None:
        return False
    user_id = await SessionStore(get_redis()).get_user_id(session_id)
    return user_id is not None


async def _send_snapshot(websocket: WebSocket, bbox: Bbox) -> None:
    async with SessionLocal() as db:
        envelope = ST_MakeEnvelope(bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat, 4326)
        # ST_X/ST_Y/ST_Within only accept `geometry`, but `position` is
        # `geography` -- PostGIS does not cast between them implicitly.
        position_geom = cast(VesselLatest.position, Geometry)
        query = (
            select(
                VesselLatest,
                Vessel.name,
                ST_X(position_geom).label("lon"),
                ST_Y(position_geom).label("lat"),
            )
            .join(Vessel, Vessel.mmsi == VesselLatest.mmsi)
            .where(ST_Within(position_geom, envelope))
            .limit(20000)
        )
        rows = (await db.execute(query)).all()

    await websocket.send_text(
        json.dumps({"type": "snapshot.begin", "schema_version": 1, "server_time": server_time()})
    )
    for latest, name, lon, lat in rows:
        await websocket.send_text(
            json.dumps(
                {
                    "type": "vessel.snapshot",
                    "schema_version": 1,
                    "server_time": server_time(),
                    "mmsi": latest.mmsi,
                    "name": name,
                    "position": {"lon": lon, "lat": lat},
                    "sog_kn": float(latest.sog_kn) if latest.sog_kn is not None else None,
                    "cog_deg": float(latest.cog_deg) if latest.cog_deg is not None else None,
                    "heading_deg": latest.heading_deg,
                    "nav_status": latest.nav_status,
                    "observed_at": latest.observed_at.isoformat() if latest.observed_at else None,
                    "received_at": latest.received_at.isoformat(),
                    "freshness": freshness_for(latest.observed_at, latest.received_at),
                    "quality_flags": latest.quality_flags,
                }
            )
        )
    await websocket.send_text(
        json.dumps(
            {
                "type": "snapshot.end",
                "schema_version": 1,
                "server_time": server_time(),
                "count": len(rows),
            }
        )
    )


@router.websocket("/api/v1/live")
async def live(websocket: WebSocket) -> None:
    if not await _authenticate(websocket):
        await websocket.close(code=4401)
        return

    await manager.connect(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if message.get("type") != "subscription.replace":
                continue

            bbox_in = message.get("bbox") or {}
            try:
                bbox = Bbox(
                    min_lon=float(bbox_in["min_lon"]),
                    min_lat=float(bbox_in["min_lat"]),
                    max_lon=float(bbox_in["max_lon"]),
                    max_lat=float(bbox_in["max_lat"]),
                )
            except (KeyError, TypeError, ValueError):
                continue

            version = await manager.set_subscription(websocket, bbox)
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "subscription.ack",
                        "schema_version": 1,
                        "server_time": server_time(),
                        "version": version,
                    }
                )
            )
            await _send_snapshot(websocket, bbox)
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
