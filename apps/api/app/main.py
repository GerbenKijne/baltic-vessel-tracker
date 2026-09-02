import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .config import get_settings
from .db import SessionLocal
from .models import User
from .realtime.manager import heartbeat_loop, stream_listener
from .redis_client import get_redis
from .routers import admin, auth, health, live, vessels, watchlists
from .security import hash_password, utcnow

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


async def bootstrap_admin() -> None:
    if not settings.bootstrap_admin_email or not settings.bootstrap_admin_password:
        return

    async with SessionLocal() as db:
        result = await db.execute(select(User).limit(1))
        if result.scalar_one_or_none() is not None:
            return

        admin = User(
            email=settings.bootstrap_admin_email,
            password_hash=hash_password(settings.bootstrap_admin_password),
            role="admin",
            created_at=utcnow(),
        )
        db.add(admin)
        await db.commit()
        logger.info("Bootstrapped admin user %s", settings.bootstrap_admin_email)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await bootstrap_admin()

    stop_event = asyncio.Event()
    redis = get_redis()
    tasks = [
        asyncio.create_task(stream_listener(redis, stop_event)),
        asyncio.create_task(heartbeat_loop(stop_event)),
    ]

    yield

    stop_event.set()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="Baltic Vessel Tracker API", lifespan=lifespan)

if settings.cors_allow_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(vessels.router)
app.include_router(watchlists.router)
app.include_router(admin.router)
app.include_router(live.router)
