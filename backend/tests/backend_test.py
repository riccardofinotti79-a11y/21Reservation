"""
21Reservation Backend API Tests
Covers: auth, restaurant/public, areas/tables/opening-hours CRUD, bookings
(auto-assign + overlap + state machine), public availability + booking,
reports, customers.
"""
import os
import time
from datetime import date, datetime, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "owner@demo.com", "password": "demo1234"}
SUBDOMAIN = "demo"


# -------------- fixtures --------------
@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="session")
def restaurant(auth_headers):
    r = requests.get(f"{API}/restaurant", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    return r.json()


def _next_weekday(target_wd: int) -> str:
    """target_wd: 0=Mon,1=Tue,...6=Sun. Returns ISO date string in future."""
    today = date.today()
    d = today + timedelta(days=1)
    while d.weekday() != target_wd:
        d += timedelta(days=1)
    return d.isoformat()


# -------------- AUTH --------------
class TestAuth:
    def test_login_success(self):
        r = requests.post(f"{API}/auth/login", json=OWNER)
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["user"]["email"] == OWNER["email"]
        assert data["user"]["role"] == "owner"
        assert data["restaurant"]["subdomain"] == "demo"

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER["email"], "password": "wrong"})
        assert r.status_code == 401

    def test_me(self, auth_headers):
        r = requests.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["email"] == OWNER["email"]


# -------------- RESTAURANT --------------
class TestRestaurant:
    def test_get_restaurant(self, auth_headers):
        r = requests.get(f"{API}/restaurant", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["subdomain"] == "demo"

    def test_public_restaurant(self):
        r = requests.get(f"{API}/public/restaurant/demo")
        assert r.status_code == 200
        d = r.json()
        assert d.get("subdomain") == "demo" or "name" in d


# -------------- SEED DATA --------------
class TestSeedData:
    def test_areas_seeded(self, auth_headers):
        r = requests.get(f"{API}/areas", headers=auth_headers)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_tables_seeded(self, auth_headers):
        r = requests.get(f"{API}/tables", headers=auth_headers)
        assert r.status_code == 200
        assert len(r.json()) >= 5

    def test_opening_hours_seeded(self, auth_headers):
        r = requests.get(f"{API}/opening-hours", headers=auth_headers)
        assert r.status_code == 200
        assert len(r.json()) >= 1


# -------------- AREAS/TABLES CRUD --------------
class TestAreasTables:
    created_area_id = None
    created_table_id = None

    def test_create_area(self, auth_headers):
        r = requests.post(
            f"{API}/areas",
            headers=auth_headers,
            json={"name": "TEST_Area", "priority": 1, "color": "#ff0000"},
        )
        assert r.status_code == 200, r.text
        TestAreasTables.created_area_id = r.json()["id"]
        assert r.json()["name"] == "TEST_Area"

    def test_create_table(self, auth_headers):
        assert TestAreasTables.created_area_id
        r = requests.post(
            f"{API}/tables",
            headers=auth_headers,
            json={
                "area_id": TestAreasTables.created_area_id,
                "name": "TEST_T1",
                "seats_min": 2,
                "seats_max": 4,
                "bookable_online": True,
            },
        )
        assert r.status_code == 200, r.text
        TestAreasTables.created_table_id = r.json()["id"]
        assert r.json()["name"] == "TEST_T1"

    def test_patch_table(self, auth_headers):
        tid = TestAreasTables.created_table_id
        r = requests.patch(
            f"{API}/tables/{tid}", headers=auth_headers, json={"seats_max": 6}
        )
        assert r.status_code == 200
        assert r.json()["seats_max"] == 6

    def test_delete_area_with_tables_fails(self, auth_headers):
        aid = TestAreasTables.created_area_id
        r = requests.delete(f"{API}/areas/{aid}", headers=auth_headers)
        assert r.status_code == 400

    def test_delete_table_then_area(self, auth_headers):
        tid = TestAreasTables.created_table_id
        r = requests.delete(f"{API}/tables/{tid}", headers=auth_headers)
        assert r.status_code == 200
        aid = TestAreasTables.created_area_id
        r2 = requests.delete(f"{API}/areas/{aid}", headers=auth_headers)
        assert r2.status_code == 200


# -------------- OPENING HOURS --------------
class TestOpeningHours:
    weekly_id = None
    exception_id = None

    def test_create_weekly(self, auth_headers):
        r = requests.post(
            f"{API}/opening-hours",
            headers=auth_headers,
            json={
                "weekday": 0,  # Monday
                "open_time": "12:30",
                "close_time": "15:00",
                "is_closed": False,
            },
        )
        assert r.status_code == 200, r.text
        TestOpeningHours.weekly_id = r.json()["id"]

    def test_create_exception(self, auth_headers):
        # a specific date closed - use far future date to avoid collision
        specific = (date.today() + timedelta(days=45)).isoformat()
        r = requests.post(
            f"{API}/opening-hours",
            headers=auth_headers,
            json={
                "specific_date": specific,
                "open_time": "00:00",
                "close_time": "00:00",
                "is_closed": True,
            },
        )
        assert r.status_code == 200, r.text
        TestOpeningHours.exception_id = r.json()["id"]

    def test_list_shows_both(self, auth_headers):
        r = requests.get(f"{API}/opening-hours", headers=auth_headers)
        assert r.status_code == 200
        ids = {oh["id"] for oh in r.json()}
        assert TestOpeningHours.weekly_id in ids
        assert TestOpeningHours.exception_id in ids

    def test_cleanup(self, auth_headers):
        for oh_id in [TestOpeningHours.weekly_id, TestOpeningHours.exception_id]:
            if oh_id:
                requests.delete(f"{API}/opening-hours/{oh_id}", headers=auth_headers)


# -------------- BOOKINGS / AUTO-ASSIGN / OVERLAP --------------
class TestBookings:
    booking_id = None
    small_table_id = None

    def _upcoming_tuesday(self):
        return _next_weekday(1)

    def test_create_booking_auto_assign_small_table(self, auth_headers):
        # Ensure booking for 2 persons - table should have closest fit (small table)
        tue = self._upcoming_tuesday()
        body = {
            "date": tue,
            "time": "19:30",
            "persons": 2,
            "customer_name": "TEST_AutoAssign",
            "customer_phone": "+390000001",
            "customer_email": "TEST_auto@example.com",
            "status": "accepted",
            "source": "phone",
        }
        r = requests.post(f"{API}/bookings", headers=auth_headers, json=body)
        assert r.status_code == 200, r.text
        b = r.json()
        assert len(b["table_ids"]) >= 1
        TestBookings.booking_id = b["id"]

        # Fetch tables to check capacity
        rt = requests.get(f"{API}/tables", headers=auth_headers)
        tables = {t["id"]: t for t in rt.json()}
        assigned_id = b["table_ids"][0]
        assigned = tables[assigned_id]
        # Must NOT get an 8-seat table when smaller tables exist that fit 2
        # Check that seats_max is not >=8 (should be closest fit)
        assert assigned["seats_max"] < 8, (
            f"Auto-assign gave large table {assigned} instead of closest fit"
        )
        TestBookings.small_table_id = assigned_id

    def test_overlap_rejected(self, auth_headers):
        # Try to book same table at overlapping time
        tue = self._upcoming_tuesday()
        r = requests.post(
            f"{API}/bookings",
            headers=auth_headers,
            json={
                "date": tue,
                "time": "19:45",
                "persons": 2,
                "customer_name": "TEST_Overlap",
                "customer_phone": "+390000002",
                "table_ids": [TestBookings.small_table_id],
                "status": "accepted",
                "source": "phone",
            },
        )
        assert r.status_code == 400, f"expected overlap rejection, got {r.status_code}: {r.text}"

    def test_state_machine(self, auth_headers):
        # Create fresh pending booking
        tue = self._upcoming_tuesday()
        r = requests.post(
            f"{API}/bookings",
            headers=auth_headers,
            json={
                "date": tue,
                "time": "22:00",
                "persons": 2,
                "customer_name": "TEST_State",
                "customer_phone": "+390000003",
                "status": "pending",
                "source": "phone",
            },
        )
        assert r.status_code == 200
        bid = r.json()["id"]

        # transition pending -> accepted
        r2 = requests.post(
            f"{API}/bookings/{bid}/status", headers=auth_headers, json={"status": "accepted"}
        )
        assert r2.status_code == 200
        # -> seated
        r3 = requests.post(
            f"{API}/bookings/{bid}/status", headers=auth_headers, json={"status": "seated"}
        )
        assert r3.status_code == 200
        history = r3.json()["status_history"]
        statuses = [h["status"] for h in history]
        assert "pending" in statuses and "accepted" in statuses and "seated" in statuses
        # cleanup
        requests.delete(f"{API}/bookings/{bid}", headers=auth_headers)

    def test_cleanup_booking(self, auth_headers):
        if TestBookings.booking_id:
            requests.delete(f"{API}/bookings/{TestBookings.booking_id}", headers=auth_headers)


# -------------- PUBLIC AVAILABILITY & BOOKING --------------
class TestPublic:
    def test_availability_day_open(self):
        tue = _next_weekday(1)
        r = requests.get(
            f"{API}/public/{SUBDOMAIN}/availability/day",
            params={"date": tue, "persons": 2},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["open"] is True
        assert isinstance(d["slots"], list) and len(d["slots"]) > 0

    def test_availability_day_closed_monday(self):
        mon = _next_weekday(0)
        r = requests.get(
            f"{API}/public/{SUBDOMAIN}/availability/day",
            params={"date": mon, "persons": 2},
        )
        assert r.status_code == 200
        assert r.json()["open"] is False

    def test_availability_month(self):
        today = date.today()
        r = requests.get(
            f"{API}/public/{SUBDOMAIN}/availability/month",
            params={"year": today.year, "month": today.month, "persons": 2},
        )
        assert r.status_code == 200
        d = r.json()
        assert "days" in d and len(d["days"]) > 0
        sample = d["days"][0]
        assert "open" in sample and "has_availability" in sample

    def test_public_book(self, auth_headers):
        tue = _next_weekday(1)
        # find an available slot first
        r_av = requests.get(
            f"{API}/public/{SUBDOMAIN}/availability/day",
            params={"date": tue, "persons": 2},
        )
        slots = r_av.json()["slots"]
        avail_slot = next((s for s in slots if s.get("available")), None)
        assert avail_slot, "no available slot for public booking"
        t = avail_slot["time"]

        r = requests.post(
            f"{API}/public/{SUBDOMAIN}/book",
            json={
                "date": tue,
                "time": t,
                "persons": 2,
                "customer_name": "TEST_Public",
                "customer_email": "TEST_public@example.com",
                "customer_phone": "+390000010",
                "guest_message": "test",
                "accept_terms": True,
            },
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "accepted"
        assert b["source"] == "online"
        assert len(b["table_ids"]) == 1
        # cleanup
        requests.delete(f"{API}/bookings/{b['id']}", headers=auth_headers)


# -------------- REPORTS --------------
class TestReports:
    def test_summary(self, auth_headers):
        today = date.today()
        d_from = (today - timedelta(days=7)).isoformat()
        d_to = (today + timedelta(days=7)).isoformat()
        r = requests.get(
            f"{API}/reports/summary",
            headers=auth_headers,
            params={"date_from": d_from, "date_to": d_to},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["per_day", "total_bookings", "total_guests", "total_no_show", "total_cancelled", "estimated_occupancy_pct"]:
            assert k in d, f"missing {k}"


# -------------- CUSTOMERS --------------
class TestCustomers:
    def test_search(self, auth_headers):
        r = requests.get(
            f"{API}/customers", headers=auth_headers, params={"search": "luca"}
        )
        assert r.status_code == 200
        # seed may or may not have luca; just ensure endpoint works and filter applied
        results = r.json()
        assert isinstance(results, list)
        # If results present, name should contain luca (ci)
        for c in results:
            assert "luca" in (c.get("name", "") + c.get("email", "") + c.get("phone", "")).lower()

    def test_patch_customer(self, auth_headers):
        # get any customer
        r = requests.get(f"{API}/customers", headers=auth_headers)
        assert r.status_code == 200
        customers = r.json()
        if not customers:
            pytest.skip("no customers")
        cid = customers[0]["id"]
        r2 = requests.patch(
            f"{API}/customers/{cid}",
            headers=auth_headers,
            json={"tags": ["TEST_vip"], "notes": "TEST_note", "bad_guest_flag": False},
        )
        assert r2.status_code == 200
        assert "TEST_vip" in r2.json().get("tags", [])
