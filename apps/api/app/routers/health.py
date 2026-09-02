from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..redis_client import get_redis

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def liveness() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)) -> dict:
    checks = {"database": "ok", "redis": "ok"}
    ready = True

    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - readiness must report, not raise
        checks["database"] = f"error: {exc}"
        ready = False

    try:
        await get_redis().ping()
    except Exception as exc:  # noqa: BLE001
        checks["redis"] = f"error: {exc}"
        ready = False

    return {"status": "ok" if ready else "degraded", "checks": checks}
