"""Iteration 7 — Edit Booking (PATCH /api/bookings/{bid}) + non-regression on bookings CRUD."""
import os
import time as _time
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "owner@demo.com", "password": "demo1234"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def future_date(h):
    # Discover a date in the next 14 days on which the restaurant is open.
    ohs = requests.get(f"{API}/opening-hours", headers=h, timeout=20).json()
    open_weekdays = {oh["weekday"] for oh in ohs if oh.get("weekday") is not None and not oh.get("is_closed")}
    for i in range(1, 21):
        d = date.today() + timedelta(days=i)
        if d.weekday() in open_weekdays:
            return d.isoformat()
    pytest.skip("No open weekday found in the next 21 days")


@pytest.fixture
def new_booking(h, future_date):
    payload = {
        "date": future_date,
        "time": "20:00",
        "persons": 2,
        "source": "phone",
        "status": "accepted",
        "customer_name": f"QA Edit {int(_time.time())}",
        "customer_phone": "+391112223333",
        "customer_email": f"qa_edit_{int(_time.time())}@example.com",
        "internal_note": "init note",
        "guest_message": "init msg",
    }
    r = requests.post(f"{API}/bookings", headers=h, json=payload, timeout=20)
    assert r.status_code == 200, r.text
    b = r.json()
    yield b
    # cleanup
    requests.delete(f"{API}/bookings/{b['id']}", headers=h, timeout=20)


# --- PATCH happy path (multi-field) ---
def test_patch_updates_multiple_fields(h, new_booking):
    bid = new_booking["id"]
    payload = {"persons": 4, "time": "20:30", "guest_message": "updated", "internal_note": "note2"}
    r = requests.patch(f"{API}/bookings/{bid}", headers=h, json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["persons"] == 4
    assert data["time"] == "20:30"
    assert data["guest_message"] == "updated"
    assert data["internal_note"] == "note2"
    # GET verifies persistence
    g = requests.get(f"{API}/bookings", headers=h, params={"date": data["date"]}, timeout=20)
    assert g.status_code == 200
    found = [x for x in g.json() if x["id"] == bid][0]
    assert found["persons"] == 4
    assert found["time"] == "20:30"


# --- PATCH partial (single field only) does not alter others ---
def test_patch_partial_internal_note_only(h, new_booking):
    bid = new_booking["id"]
    r = requests.patch(f"{API}/bookings/{bid}", headers=h, json={"internal_note": "only-note"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["internal_note"] == "only-note"
    # untouched
    assert d["persons"] == new_booking["persons"]
    assert d["time"] == new_booking["time"]
    assert d["guest_message"] == new_booking["guest_message"]


def test_patch_partial_persons_only(h, new_booking):
    bid = new_booking["id"]
    r = requests.patch(f"{API}/bookings/{bid}", headers=h, json={"persons": 6}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["persons"] == 6
    assert d["internal_note"] == new_booking["internal_note"]


# --- PATCH status change: history append + metrics + waitlist path ---
def test_patch_status_change_appends_history(h, new_booking):
    bid = new_booking["id"]
    before = len(new_booking.get("status_history") or [])
    r = requests.patch(f"{API}/bookings/{bid}", headers=h, json={"status": "cancelled"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "cancelled"
    hist = d.get("status_history") or []
    assert len(hist) == before + 1
    assert hist[-1]["status"] == "cancelled"
    # customer metrics recomputed
    c = requests.get(f"{API}/customers/{d['customer_id']}", headers=h, timeout=20)
    assert c.status_code == 200
    assert c.json()["cancelled_count"] >= 1


# --- 404 for missing ---
def test_patch_nonexistent_returns_404(h):
    r = requests.patch(f"{API}/bookings/does-not-exist-xyz", headers=h, json={"persons": 3}, timeout=20)
    assert r.status_code == 404


# --- 401/403 without JWT ---
def test_patch_without_auth_returns_401_or_403(new_booking):
    r = requests.patch(f"{API}/bookings/{new_booking['id']}", json={"persons": 3}, timeout=20)
    assert r.status_code in (401, 403)


# --- Non-regression: POST/GET/status/DELETE ---
def test_regression_full_crud(h, future_date):
    # CREATE
    p = {
        "date": future_date, "time": "13:00", "persons": 2,
        "source": "phone", "status": "pending",
        "customer_name": f"QA Regr {int(_time.time())}",
        "customer_phone": "+390000000000",
        "customer_email": f"qa_regr_{int(_time.time())}@example.com",
    }
    r = requests.post(f"{API}/bookings", headers=h, json=p, timeout=20)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]

    # GET list
    g = requests.get(f"{API}/bookings", headers=h, params={"date": future_date}, timeout=20)
    assert g.status_code == 200
    assert any(x["id"] == bid for x in g.json())

    # STATUS change
    s = requests.post(f"{API}/bookings/{bid}/status", headers=h, json={"status": "accepted"}, timeout=20)
    assert s.status_code == 200
    assert s.json()["status"] == "accepted"

    # DELETE
    d = requests.delete(f"{API}/bookings/{bid}", headers=h, timeout=20)
    assert d.status_code == 200
    assert d.json().get("deleted") is True
