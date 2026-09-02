from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://baltic:baltic@postgres:5432/baltic"
    redis_url: str = "redis://redis:6379/0"

    session_cookie_name: str = "bvt_session"
    session_ttl_seconds: int = 60 * 60 * 24 * 7
    csrf_cookie_name: str = "bvt_csrf"

    bootstrap_admin_email: Optional[str] = None
    bootstrap_admin_password: Optional[str] = None

    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 300

    live_fresh_seconds: int = 120
    stale_seconds: int = 900
    viewport_max_results: int = 20000
    ws_heartbeat_seconds: int = 25

    # PRD Appendix A default.
    track_max_points: int = 5000
    track_default_window_hours: int = 24
    track_gap_minutes: int = 30

    cors_allow_origins: list[str] = []

    cookie_secure: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
