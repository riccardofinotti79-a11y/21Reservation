"""Seed demo data for 21Reservation."""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from auth import hash_password
from db import execute, execute_many, fetch_all, fetch_one, get_conn
from models import (
    Area,
    Booking,
    Customer,
    OpeningHour,
    Position,
    Restaurant,
    StatusChange,
    Table,
    User,
    DurationRule,
)


async def seed_demo() -> dict:
    """Idempotently create a demo restaurant + staff account + tables + hours + a few bookings.

    Returns a summary dict.
    """
    existing = await fetch_one("SELECT id FROM restaurants WHERE subdomain = 'demo'")
    if existing:
        return {"created": False, "restaurant_id": existing["id"]}

    # Restaurant
    r = Restaurant(
        name="21Reservation Demo",
        subdomain="demo",
        address="Via Roma 21, Milano",
        phone="+39 02 1234567",
        email="demo@21reservation.app",
        language="it",
        currency="EUR",
        timezone="Europe/Rome",
    )
    await execute(
        "INSERT INTO restaurants (id, name, subdomain, status, address, phone, email, language, currency, timezone, "
        "deposit_enabled, deposit_threshold_persons, deposit_amount_per_person, avg_ticket_per_guest, "
        "reminder_enabled, reminder_lead_hours, whatsapp_enabled, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (r.id, r.name, r.subdomain, r.status, r.address, r.phone, r.email, r.language, r.currency, r.timezone,
         r.deposit_enabled, r.deposit_threshold_persons, r.deposit_amount_per_person, r.avg_ticket_per_guest,
         r.reminder_enabled, r.reminder_lead_hours, r.whatsapp_enabled, r.created_at),
    )

    # Users: owner + staff
    owner = User(
        restaurant_id=r.id,
        name="Marco Rossi",
        email="owner@demo.com",
        password_hash=hash_password("demo1234"),
        role="owner",
    )
    staff = User(
        restaurant_id=r.id,
        name="Sara Bianchi",
        email="staff@demo.com",
        password_hash=hash_password("demo1234"),
        role="staff",
    )
    await execute_many(
        "INSERT INTO users (id, restaurant_id, name, email, password_hash, role, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,now())",
        [(u.id, u.restaurant_id, u.name, u.email, u.password_hash, u.role) for u in (owner, staff)],
    )

    # Areas
    sala = Area(restaurant_id=r.id, name="Sala Principale", priority=10)
    dehors = Area(restaurant_id=r.id, name="Dehors", priority=5)
    private = Area(restaurant_id=r.id, name="Sala Privata", priority=3)
    area_docs = [(a.id, a.restaurant_id, a.name, a.priority) for a in (sala, dehors, private)]
    await execute_many(
        "INSERT INTO areas (id, restaurant_id, name, priority) VALUES (%s,%s,%s,%s)", area_docs
    )

    # Tables
    tables = []
    def _grid_pos(idx):
        col = idx % 4
        row = idx // 4
        return (40 + col * 120, 40 + row * 100)
    sala_i = 0; dehors_i = 0; private_i = 0
    # Sala Principale
    for i, (name, mn, mx) in enumerate([
        ("T1", 1, 2), ("T2", 1, 2), ("T3", 2, 4), ("T4", 2, 4),
        ("T5", 4, 6), ("T6", 4, 6), ("T7", 6, 8),
    ]):
        x, y = _grid_pos(sala_i)
        tables.append(Table(
            restaurant_id=r.id, area_id=sala.id, name=name,
            seats_min=mn, seats_max=mx, priority=10 - i,
            shape="round" if mn <= 2 else "square",
        ).model_copy(update={"position": Position(x=x, y=y)}))
        sala_i += 1
    # Dehors
    for i, (name, mn, mx) in enumerate([
        ("D1", 2, 2), ("D2", 2, 4), ("D3", 4, 6),
    ]):
        x, y = _grid_pos(dehors_i)
        tables.append(Table(
            restaurant_id=r.id, area_id=dehors.id, name=name,
            seats_min=mn, seats_max=mx, priority=5 - i,
            shape="square",
        ).model_copy(update={"position": Position(x=x, y=y)}))
        dehors_i += 1
    # Private
    x, y = _grid_pos(private_i)
    tables.append(Table(
        restaurant_id=r.id, area_id=private.id, name="Private-1",
        seats_min=6, seats_max=12, priority=1, shape="rect",
    ).model_copy(update={"position": Position(x=x, y=y)}))
    await execute_many(
        "INSERT INTO tables (id, restaurant_id, area_id, name, seats_min, seats_max, priority, "
        "bookable_staff, bookable_online, shape, position_x, position_y) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,TRUE,TRUE,%s,%s,%s)",
        [(t.id, t.restaurant_id, t.area_id, t.name, t.seats_min, t.seats_max, t.priority, t.shape,
          t.position.x, t.position.y) for t in tables],
    )

    # Opening hours: dinner service Tue-Sun, 19:00 - 23:00
    duration_rules = [
        DurationRule(min_persons=1, max_persons=3, duration_minutes=90),
        DurationRule(min_persons=4, max_persons=6, duration_minutes=120),
        DurationRule(min_persons=7, max_persons=20, duration_minutes=150),
    ]
    ohs = []
    for wd in [1, 2, 3, 4, 5, 6]:  # Tue..Sun
        ohs.append(OpeningHour(
            restaurant_id=r.id,
            weekday=wd,
            open_time="19:00",
            close_time="23:00",
            title="Cena",
            service_type="dinner",
            slot_interval_minutes=15,
            default_duration_minutes=120,
            duration_rules=duration_rules,
        ))
    # Lunch Sat/Sun
    for wd in [5, 6]:
        ohs.append(OpeningHour(
            restaurant_id=r.id,
            weekday=wd,
            open_time="12:30",
            close_time="15:00",
            title="Pranzo",
            service_type="lunch",
            slot_interval_minutes=15,
            default_duration_minutes=90,
            duration_rules=duration_rules,
        ))
    await execute_many(
        "INSERT INTO opening_hours (id, restaurant_id, weekday, specific_date, open_time, close_time, title, "
        "service_type, slot_interval_minutes, default_duration_minutes, duration_rules, is_closed, "
        "requires_payment, payment_amount) "
        "VALUES (%s,%s,%s,NULL,%s,%s,%s,%s,%s,%s,%s,FALSE,FALSE,%s)",
        [(oh.id, oh.restaurant_id, oh.weekday, oh.open_time, oh.close_time, oh.title, oh.service_type,
          oh.slot_interval_minutes, oh.default_duration_minutes, oh.duration_rules, oh.payment_amount)
         for oh in ohs],
    )

    # Customers
    customers_data = [
        ("Luca Ferrari", "+39 333 1112222", "luca@example.com"),
        ("Giulia Neri", "+39 333 2223333", "giulia@example.com"),
        ("Andrea Verdi", "+39 333 3334444", "andrea@example.com"),
        ("Chiara Blu", "+39 333 4445555", "chiara@example.com"),
    ]
    customers = []
    for name, phone, email in customers_data:
        c = Customer(restaurant_id=r.id, name=name, phone=phone, email=email)
        await execute(
            "INSERT INTO customers (id, restaurant_id, name, phone, email, tags, created_at) "
            "VALUES (%s,%s,%s,%s,%s,'[]'::jsonb,now())",
            (c.id, c.restaurant_id, c.name, c.phone, c.email),
        )
        customers.append(c)

    # A few bookings today + next days
    today = datetime.now().date()
    sample_bookings = [
        (0, "19:30", 2, "accepted", customers[0], tables[0].id),
        (0, "20:00", 4, "accepted", customers[1], tables[2].id),
        (0, "20:30", 6, "pending", customers[2], tables[4].id),
        (1, "19:45", 2, "accepted", customers[3], tables[1].id),
        (1, "21:00", 8, "accepted", customers[0], tables[6].id),
        (2, "20:15", 3, "seated", customers[1], tables[3].id),
    ]
    involved_customer_ids = set()
    for offset, time_str, persons, status, cust, table_id in sample_bookings:
        d = (today + timedelta(days=offset)).isoformat()
        b = Booking(
            restaurant_id=r.id,
            customer_id=cust.id,
            date=d,
            time=time_str,
            duration_minutes=120,
            persons=persons,
            status=status,
            source="phone",
            table_ids=[table_id],
            status_history=[StatusChange(status=status)],
        )
        async with get_conn() as conn:
            row = b.model_dump()
            await conn.execute(
                "INSERT INTO bookings (id, restaurant_id, customer_id, date, time, duration_minutes, persons, status, source, deposit_required, deposit_amount, created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,FALSE,%s,%s)",
                (row["id"], row["restaurant_id"], row["customer_id"], row["date"], row["time"],
                 row["duration_minutes"], row["persons"], row["status"], row["source"], row["deposit_amount"],
                 row["created_at"]),
            )
            start_ts = datetime.strptime(f"{d} {time_str}", "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("Europe/Rome"))
            end_ts = start_ts + timedelta(minutes=b.duration_minutes)
            await conn.execute(
                "INSERT INTO booking_tables (booking_id, table_id, start_ts, end_ts, active) VALUES (%s,%s,%s,%s,TRUE)",
                (b.id, table_id, start_ts, end_ts),
            )
            for sc in b.status_history:
                await conn.execute(
                    "INSERT INTO booking_status_history (booking_id, status, at, by_user_id) VALUES (%s,%s,%s,NULL)",
                    (b.id, sc.status, sc.at),
                )
        involved_customer_ids.add(cust.id)

    # Recompute metrics for each customer touched by seed bookings
    for cid in involved_customer_ids:
        doc = await fetch_one(
            "SELECT COUNT(*) AS total, "
            "COUNT(*) FILTER (WHERE status = 'no_show') AS no_show, "
            "COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled "
            "FROM bookings WHERE customer_id = %s", (cid,))
        await execute(
            "UPDATE customers SET total_bookings = %s, no_show_count = %s, cancelled_count = %s WHERE id = %s",
            (doc["total"], doc["no_show"], doc["cancelled"], cid),
        )

    return {
        "created": True,
        "restaurant_id": r.id,
        "subdomain": "demo",
        "owner_email": "owner@demo.com",
        "staff_email": "staff@demo.com",
        "password": "demo1234",
    }