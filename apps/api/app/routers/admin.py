from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_csrf
from ..models import SourceStatus
from ..schemas import SourceStatusOut

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get(
    "/sources", response_model=list[SourceStatusOut], dependencies=[Depends(get_current_user)]
)
async def list_source_status(db: AsyncSession = Depends(get_db)) -> list[SourceStatusOut]:
    rows = (await db.execute(select(SourceStatus))).scalars().all()
    return [
        SourceStatusOut(
            source=row.source,
            instance=row.instance,
            state=row.state,
            last_message_at=row.last_message_at,
            message_count=row.message_count,
            error_count=row.error_count,
            reconnect_count=row.reconnect_count,
            error_summary=row.error_summary,
        )
        for row in rows
    ]


@router.delete(
    "/sources/{source}/{instance}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(get_current_user), Depends(require_csrf)],
)
async def remove_source_status(
    source: str, instance: str, db: AsyncSession = Depends(get_db)
) -> None:
    """Manual cleanup for stale rows -- most commonly a previous worker
    instance whose identity (container hostname) no longer exists, left
    permanently "degraded" once nothing updates it again. Does not affect
    a currently-running instance; it will just reappear on its next
    heartbeat if you delete an active one by mistake."""
    result = await db.execute(
        delete(SourceStatus).where(
            SourceStatus.source == source, SourceStatus.instance == instance
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source instance not found")
    await db.commit()
