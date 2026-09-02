from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: str


class VesselOut(BaseModel):
    mmsi: str
    name: Optional[str]
    lon: Optional[float]
    lat: Optional[float]
    sog_kn: Optional[float]
    cog_deg: Optional[float]
    heading_deg: Optional[int]
    nav_status: Optional[str]
    observed_at: Optional[datetime]
    received_at: datetime
    freshness: str
    quality_flags: list[str]


class VesselListOut(BaseModel):
    vessels: list[VesselOut]
    truncated: bool
