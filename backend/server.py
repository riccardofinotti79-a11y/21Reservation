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
    PublicRestaurantInfo, Restaurant, RestaurantUpdate, SlotAvailability,
    StatusChange, Table, TableCreate, TableUpdate, User, UserPublic,
    WaitlistEntry, WaitlistCreate, new_id, utc_now,
)
from auth import (  # noqa: E402
    create_access_token, get_current_user, hash_password, verify_password,
)
from availability import (  # noqa: E402
    auto_assign_table, duration_for_persons, find_available_tables,
    generate_slots, hhmm_to_minutes, pick_opening_hour, services_available_on,
    slot_within_limits,
)
from email_service import (  # noqa: E402
    booking_confirmation_html, send_email, staff_notification_html,
)
from payments import (  # noqa: E402
    construct_event, create_deposit_checkout, retrieve_session,
)
from reminders import send_reminders_for_restaurant  # noqa: E402
from seed import seed_demo  # noqa: E402
from whatsapp_service import send_whatsapp  # noqa: E402

import secrets as _secrets  # noqa: E402
from fastapi import Request  # noqa: E402

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
    # If the booking frees up capacity, offer the seat to the waitlist
    if body.status in ("cancelled", "declined", "no_show"):
        await _try_notify_waitlist(cur["restaurant_id"], doc["date"])
    updated = await db.bookings.find_one({"id": bid}, NO_ID)
    return Booking(**updated)


@api.delete("/bookings/{bid}")
async def delete_booking(bid: str, cur=Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": bid, "restaurant_id": cur["restaurant_id"]}, NO_ID)
    if not doc:
        raise HTTPException(404, "Booking not found")
    await db.bookings.delete_one({"id": bid})
    await _recompute_customer_metrics(doc["customer_id"])
    await _try_notify_waitlist(cur["restaurant_id"], doc["date"])
    return {"deleted": True}


# ==================== WAITLIST ====================
async def _slot_has_availability(rid: str, date_str: str, persons: int, service: Optional[str]) -> bool:
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    oh = pick_opening_hour(date_str, ohs, service=service)
    if not oh:
        return False
    duration = duration_for_persons(oh, persons)
    tables_all = await db.tables.find({"restaurant_id": rid, "bookable_online": True}, NO_ID).to_list(1000)
    existing = await _get_bookings_for_date(rid, date_str)
    from availability import generate_slots
    for s in generate_slots(oh, persons):
        if find_available_tables(persons, date_str, s, duration, tables_all, existing, online_only=True):
            return True
    return False


async def _try_notify_waitlist(rid: str, date_str: str):
    """Best-effort: scan waitlist entries for the given date, notify the first
    one that now has availability. Idempotent — an entry once notified stays 'notified'."""
    r = await _get_restaurant(rid)
    entries = await db.waitlist.find(
        {"restaurant_id": rid, "date": date_str, "status": "waiting"}, NO_ID
    ).sort("created_at", 1).to_list(200)
    for w in entries:
        try:
            has = await _slot_has_availability(rid, date_str, w["persons"], w.get("service"))
        except Exception as e:
            logger.warning(f"Waitlist scan failed: {e}")
            continue
        if not has:
            continue
        base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
        book_link = f"{base}/book/{r['subdomain']}"
        # Email
        try:
            html = f"""
            <html><body style="font-family:Georgia,serif;background:#f6f6f6;padding:24px;">
              <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
                <div style="background:#0a0a0a;color:#fafafa;padding:24px 32px;">
                  <div style="font-size:12px;letter-spacing:.25em;text-transform:uppercase;color:#a1a1aa;">{r['name']}</div>
                  <div style="font-size:24px;margin-top:6px;">Un tavolo si è appena liberato</div>
                </div>
                <div style="padding:24px 32px;font-family:Arial,sans-serif;color:#0a0a0a;">
                  <p>Ciao {w['customer_name']},</p>
                  <p>C'è ora disponibilità per <strong>{w['persons']} persone</strong> in data <strong>{w['date']}</strong>.
                     Prenota subito prima che qualcun altro lo prenda:</p>
                  <p><a href="{book_link}" style="display:inline-block;padding:12px 22px;background:#d97706;color:#0a0a0a;border-radius:999px;text-decoration:none;font-weight:600;">Prenota adesso</a></p>
                </div>
              </div>
            </body></html>
            """
            await send_email(w["customer_email"], f"Un tavolo libero da {r['name']}", html)
        except Exception as e:
            logger.warning(f"Waitlist email failed: {e}")
        # WhatsApp best-effort
        try:
            if w.get("customer_phone"):
                await send_whatsapp(
                    r, w["customer_phone"],
                    f"Ciao {w['customer_name']}, un tavolo per {w['persons']} si è liberato da {r['name']} il {w['date']}. Prenota: {book_link}",
                )
        except Exception:
            pass
        await db.waitlist.update_one(
            {"id": w["id"]},
            {"$set": {"status": "notified", "notified_at": utc_now().isoformat()}},
        )
        # Only notify the first matching entry per invocation
        break


@api.post("/public/{subdomain}/waitlist", response_model=WaitlistEntry)
async def public_join_waitlist(subdomain: str, body: WaitlistCreate):
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    customer = await _find_or_create_customer(rid, body.customer_name, body.customer_email, body.customer_phone)
    entry = WaitlistEntry(
        restaurant_id=rid,
        customer_id=customer["id"],
        **body.model_dump(),
    )
    d = entry.model_dump()
    d["created_at"] = d["created_at"].isoformat()
    await db.waitlist.insert_one(d)
    # Notify restaurant staff (best-effort)
    if r.get("email"):
        try:
            await send_email(
                r["email"],
                f"Nuova iscrizione lista d'attesa — {body.customer_name}",
                f"<p>{body.customer_name} è in lista d'attesa per il {body.date} — {body.persons} ospiti.</p>"
                f"<p>Tel: {body.customer_phone}</p><p>Email: {body.customer_email}</p>",
            )
        except Exception:
            pass
    return entry


@api.get("/waitlist", response_model=List[WaitlistEntry])
async def list_waitlist(
    cur=Depends(get_current_user),
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    q = {"restaurant_id": cur["restaurant_id"]}
    if status:
        q["status"] = status
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    docs = await db.waitlist.find(q, NO_ID).sort([("date", 1), ("created_at", 1)]).to_list(1000)
    return [WaitlistEntry(**d) for d in docs]


@api.post("/waitlist/{wid}/notify")
async def waitlist_notify_manual(wid: str, cur=Depends(get_current_user)):
    doc = await db.waitlist.find_one({"id": wid, "restaurant_id": cur["restaurant_id"]}, NO_ID)
    if not doc:
        raise HTTPException(404, "Waitlist entry not found")
    r = await _get_restaurant(cur["restaurant_id"])
    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    book_link = f"{base}/book/{r['subdomain']}"
    ok_email = False
    if doc.get("customer_email"):
        try:
            html = (
                f"<p>Ciao {doc['customer_name']},</p>"
                f"<p>Un tavolo per {doc['persons']} si è liberato da <strong>{r['name']}</strong> il {doc['date']}. "
                f"<a href='{book_link}'>Prenota adesso</a>.</p>"
            )
            ok_email = await send_email(doc["customer_email"], f"Un tavolo libero da {r['name']}", html)
        except Exception:
            pass
    await db.waitlist.update_one(
        {"id": wid},
        {"$set": {"status": "notified", "notified_at": utc_now().isoformat()}},
    )
    return {"ok": True, "email_sent": ok_email}


@api.delete("/waitlist/{wid}")
async def waitlist_remove(wid: str, cur=Depends(get_current_user)):
    r = await db.waitlist.delete_one({"id": wid, "restaurant_id": cur["restaurant_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Waitlist entry not found")
    return {"deleted": True}


# ==================== HOME DASHBOARD ====================
def _iso_week_bounds(d: date_cls):
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _month_bounds(d: date_cls):
    from calendar import monthrange
    first = d.replace(day=1)
    last = d.replace(day=monthrange(d.year, d.month)[1])
    return first, last


@api.get("/reports/home")
async def reports_home(cur=Depends(get_current_user)):
    today = date_cls.today()
    week_start, week_end = _iso_week_bounds(today)
    month_start, month_end = _month_bounds(today)
    r = await _get_restaurant(cur["restaurant_id"])
    ticket = float(r.get("avg_ticket_per_guest", 0) or 0)
    active = {"pending", "accepted", "seated"}

    def _aggregate(docs):
        b = 0; g = 0
        for d in docs:
            if d.get("status") in active:
                b += 1
                g += d.get("persons", 0)
        return {"bookings": b, "guests": g, "revenue": round(g * ticket, 2)}

    # Fetch broad range: from 6 days ago up to month_end (covers today/week/month + last7)
    range_start = min(today - timedelta(days=6), week_start, month_start)
    range_end = max(month_end, week_end, today)
    all_docs = await _get_bookings_range(cur["restaurant_id"], range_start.isoformat(), range_end.isoformat())
    by_date = {}
    for d in all_docs:
        by_date.setdefault(d["date"], []).append(d)

    def _for(d0, d1):
        acc = []
        d = d0
        while d <= d1:
            acc.extend(by_date.get(d.isoformat(), []))
            d = d + timedelta(days=1)
        return acc

    today_docs = by_date.get(today.isoformat(), [])
    week_docs = _for(week_start, week_end)
    month_docs = _for(month_start, month_end)

    last7 = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        agg = _aggregate(by_date.get(d.isoformat(), []))
        last7.append({"date": d.isoformat(), **agg})

    # Pending count today
    today_pending = sum(1 for x in today_docs if x.get("status") == "pending")

    # Upcoming bookings (next 3 upcoming today or later)
    upcoming = []
    now_iso = today.isoformat()
    future_docs = [x for x in all_docs if x["date"] >= now_iso and x.get("status") in active]
    future_docs.sort(key=lambda x: (x["date"], x.get("time", "00:00")))
    upcoming = future_docs[:5]

    # Waitlist counts
    wl_active = await db.waitlist.count_documents(
        {"restaurant_id": cur["restaurant_id"], "status": "waiting"}
    )

    return {
        "today": {**_aggregate(today_docs), "date": today.isoformat(), "pending": today_pending},
        "week": {
            **_aggregate(week_docs),
            "start": week_start.isoformat(), "end": week_end.isoformat(),
        },
        "month": {
            **_aggregate(month_docs),
            "start": month_start.isoformat(), "end": month_end.isoformat(),
        },
        "last7": last7,
        "waitlist_active": wl_active,
        "currency": r.get("currency", "EUR"),
        "avg_ticket_per_guest": ticket,
        "upcoming": upcoming,
    }


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
async def public_day_availability(subdomain: str, date: str, persons: int, service: Optional[str] = None):
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    oh = pick_opening_hour(date, ohs, service=service)
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
async def public_month_availability(subdomain: str, year: int, month: int, persons: int, service: Optional[str] = None):
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
        oh = pick_opening_hour(d.isoformat(), ohs, service=service)
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


@api.get("/public/{subdomain}/services")
async def public_services(subdomain: str, days_ahead: int = 60):
    """Returns which services (lunch/dinner) are offered by this restaurant,
    based on their weekly opening hours."""
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    weekly = [oh for oh in ohs if not oh.get("specific_date") and not oh.get("is_closed")]
    services = sorted({(oh.get("service_type") or "other") for oh in weekly})
    return {"services": services}


@api.post("/public/{subdomain}/book")
async def public_create_booking(subdomain: str, body: BookingCreatePublic):
    if not body.accept_terms:
        raise HTTPException(400, "Devi accettare i termini")
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    ohs = await db.opening_hours.find({"restaurant_id": rid}, NO_ID).to_list(500)
    oh = pick_opening_hour(body.date, ohs, service=body.service)
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

    # Deposit rule
    deposit_required = bool(
        r.get("deposit_enabled")
        and body.persons >= int(r.get("deposit_threshold_persons", 8))
        and float(r.get("deposit_amount_per_person", 0)) > 0
    )
    deposit_amount = 0.0
    initial_status = "accepted"
    deposit_status = None
    if deposit_required:
        deposit_amount = round(body.persons * float(r.get("deposit_amount_per_person", 0)), 2)
        initial_status = "pending"
        deposit_status = "pending"

    booking = Booking(
        restaurant_id=rid,
        customer_id=customer["id"],
        date=body.date,
        time=body.time,
        duration_minutes=duration,
        persons=body.persons,
        status=initial_status,
        source="online",
        table_ids=[assigned],
        guest_message=body.guest_message,
        status_history=[StatusChange(status=initial_status)],
        deposit_required=deposit_required,
        deposit_amount=deposit_amount,
        deposit_status=deposit_status,
        cancel_token=_secrets.token_urlsafe(24),
    )
    doc = _serialize(booking.model_dump())
    await db.bookings.insert_one(doc)
    await _recompute_customer_metrics(customer["id"])

    # If deposit required — create Stripe Checkout and return the URL
    checkout_url = None
    if deposit_required and body.origin_url:
        try:
            checkout = create_deposit_checkout(
                origin_url=body.origin_url,
                booking_id=booking.id,
                amount_eur=deposit_amount,
                currency=r.get("currency", "EUR"),
                guest_email=body.customer_email,
                restaurant_name=r["name"],
            )
            await db.bookings.update_one(
                {"id": booking.id},
                {"$set": {"deposit_session_id": checkout["session_id"]}},
            )
            checkout_url = checkout["url"]
        except Exception as e:
            logger.error(f"Stripe checkout create failed: {e}")
            # Roll back to accepted so booking still stands
            await db.bookings.update_one(
                {"id": booking.id},
                {"$set": {"status": "accepted", "deposit_required": False, "deposit_status": None}},
            )

    # Confirmation email (only if not awaiting deposit)
    if not deposit_required:
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

    # Reload booking (may have deposit_session_id)
    booking_doc = await db.bookings.find_one({"id": booking.id}, NO_ID)
    return {
        "booking": Booking(**booking_doc).model_dump(),
        "checkout_url": checkout_url,
        "deposit_required": deposit_required,
    }


# ==================== REPORTS ====================
@api.get("/reports/summary")
async def reports_summary(
    date_from: str,
    date_to: str,
    cur=Depends(get_current_user),
):
    docs = await _get_bookings_range(cur["restaurant_id"], date_from, date_to)
    restaurant = await _get_restaurant(cur["restaurant_id"])
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
        "avg_ticket_per_guest": float(restaurant.get("avg_ticket_per_guest", 0) or 0),
        "estimated_revenue": round(total_guests * float(restaurant.get("avg_ticket_per_guest", 0) or 0), 2),
        "currency": restaurant.get("currency", "EUR"),
    }


# ==================== SETTINGS ====================
@api.patch("/restaurant", response_model=Restaurant)
async def update_restaurant(body: RestaurantUpdate, cur=Depends(get_current_user)):
    if cur["role"] != "owner":
        raise HTTPException(403, "Owner role required")
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        r = await _get_restaurant(cur["restaurant_id"])
        return Restaurant(**r)
    r = await db.restaurants.find_one_and_update(
        {"id": cur["restaurant_id"]}, {"$set": upd},
        projection=NO_ID, return_document=True,
    )
    return Restaurant(**r)


# ==================== WHATSAPP ====================
@api.get("/whatsapp/status")
async def whatsapp_status(cur=Depends(get_current_user)):
    from whatsapp_service import whatsapp_is_configured
    r = await _get_restaurant(cur["restaurant_id"])
    return {
        "enabled": bool(r.get("whatsapp_enabled")),
        "provider": r.get("whatsapp_provider"),
        "configured": whatsapp_is_configured(r),
    }


@api.post("/whatsapp/test")
async def whatsapp_test(payload: dict, cur=Depends(get_current_user)):
    if cur["role"] != "owner":
        raise HTTPException(403, "Owner role required")
    to = (payload or {}).get("to") or ""
    if not to:
        raise HTTPException(400, "Manca il numero destinatario")
    r = await _get_restaurant(cur["restaurant_id"])
    from whatsapp_service import whatsapp_is_configured
    if not whatsapp_is_configured(r):
        raise HTTPException(400, "WhatsApp non configurato: verifica provider e credenziali")
    msg = (payload or {}).get("message") or f"Test WhatsApp da {r['name']} — funziona!"
    ok = await send_whatsapp(r, to, msg)
    if not ok:
        raise HTTPException(502, "Invio fallito: controlla i log del server per dettagli")
    return {"ok": True}


# ==================== PAYMENTS (DEPOSITS) ====================
@api.get("/payments/status/{session_id}")
async def payment_status(session_id: str):
    """Public: poll deposit status."""
    booking = await db.bookings.find_one({"deposit_session_id": session_id}, NO_ID)
    if not booking:
        raise HTTPException(404, "Session not found")
    # Fallback: if pending, ask Stripe directly (webhook may be delayed)
    if booking.get("deposit_status") != "paid":
        try:
            s = retrieve_session(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                # idempotent update
                await db.bookings.update_one(
                    {"id": booking["id"], "deposit_status": {"$ne": "paid"}},
                    {"$set": {"deposit_status": "paid", "status": "accepted"}},
                )
                booking = await db.bookings.find_one({"id": booking["id"]}, NO_ID)
        except Exception as e:
            logger.warning(f"Stripe status fetch failed: {e}")
    return {
        "session_id": session_id,
        "deposit_status": booking.get("deposit_status"),
        "booking_status": booking.get("status"),
        "booking_id": booking["id"],
    }


@api.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = construct_event(payload, sig)
    except Exception as e:
        logger.error(f"Webhook signature error: {e}")
        raise HTTPException(400, "Invalid signature")
    obj = event["data"]["object"]
    et = event["type"]
    if et in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        session_id = obj.get("id")
        await db.bookings.update_one(
            {"deposit_session_id": session_id, "deposit_status": {"$ne": "paid"}},
            {"$set": {
                "deposit_status": "paid",
                "status": "accepted",
                "status_history": [
                    *(await db.bookings.find_one({"deposit_session_id": session_id}, NO_ID) or {}).get("status_history", []),
                    {"status": "accepted", "at": utc_now().isoformat()},
                ],
            }},
        )
        # Best-effort email
        b = await db.bookings.find_one({"deposit_session_id": session_id}, NO_ID)
        if b:
            r = await _get_restaurant(b["restaurant_id"])
            c = await db.customers.find_one({"id": b["customer_id"]}, NO_ID)
            if c and c.get("email"):
                try:
                    html = booking_confirmation_html(
                        r["name"], c["name"], b["date"], b["time"], b["persons"], "accepted", r.get("address"),
                    )
                    await send_email(c["email"], f"Deposito ricevuto — {r['name']}", html)
                except Exception:
                    pass
    elif et in ("checkout.session.expired", "checkout.session.async_payment_failed"):
        await db.bookings.update_one(
            {"deposit_session_id": obj.get("id")},
            {"$set": {"deposit_status": "failed", "status": "cancelled"}},
        )
    return {"status": "ok"}


# ==================== PUBLIC CANCEL BY TOKEN ====================
@api.get("/public/cancel/{token}")
async def public_get_cancel(token: str):
    b = await db.bookings.find_one({"cancel_token": token}, NO_ID)
    if not b:
        raise HTTPException(404, "Not found")
    r = await _get_restaurant(b["restaurant_id"])
    c = await db.customers.find_one({"id": b["customer_id"]}, NO_ID)
    return {
        "restaurant_name": r["name"],
        "date": b["date"],
        "time": b["time"],
        "persons": b["persons"],
        "customer_name": c["name"] if c else "",
        "status": b["status"],
        "already_cancelled": b["status"] == "cancelled",
    }


@api.post("/public/cancel/{token}")
async def public_do_cancel(token: str):
    b = await db.bookings.find_one({"cancel_token": token}, NO_ID)
    if not b:
        raise HTTPException(404, "Not found")
    if b["status"] == "cancelled":
        return {"ok": True, "already": True}
    history = b.get("status_history", []) or []
    history.append({"status": "cancelled", "at": utc_now().isoformat()})
    await db.bookings.update_one(
        {"id": b["id"]},
        {"$set": {"status": "cancelled", "status_history": history}},
    )
    await _recompute_customer_metrics(b["customer_id"])
    return {"ok": True}


# ==================== CRON: REMINDERS ====================
@api.post("/cron/send-reminders")
async def cron_send_reminders(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("authorization", "")
    expected = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not expected or not auth.startswith("Bearer ") or auth.split(" ", 1)[1] != expected:
        raise HTTPException(401, "Unauthorized")
    base_url = os.environ.get("PUBLIC_BASE_URL") or str(request.base_url).rstrip("/")
    results = []
    async for r in db.restaurants.find({}, NO_ID):
        try:
            res = await send_reminders_for_restaurant(db, r, base_url)
            results.append(res)
        except Exception as e:
            logger.error(f"Reminder job failed for {r.get('id')}: {e}")
    return {"ok": True, "restaurants": results}


# ==================== FRONTEND CONFIG ====================
@api.get("/config/public")
async def public_config():
    return {
        "stripe_publishable_key": os.environ.get("STRIPE_PUBLISHABLE_KEY"),
    }


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
    # One-off idempotent repair
    try:
        await _repair_data(db)
    except Exception as e:
        logger.warning(f"Repair pass skipped: {e}")


async def _repair_data(db):
    """Idempotent one-off cleanup safe to run on every boot:
    (a) grid-place tables still at position (0,0), grouped by area (4/row, 120px step);
    (b) recompute total/no_show/cancelled counts for every customer;
    (c) delete customers whose name starts with 'TEST_'.
    """
    # (a) Grid-place stuck tables per area (any table still at 0,0 gets a slot)
    areas_all = await db.areas.find({}, NO_ID).to_list(1000)
    for area in areas_all:
        stuck = await db.tables.find(
            {"area_id": area["id"], "position.x": 0, "position.y": 0},
            NO_ID,
        ).sort("name", 1).to_list(500)
        placed_count = await db.tables.count_documents(
            {"area_id": area["id"], "$or": [{"position.x": {"$ne": 0}}, {"position.y": {"$ne": 0}}]}
        )
        for idx, tb in enumerate(stuck):
            slot = placed_count + idx  # offset so we don't overlap already-placed
            col = slot % 4
            row = slot // 4
            await db.tables.update_one(
                {"id": tb["id"]},
                {"$set": {"position": {"x": 40 + col * 120, "y": 40 + row * 100}}},
            )
    # (b) Recompute metrics for every customer
    async for c in db.customers.find({}, NO_ID):
        docs = await db.bookings.find({"customer_id": c["id"]}, NO_ID).to_list(5000)
        total = len(docs)
        no_show = sum(1 for x in docs if x.get("status") == "no_show")
        cancelled = sum(1 for x in docs if x.get("status") == "cancelled")
        if (c.get("total_bookings") != total
                or c.get("no_show_count") != no_show
                or c.get("cancelled_count") != cancelled):
            await db.customers.update_one(
                {"id": c["id"]},
                {"$set": {
                    "total_bookings": total,
                    "no_show_count": no_show,
                    "cancelled_count": cancelled,
                }},
            )
    # (c) Delete TEST_ customers
    await db.customers.delete_many({"name": {"$regex": "^TEST_"}})


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
