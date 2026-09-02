import secrets
from datetime import datetime, timezone
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from redis.asyncio import Redis

from .config import get_settings

settings = get_settings()
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


class SessionStore:
    """Server-side sessions in Redis so a logout/revoke actually revokes."""

    def __init__(self, redis: Redis):
        self._redis = redis

    def _key(self, session_id: str) -> str:
        return f"session:{session_id}"

    async def create(self, user_id: str) -> str:
        session_id = new_token()
        await self._redis.set(
            self._key(session_id), user_id, ex=settings.session_ttl_seconds
        )
        return session_id

    async def get_user_id(self, session_id: str) -> Optional[str]:
        value = await self._redis.get(self._key(session_id))
        return value.decode() if value else None

    async def destroy(self, session_id: str) -> None:
        await self._redis.delete(self._key(session_id))


class LoginRateLimiter:
    def __init__(self, redis: Redis):
        self._redis = redis

    def _key(self, identifier: str) -> str:
        return f"login_attempts:{identifier}"

    async def is_blocked(self, identifier: str) -> bool:
        count = await self._redis.get(self._key(identifier))
        return count is not None and int(count) >= settings.login_rate_limit_attempts

    async def record_failure(self, identifier: str) -> None:
        key = self._key(identifier)
        count = await self._redis.incr(key)
        if count == 1:
            await self._redis.expire(key, settings.login_rate_limit_window_seconds)

    async def reset(self, identifier: str) -> None:
        await self._redis.delete(self._key(identifier))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
