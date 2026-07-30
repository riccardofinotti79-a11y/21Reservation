"""Iteration 4 tests: waitlist (public + staff), auto-notify on cancel, home dashboard."""
import os
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
OWNER = {"email": "owner@demo.com", "password": "demo1234"}
SUB = "demo"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


def _future_saturday():
    d = date.today() + timedelta(days=1)
    while d.weekday() != 5:  # Sat
        d += timedelta(days=1)
    # skip a bit farther to reduce conflict
    return (d + timedelta(days=14)).isoformat()


# ============ WAITLIST public + staff ============
class TestWaitlistBasic:
    created_id = None

    def test_public_join_waitlist(self):
        r = requests.post(
            f"{API}/public/{SUB}/waitlist",
            json={
                "date": _future_saturday(),
                "persons": 2,
                "service": "dinner",
                "customer_name": "TEST_WL_Basic",
                "customer_email": "test_wl_basic@example.com",
                "customer_phone": "+390000700",
                "message": "TEST",
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"]
        assert d["status"] == "waiting"
        assert d["persons"] == 2
        TestWaitlistBasic.created_id = d["id"]

    def test_staff_list_shows_entry(self, h):
        r = requests.get(f"{API}/waitlist", headers=h)
        assert r.status_code == 200
        ids = {e["id"] for e in r.json()}
        assert TestWaitlistBasic.created_id in ids

    def test_manual_notify(self, h):
        r = requests.post(
            f"{API}/waitlist/{TestWaitlistBasic.created_id}/notify", headers=h
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert "email_sent" in d
        # verify status transitioned
        lr = requests.get(f"{API}/waitlist", headers=h).json()
        target = next(e for e in lr if e["id"] == TestWaitlistBasic.created_id)
        assert target["status"] == "notified"
        assert target["notified_at"]

    def test_delete(self, h):
        r = requests.delete(f"{API}/waitlist/{TestWaitlistBasic.created_id}", headers=h)
        assert r.status_code == 200
        assert r.json().get("deleted") is True

    def test_delete_missing_returns_404(self, h):
        r = requests.delete(f"{API}/waitlist/does-not-exist", headers=h)
        assert r.status_code == 404


# ============ AUTO-NOTIFY on cancel ============
class TestWaitlistAutoNotify:
    def test_cancel_notifies_waiting_entry(self, h):
        d = _future_saturday()
        # Create a booking (uses a table)
        b_body = {
            "date": d, "time": "20:00", "persons": 2,
            "customer_name": "TEST_WL_Cancel", "customer_phone": "+390000701",
            "customer_email": "test_wl_cancel@example.com",
            "status": "accepted", "source": "phone",
        }
        rb = requests.post(f"{API}/bookings", headers=h, json=b_body)
        assert rb.status_code == 200, rb.text
        bid = rb.json()["id"]
        try:
            # Join waitlist for same date/persons
            rw = requests.post(
                f"{API}/public/{SUB}/waitlist",
                json={
                    "date": d, "persons": 2, "service": "dinner",
                    "customer_name": "TEST_WL_AutoNotify",
                    "customer_email": "test_wl_auto@example.com",
                    "customer_phone": "+390000702",
                },
            )
            assert rw.status_code == 200, rw.text
            wid = rw.json()["id"]
            assert rw.json()["status"] == "waiting"

            # Cancel the booking -> triggers _try_notify_waitlist
            rc = requests.post(
                f"{API}/bookings/{bid}/status", headers=h,
                json={"status": "cancelled"},
            )
            assert rc.status_code == 200, rc.text

            # Verify waitlist entry got notified
            lr = requests.get(f"{API}/waitlist", headers=h).json()
            entry = next((e for e in lr if e["id"] == wid), None)
            assert entry is not None
            assert entry["status"] == "notified", f"expected notified, got {entry['status']}"
            assert entry["notified_at"]

            # Cleanup
            requests.delete(f"{API}/waitlist/{wid}", headers=h)
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=h)


# ============ HOME DASHBOARD ============
class TestReportsHome:
    def test_shape(self, h):
        r = requests.get(f"{API}/reports/home", headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("today", "week", "month", "last7", "upcoming", "waitlist_active", "currency", "avg_ticket_per_guest"):
            assert k in d, f"missing key {k}"

        # today
        for k in ("bookings", "guests", "revenue", "pending"):
            assert k in d["today"], f"today missing {k}"
        assert isinstance(d["today"]["bookings"], int)
        assert isinstance(d["today"]["guests"], int)
        assert isinstance(d["today"]["revenue"], (int, float))
        assert isinstance(d["today"]["pending"], int)

        # week/month
        for k in ("bookings", "guests", "revenue", "start", "end"):
            assert k in d["week"], f"week missing {k}"
            assert k in d["month"], f"month missing {k}"

        # last7 is exactly 7 items
        assert isinstance(d["last7"], list)
        assert len(d["last7"]) == 7
        for entry in d["last7"]:
            for k in ("date", "bookings", "guests", "revenue"):
                assert k in entry

        # upcoming: <= 5
        assert isinstance(d["upcoming"], list)
        assert len(d["upcoming"]) <= 5

        # waitlist_active is int
        assert isinstance(d["waitlist_active"], int)

    def test_revenue_matches_ticket(self, h):
        r = requests.get(f"{API}/reports/home", headers=h)
        d = r.json()
        tk = d["avg_ticket_per_guest"]
        # revenue = guests * ticket
        for scope in ("today", "week", "month"):
            expected = round(d[scope]["guests"] * tk, 2)
            assert abs(d[scope]["revenue"] - expected) < 0.01, (
                f"{scope}: {d[scope]['revenue']} vs {expected}"
            )


# ============ Auth guard ============
class TestWaitlistAuth:
    def test_list_requires_auth(self):
        r = requests.get(f"{API}/waitlist")
        assert r.status_code in (401, 403)

    def test_reports_home_requires_auth(self):
        r = requests.get(f"{API}/reports/home")
        assert r.status_code in (401, 403)
