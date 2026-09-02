
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user, require_csrf
from ..models import User
from ..redis_client import get_redis
from ..schemas import LoginRequest, UserOut
from ..security import LoginRateLimiter, SessionStore, new_token, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
settings = get_settings()


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)
) -> UserOut:
    redis = get_redis()
    limiter = LoginRateLimiter(redis)

    if await limiter.is_blocked(body.email):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts, try later"
        )

    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(user.password_hash, body.password):
        await limiter.record_failure(body.email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    await limiter.reset(body.email)

    store = SessionStore(redis)
    session_id = await store.create(str(user.id))
    csrf_token = new_token()

    response.set_cookie(
        settings.session_cookie_name,
        session_id,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf_token,
        max_age=settings.session_ttl_seconds,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
    )

    return UserOut(id=str(user.id), email=user.email, role=user.role)


@router.post("/logout", dependencies=[Depends(require_csrf)])
async def logout(
    response: Response,
    current_user: User = Depends(get_current_user),
    session_id: Optional[str] = Cookie(default=None, alias="bvt_session"),
) -> dict:
    if session_id is not None:
        await SessionStore(get_redis()).destroy(session_id)
    response.delete_cookie(settings.session_cookie_name)
    response.delete_cookie(settings.csrf_cookie_name)
    return {"status": "logged_out"}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=str(current_user.id), email=current_user.email, role=current_user.role)
