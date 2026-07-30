"""Seed demo data for 21Reservation."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from auth import hash_password
from models import (
    Area,
    Booking,
    Customer,
    OpeningHour,
    Restaurant,
    StatusChange,
    Table,
    User,
    DurationRule,
    new_id,
)


async def seed_demo(db) -> dict:
    """Idempotently create a demo restaurant + staff account + tables + hours + a few bookings.

    Returns a summary dict.
    """
    existing = await db.restaurants.find_one({"subdomain": "demo"}, {"_id": 0})
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
    r_doc = r.model_dump()
    r_doc["created_at"] = r_doc["created_at"].isoformat()
    await db.restaurants.insert_one(r_doc)

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
    for u in (owner, staff):
        d = u.model_dump()
        d["created_at"] = d["created_at"].isoformat()
        await db.users.insert_one(d)

    # Areas
    sala = Area(restaurant_id=r.id, name="Sala Principale", priority=10)
    dehors = Area(restaurant_id=r.id, name="Dehors", priority=5)
    private = Area(restaurant_id=r.id, name="Sala Privata", priority=3)
    await db.areas.insert_many([a.model_dump() for a in (sala, dehors, private)])

    # Tables
    tables = []
    # Sala Principale
    for i, (name, mn, mx) in enumerate([
        ("T1", 1, 2), ("T2", 1, 2), ("T3", 2, 4), ("T4", 2, 4),
        ("T5", 4, 6), ("T6", 4, 6), ("T7", 6, 8),
    ]):
        tables.append(Table(
            restaurant_id=r.id, area_id=sala.id, name=name,
            seats_min=mn, seats_max=mx, priority=10 - i,
            shape="round" if mn <= 2 else "square",
        ))
    # Dehors
    for i, (name, mn, mx) in enumerate([
        ("D1", 2, 2), ("D2", 2, 4), ("D3", 4, 6),
    ]):
        tables.append(Table(
            restaurant_id=r.id, area_id=dehors.id, name=name,
            seats_min=mn, seats_max=mx, priority=5 - i,
            shape="square",
        ))
    # Private
    tables.append(Table(
        restaurant_id=r.id, area_id=private.id, name="Private-1",
        seats_min=6, seats_max=12, priority=1, shape="rect",
    ))
    await db.tables.insert_many([t.model_dump() for t in tables])

    # Opening hours: dinner service Tue-Sun, 19:00 - 23:00
    duration_rules = [
        DurationRule(min_persons=1, max_persons=3, duration_minutes=90),
        DurationRule(min_persons=4, max_persons=6, duration_minutes=120),
        DurationRule(min_persons=7, max_persons=20, duration_minutes=150),
    ]
    ohs = []
    for wd in [1, 2, 3, 4, 5, 6]:  # Tue..Sun
        oh = OpeningHour(
            restaurant_id=r.id,
            weekday=wd,
            open_time="19:00",
            close_time="23:00",
            title="Cena",
            slot_interval_minutes=15,
            default_duration_minutes=120,
            duration_rules=duration_rules,
        )
        ohs.append(oh)
    # Lunch Sat/Sun
    for wd in [5, 6]:
        oh = OpeningHour(
            restaurant_id=r.id,
            weekday=wd,
            open_time="12:30",
            close_time="15:00",
            title="Pranzo",
            slot_interval_minutes=15,
            default_duration_minutes=90,
            duration_rules=duration_rules,
        )
        ohs.append(oh)
    for oh in ohs:
        d = oh.model_dump()
        # duration_rules already serialized as dicts by model_dump
        await db.opening_hours.insert_one(d)

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
        d = c.model_dump()
        d["created_at"] = d["created_at"].isoformat()
        await db.customers.insert_one(d)
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
        doc = b.model_dump()
        doc["created_at"] = doc["created_at"].isoformat()
        for sh in doc["status_history"]:
            sh["at"] = sh["at"].isoformat() if hasattr(sh["at"], "isoformat") else sh["at"]
        await db.bookings.insert_one(doc)

    return {
        "created": True,
        "restaurant_id": r.id,
        "subdomain": "demo",
        "owner_email": "owner@demo.com",
        "staff_email": "staff@demo.com",
        "password": "demo1234",
    }
