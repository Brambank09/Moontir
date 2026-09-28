from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
import logging
import os
import uuid

import bcrypt
import httpx
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get("DB_NAME", "moontir")]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
security = HTTPBearer(auto_error=False)

app = FastAPI(title="Moontir API")
api_router = APIRouter(prefix="/api")
logger = logging.getLogger("moontir")

# Service groups:
#   light   — quick, at-home light maintenance and fluid checks
#   detail  — full detailing / cosmetics
#   special — Moontir Special Care bundles that combine detailing + light service
SERVICES = [
    # LIGHT SERVICE / QUICK SERVICE
    {"id": "care", "group": "light", "name": "Essential Car Care", "name_id": "Perawatan Mobil Esensial", "category": "Light Service", "category_id": "Layanan Cepat", "description": "A practical checkup for everyday driving confidence.", "description_id": "Pemeriksaan praktis untuk berkendara sehari-hari.", "duration": "90 minutes", "duration_id": "90 menit", "price": 185000, "featured": False, "features": ["Fluid check", "Battery check", "Tire pressure"]},
    {"id": "fluid", "group": "light", "name": "Rapid Fluid Refresh", "name_id": "Segarkan Fluida Cepat", "category": "Light Service", "category_id": "Layanan Cepat", "description": "Top-up engine oil, coolant, brake and wiper fluids.", "description_id": "Isi ulang oli mesin, coolant, minyak rem, dan wiper.", "duration": "45 minutes", "duration_id": "45 menit", "price": 135000, "featured": True, "features": ["Oil top-up", "Coolant top-up", "Brake & wiper fluid"]},
    {"id": "tune", "group": "light", "name": "Home Tune-Up", "name_id": "Tune-Up di Rumah", "category": "Light Service", "category_id": "Layanan Cepat", "description": "Air filter, spark plug, and battery terminal service.", "description_id": "Servis filter udara, busi, dan terminal aki.", "duration": "75 minutes", "duration_id": "75 menit", "price": 210000, "featured": False, "features": ["Air filter", "Spark plugs", "Battery terminals"]},

    # CAR DETAILING
    {"id": "shine", "group": "detail", "name": "Moon Shine Detail", "name_id": "Detail Moon Shine", "category": "Detailing", "category_id": "Detailing", "description": "Deep exterior wash, polish, and paint protection.", "description_id": "Cuci eksterior, poles, dan perlindungan cat menyeluruh.", "duration": "2–3 hours", "duration_id": "2–3 jam", "price": 275000, "featured": True, "features": ["Foam wash", "Paint polish", "Tire dressing"]},
    {"id": "interior", "group": "detail", "name": "Lunar Interior Reset", "name_id": "Reset Interior Lunar", "category": "Detailing", "category_id": "Detailing", "description": "Refresh the cabin with vacuuming and surface care.", "description_id": "Segarkan kabin dengan vakum dan perawatan permukaan.", "duration": "2 hours", "duration_id": "2 jam", "price": 225000, "featured": True, "features": ["Deep vacuum", "Dashboard care", "Odor refresh"]},
    {"id": "glass", "group": "detail", "name": "Crystal Glass Coating", "name_id": "Lapisan Kaca Kristal", "category": "Detailing", "category_id": "Detailing", "description": "Hydrophobic glass coating for clarity in rain.", "description_id": "Lapisan kaca hidrofobik untuk pandangan jernih saat hujan.", "duration": "90 minutes", "duration_id": "90 menit", "price": 195000, "featured": False, "features": ["Glass polish", "Hydrophobic seal", "Wiper prep"]},

    # MOONTIR SPECIAL CARE — bundles of detail + light
    {"id": "full", "group": "special", "name": "Full Moon Package", "name_id": "Paket Full Moon", "category": "Special Care", "category_id": "Perawatan Spesial", "description": "Full exterior + interior detail with essential mechanical checkup.", "description_id": "Detail eksterior + interior lengkap dengan pemeriksaan mekanis esensial.", "duration": "4 hours", "duration_id": "4 jam", "price": 495000, "featured": True, "features": ["Exterior detail", "Interior reset", "Light service checkup"]},
    {"id": "eclipse", "group": "special", "name": "Total Eclipse Care", "name_id": "Perawatan Total Eclipse", "category": "Special Care", "category_id": "Perawatan Spesial", "description": "Signature bundle: detailing, coating, and full tune-up.", "description_id": "Bundel andalan: detailing, coating, dan tune-up penuh.", "duration": "5 hours", "duration_id": "5 jam", "price": 685000, "featured": False, "features": ["Full detail", "Glass coating", "Home tune-up"]},
]

VEHICLE_MULTIPLIERS = {"Sedan": 1.00, "Hatchback": 1.00, "MPV": 1.15, "SUV": 1.25, "Truck": 1.40, "Pickup": 1.30}
DEFAULT_MULTIPLIER = 1.0


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RegisterInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class VehicleCreate(BaseModel):
    nickname: str = Field(min_length=1, max_length=40)
    make: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=40)
    year: str = Field(min_length=4, max_length=4)
    plate: str = Field(min_length=3, max_length=12)
    type: str = Field(default="Sedan", max_length=20)


class VehicleUpdate(BaseModel):
    nickname: Optional[str] = Field(default=None, min_length=1, max_length=40)
    make: Optional[str] = Field(default=None, min_length=1, max_length=40)
    model: Optional[str] = Field(default=None, min_length=1, max_length=40)
    year: Optional[str] = Field(default=None, min_length=4, max_length=4)
    plate: Optional[str] = Field(default=None, min_length=3, max_length=12)
    type: Optional[str] = Field(default=None, max_length=20)


class VehicleOut(VehicleCreate):
    id: str
    created_at: str


class AddressInput(BaseModel):
    label: str = Field(min_length=5, max_length=400)
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)


class OrderCreate(BaseModel):
    service_id: str
    vehicle_id: str
    address: AddressInput
    schedule_date: str = Field(min_length=8, max_length=20)
    schedule_time: str = Field(min_length=3, max_length=30)
    notes: str = Field(default="", max_length=500)


class InvoiceItem(BaseModel):
    label: str
    label_id: Optional[str] = None
    amount: int


class OrderOut(BaseModel):
    id: str
    service_id: str
    service_name: str
    vehicle: VehicleOut
    address: AddressInput
    schedule_date: str
    schedule_time: str
    notes: str
    status: str
    status_history: List[dict]
    items: List[InvoiceItem]
    total: int
    payment_status: str
    created_at: str


class QuoteInput(BaseModel):
    service_id: str
    vehicle_type: str = Field(default="Sedan", max_length=20)


def token_for(user: dict) -> str:
    return jwt.encode({"sub": user["id"], "exp": datetime.now(timezone.utc).timestamp() + 60 * 60 * 24 * 30}, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Please sign in first.")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Your session has expired.") from exc
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Account not found.")
    return user


def user_out(user: dict) -> UserOut:
    return UserOut(id=user["id"], name=user["name"], email=user["email"])


def auth_response(user: dict) -> AuthResponse:
    return AuthResponse(token=token_for(user), user=user_out(user))


def _round_rupiah(value: float) -> int:
    return int(round(value / 500.0) * 500)


def price_breakdown(service: dict, vehicle_type: str) -> dict:
    multiplier = VEHICLE_MULTIPLIERS.get(vehicle_type, DEFAULT_MULTIPLIER)
    base = int(service["price"])
    total = _round_rupiah(base * multiplier)
    surcharge = total - base
    items: List[dict] = [{"label": service["name"], "label_id": service["name_id"], "amount": base}]
    if surcharge > 0:
        items.append({"label": f"{vehicle_type} handling surcharge", "label_id": f"Biaya penanganan {vehicle_type}", "amount": surcharge})
    return {"items": items, "total": total, "multiplier": multiplier, "vehicle_type": vehicle_type, "base": base, "surcharge": surcharge}


@api_router.get("/")
async def root():
    return {"message": "Moontir API is ready"}


@api_router.get("/health")
async def health():
    await db.command("ping")
    return {"ok": True}


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(input: RegisterInput):
    email = str(input.email).lower()
    if await db.users.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = {"id": str(uuid.uuid4()), "name": input.name.strip(), "email": email, "password_hash": bcrypt.hashpw(input.password.encode(), bcrypt.gensalt()).decode(), "created_at": now_iso()}
    await db.users.insert_one(user)
    return auth_response(user)


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(input: LoginInput):
    user = await db.users.find_one({"email": str(input.email).lower()}, {"_id": 0})
    if not user or not bcrypt.checkpw(input.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return auth_response(user)


@api_router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return user_out(user)


@api_router.patch("/me", response_model=UserOut)
async def update_me(input: ProfileUpdate, user: dict = Depends(current_user)):
    name = input.name.strip()
    await db.users.update_one({"id": user["id"]}, {"$set": {"name": name}})
    user["name"] = name
    return user_out(user)


@api_router.get("/services")
async def services():
    return SERVICES


@api_router.post("/quote")
async def quote(input: QuoteInput):
    service = next((item for item in SERVICES if item["id"] == input.service_id), None)
    if not service:
        raise HTTPException(status_code=404, detail="Service package not found.")
    return price_breakdown(service, input.vehicle_type)


@api_router.get("/vehicles", response_model=List[VehicleOut])
async def vehicles(user: dict = Depends(current_user)):
    rows = await db.vehicles.find({"user_id": user["id"]}, {"_id": 0, "user_id": 0}).sort("created_at", -1).to_list(100)
    return rows


@api_router.post("/vehicles", response_model=VehicleOut)
async def create_vehicle(input: VehicleCreate, user: dict = Depends(current_user)):
    vehicle = {**input.model_dump(), "id": str(uuid.uuid4()), "user_id": user["id"], "created_at": now_iso()}
    await db.vehicles.insert_one(vehicle)
    return VehicleOut(**{k: v for k, v in vehicle.items() if k != "user_id"})


@api_router.patch("/vehicles/{vehicle_id}", response_model=VehicleOut)
async def update_vehicle(vehicle_id: str, input: VehicleUpdate, user: dict = Depends(current_user)):
    updates = {k: v for k, v in input.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    result = await db.vehicles.find_one_and_update(
        {"id": vehicle_id, "user_id": user["id"]},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0, "user_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Vehicle not found.")
    return VehicleOut(**result)


@api_router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str, user: dict = Depends(current_user)):
    deleted = await db.vehicles.delete_one({"id": vehicle_id, "user_id": user["id"]})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Vehicle not found.")
    return {"ok": True, "id": vehicle_id}


async def nominatim(path: str, params: dict):
    headers = {"User-Agent": os.getenv("NOMINATIM_USER_AGENT", "Moontir/1.0 contact@moontir.app")}
    try:
        async with httpx.AsyncClient(timeout=8) as http:
            response = await http.get(f"https://nominatim.openstreetmap.org/{path}", params=params, headers=headers)
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Map search is busy. Please try again in a moment.")
        response.raise_for_status()
        return response.json()
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        logger.warning("Nominatim request failed: %s", exc)
        raise HTTPException(status_code=503, detail="Map search is temporarily unavailable.") from exc


@api_router.get("/geocode")
async def geocode(q: str = Query(min_length=3, max_length=200)):
    rows = await nominatim("search", {"q": q, "format": "jsonv2", "addressdetails": 1, "limit": 5, "countrycodes": "id", "accept-language": "id,en"})
    return [{"displayName": row.get("display_name", ""), "latitude": float(row["lat"]), "longitude": float(row["lon"]), "osmId": row.get("osm_id")} for row in rows]


@api_router.get("/reverse-geocode")
async def reverse_geocode(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    row = await nominatim("reverse", {"lat": lat, "lon": lon, "format": "jsonv2", "addressdetails": 1, "accept-language": "id,en"})
    return {"displayName": row.get("display_name", ""), "latitude": lat, "longitude": lon}


@api_router.get("/orders", response_model=List[OrderOut])
async def orders(user: dict = Depends(current_user)):
    rows = await db.orders.find({"user_id": user["id"]}, {"_id": 0, "user_id": 0}).sort("created_at", -1).to_list(100)
    return rows


@api_router.post("/orders", response_model=OrderOut)
async def create_order(input: OrderCreate, user: dict = Depends(current_user)):
    service = next((item for item in SERVICES if item["id"] == input.service_id), None)
    if not service:
        raise HTTPException(status_code=404, detail="Service package not found.")
    vehicle = await db.vehicles.find_one({"id": input.vehicle_id, "user_id": user["id"]}, {"_id": 0, "user_id": 0})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found in your garage.")
    breakdown = price_breakdown(service, vehicle.get("type", "Sedan"))
    created = now_iso()
    order = {
        "id": str(uuid.uuid4()),
        "service_id": service["id"],
        "service_name": service["name"],
        "vehicle": vehicle,
        "address": input.address.model_dump(),
        "schedule_date": input.schedule_date,
        "schedule_time": input.schedule_time,
        "notes": input.notes.strip(),
        "status": "dispatch",
        "status_history": [{"key": "dispatch", "label": "Dispatch confirmed", "label_id": "Dispatch dikonfirmasi", "at": created}],
        "items": breakdown["items"],
        "total": breakdown["total"],
        "payment_status": "unpaid",
        "created_at": created,
        "user_id": user["id"],
    }
    await db.orders.insert_one(order)
    return OrderOut(**{k: v for k, v in order.items() if k != "user_id"})


app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
