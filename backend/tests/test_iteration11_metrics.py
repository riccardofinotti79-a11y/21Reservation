"""Iteration 11 — Agency metrics dashboard (GET /api/admin/metrics)."""
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

AGENCY = ("admin@21agency.com", "agency123")
OWNER = ("owner@demo.com", "demo1234")
STAFF = ("staff@demo.com", "demo1234")

TS = int(time.time())
NEW_SUB = f"metrics-test-a-{TS}"
NEW_NAME = "Metrics Test A"
NEW_OWNER_EMAIL = f"rossi+metrics{TS}@example.com"
NEW_OWNER_PW = "pass1234"


def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def agency_token():
    r = _login(*AGENCY)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def owner_token():
    r = _login(*OWNER)
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def staff_token():
    r = _login(*STAFF)
    assert r.status_code == 200
    return r.json()["access_token"]


# ---------- Auth ----------

def test_metrics_no_token():
    r = requests.get(f"{API}/admin/metrics", timeout=15)
    assert r.status_code in (401, 403), r.status_code


def test_metrics_owner_forbidden(owner_token):
    r = requests.get(f"{API}/admin/metrics", headers=_h(owner_token), timeout=15)
    assert r.status_code == 403


def test_metrics_staff_forbidden(staff_token):
    r = requests.get(f"{API}/admin/metrics", headers=_h(staff_token), timeout=15)
    assert r.status_code == 403


# ---------- Shape ----------

def test_metrics_shape(agency_token):
    r = requests.get(f"{API}/admin/metrics", headers=_h(agency_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "totals" in d and "per_restaurant" in d
    t = d["totals"]
    for k in ("restaurants_total", "restaurants_active", "restaurants_suspended",
              "bookings_total", "bookings_30d"):
        assert k in t, f"missing totals.{k}"
        assert isinstance(t[k], int)
    assert isinstance(d["per_restaurant"], list)
    if d["per_restaurant"]:
        row = d["per_restaurant"][0]
        for k in ("id", "name", "subdomain", "status", "bookings_total",
                  "bookings_7d", "bookings_30d", "guests_total", "customers_count"):
            assert k in row, f"missing per_restaurant.{k}"


def test_metrics_totals_consistency(agency_token):
    r = requests.get(f"{API}/admin/metrics", headers=_h(agency_token), timeout=15)
    assert r.status_code == 200
    d = r.json()
    sum_bt = sum(x["bookings_total"] for x in d["per_restaurant"])
    assert d["totals"]["bookings_total"] == sum_bt
    sum_30 = sum(x["bookings_30d"] for x in d["per_restaurant"])
    assert d["totals"]["bookings_30d"] == sum_30
    # active + suspended == total
    assert d["totals"]["restaurants_active"] + d["totals"]["restaurants_suspended"] == d["totals"]["restaurants_total"]


# ---------- Numeric correctness ----------

@pytest.fixture(scope="module")
def demo_before(agency_token):
    r = requests.get(f"{API}/admin/metrics", headers=_h(agency_token), timeout=15)
    assert r.status_code == 200
    for row in r.json()["per_restaurant"]:
        if row["subdomain"] == "demo":
            return row
    pytest.skip("demo not found")


@pytest.fixture(scope="module")
def new_restaurant(agency_token):
    body = {
        "restaurant_name": NEW_NAME,
        "subdomain": NEW_SUB,
        "owner_name": "Rossi Metrics",
        "owner_email": NEW_OWNER_EMAIL,
        "owner_password": NEW_OWNER_PW,
    }
    r = requests.post(f"{API}/admin/restaurants", json=body, headers=_h(agency_token), timeout=15)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    # ensure we can retrieve the id
    lst = requests.get(f"{API}/admin/restaurants", headers=_h(agency_token), timeout=15).json()
    ent = next((x for x in lst if x["subdomain"] == NEW_SUB), None)
    assert ent is not None
    yield ent
    # cleanup: suspend restaurant + delete owner user
    requests.put(
        f"{API}/admin/restaurants/{ent['id']}",
        json={"status": "suspended"},
        headers=_h(agency_token),
        timeout=15,
    )
    # find user id
    detail = requests.get(f"{API}/admin/restaurants/{ent['id']}", headers=_h(agency_token), timeout=15).json()
    for u in detail.get("users", []):
        if u["email"] == NEW_OWNER_EMAIL:
            requests.delete(f"{API}/admin/users/{u['id']}", headers=_h(agency_token), timeout=15)
            break


def test_metrics_new_restaurant_zero(agency_token, new_restaurant):
    r = requests.get(f"{API}/admin/metrics", headers=_h(agency_token), timeout=15)
    assert r.status_code == 200
    row = next((x for x in r.json()["per_restaurant"] if x["subdomain"] == NEW_SUB), None)
    assert row is not None, "new restaurant not in metrics"
    assert row["bookings_total"] == 0
    assert row["guests_total"] == 0
    assert row["customers_count"] == 0
    assert row["status"] == "active"


def test_metrics_after_bookings(agency_token, new_restaurant, demo_before):
    # Seed 2 bookings directly to MongoDB (new restaurant has no opening_hours/tables).
    # Allowed per task note.
    import asyncio
    from datetime import date, timedelta, datetime, timezone
    from motor.motor_asyncio import AsyncIOMotorClient
    import uuid
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    d = (date.today() + timedelta(days=3)).isoformat()
    rid = new_restaurant["id"]

    async def seed():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        for i in range(2):
            await db.bookings.insert_one({
                "id": str(uuid.uuid4()),
                "restaurant_id": rid,
                "date": d,
                "time": f"20:{i:02d}",
                "persons": 2 + i,  # 2+3=5
                "duration_minutes": 120,
                "status": "accepted",
                "source": "phone",
                "table_ids": [],
                "customer_name": f"Guest {i}",
                "customer_email": f"guest{i}+{TS}@example.com",
                "customer_phone": "+390000000000",
                "created_at": datetime.now(timezone.utc),
            })
        client.close()
    asyncio.run(seed())

    r = requests.get(f"{API}/admin/metrics", headers=_h(agency_token), timeout=15)
    assert r.status_code == 200
    d2 = r.json()
    row = next((x for x in d2["per_restaurant"] if x["subdomain"] == NEW_SUB), None)
    assert row is not None
    assert row["bookings_total"] == 2, f"expected 2, got {row['bookings_total']}"
    assert row["guests_total"] == 5, f"expected 5 guests, got {row['guests_total']}"

    # Tenant isolation — demo unchanged
    demo_after = next((x for x in d2["per_restaurant"] if x["subdomain"] == "demo"), None)
    assert demo_after is not None
    assert demo_after["bookings_total"] == demo_before["bookings_total"]
    assert demo_after["guests_total"] == demo_before["guests_total"]
    assert demo_after["customers_count"] == demo_before["customers_count"]
