"""21Reservation FastAPI server."""
from __future__ import annotations

import logging
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone, date as date_cls
from pathlib import Path
from typing import List, Optional
from zoneinfo import ZoneInfo

import psycopg
from psycopg.errors import ExclusionViolation  # noqa: E402

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from starlette.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from models import (  # noqa: E402
    AdminRestaurantCreate, AdminRestaurantUpdate, AdminRestaurantSummary, AdminUserCreate,
    Area, AreaCreate, Booking, BookingCreatePublic, BookingCreateStaff,
    BookingStatusUpdate, BookingUpdate, Customer, CustomerCreate, CustomerUpdate,
    DayAvailability, LoginRequest, LoginResponse, OpeningHour, OpeningHourCreate,
    Position, PublicRestaurantInfo, Restaurant, RestaurantUpdate, SlotAvailability,
    StatusChange, Table, TableCreate, TableUpdate, User, UserPublic,
    WaitlistEntry, WaitlistCreate, new_id, utc_now,
)
from auth import (  # noqa: E402
    create_access_token, get_current_user, hash_password, require_agency_admin, verify_password,
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
from whatsapp_service import (  # noqa: E402
    build_confirmation_wa, send_whatsapp, whatsapp_is_configured,
)

import secrets as _secrets  # noqa: E402
from fastapi import Request  # noqa: E402

from db import (  # noqa: E402
    close_db, execute, execute_returning, fetch_all, fetch_one, get_conn, init_db,
)

app = FastAPI(title="21Reservation")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("21reservation")


# -------- Helpers --------
async def _get_restaurant(rid: str) -> dict:
    r = await fetch_one("SELECT * FROM restaurants WHERE id = %s", (rid,))
    if not r:
        raise HTTPException(404, "Restaurant not found")
    return r


async def _get_restaurant_by_subdomain(sub: str) -> dict:
    r = await fetch_one("SELECT * FROM restaurants WHERE subdomain = %s", (sub,))
    if not r:
        raise HTTPException(404, "Restaurant not found")
    return r


# ==================== AUTH ====================
@api.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    user = await fetch_one("SELECT * FROM users WHERE email = %s", (body.email.lower(),))
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenziali non valide")
    role = user.get("role", "staff")
    restaurant_obj = None
    if role != "agency_admin":
        # Regular users: enforce restaurant status = active
        r = await _get_restaurant(user["restaurant_id"])
        if r.get("status", "active") == "suspended":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account sospeso — contatta l'agenzia")
        restaurant_obj = Restaurant(**r)
    token = create_access_token(user["id"], user.get("restaurant_id"), role)
    return LoginResponse(
        access_token=token,
        user=UserPublic(**{k: user.get(k) for k in ("id", "restaurant_id", "name", "email", "role")}),
        restaurant=restaurant_obj,
    )


@api.get("/auth/me", response_model=UserPublic)
async def me(cur=Depends(get_current_user)):
    user = await fetch_one("SELECT * FROM users WHERE id = %s", (cur["user_id"],))
    if not user:
        raise HTTPException(404, "User not found")
    return UserPublic(**{k: user.get(k) for k in ("id", "restaurant_id", "name", "email", "role")})


# ==================== ADMIN (Agency portal) ====================
@api.get("/admin/metrics")
async def admin_metrics(_=Depends(require_agency_admin)):
    now = utc_now()
    day7 = (now - timedelta(days=7)).date().isoformat()
    day30 = (now - timedelta(days=30)).date().isoformat()
    rows = await fetch_all(
        """
        SELECT r.id, r.name, r.subdomain, r.status,
               COALESCE(b.total, 0) AS bookings_total,
               COALESCE(b.last7, 0) AS bookings_7d,
               COALESCE(b.last30, 0) AS bookings_30d,
               COALESCE(b.guests, 0) AS guests_total,
               COALESCE(c.customers_count, 0) AS customers_count
        FROM restaurants r
        LEFT JOIN (
            SELECT restaurant_id,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE date >= %s)::int AS last7,
                   COUNT(*) FILTER (WHERE date >= %s)::int AS last30,
                   COALESCE(SUM(persons), 0)::int AS guests
            FROM bookings
            GROUP BY restaurant_id
        ) b ON b.restaurant_id = r.id
        LEFT JOIN (
            SELECT restaurant_id, COUNT(*)::int AS customers_count
            FROM customers
            GROUP BY restaurant_id
        ) c ON c.restaurant_id = r.id
        """,
        (day7, day30),
    )
    per_r = []
    total_bookings = 0
    total_30d = 0
    active = 0
    suspended = 0
    for doc in rows:
        per_r.append(doc)
        total_bookings += doc["bookings_total"]
        total_30d += doc["bookings_30d"]
        if doc.get("status", "active") == "active":
            active += 1
        else:
            suspended += 1
    return {
        "totals": {
            "restaurants_total": len(per_r),
            "restaurants_active": active,
            "restaurants_suspended": suspended,
            "bookings_total": total_bookings,
            "bookings_30d": total_30d,
        },
        "per_restaurant": per_r,
    }


@api.get("/admin/restaurants", response_model=List[AdminRestaurantSummary])
async def admin_list_restaurants(_=Depends(require_agency_admin)):
    rows = await fetch_all("""
        SELECT r.id, r.name, r.subdomain, r.status, r.created_at,
               (SELECT COUNT(*) FROM users u WHERE u.restaurant_id = r.id)::int AS user_count
        FROM restaurants r
        ORDER BY r.created_at, r.id
    """)
    return [
        AdminRestaurantSummary(
            id=row["id"], name=row["name"], subdomain=row["subdomain"],
            status=row.get("status", "active"),
            user_count=row.get("user_count", 0),
            created_at=row.get("created_at"),
        )
        for row in rows
    ]


@api.post("/admin/restaurants")
async def admin_create_restaurant(body: AdminRestaurantCreate, _=Depends(require_agency_admin)):
    sub = body.subdomain.strip().lower()
    if not sub or not re.fullmatch(r"[a-z0-9-]+", sub):
        raise HTTPException(400, "Subdomain non valido (solo lettere minuscole, numeri e trattini)")
    if await fetch_one("SELECT 1 FROM restaurants WHERE subdomain = %s", (sub,)):
        raise HTTPException(400, "Subdomain già in uso")
    email = body.owner_email.lower()
    if await fetch_one("SELECT 1 FROM users WHERE email = %s", (email,)):
        raise HTTPException(400, "Email owner già registrata")
    r = Restaurant(name=body.restaurant_name, subdomain=sub, language=body.language)
    owner = User(
        restaurant_id=r.id, name=body.owner_name, email=email,
        password_hash=hash_password(body.owner_password), role="owner",
    )
    rd = r.model_dump()
    ud = owner.model_dump()
    await execute(
        "INSERT INTO restaurants (id, name, subdomain, language, created_at) VALUES (%s,%s,%s,%s,%s)",
        (rd["id"], rd["name"], rd["subdomain"], rd["language"], rd["created_at"]),
    )
    await execute(
        "INSERT INTO users (id, restaurant_id, name, email, password_hash, role, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (ud["id"], ud["restaurant_id"], ud["name"], ud["email"], ud["password_hash"], ud["role"], ud["created_at"]),
    )
    return {
        "restaurant": r.model_dump(mode="json"),
        "owner": UserPublic(**{k: ud[k] for k in ("id", "restaurant_id", "name", "email", "role")}).model_dump(),
        "credentials": {"email": email, "password": body.owner_password},
    }


@api.get("/admin/restaurants/{rid}")
async def admin_get_restaurant(rid: str, _=Depends(require_agency_admin)):
    r = await fetch_one("SELECT * FROM restaurants WHERE id = %s", (rid,))
    if not r:
        raise HTTPException(404, "Restaurant not found")
    users = await fetch_all("SELECT * FROM users WHERE restaurant_id = %s ORDER BY name", (rid,))
    return {
        "restaurant": Restaurant(**r).model_dump(mode="json"),
        "users": [UserPublic(**{k: u.get(k) for k in ("id", "restaurant_id", "name", "email", "role")}).model_dump() for u in users],
    }


@api.patch("/admin/restaurants/{rid}", response_model=Restaurant)
async def admin_update_restaurant(rid: str, body: AdminRestaurantUpdate, _=Depends(require_agency_admin)):
    existing = await fetch_one("SELECT 1 FROM restaurants WHERE id = %s", (rid,))
    if not existing:
        raise HTTPException(404, "Restaurant not found")
    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "subdomain" in patch:
        patch["subdomain"] = patch["subdomain"].strip().lower()
        if not patch["subdomain"] or not re.fullmatch(r"[a-z0-9-]+", patch["subdomain"]):
            raise HTTPException(400, "Subdomain non valido (solo lettere minuscole, numeri e trattini)")
        clash = await fetch_one("SELECT 1 FROM restaurants WHERE subdomain = %s AND id != %s", (patch["subdomain"], rid))
        if clash:
            raise HTTPException(400, "Subdomain già in uso")
    if patch:
        set_clause = ", ".join(f"{k} = %s" for k in patch)
        await execute(f"UPDATE restaurants SET {set_clause} WHERE id = %s", (*patch.values(), rid))
    updated = await fetch_one("SELECT * FROM restaurants WHERE id = %s", (rid,))
    return Restaurant(**updated)


@api.post("/admin/restaurants/{rid}/users", response_model=UserPublic)
async def admin_add_user(rid: str, body: AdminUserCreate, _=Depends(require_agency_admin)):
    existing = await fetch_one("SELECT 1 FROM restaurants WHERE id = %s", (rid,))
    if not existing:
        raise HTTPException(404, "Restaurant not found")
    email = body.email.lower()
    if await fetch_one("SELECT 1 FROM users WHERE email = %s", (email,)):
        raise HTTPException(400, "Email già registrata")
    u = User(restaurant_id=rid, name=body.name, email=email,
             password_hash=hash_password(body.password), role=body.role)
    doc = u.model_dump()
    await execute(
        "INSERT INTO users (id, restaurant_id, name, email, password_hash, role, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (doc["id"], doc["restaurant_id"], doc["name"], doc["email"], doc["password_hash"], doc["role"], doc["created_at"]),
    )
    return UserPublic(**{k: doc[k] for k in ("id", "restaurant_id", "name", "email", "role")})


@api.delete("/admin/users/{uid}")
async def admin_delete_user(uid: str, cur=Depends(require_agency_admin)):
    if uid == cur["user_id"]:
        raise HTTPException(400, "Non puoi eliminare te stesso")
    u = await fetch_one("SELECT * FROM users WHERE id = %s", (uid,))
    if not u:
        raise HTTPException(404, "User not found")
    if u.get("role") == "agency_admin":
        raise HTTPException(400, "Non puoi eliminare un agency_admin")
    await execute("DELETE FROM users WHERE id = %s", (uid,))
    return {"deleted": True}


# ==================== SEED ====================
SEED_ENABLED = os.environ.get("SEED_ENABLED", "false").lower() == "true"


@api.post("/seed/demo")
async def do_seed(cur=Depends(get_current_user)):
    """Idempotent demo seeding — only when SEED_ENABLED=true and user is authenticated."""
    if not SEED_ENABLED:
        raise HTTPException(404, "Not found")
    return await seed_demo()


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
    docs = await fetch_all("SELECT * FROM areas WHERE restaurant_id = %s ORDER BY priority DESC", (cur["restaurant_id"],))
    return [Area(**d) for d in docs]


@api.post("/areas", response_model=Area)
async def create_area(body: AreaCreate, cur=Depends(get_current_user)):
    a = Area(restaurant_id=cur["restaurant_id"], **body.model_dump())
    await execute("INSERT INTO areas (id, restaurant_id, name, priority) VALUES (%s,%s,%s,%s)", (a.id, a.restaurant_id, a.name, a.priority))
    return a


@api.patch("/areas/{area_id}", response_model=Area)
async def update_area(area_id: str, body: AreaCreate, cur=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    set_clause = ", ".join(f"{k} = %s" for k in upd)
    rowcount = await execute(f"UPDATE areas SET {set_clause} WHERE id = %s AND restaurant_id = %s", (*upd.values(), area_id, cur["restaurant_id"]))
    if rowcount == 0:
        raise HTTPException(404, "Area not found")
    r = await fetch_one("SELECT * FROM areas WHERE id = %s", (area_id,))
    return Area(**r)


@api.delete("/areas/{area_id}")
async def delete_area(area_id: str, cur=Depends(get_current_user)):
    exists = await fetch_one("SELECT 1 FROM tables WHERE area_id = %s AND restaurant_id = %s LIMIT 1", (area_id, cur["restaurant_id"]))
    if exists:
        raise HTTPException(400, "L'area contiene tavoli, spostali o eliminali prima")
    rowcount = await execute("DELETE FROM areas WHERE id = %s AND restaurant_id = %s", (area_id, cur["restaurant_id"]))
    if rowcount == 0:
        raise HTTPException(404, "Area not found")
    return {"deleted": True}


# ==================== TABLES ====================
def _table_from_row(d: dict) -> Table:
    """Convert flat PG row (position_x/y) to Table model with nested Position."""
    d["position"] = Position(x=d.pop("position_x", 0), y=d.pop("position_y", 0))
    return Table(**d)


@api.get("/tables", response_model=List[Table])
async def list_tables(cur=Depends(get_current_user)):
    docs = await fetch_all("SELECT * FROM tables WHERE restaurant_id = %s ORDER BY priority, name", (cur["restaurant_id"],))
    return [_table_from_row(d) for d in docs]


@api.post("/tables", response_model=Table)
async def create_table(body: TableCreate, cur=Depends(get_current_user)):
    area = await fetch_one("SELECT 1 FROM areas WHERE id = %s AND restaurant_id = %s", (body.area_id, cur["restaurant_id"]))
    if not area:
        raise HTTPException(400, "Area non valida")
    t = Table(restaurant_id=cur["restaurant_id"], **body.model_dump())
    pos = t.position
    await execute(
        "INSERT INTO tables (id, restaurant_id, area_id, name, seats_min, seats_max, priority, bookable_staff, bookable_online, internal_note, shape, position_x, position_y) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (t.id, t.restaurant_id, t.area_id, t.name, t.seats_min, t.seats_max, t.priority,
         t.bookable_staff, t.bookable_online, t.internal_note, t.shape, pos.x, pos.y),
    )
    return t


@api.patch("/tables/{table_id}", response_model=Table)
async def update_table(table_id: str, body: TableUpdate, cur=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "position" in upd:
        pos = upd.pop("position")
        if isinstance(pos, dict):
            upd["position_x"] = pos.get("x", 0)
            upd["position_y"] = pos.get("y", 0)
    if not upd:
        row = await fetch_one("SELECT * FROM tables WHERE id = %s AND restaurant_id = %s", (table_id, cur["restaurant_id"]))
        if not row:
            raise HTTPException(404, "Table not found")
        return _table_from_row(row)
    set_clause = ", ".join(f"{k} = %s" for k in upd)
    rowcount = await execute(f"UPDATE tables SET {set_clause} WHERE id = %s AND restaurant_id = %s", (*upd.values(), table_id, cur["restaurant_id"]))
    if rowcount == 0:
        raise HTTPException(404, "Table not found")
    row = await fetch_one("SELECT * FROM tables WHERE id = %s", (table_id,))
    return _table_from_row(row)


@api.delete("/tables/{table_id}")
async def delete_table(table_id: str, cur=Depends(get_current_user)):
    rowcount = await execute("DELETE FROM tables WHERE id = %s AND restaurant_id = %s", (table_id, cur["restaurant_id"]))
    if rowcount == 0:
        raise HTTPException(404, "Table not found")
    return {"deleted": True}


# ==================== OPENING HOURS ====================
@api.get("/opening-hours", response_model=List[OpeningHour])
async def list_opening_hours(cur=Depends(get_current_user)):
    docs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (cur["restaurant_id"],))
    return [OpeningHour(**d) for d in docs]


@api.post("/opening-hours", response_model=OpeningHour)
async def create_opening_hour(body: OpeningHourCreate, cur=Depends(get_current_user)):
    if body.weekday is None and not body.specific_date:
        raise HTTPException(400, "Serve un weekday o una specific_date")
    oh = OpeningHour(restaurant_id=cur["restaurant_id"], **body.model_dump())
    await execute(
        "INSERT INTO opening_hours (id, restaurant_id, weekday, specific_date, open_time, close_time, title, service_type, "
        "slot_interval_minutes, default_duration_minutes, duration_rules, is_closed, requires_payment, payment_amount) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (oh.id, oh.restaurant_id, oh.weekday, oh.specific_date, oh.open_time, oh.close_time,
         oh.title, oh.service_type, oh.slot_interval_minutes, oh.default_duration_minutes,
         oh.duration_rules, oh.is_closed, oh.requires_payment, oh.payment_amount),
    )
    return oh


@api.patch("/opening-hours/{oh_id}", response_model=OpeningHour)
async def update_opening_hour(oh_id: str, body: OpeningHourCreate, cur=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    set_clause = ", ".join(f"{k} = %s" for k in upd)
    rowcount = await execute(f"UPDATE opening_hours SET {set_clause} WHERE id = %s AND restaurant_id = %s", (*upd.values(), oh_id, cur["restaurant_id"]))
    if rowcount == 0:
        raise HTTPException(404, "Opening hour not found")
    r = await fetch_one("SELECT * FROM opening_hours WHERE id = %s", (oh_id,))
    return OpeningHour(**r)


@api.delete("/opening-hours/{oh_id}")
async def delete_opening_hour(oh_id: str, cur=Depends(get_current_user)):
    rowcount = await execute("DELETE FROM opening_hours WHERE id = %s AND restaurant_id = %s", (oh_id, cur["restaurant_id"]))
    if rowcount == 0:
        raise HTTPException(404, "Opening hour not found")
    return {"deleted": True}


# ==================== BOOKING LIMITS ====================
from models import BookingLimit, BaseModel  # noqa: E402


@api.get("/booking-limits")
async def list_booking_limits(cur=Depends(get_current_user)):
    """List all booking limits for this restaurant, enriched with opening hour info."""
    rows = await fetch_all("""
        SELECT bl.*, oh.weekday, oh.service_type, oh.open_time, oh.close_time
        FROM booking_limits bl
        JOIN opening_hours oh ON oh.id = bl.opening_hour_id
        WHERE oh.restaurant_id = %s
    """, (cur["restaurant_id"],))
    return rows


class BookingLimitUpdate(BaseModel):
    max_bookings_total: Optional[int] = None
    max_guests_total: Optional[int] = None
    max_bookings_per_slot: Optional[int] = None
    max_guests_per_slot: Optional[int] = None


@api.post("/booking-limits")
async def upsert_booking_limit(opening_hour_id: str, body: BookingLimitUpdate, cur=Depends(get_current_user)):
    """Create or update a booking limit for a specific opening hour."""
    oh = await fetch_one("SELECT 1 FROM opening_hours WHERE id = %s AND restaurant_id = %s", (opening_hour_id, cur["restaurant_id"]))
    if not oh:
        raise HTTPException(404, "Opening hour not found")
    update_fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not update_fields:
        raise HTTPException(400, "Nessun campo fornito")
    existing = await fetch_one("SELECT * FROM booking_limits WHERE opening_hour_id = %s", (opening_hour_id,))
    if existing:
        set_clause = ", ".join(f"{k} = %s" for k in update_fields)
        await execute(f"UPDATE booking_limits SET {set_clause} WHERE opening_hour_id = %s", (*update_fields.values(), opening_hour_id))
        doc = {**existing, **update_fields}
    else:
        bl = BookingLimit(opening_hour_id=opening_hour_id, **update_fields)
        doc = bl.model_dump()
        await execute(
            "INSERT INTO booking_limits (id, opening_hour_id, max_bookings_total, max_guests_total, max_bookings_per_slot, max_guests_per_slot) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (doc["id"], doc["opening_hour_id"], doc.get("max_bookings_total"), doc.get("max_guests_total"),
             doc.get("max_bookings_per_slot"), doc.get("max_guests_per_slot")),
        )
    return doc


@api.delete("/booking-limits/{limit_id}")
async def delete_booking_limit(limit_id: str, cur=Depends(get_current_user)):
    rowcount = await execute("DELETE FROM booking_limits WHERE id = %s", (limit_id,))
    if rowcount == 0:
        raise HTTPException(404, "Booking limit not found")
    return {"deleted": True}


# ==================== CUSTOMERS ====================
def _normalize_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    return re.sub(r"[\s\-\(\)]", "", phone)


def _ts_in_tz(tz: str, date_str: str, time_str: str) -> datetime:
    """Combine a booking (YYYY-MM-DD + HH:MM) into a tz-aware UTC timestamp."""
    local = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    return local.replace(tzinfo=ZoneInfo(tz))


def _customer_conds(restaurant_id: str, email: Optional[str], phone: Optional[str]):
    """Build WHERE clause + params to find a customer by email/phone."""
    params = [restaurant_id]
    conds = []
    if email:
        params.append(email.lower())
        conds.append("LOWER(email) = %s")
    if phone:
        params.append(phone)
        conds.append("phone = %s")
    clause = ""
    if conds:
        clause = " AND (" + " OR ".join(conds) + ")"
    return clause, params


async def _find_or_create_customer(
    restaurant_id: str,
    name: Optional[str],
    email: Optional[str],
    phone: Optional[str],
) -> dict:
    norm_phone = _normalize_phone(phone)
    clause, match_params = _customer_conds(restaurant_id, email, norm_phone)
    if clause:
        existing = await fetch_one(f"SELECT * FROM customers WHERE restaurant_id = %s{clause} LIMIT 1", tuple(match_params))
        if existing:
            return existing
    c = Customer(
        restaurant_id=restaurant_id,
        name=name or "Ospite",
        email=(email.lower() if email else None),
        phone=norm_phone,
    )
    d = c.model_dump()
    try:
        await execute(
            "INSERT INTO customers (id, restaurant_id, name, phone, email, tags, notes, bad_guest_flag, total_bookings, no_show_count, cancelled_count, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (d["id"], d["restaurant_id"], d["name"], d["phone"], d["email"], d["tags"], d["notes"],
             d["bad_guest_flag"], d["total_bookings"], d["no_show_count"], d["cancelled_count"], d["created_at"]),
        )
    except psycopg.errors.UniqueViolation:
        # A concurrent request created the same customer first (email or phone) — return theirs.
        if clause:
            return await fetch_one(f"SELECT * FROM customers WHERE restaurant_id = %s{clause} LIMIT 1", tuple(match_params))
        return await fetch_one("SELECT * FROM customers WHERE id = %s", (d["id"],))
    return d


@api.get("/customers", response_model=List[Customer])
async def list_customers(
    cur=Depends(get_current_user),
    search: Optional[str] = None,
):
    sql = "SELECT * FROM customers WHERE restaurant_id = %s"
    params: List = [cur["restaurant_id"]]
    if search:
        # Escape LIKE wildcards so user input matches literally (keeps case-insensitive search)
        safe = search.strip().replace("%", r"\%").replace("_", r"\_")
        like = f"%{safe}%"
        sql += " AND (name ILIKE %s OR email ILIKE %s OR phone ILIKE %s)"
        params += [like, like, like]
    sql += " ORDER BY name"
    docs = await fetch_all(sql, tuple(params))
    return [Customer(**d) for d in docs]


@api.post("/customers", response_model=Customer)
async def create_customer(body: CustomerCreate, cur=Depends(get_current_user)):
    c = Customer(restaurant_id=cur["restaurant_id"], **body.model_dump())
    d = c.model_dump()
    await execute(
        "INSERT INTO customers (id, restaurant_id, name, phone, email, tags, notes, bad_guest_flag, total_bookings, no_show_count, cancelled_count, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (d["id"], d["restaurant_id"], d["name"], d["phone"], d["email"], d["tags"], d["notes"],
         d["bad_guest_flag"], d["total_bookings"], d["no_show_count"], d["cancelled_count"], d["created_at"]),
    )
    return c


@api.get("/customers/{cid}", response_model=Customer)
async def get_customer(cid: str, cur=Depends(get_current_user)):
    d = await fetch_one("SELECT * FROM customers WHERE id = %s AND restaurant_id = %s", (cid, cur["restaurant_id"]))
    if not d:
        raise HTTPException(404, "Customer not found")
    return Customer(**d)


@api.patch("/customers/{cid}", response_model=Customer)
async def update_customer(cid: str, body: CustomerUpdate, cur=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if upd:
        set_clause = ", ".join(f"{k} = %s" for k in upd)
        rowcount = await execute(f"UPDATE customers SET {set_clause} WHERE id = %s AND restaurant_id = %s", (*upd.values(), cid, cur["restaurant_id"]))
        if rowcount == 0:
            raise HTTPException(404, "Customer not found")
    r = await fetch_one("SELECT * FROM customers WHERE id = %s", (cid,))
    return Customer(**r)


@api.get("/customers/{cid}/bookings", response_model=List[Booking])
async def customer_bookings(cid: str, cur=Depends(get_current_user)):
    rows = await fetch_all("SELECT * FROM bookings WHERE customer_id = %s AND restaurant_id = %s ORDER BY date DESC", (cid, cur["restaurant_id"]))
    return await _load_bookings(rows)


# ==================== BOOKINGS ====================
async def _attach_table_ids(rows: List[dict]) -> List[dict]:
    """Attach table_ids from the booking_tables bridge to each booking row."""
    if not rows:
        return rows
    ids = [r["id"] for r in rows]
    ph = ", ".join(["%s"] * len(ids))
    tid_rows = await fetch_all(
        f"SELECT booking_id, table_id FROM booking_tables WHERE booking_id IN ({ph})", tuple(ids),
    )
    by_id = defaultdict(list)
    for t in tid_rows:
        by_id[t["booking_id"]].append(t["table_id"])
    for r in rows:
        r["table_ids"] = by_id.get(r["id"], [])
    return rows


async def _load_bookings(rows: List[dict]) -> List[Booking]:
    """Turn booking rows into Booking models with table_ids + status_history (batched)."""
    if not rows:
        return []
    await _attach_table_ids(rows)
    ids = [r["id"] for r in rows]
    ph = ", ".join(["%s"] * len(ids))
    hist_rows = await fetch_all(
        f"SELECT booking_id, status, at, by_user_id FROM booking_status_history WHERE booking_id IN ({ph}) ORDER BY at", tuple(ids),
    )
    hist_map = defaultdict(list)
    for h in hist_rows:
        hist_map[h["booking_id"]].append({
            "status": h["status"], "at": h["at"], "by_user_id": h["by_user_id"],
        })
    out = []
    for r in rows:
        out.append(Booking(**r, table_ids=r.pop("table_ids", []), status_history=hist_map.get(r["id"], [])))
    return out


async def _load_booking(row: dict) -> Booking:
    return (await _load_bookings([row]))[0]


async def _get_bookings_for_date(rid: str, date_str: str) -> List[dict]:
    rows = await fetch_all("SELECT * FROM bookings WHERE restaurant_id = %s AND date = %s", (rid, date_str))
    return await _attach_table_ids(rows)


async def _get_bookings_range(rid: str, start: str, end: str) -> List[dict]:
    rows = await fetch_all("SELECT * FROM bookings WHERE restaurant_id = %s AND date >= %s AND date <= %s", (rid, start, end))
    return await _attach_table_ids(rows)


async def _recompute_customer_metrics(cid: str):
    counts = await fetch_all(
        "SELECT status, COUNT(*)::int AS n FROM bookings WHERE customer_id = %s GROUP BY status", (cid,),
    )
    totals = {row["status"]: row["n"] for row in counts}
    total = sum(totals.values())
    no_show = totals.get("no_show", 0)
    cancelled = totals.get("cancelled", 0)
    await execute(
        "UPDATE customers SET total_bookings = %s, no_show_count = %s, cancelled_count = %s WHERE id = %s",
        (total, no_show, cancelled, cid),
    )


@api.get("/bookings", response_model=List[Booking])
async def list_bookings(
    cur=Depends(get_current_user),
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    sql = "SELECT * FROM bookings WHERE restaurant_id = %s"
    params: List = [cur["restaurant_id"]]
    if date:
        sql += " AND date = %s"
        params.append(date)
    elif date_from and date_to:
        sql += " AND date >= %s AND date <= %s"
        params += [date_from, date_to]
    sql += " ORDER BY date, time"
    rows = await fetch_all(sql, tuple(params))
    return await _load_bookings(rows)


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
    r = await _get_restaurant(rid)
    ohs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (rid,))
    oh = pick_opening_hour(body.date, ohs)
    if not oh:
        raise HTTPException(400, "Ristorante chiuso in quella data")

    duration = body.duration_minutes or duration_for_persons(oh, body.persons)

    # Customer resolve
    if body.customer_id:
        customer = await fetch_one("SELECT * FROM customers WHERE id = %s AND restaurant_id = %s", (body.customer_id, rid))
        if not customer:
            raise HTTPException(400, "Cliente non trovato")
    else:
        customer = await _find_or_create_customer(
            rid, body.customer_name, body.customer_email, body.customer_phone
        )

    # Tables
    tables_all = await fetch_all("SELECT * FROM tables WHERE restaurant_id = %s", (rid,))
    areas_all = await fetch_all("SELECT * FROM areas WHERE restaurant_id = %s", (rid,))
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
    await _insert_booking_full(booking, r["timezone"])
    await _recompute_customer_metrics(customer["id"])
    return booking


async def _insert_booking_full(booking: Booking, tz: str):
    """Insert a booking row + bridge rows + status history in one transaction.
    EXCLUDE raises ExclusionViolation on a double-booking race → 409."""
    start_ts = _ts_in_tz(tz, booking.date, booking.time)
    end_ts = start_ts + timedelta(minutes=booking.duration_minutes)
    row = booking.model_dump()
    try:
        async with get_conn() as conn:
            await conn.execute(
                "INSERT INTO bookings (id, restaurant_id, customer_id, date, time, duration_minutes, persons, status, source, guest_message, internal_note, deposit_required, deposit_amount, deposit_status, deposit_session_id, reminder_sent_at, cancel_token, cancel_token_expires_at, created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (row["id"], row["restaurant_id"], row["customer_id"], row["date"], row["time"],
                 row["duration_minutes"], row["persons"], row["status"], row["source"],
                 row["guest_message"], row["internal_note"], row["deposit_required"], row["deposit_amount"],
                 row["deposit_status"], row["deposit_session_id"], row["reminder_sent_at"],
                 row["cancel_token"], row["cancel_token_expires_at"], row["created_at"]),
            )
            for tid in booking.table_ids:
                await conn.execute(
                    "INSERT INTO booking_tables (booking_id, table_id, start_ts, end_ts, active) VALUES (%s,%s,%s,%s,TRUE)",
                    (booking.id, tid, start_ts, end_ts),
                )
            for sc in booking.status_history:
                await conn.execute(
                    "INSERT INTO booking_status_history (booking_id, status, at, by_user_id) VALUES (%s,%s,%s,%s)",
                    (booking.id, sc.status, sc.at, sc.by_user_id),
                )
    except ExclusionViolation:
        raise HTTPException(409, "Il tavolo è appena stato occupato per questo slot, riprova")


@api.patch("/bookings/{bid}", response_model=Booking)
async def update_booking(bid: str, body: BookingUpdate, cur=Depends(get_current_user)):
    existing = await fetch_one("SELECT * FROM bookings WHERE id = %s AND restaurant_id = %s", (bid, cur["restaurant_id"]))
    if not existing:
        raise HTTPException(404, "Booking not found")
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    table_ids = upd.pop("table_ids", None)
    old_status = existing.get("status")
    new_status = upd.get("status")
    status_changed = bool(new_status and new_status != old_status)
    inactive = new_status in ("cancelled", "declined", "no_show")

    # Effective date/time/duration after this update (used to refresh the EXCLUDE window)
    eff_date = upd.get("date", existing["date"])
    eff_time = upd.get("time", existing["time"])
    eff_dur = upd.get("duration_minutes", existing["duration_minutes"])

    async with get_conn() as conn:
        if status_changed:
            await conn.execute(
                "INSERT INTO booking_status_history (booking_id, status, at, by_user_id) VALUES (%s,%s,%s,%s)",
                (bid, new_status, utc_now(), cur["user_id"]),
            )
        if upd:
            set_clause = ", ".join(f"{k} = %s" for k in upd)
            await conn.execute(f"UPDATE bookings SET {set_clause} WHERE id = %s", (*upd.values(), bid))
        if inactive:
            # Free the table for new bookings; keep history of the bridge rows.
            await conn.execute("UPDATE booking_tables SET active = FALSE WHERE booking_id = %s", (bid,))
        elif table_ids is not None:
            r = await _get_restaurant(cur["restaurant_id"])
            start_ts = _ts_in_tz(r["timezone"], eff_date, eff_time)
            end_ts = start_ts + timedelta(minutes=eff_dur)
            await conn.execute("DELETE FROM booking_tables WHERE booking_id = %s", (bid,))
            for tid in table_ids:
                await conn.execute(
                    "INSERT INTO booking_tables (booking_id, table_id, start_ts, end_ts, active) VALUES (%s,%s,%s,%s,TRUE)",
                    (bid, tid, start_ts, end_ts),
                )
        elif "date" in upd or "time" in upd or "duration_minutes" in upd:
            # Keep same tables but refresh the time window.
            r = await _get_restaurant(cur["restaurant_id"])
            start_ts = _ts_in_tz(r["timezone"], eff_date, eff_time)
            end_ts = start_ts + timedelta(minutes=eff_dur)
            await conn.execute("UPDATE booking_tables SET start_ts = %s, end_ts = %s WHERE booking_id = %s", (start_ts, end_ts, bid))

    if status_changed:
        await _recompute_customer_metrics(existing["customer_id"])
        if inactive:
            await _try_notify_waitlist(cur["restaurant_id"], eff_date)
    row = await fetch_one("SELECT * FROM bookings WHERE id = %s", (bid,))
    return await _load_booking(row)


@api.post("/bookings/{bid}/status", response_model=Booking)
async def change_status(bid: str, body: BookingStatusUpdate, cur=Depends(get_current_user)):
    doc = await fetch_one("SELECT * FROM bookings WHERE id = %s AND restaurant_id = %s", (bid, cur["restaurant_id"]))
    if not doc:
        raise HTTPException(404, "Booking not found")
    async with get_conn() as conn:
        await conn.execute("UPDATE bookings SET status = %s WHERE id = %s", (body.status, bid))
        await conn.execute(
            "INSERT INTO booking_status_history (booking_id, status, at, by_user_id) VALUES (%s,%s,%s,%s)",
            (bid, body.status, utc_now(), cur["user_id"]),
        )
        if body.status in ("cancelled", "declined", "no_show"):
            await conn.execute("UPDATE booking_tables SET active = FALSE WHERE booking_id = %s", (bid,))
    await _recompute_customer_metrics(doc["customer_id"])
    # Notify guest when approved (only on a real transition to accepted)
    if body.status == "accepted" and (doc.get("status") or "") != "accepted":
        r = await _get_restaurant(cur["restaurant_id"])
        c = await fetch_one("SELECT * FROM customers WHERE id = %s", (doc["customer_id"],))
        await _notify_guest_confirmed(r, c, doc)
    # If the booking frees up capacity, offer the seat to the waitlist
    if body.status in ("cancelled", "declined", "no_show"):
        await _try_notify_waitlist(cur["restaurant_id"], doc["date"])
    updated = await fetch_one("SELECT * FROM bookings WHERE id = %s", (bid,))
    return await _load_booking(updated)


@api.delete("/bookings/{bid}")
async def delete_booking(bid: str, cur=Depends(get_current_user)):
    doc = await fetch_one("SELECT * FROM bookings WHERE id = %s AND restaurant_id = %s", (bid, cur["restaurant_id"]))
    if not doc:
        raise HTTPException(404, "Booking not found")
    # ON DELETE CASCADE removes bridge + status history rows.
    await execute("DELETE FROM bookings WHERE id = %s", (bid,))
    await _recompute_customer_metrics(doc["customer_id"])
    await _try_notify_waitlist(cur["restaurant_id"], doc["date"])
    return {"deleted": True}


# ==================== WAITLIST ====================
async def _slot_has_availability(rid: str, date_str: str, persons: int, service: Optional[str]) -> bool:
    ohs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (rid,))
    oh = pick_opening_hour(date_str, ohs, service=service)
    if not oh:
        return False
    duration = duration_for_persons(oh, persons)
    tables_all = await fetch_all("SELECT * FROM tables WHERE restaurant_id = %s AND bookable_online = TRUE", (rid,))
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
    entries = await fetch_all(
        "SELECT * FROM waitlist WHERE restaurant_id = %s AND date = %s AND status = 'waiting' ORDER BY created_at",
        (rid, date_str),
    )
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
        await execute(
            "UPDATE waitlist SET status = 'notified', notified_at = %s WHERE id = %s",
            (utc_now().isoformat(), w["id"]),
        )
        # Only notify the first matching entry per invocation
        break


@api.post("/public/{subdomain}/waitlist", response_model=WaitlistEntry)
async def public_join_waitlist(subdomain: str, body: WaitlistCreate, request: Request):
    _check_public_rate_limit(request)
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    customer = await _find_or_create_customer(rid, body.customer_name, body.customer_email, body.customer_phone)
    entry = WaitlistEntry(
        restaurant_id=rid,
        customer_id=customer["id"],
        **body.model_dump(),
    )
    d = entry.model_dump()
    await execute(
        "INSERT INTO waitlist (id, restaurant_id, date, service, persons, preferred_time, customer_id, customer_name, customer_email, customer_phone, message, status, notified_at, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (d["id"], d["restaurant_id"], d["date"], d["service"], d["persons"], d["preferred_time"],
         d["customer_id"], d["customer_name"], d["customer_email"], d["customer_phone"],
         d["message"], d["status"], d["notified_at"], d["created_at"]),
    )
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
    sql = "SELECT * FROM waitlist WHERE restaurant_id = %s"
    params: List = [cur["restaurant_id"]]
    if status:
        sql += " AND status = %s"
        params.append(status)
    if date_from and date_to:
        sql += " AND date >= %s AND date <= %s"
        params += [date_from, date_to]
    sql += " ORDER BY date, created_at"
    docs = await fetch_all(sql, tuple(params))
    return [WaitlistEntry(**d) for d in docs]


@api.post("/waitlist/{wid}/notify")
async def waitlist_notify_manual(wid: str, cur=Depends(get_current_user)):
    doc = await fetch_one("SELECT * FROM waitlist WHERE id = %s AND restaurant_id = %s", (wid, cur["restaurant_id"]))
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
    await execute(
        "UPDATE waitlist SET status = 'notified', notified_at = %s WHERE id = %s",
        (utc_now().isoformat(), wid),
    )
    return {"ok": True, "email_sent": ok_email}


@api.delete("/waitlist/{wid}")
async def waitlist_remove(wid: str, cur=Depends(get_current_user)):
    rowcount = await execute("DELETE FROM waitlist WHERE id = %s AND restaurant_id = %s", (wid, cur["restaurant_id"]))
    if rowcount == 0:
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
    wl_active = (await fetch_one(
        "SELECT COUNT(*) AS n FROM waitlist WHERE restaurant_id = %s AND status = 'waiting'",
        (cur["restaurant_id"],),
    ))["n"]

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
    ohs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (rid,))
    oh = pick_opening_hour(date, ohs)
    if not oh:
        return {"suggested": None, "candidates": [], "closed": True}
    duration = duration_minutes or duration_for_persons(oh, persons)
    tables_all = await fetch_all("SELECT * FROM tables WHERE restaurant_id = %s", (rid,))
    areas_all = await fetch_all("SELECT * FROM areas WHERE restaurant_id = %s", (rid,))
    existing = await _get_bookings_for_date(rid, date)
    candidates = find_available_tables(persons, date, time, duration, tables_all, existing, online_only=False)
    suggested = auto_assign_table(persons, date, time, duration, tables_all, areas_all, existing, online_only=False)
    return {"suggested": suggested, "candidates": [c["id"] for c in candidates], "closed": False, "duration_minutes": duration}


# ==================== PUBLIC BOOKING ====================
@api.get("/public/{subdomain}/availability/day", response_model=DayAvailability)
async def public_day_availability(subdomain: str, date: str, persons: int, service: Optional[str] = None):
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    ohs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (rid,))
    oh = pick_opening_hour(date, ohs, service=service)
    if not oh:
        return DayAvailability(date=date, open=False, slots=[])
    duration = duration_for_persons(oh, persons)
    slots = generate_slots(oh, persons)
    tables_all = await fetch_all(
        "SELECT * FROM tables WHERE restaurant_id = %s AND bookable_online = TRUE", (rid,)
    )
    if not tables_all:
        return DayAvailability(date=date, open=True, slots=[])
    existing = await _get_bookings_for_date(rid, date)

    # Get limits for this opening hour
    limits = await fetch_one("SELECT * FROM booking_limits WHERE opening_hour_id = %s", (oh["id"],))

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
    ohs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (rid,))
    tables_all = await fetch_all("SELECT * FROM tables WHERE restaurant_id = %s AND bookable_online = TRUE", (rid,))
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
    ohs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (rid,))
    weekly = [oh for oh in ohs if not oh.get("specific_date") and not oh.get("is_closed")]
    services = sorted({(oh.get("service_type") or "other") for oh in weekly})
    return {"services": services}


async def _notify_guest_confirmed(r: dict, customer: dict, booking_doc: dict) -> None:
    """Notify guest their booking is confirmed — WhatsApp if configured, else email."""
    if not customer:
        return
    date = booking_doc.get("date")
    time = booking_doc.get("time")
    persons = booking_doc.get("persons")
    name = customer.get("name", "")
    restaurant_name = (r or {}).get("name", "")
    # WhatsApp first when the restaurant has it configured
    if whatsapp_is_configured(r) and customer.get("phone"):
        msg = build_confirmation_wa(restaurant_name, name, date, time, persons)
        try:
            if await send_whatsapp(r, customer["phone"], msg):
                return
        except Exception as e:
            logger.warning(f"WA confirm failed: {e}")
    if customer.get("email"):
        try:
            html = booking_confirmation_html(
                restaurant_name, name, date, time, persons, "accepted", (r or {}).get("address"),
            )
            await send_email(customer["email"], f"Prenotazione confermata — {restaurant_name}", html)
        except Exception as e:
            logger.warning(f"Email confirm failed: {e}")


@api.post("/public/{subdomain}/book")
async def public_create_booking(subdomain: str, body: BookingCreatePublic, request: Request):
    _check_public_rate_limit(request)
    if not body.accept_terms:
        raise HTTPException(400, "Devi accettare i termini")
    try:
        booking_date = date_cls.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(400, "Data non valida")
    if booking_date < date_cls.today():
        raise HTTPException(400, "Non è possibile prenotare per una data passata")
    r = await _get_restaurant_by_subdomain(subdomain)
    rid = r["id"]
    ohs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (rid,))
    oh = pick_opening_hour(body.date, ohs, service=body.service)
    if not oh:
        raise HTTPException(400, "Ristorante chiuso in quella data")

    duration = duration_for_persons(oh, body.persons)
    tables_all = await fetch_all("SELECT * FROM tables WHERE restaurant_id = %s AND bookable_online = TRUE", (rid,))
    areas_all = await fetch_all("SELECT * FROM areas WHERE restaurant_id = %s", (rid,))
    existing = await _get_bookings_for_date(rid, body.date)

    limits = await fetch_one("SELECT * FROM booking_limits WHERE opening_hour_id = %s", (oh["id"],))
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
    initial_status = "pending"  # online bookings require staff approval by default
    deposit_status = None
    if deposit_required:
        deposit_amount = round(body.persons * float(r.get("deposit_amount_per_person", 0)), 2)
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
        cancel_token_expires_at=utc_now() + timedelta(days=30),
    )
    await _insert_booking_full(booking, r["timezone"])
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
            await execute("UPDATE bookings SET deposit_session_id = %s WHERE id = %s", (checkout["session_id"], booking.id))
            checkout_url = checkout["url"]
        except Exception as e:
            logger.error(f"Stripe checkout create failed: {e}")
            # Keep booking pending (no deposit) so it still awaits staff approval
            await execute(
                "UPDATE bookings SET status = 'pending', deposit_required = FALSE, deposit_status = NULL WHERE id = %s",
                (booking.id,),
            )

    # Staff notification only — guest confirmation is sent upon approval
    if r.get("email"):
        try:
            html_staff = staff_notification_html(
                r["name"], body.customer_name, body.customer_phone, body.customer_email,
                body.date, body.time, body.persons, body.guest_message,
            )
            await send_email(r["email"], f"Nuova prenotazione online da approvare — {body.customer_name}", html_staff)
        except Exception as e:
            logger.warning(f"Staff email best-effort failed: {e}")

    # Reload booking (may have deposit_session_id)
    booking_row = await fetch_one("SELECT * FROM bookings WHERE id = %s", (booking.id,))
    return {
        "booking": (await _load_booking(booking_row)).model_dump(),
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

    tables_all = await fetch_all("SELECT * FROM tables WHERE restaurant_id = %s", (cur["restaurant_id"],))
    total_capacity = sum(t.get("seats_max", 0) for t in tables_all) or 1
    services = 0
    ohs = await fetch_all("SELECT * FROM opening_hours WHERE restaurant_id = %s", (cur["restaurant_id"],))
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
    set_clause = ", ".join(f"{k} = %s" for k in upd)
    await execute(f"UPDATE restaurants SET {set_clause} WHERE id = %s", (*upd.values(), cur["restaurant_id"]))
    r = await _get_restaurant(cur["restaurant_id"])
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
# Very small in-memory rate limit for the public status poll (100 calls / minute per process).
_last_poll_ts: list = []  # timestamps of recent calls

# ==================== PUBLIC RATE LIMITS ====================
# Per-IP sliding-window rate limiter for public endpoints (60 requests / minute per IP).
import time as _time
_public_rate_limits: dict = {}  # ip -> list of timestamps


def _check_public_rate_limit(request: Request, limit: int = 60, window: int = 60):
    """Raise 429 if an IP exceeds `limit` requests in `window` seconds."""
    ip = request.client.host if request.client else "unknown"
    now = _time.monotonic()
    timestamps = _public_rate_limits.setdefault(ip, [])
    # Purge old entries
    _public_rate_limits[ip] = [t for t in timestamps if t > now - window]
    if len(_public_rate_limits[ip]) >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Troppe richieste, riprova più tardi")
    _public_rate_limits[ip].append(now)


def _check_poll_rate_limit():
    """Raise 429 if more than 100 calls in the last 60 seconds (process-local)."""
    import time as _time
    now = _time.monotonic()
    _last_poll_ts[:] = [t for t in _last_poll_ts if t > now - 60]
    if len(_last_poll_ts) >= 100:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded, retry later")
    _last_poll_ts.append(now)


@api.get("/payments/status/{session_id}")
async def payment_status(session_id: str):
    """Public: poll deposit status for the booking tied to the Stripe session_id.

    Stays public because the booking flow has no authenticated user at checkout time.
    Mitigations:  (a) session_id is an unguessable Stripe id, (b) response exposes only
    payment/bookings status — no PII or booking details, (c) rate-limited.
    """
    _check_poll_rate_limit()
    booking = await fetch_one("SELECT * FROM bookings WHERE deposit_session_id = %s", (session_id,))
    if not booking:
        raise HTTPException(404, "Session not found")
    # Fallback: if pending, ask Stripe directly (webhook may be delayed)
    if booking.get("deposit_status") != "paid":
        try:
            s = retrieve_session(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                # idempotent update (deposit_status != 'paid' guard avoids double-apply)
                was_pending = (booking.get("deposit_status") or "") != "paid"
                rowcount = await execute(
                    "UPDATE bookings SET deposit_status = 'paid', status = 'accepted' WHERE id = %s AND deposit_status <> 'paid'",
                    (booking["id"],),
                )
                booking = await fetch_one("SELECT * FROM bookings WHERE id = %s", (booking["id"],))
                if rowcount and was_pending:
                    r = await _get_restaurant(booking["restaurant_id"])
                    c = await fetch_one("SELECT * FROM customers WHERE id = %s", (booking["customer_id"],))
                    await _notify_guest_confirmed(r, c, booking)
        except Exception as e:
            logger.warning(f"Stripe status fetch failed: {e}")
    return {
        "session_id": session_id,
        "deposit_status": booking.get("deposit_status"),
        "booking_status": booking.get("status"),
        # booking_id intentionally excluded — caller already knows the session_id
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
        rowcount = await execute(
            "UPDATE bookings SET deposit_status = 'paid', status = 'accepted' WHERE deposit_session_id = %s AND deposit_status <> 'paid'",
            (session_id,),
        )
        if rowcount:
            await execute(
                "INSERT INTO booking_status_history (booking_id, status, at, by_user_id) "
                "SELECT id, 'accepted', %s, 'stripe_webhook' FROM bookings WHERE deposit_session_id = %s",
                (utc_now(), session_id),
            )
        # Best-effort notify guest that deposit paid + booking confirmed
        b = await fetch_one("SELECT * FROM bookings WHERE deposit_session_id = %s", (session_id,))
        if b:
            r = await _get_restaurant(b["restaurant_id"])
            c = await fetch_one("SELECT * FROM customers WHERE id = %s", (b["customer_id"],))
            await _notify_guest_confirmed(r, c, b)
    elif et in ("checkout.session.expired", "checkout.session.async_payment_failed"):
        await execute(
            "UPDATE bookings SET deposit_status = 'failed', status = 'cancelled' WHERE deposit_session_id = %s",
            (obj.get("id"),),
        )
        await execute(
            "INSERT INTO booking_status_history (booking_id, status, at, by_user_id) "
            "SELECT id, 'cancelled', %s, 'stripe_webhook' FROM bookings WHERE deposit_session_id = %s",
            (utc_now(), obj.get("id")),
        )
        await execute(
            "UPDATE booking_tables SET active = FALSE WHERE booking_id IN (SELECT id FROM bookings WHERE deposit_session_id = %s)",
            (obj.get("id"),),
        )
    return {"status": "ok"}


# ==================== PUBLIC CANCEL BY TOKEN ====================
@api.get("/public/cancel/{token}")
async def public_get_cancel(token: str):
    b = await fetch_one("SELECT * FROM bookings WHERE cancel_token = %s", (token,))
    if not b:
        raise HTTPException(404, "Not found")
    r = await _get_restaurant(b["restaurant_id"])
    c = await fetch_one("SELECT * FROM customers WHERE id = %s", (b["customer_id"],))
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
async def public_do_cancel(token: str, request: Request):
    _check_public_rate_limit(request)
    b = await fetch_one("SELECT * FROM bookings WHERE cancel_token = %s", (token,))
    if not b:
        raise HTTPException(404, "Not found")
    if b["status"] == "cancelled":
        return {"ok": True, "already": True}
    # Reject cancellation if token has expired
    expires_at = b.get("cancel_token_expires_at")
    if expires_at:
        exp_dt = datetime.fromisoformat(expires_at) if isinstance(expires_at, str) else expires_at
        if exp_dt.replace(tzinfo=timezone.utc) < utc_now():
            raise HTTPException(410, "Il link di cancellazione è scaduto")
    async with get_conn() as conn:
        await conn.execute("UPDATE bookings SET status = 'cancelled' WHERE id = %s", (b["id"],))
        await conn.execute(
            "INSERT INTO booking_status_history (booking_id, status, at, by_user_id) VALUES (%s,'cancelled',%s,NULL)",
            (b["id"], utc_now()),
        )
        await conn.execute("UPDATE booking_tables SET active = FALSE WHERE booking_id = %s", (b["id"],))
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
    for r in await fetch_all("SELECT * FROM restaurants"):
        try:
            res = await send_reminders_for_restaurant(r, base_url)
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

# CORS: require explicit whitelist. Never fall back to "*" in production.
# Comma-separated list, e.g. CORS_ORIGINS=https://app.example.com,https://www.example.com
_cors_origins = os.environ.get("CORS_ORIGINS", "").strip()
if not _cors_origins:
    # Refuse to run unconfigured: wildcard + credentials is a security hole.
    raise RuntimeError(
        "CORS_ORIGINS env var is required (comma-separated allowed origins). "
        "Set it before starting the server."
    )
_cors_origins_list = [o.strip() for o in _cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await init_db()
    # Auto-seed demo on cold start — only when SEED_ENABLED=true
    if SEED_ENABLED:
        try:
            await seed_demo()
        except Exception as e:
            logger.warning(f"Auto-seed skipped: {e}")
    # Seed agency admin from env (idempotent)
    try:
        await _seed_agency_admin()
    except Exception as e:
        logger.warning(f"Agency admin seed skipped: {e}")
    # One-off idempotent repair — skip in production unless explicitly enabled
    if os.environ.get("RUN_REPAIR_ON_BOOT", "").lower() in ("1", "true", "yes"):
        try:
            await _repair_data()
        except Exception as e:
            logger.warning(f"Repair pass skipped: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    await close_db()


async def _seed_agency_admin():
    """Idempotently ensure a single agency_admin account exists (from env vars).

    AGENCY_ADMIN_EMAIL / AGENCY_ADMIN_PASSWORD; falls back to demo values if unset.
    """
    email = (os.environ.get("AGENCY_ADMIN_EMAIL") or "admin@21agency.com").lower()
    password = os.environ.get("AGENCY_ADMIN_PASSWORD")
    if not password:
        logger.warning("AGENCY_ADMIN_PASSWORD not set — using insecure default. Set this env var in production.")
        password = "agency123"
    existing = await fetch_one("SELECT * FROM users WHERE email = %s", (email,))
    if existing:
        # Ensure role/restaurant fields are correct even if the row pre-existed with wrong shape
        update = {}
        if existing.get("role") != "agency_admin":
            update["role"] = "agency_admin"
        if existing.get("restaurant_id") is not None:
            update["restaurant_id"] = None
        if update:
            set_clause = ", ".join(f"{k} = %s" for k in update)
            await execute(f"UPDATE users SET {set_clause} WHERE id = %s", (*update.values(), existing["id"]))
        return
    u = User(
        restaurant_id=None, name="Agency Admin", email=email,
        password_hash=hash_password(password), role="agency_admin",
    )
    doc = u.model_dump()
    await execute(
        "INSERT INTO users (id, restaurant_id, name, email, password_hash, role, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (doc["id"], doc["restaurant_id"], doc["name"], doc["email"], doc["password_hash"], doc["role"], doc["created_at"]),
    )
    logger.info(f"Seeded agency_admin: {email}")


async def _repair_data():
    """Idempotent one-off cleanup safe to run on every boot:
    (a) grid-place tables still at position (0,0), grouped by area (4/row, 120px step);
    (b) recompute total/no_show/cancelled counts for every customer;
    (c) delete customers whose name starts with 'TEST_', 'QA ', 'QA_' or 'AUDIT_'.
    """
    # (a) Grid-place stuck tables per area (any table still at 0,0 gets next free slot)
    def _slot_of(x, y):
        sx = int(round((x - 40) / 120))
        sy = int(round((y - 40) / 100))
        return (sx, sy) if sx >= 0 and sy >= 0 and sx < 4 else None

    def _pos_of(idx):
        col = idx % 4
        row = idx // 4
        return (40 + col * 120, 40 + row * 100)

    areas_all = await fetch_all("SELECT id FROM areas")
    for area in areas_all:
        placed = await fetch_all(
            "SELECT id, position_x, position_y FROM tables WHERE area_id = %s AND (position_x <> 0 OR position_y <> 0)",
            (area["id"],),
        )
        occupied = set()
        for tb in placed:
            s = _slot_of(tb["position_x"] or 0, tb["position_y"] or 0)
            if s is not None:
                occupied.add(s)
        stuck = await fetch_all(
            "SELECT id, name FROM tables WHERE area_id = %s AND position_x = 0 AND position_y = 0 ORDER BY name",
            (area["id"],),
        )
        cursor = 0
        for tb in stuck:
            # advance to next unoccupied slot
            while True:
                slot = (cursor % 4, cursor // 4)
                cursor += 1
                if slot not in occupied:
                    occupied.add(slot)
                    break
            px, py = _pos_of((slot[1] * 4) + slot[0])
            await execute(
                "UPDATE tables SET position_x = %s, position_y = %s WHERE id = %s",
                (px, py, tb["id"]),
            )
    # (b) Recompute metrics for every customer
    for c in await fetch_all("SELECT id, total_bookings, no_show_count, cancelled_count FROM customers"):
        counts = await fetch_all(
            "SELECT status, COUNT(*)::int AS n FROM bookings WHERE customer_id = %s GROUP BY status",
            (c["id"],),
        )
        totals = {row["status"]: row["n"] for row in counts}
        total = sum(totals.values())
        no_show = totals.get("no_show", 0)
        cancelled = totals.get("cancelled", 0)
        if (c.get("total_bookings") != total
                or c.get("no_show_count") != no_show
                or c.get("cancelled_count") != cancelled):
            await execute(
                "UPDATE customers SET total_bookings = %s, no_show_count = %s, cancelled_count = %s WHERE id = %s",
                (total, no_show, cancelled, c["id"]),
            )
    # (c) Delete synthetic test customers (TEST_*, QA *, QA_*, AUDIT_*)
    await execute("DELETE FROM customers WHERE name ~ '^(TEST_|QA[ _]|AUDIT_)'")
