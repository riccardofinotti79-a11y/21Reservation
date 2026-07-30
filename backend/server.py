"""21Reservation FastAPI server."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone, date as date_cls
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from models import (  # noqa: E402
    Area, AreaCreate, Booking, BookingCreatePublic, BookingCreateStaff,
    BookingStatusUpdate, BookingUpdate, Customer, CustomerCreate, CustomerUpdate,
    DayAvailability, LoginRequest, LoginResponse, OpeningHour, OpeningHourCreate,
    PublicRestaurantInfo, Restaurant, SlotAvailability, StatusChange, Table,
    TableCreate, TableUpdate, User, UserPublic, new_id, utc_now,
)
from auth import (  # noqa: E402
    create_access_token, get_current_user, hash_password, verify_password,
)
from availability import (  # noqa: E402
    auto_assign_table, duration_for_persons, find_available_tables,
    generate_slots, hhmm_to_minutes, pick_opening_hour, slot_within_limits,
)
from email_service import (  # noqa: E402
    booking_confirmation_html, send_email, staff_notification_html,
)
from seed import seed_demo  # noqa: E402

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="21Reservation")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("21reservation")


# -------- Helpers --------
NO_ID = {"_id": 0}


def _iso(v):
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def _serialize(doc: dict) -> dict:
    """Serialize datetimes for storage."""
    out = {}
    for k, v in doc.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, list):
            out[k] = [_serialize(i) if isinstance(i, dict) else _iso(i) for i in v]
        elif isinstance(v, dict):
            out[k] = _serialize(v)
        else:
            out[k] = v
    return out


async def _get_restaurant(rid: str) -> dict:
    r = await db.restaurants.find_one({"id": rid}, NO_ID)
    if not r:
        raise HTTPException(404, "Restaurant not found")
    return r


async def _get_restaurant_by_subdomain(sub: str) -> dict:
    r = await db.restaurants.find_one({"subdomain": sub}, NO_ID)
    if not r:
        raise HTTPException(404, "Restaurant not found")
    return r


# ==================== AUTH ====================
@api.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    user = await db.users.find_one({"email": body.email.lower()}, NO_ID)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenziali non valide")
    r = await _get_restaurant(user["restaurant_id"])
    token = create_access_token(user["id"], user["restaurant_id"], user["role"])
    return LoginResponse(
        access_token=token,
        user=UserPublic(**{k: user[k] for k in ("id", "restaurant_id", "name", "email", "role")}),
        restaurant=Restaurant(**r),
    )


@api.get("/auth/me", response_model=UserPublic)
async def me(cur=Depends(get_current_user)):
    user = await db.users.find_one({"id": cur["user_id"]}, NO_ID)
    if not user:
        raise HTTPException(404, "User not found")
    return UserPublic(**{k: user[k] for k in ("id", "restaurant_id", "name", "email", "role")})


# ==================== SEED ====================
@api.post("/seed/demo")
async def do_seed():
    """Idempotent demo seeding (safe to call multiple times)."""
    return await seed_demo(db)


# ==================== RESTAURANT ====================
@api.get("/restaurant", response_model=Restaurant)
async def get_my_restaurant(cur=Depends(get_current_user)):
    return Restaurant(**await _get_restaurant(cur["restaurant_id"]))


@api.get("/public/restaurant/{subdomain}", response_model=PublicRestaurantInfo)
async def get_public_restaurant(subdomain: str):
    r = await _get_restaurant_by_subdomain(subdomain)
    return PublicRestaurantInfo(**r)


# ==================== AREAS ====================
@api.get("/areas", response_model=List[Area])
async def list_areas(cur=Depends(get_current_user)):
    docs = await db.areas.find({"restaurant_id": cur["restaurant_id"]}, NO_ID).sort("priority", -1).to_list(500)
    return [Area(**d) for d in docs]


@api.post("/areas", response_model=Area)
async def create_area(body: AreaCreate, cur=Depends(get_current_user)):
    a = Area(restaurant_id=cur["restaurant_id"], **body.model_dump())
    await db.areas.insert_one(a.model_dump())
    return a


@api.patch("/areas/{area_id}", response_model=Area)
async def update_area(area_id: str, body: AreaCreate, cur=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    r = await db.areas.find_one_and_update(
        {"id": area_id, "restaurant_id": cur["restaurant_id"]},
        {"$set": upd},
        projection=NO_ID,
        return_document=True,
    )
    if not r:
        raise HTTPException(404, "Area not found")
    return Area(**r)


@api.delete("/areas/{area_id}")
async def delete_area(area_id: str, cur=Depends(get_current_user)):
    tables = await db.tables.count_documents({"area_id": area_id, "restaurant_id": cur["restaurant_id"]})
    if tables > 0:
        raise HTTPException(400, "L'area contiene tavoli, spostali o eliminali prima")
    r = await db.areas.delete_one({"id": area_id, "restaurant_id": cur["restaurant_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Area not found")
    return {"deleted": True}


# ==================== TABLES ====================
@api.get("/tables", response_model=List[Table])
async def list_tables(cur=Depends(get_current_user)):
    docs = await db.tables.find({"restaurant_id": cur["restaurant_id"]}, NO_ID).to_list(1000)
    return [Table(**d) for d in docs]


@api.post("/tables", response_model=Table)
async def create_table(body: TableCreate, cur=Depends(get_current_user)):
    area = await db.areas.find_one({"id": body.area_id, "restaurant_id": cur["restaurant_id"]}, NO_ID)
    if not area:
        raise HTTPException(400, "Area non valida")
    t = Table(restaurant_id=cur["restaurant_id"], **body.model_dump())
    await db.tables.insert_one(t.model_dump())
    return t


@api.patch("/tables/{table_id}", response_model=Table)
async def update_table(table_id: str, body: TableUpdate, cur=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "position" in upd and hasattr(upd["position"], "model_dump"):
        upd["position"] = upd["position"].model_dump()
    r = await db.tables.find_one_and_update(
        {"id": table_id, "restaurant_id": cur["restaurant_id"]},
        {"$set": upd},
        projection=NO_ID,
        return_document=True,
    )
    if not r:
        raise HTTPException(404, "Table not found")
    return Table(**r)


@api.delete("/tables/{table_id}")
async def delete_table(table_id: str, cur=Depends(get_current_user)):
    r = await db.tables.delete_one({"id": table_id, "restaurant_id": cur["restaurant_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Table not found")
    return {"deleted": True}


# ==================== OPENING HOURS ====================
@api.get("/opening-hours", response_model=List[OpeningHour])
async def list_opening_hours(cur=Depends(get_current_user)):
    docs = await db.opening_hours.find({"restaurant_id": cur["restaurant_id"]}, NO_ID).to_list(500)
    return [OpeningHour(**d) for d in docs]


@api.post("/opening-hours", response_model=OpeningHour)
async def create_opening_hour(body: OpeningHourCreate, cur=Depends(get_current_user)):
    if body.weekday is None and not body.specific_date:
        raise HTTPException(400, "Serve un weekday o una specific_date")
    oh = OpeningHour(restaurant_id=cur["restaurant_id"], **body.model_dump())
    await db.opening_hours.insert_one(oh.model_dump())
    return oh


@api.patch("/opening-hours/{oh_id}", response_model=OpeningHour)
async def update_opening_hour(oh_id: str, body: OpeningHourCreate, cur=Depends(get_current_user)):
    upd = body.model_dump()
    r = await db.opening_hours.find_one_and_update(
        {"id": oh_id, "restaurant_id": cur["restaurant_id"]},
        {"$set": upd},
        projection=NO_ID,
        return_document=True,
    )
    if not r:
        raise HTTPException(404, "Opening hour not found")
    return OpeningHour(**r)


@api.delete("/opening-hours/{oh_id}")
async def delete_opening_hour(oh_id: str, cur=Depends(get_current_user)):
    r = await db.opening_hours.delete_one({"id": oh_id, "restaurant_id": cur["restaurant_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Opening hour not found")
    return {"deleted": True}


# ==================== CUSTOMERS ====================
async def _find_or_create_customer(
    restaurant_id: str,
    name: Optional[str],
    email: Optional[str],
    phone: Optional[str],
) -> dict:
    q = {"restaurant_id": restaurant_id}
    or_clauses = []
    if email:
        or_clauses.append({"email": email.lower()})
    if phone:
        or_clauses.append({"phone": phone})
    if or_clauses:
        q["$or"] = or_clauses
        existing = await db.customers.find_one(q, NO_ID)
        if existing:
            return existing
    c = Customer(
        restaurant_id=restaurant_id,
        name=name or "Ospite",
        email=(email.lower() if email else None),
        phone=phone,
    )
    d = c.model_dump()
    d["created_at"] = d["created_at"].isoformat()
    await db.customers.insert_one(d)
    return d


@api.get("/customers", response_model=List[Customer])
async def list_customers(
    cur=Depends(get_current_user),
    search: Optional[str] = None,
):
    q = {"restaurant_id": cur["restaurant_id"]}
    if search:
        q["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.customers.find(q, NO_ID).sort("name", 1).to_list(1000)
    return [Customer(**d) for d in docs]


@api.post("/customers", response_model=Customer)
async def create_customer(body: CustomerCreate, cur=Depends(get_current_user)):
    c = Customer(restaurant_id=cur["restaurant_id"], **body.model_dump())
    d = c.model_dump()
    d["created_at"] = d["created_at"].isoformat()
    await db.customers.insert_one(d)
    return c


@api.get("/customers/{cid}", response_model=Customer)
async def get_customer(cid: str, cur=Depends(get_current_user)):
    d = await db.customers.find_one({"id": cid, "restaurant_id": cur["restaurant_id"]}, NO_ID)
    if not d:
        raise HTTPException(404, "Customer not found")
    return Customer(**d)


@api.patch("/customers/{cid}", response_model=Customer)
async def update_customer(cid: str, body: CustomerUpdate, cur=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    r = await db.customers.find_one_and_update(
        {"id": cid, "restaurant_id": cur["restaurant_id"]},
        {"$set": upd},
        projection=NO_ID,
        return_document=True,
    )
    if not r:
        raise HTTPException(404, "Customer not found")
    return Customer(**r)


@api.get("/customers/{cid}/bookings", response_model=List[Booking])
async def customer_bookings(cid: str, cur=Depends(get_current_user)):
    docs = await db.bookings.find(
        {"customer_id": cid, "restaurant_id": cur["restaurant_id"]}, NO_ID
    ).sort("date", -1).to_list(500)
    return [Booking(**d) for d in docs]


# ==================== BOOKINGS ====================
async def _get_bookings_for_date(rid: str, date_str: str) -> List[dict]:
    return await db.bookings.find({"restaurant_id": rid, "date": date_str}, NO_ID).to_list(2000)


async def _get_bookings_range(rid: str, start: str, end: str) -> List[dict]:
    return await db.bookings.find(
        {"restaurant_id": rid, "date": {"$gte": start, "$lte": end}}, NO_ID
    ).to_list(5000)


async def _recompute_customer_metrics(cid: str):
    docs = await db.bookings.find({"customer_id": cid}, NO_ID).to_list(2000)
    total = len(docs)
    no_show = sum(1 for d in docs if d.get("status") == "no_show")
    cancelled = sum(1 for d in docs if d.get("status") == "cancelled")
    await db.customers.update_one(
        {"id": cid},
        {"$set": {
            "total_bookings": total,
            "no_show_count": no_show,
            "cancelled_count": cancelled,
        }},
    )


@api.get("/bookings", response_model=List[Booking])
async def list_bookings(
    cur=Depends(get_current_user),
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    q = {"restaurant_id": cur["restaurant_id"]}
    if date:
        q["date"] = date
    elif date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    docs = await db.bookings.find(q, NO_ID).sort([("date", 1), ("time", 1)]).to_list(5000)
    return [Booking(**d) for d in docs]


@api.get("/bookings/day-summary")
async def bookings_day_summary(
    date_from: str,
    date_to: str,
    cur=Depends(get_current_user),
):
    """Returns count of bookings and total guests per day."""
    docs = await _get_bookings_range(cur["restaurant_id"], date_from, date_to)
    active = {"pending", "accepted", "seated"}
    summary = {}
    for d in docs:
        if d.get("status") not in active:
            continue
        key = d["date"]
        s = summary.setdefault(key, {"date": key, "bookings": 0, "guests": 0})
        s["bookings"] += 1
        s["guests"] += d.get("persons", 0)
    return list(summary.values())


@api.post("/bookings", response_model=Booking)
async def create_booking_staff(body: BookingCreateStaff, cur=Depends(get_current_user)):
    rid = cur["restaurant_id"]
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    oh = pick_opening_hour(body.date, ohs)
    if not oh:
        raise HTTPException(400, "Ristorante chiuso in quella data")

    duration = body.duration_minutes or duration_for_persons(oh, body.persons)

    # Customer resolve
    if body.customer_id:
        customer = await db.customers.find_one(
            {"id": body.customer_id, "restaurant_id": rid}, NO_ID,
        )
        if not customer:
            raise HTTPException(400, "Cliente non trovato")
    else:
        customer = await _find_or_create_customer(
            rid, body.customer_name, body.customer_email, body.customer_phone
        )

    # Tables
    tables_all = await db.tables.find({"restaurant_id": rid}, NO_ID).to_list(1000)
    areas_all = await db.areas.find({"restaurant_id": rid}, NO_ID).to_list(500)
    existing = await _get_bookings_for_date(rid, body.date)

    table_ids = body.table_ids
    if not table_ids:
        auto = auto_assign_table(
            body.persons, body.date, body.time, duration,
            tables_all, areas_all, existing, online_only=False,
        )
        table_ids = [auto] if auto else []

    # Validate provided tables aren't taken
    if table_ids:
        avail_now = find_available_tables(
            body.persons, body.date, body.time, duration,
            [t for t in tables_all if t["id"] in table_ids], existing, online_only=False,
        )
        avail_ids = {t["id"] for t in avail_now}
        for tid in table_ids:
            if tid not in avail_ids:
                # allow the table even if capacity is off, but not if it overlaps
                overlap = False
                req_start = hhmm_to_minutes(body.time)
                req_end = req_start + duration
                for b in existing:
                    if b.get("status") not in {"pending", "accepted", "seated"}:
                        continue
                    b_start = hhmm_to_minutes(b["time"])
                    b_end = b_start + b.get("duration_minutes", 120)
                    if tid in b.get("table_ids", []) and not (req_end <= b_start or b_end <= req_start):
                        overlap = True
                        break
                if overlap:
                    raise HTTPException(400, f"Il tavolo {tid} è già occupato in quello slot")

    booking = Booking(
        restaurant_id=rid,
        customer_id=customer["id"],
        date=body.date,
        time=body.time,
        duration_minutes=duration,
        persons=body.persons,
        status=body.status,
        source=body.source,
        table_ids=table_ids or [],
        guest_message=body.guest_message,
        internal_note=body.internal_note,
        status_history=[StatusChange(status=body.status, by_user_id=cur["user_id"])],
    )
    doc = _serialize(booking.model_dump())
    await db.bookings.insert_one(doc)
    await _recompute_customer_metrics(customer["id"])
    return booking


@api.patch("/bookings/{bid}", response_model=Booking)
async def update_booking(bid: str, body: BookingUpdate, cur=Depends(get_current_user)):
    existing = await db.bookings.find_one({"id": bid, "restaurant_id": cur["restaurant_id"]}, NO_ID)
    if not existing:
        raise HTTPException(404, "Booking not found")
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if upd:
        await db.bookings.update_one({"id": bid}, {"$set": upd})
    doc = await db.bookings.find_one({"id": bid}, NO_ID)
    return Booking(**doc)


@api.post("/bookings/{bid}/status", response_model=Booking)
async def change_status(bid: str, body: BookingStatusUpdate, cur=Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": bid, "restaurant_id": cur["restaurant_id"]}, NO_ID)
    if not doc:
        raise HTTPException(404, "Booking not found")
    history = doc.get("status_history", []) or []
    history.append({"status": body.status, "at": utc_now().isoformat(), "by_user_id": cur["user_id"]})
    await db.bookings.update_one(
        {"id": bid},
        {"$set": {"status": body.status, "status_history": history}},
    )
    await _recompute_customer_metrics(doc["customer_id"])
    updated = await db.bookings.find_one({"id": bid}, NO_ID)
    return Booking(**updated)


@api.delete("/bookings/{bid}")
async def delete_booking(bid: str, cur=Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": bid, "restaurant_id": cur["restaurant_id"]}, NO_ID)
    if not doc:
        raise HTTPException(404, "Booking not found")
    await db.bookings.delete_one({"id": bid})
    await _recompute_customer_metrics(doc["customer_id"])
    return {"deleted": True}


# ==================== AVAILABILITY ====================
@api.get("/availability/suggest-tables")
async def suggest_tables(
    date: str, time: str, persons: int, duration_minutes: Optional[int] = None,
    cur=Depends(get_current_user),
):
    rid = cur["restaurant_id"]
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    oh = pick_opening_hour(date, ohs)
    if not oh:
        return {"suggested": None, "candidates": [], "closed": True}
    duration = duration_minutes or duration_for_persons(oh, persons)
    tables_all = await db.tables.find({"restaurant_id": rid}, NO_ID).to_list(1000)
    areas_all = await db.areas.find({"restaurant_id": rid}, NO_ID).to_list(500)
    existing = await _get_bookings_for_date(rid, date)
    candidates = find_available_tables(persons, date, time, duration, tables_all, existing, online_only=False)
    suggested = auto_assign_table(persons, date, time, duration, tables_all, areas_all, existing, online_only=False)
    return {"suggested": suggested, "candidates": [c["id"] for c in candidates], "closed": False, "duration_minutes": duration}


# ==================== PUBLIC BOOKING ====================
@api.get("/public/{subdomain}/availability/day", response_model=DayAvailability)
async def public_day_availability(subdomain: str, date: str, persons: int):
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    oh = pick_opening_hour(date, ohs)
    if not oh:
        return DayAvailability(date=date, open=False, slots=[])
    duration = duration_for_persons(oh, persons)
    slots = generate_slots(oh, persons)
    tables_all = await db.tables.find(
        {"restaurant_id": rid, "bookable_online": True}, NO_ID
    ).to_list(1000)
    if not tables_all:
        return DayAvailability(date=date, open=True, slots=[])
    existing = await _get_bookings_for_date(rid, date)

    # Get limits for this opening hour
    limits = await db.booking_limits.find_one({"opening_hour_id": oh["id"]}, NO_ID)

    result = []
    for s in slots:
        avail = find_available_tables(persons, date, s, duration, tables_all, existing, online_only=True)
        if not avail:
            result.append(SlotAvailability(time=s, available=False, reason="no_tables"))
            continue
        ok, reason = slot_within_limits(date, s, persons, oh, limits, existing)
        result.append(SlotAvailability(time=s, available=ok, reason=None if ok else reason))
    return DayAvailability(date=date, open=True, slots=result)


@api.get("/public/{subdomain}/availability/month")
async def public_month_availability(subdomain: str, year: int, month: int, persons: int):
    """Returns a list of dates with any availability, for the given month."""
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    from calendar import monthrange
    _, days = monthrange(year, month)
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    tables_all = await db.tables.find({"restaurant_id": rid, "bookable_online": True}, NO_ID).to_list(1000)
    if not tables_all:
        return {"days": []}

    today = date_cls.today()
    output = []
    for day in range(1, days + 1):
        d = date_cls(year, month, day)
        if d < today:
            output.append({"date": d.isoformat(), "open": False, "has_availability": False})
            continue
        oh = pick_opening_hour(d.isoformat(), ohs)
        if not oh:
            output.append({"date": d.isoformat(), "open": False, "has_availability": False})
            continue
        duration = duration_for_persons(oh, persons)
        slots = generate_slots(oh, persons)
        existing = await _get_bookings_for_date(rid, d.isoformat())
        has_any = False
        for s in slots:
            avail = find_available_tables(persons, d.isoformat(), s, duration, tables_all, existing, online_only=True)
            if avail:
                has_any = True
                break
        output.append({"date": d.isoformat(), "open": True, "has_availability": has_any})
    return {"days": output}


@api.post("/public/{subdomain}/book", response_model=Booking)
async def public_create_booking(subdomain: str, body: BookingCreatePublic):
    if not body.accept_terms:
        raise HTTPException(400, "Devi accettare i termini")
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    oh = pick_opening_hour(body.date, ohs)
    if not oh:
        raise HTTPException(400, "Ristorante chiuso in quella data")

    duration = duration_for_persons(oh, body.persons)
    tables_all = await db.tables.find({"restaurant_id": rid, "bookable_online": True}, NO_ID).to_list(1000)
    areas_all = await db.areas.find({"restaurant_id": rid}, NO_ID).to_list(500)
    existing = await _get_bookings_for_date(rid, body.date)

    limits = await db.booking_limits.find_one({"opening_hour_id": oh["id"]}, NO_ID)
    ok, reason = slot_within_limits(body.date, body.time, body.persons, oh, limits, existing)
    if not ok:
        raise HTTPException(409, f"Slot non disponibile: {reason}")

    assigned = auto_assign_table(
        body.persons, body.date, body.time, duration,
        tables_all, areas_all, existing, online_only=True,
    )
    if not assigned:
        raise HTTPException(409, "Nessun tavolo disponibile per questo slot")

    # Customer
    customer = await _find_or_create_customer(rid, body.customer_name, body.customer_email, body.customer_phone)

    booking = Booking(
        restaurant_id=rid,
        customer_id=customer["id"],
        date=body.date,
        time=body.time,
        duration_minutes=duration,
        persons=body.persons,
        status="accepted",
        source="online",
        table_ids=[assigned],
        guest_message=body.guest_message,
        status_history=[StatusChange(status="accepted")],
    )
    doc = _serialize(booking.model_dump())
    await db.bookings.insert_one(doc)
    await _recompute_customer_metrics(customer["id"])

    # Emails (best-effort, do not fail booking on email issues)
    try:
        html_guest = booking_confirmation_html(
            r["name"], body.customer_name, body.date, body.time, body.persons, "accepted", r.get("address"),
        )
        await send_email(body.customer_email, f"Prenotazione confermata — {r['name']}", html_guest)
        if r.get("email"):
            html_staff = staff_notification_html(
                r["name"], body.customer_name, body.customer_phone, body.customer_email,
                body.date, body.time, body.persons, body.guest_message,
            )
            await send_email(r["email"], f"Nuova prenotazione online — {body.customer_name}", html_staff)
    except Exception as e:
        logger.warning(f"Email best-effort failed: {e}")

    return booking


# ==================== REPORTS ====================
@api.get("/reports/summary")
async def reports_summary(
    date_from: str,
    date_to: str,
    cur=Depends(get_current_user),
):
    docs = await _get_bookings_range(cur["restaurant_id"], date_from, date_to)
    active = {"pending", "accepted", "seated"}
    per_day = {}
    for d in docs:
        key = d["date"]
        s = per_day.setdefault(key, {"date": key, "bookings": 0, "guests": 0, "no_show": 0, "cancelled": 0})
        if d.get("status") in active:
            s["bookings"] += 1
            s["guests"] += d.get("persons", 0)
        elif d.get("status") == "no_show":
            s["no_show"] += 1
        elif d.get("status") == "cancelled":
            s["cancelled"] += 1

    tables_all = await db.tables.find({"restaurant_id": cur["restaurant_id"]}, NO_ID).to_list(1000)
    total_capacity = sum(t.get("seats_max", 0) for t in tables_all) or 1
    services = 0
    ohs = await db.opening_hours.find({"restaurant_id": cur["restaurant_id"]}, NO_ID).to_list(500)
    from datetime import date as dcls
    d_from = dcls.fromisoformat(date_from)
    d_to = dcls.fromisoformat(date_to)
    day = d_from
    while day <= d_to:
        if pick_opening_hour(day.isoformat(), ohs):
            services += 1
        day = day + timedelta(days=1)
    total_guests = sum(v["guests"] for v in per_day.values())
    occupancy = 0.0
    if services > 0:
        occupancy = round(100.0 * total_guests / (services * total_capacity), 1)

    return {
        "per_day": sorted(per_day.values(), key=lambda x: x["date"]),
        "total_bookings": sum(v["bookings"] for v in per_day.values()),
        "total_guests": total_guests,
        "total_no_show": sum(v["no_show"] for v in per_day.values()),
        "total_cancelled": sum(v["cancelled"] for v in per_day.values()),
        "estimated_occupancy_pct": occupancy,
    }


# ==================== HEALTH ====================
@api.get("/")
async def root():
    return {"service": "21Reservation", "status": "ok"}


# Mount router
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    # Auto-seed demo on cold start
    try:
        await seed_demo(db)
    except Exception as e:
        logger.warning(f"Auto-seed skipped: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
