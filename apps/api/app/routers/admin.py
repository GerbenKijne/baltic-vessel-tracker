from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
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
