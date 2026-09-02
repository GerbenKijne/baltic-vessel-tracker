import uuid
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import User
from .redis_client import get_redis
from .security import SessionStore

settings = get_settings()


async def get_current_user(
    session: AsyncSession = Depends(get_db),
    session_id: Optional[str] = Cookie(default=None, alias="bvt_session"),
) -> User:
    if session_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    store = SessionStore(get_redis())
    user_id = await store.get_user_id(session_id)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")

    user = await session.get(User, uuid.UUID(user_id))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


async def require_csrf(
    csrf_cookie: Optional[str] = Cookie(default=None, alias="bvt_csrf"),
    x_csrf_token: Optional[str] = Header(default=None),
) -> None:
    """Double-submit CSRF check for cookie-authenticated mutating requests."""
    if not csrf_cookie or not x_csrf_token or csrf_cookie != x_csrf_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF check failed")
