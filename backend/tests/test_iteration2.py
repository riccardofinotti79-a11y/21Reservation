"""
21Reservation Iteration 2 — new features backend tests.
Covers: PATCH /restaurant (owner/staff), reports revenue, public book with deposit,
payments/status, stripe/webhook signature, public cancel by token, cron reminders,
tables position persist.
"""
import os
import time
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "owner@demo.com", "password": "demo1234"}
STAFF = {"email": "staff@demo.com", "password": "demo1234"}
SUBDOMAIN = "demo"
CRON_SECRET = "21r-cron-3f9e12c7ab6d84902fea7b1c5d8e0a4f"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def owner_headers():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def staff_headers():
    r = requests.post(f"{API}/auth/login", json=STAFF, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _next_weekday(target_wd: int) -> str:
    today = date.today()
    d = today + timedelta(days=1)
    while d.weekday() != target_wd:
        d += timedelta(days=1)
    return d.isoformat()


def _future_open_date():
    # any weekday except Monday (0)
    return _next_weekday(1)


# ---------- PATCH /restaurant ----------
class TestSettingsPatch:
    def test_owner_patch_settings(self, owner_headers):
        payload = {
            "deposit_enabled": True,
            "deposit_threshold_persons": 8,
            "deposit_amount_per_person": 20.0,
            "avg_ticket_per_guest": 65.0,
            "reminder_enabled": True,
            "reminder_lead_hours": 24,
            "whatsapp_enabled": False,
            "whatsapp_provider": None,
            "whatsapp_from": None,
        }
        r = requests.patch(f"{API}/restaurant", headers=owner_headers, json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["deposit_enabled"] is True
        assert d["deposit_threshold_persons"] == 8
        assert d["deposit_amount_per_person"] == 20.0
        assert d["avg_ticket_per_guest"] == 65.0
        assert d["reminder_lead_hours"] == 24

    def test_staff_patch_forbidden(self, staff_headers):
        r = requests.patch(
            f"{API}/restaurant", headers=staff_headers,
            json={"avg_ticket_per_guest": 99.0},
        )
        assert r.status_code == 403, r.text


# ---------- Reports revenue ----------
class TestReportsRevenue:
    def test_summary_includes_revenue(self, owner_headers):
        # ensure avg ticket set
        requests.patch(
            f"{API}/restaurant", headers=owner_headers,
            json={"avg_ticket_per_guest": 65.0},
        )
        today = date.today()
        d_from = (today - timedelta(days=7)).isoformat()
        d_to = (today + timedelta(days=14)).isoformat()
        r = requests.get(
            f"{API}/reports/summary", headers=owner_headers,
            params={"date_from": d_from, "date_to": d_to},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "avg_ticket_per_guest" in d
        assert "estimated_revenue" in d
        assert "currency" in d
        assert d["avg_ticket_per_guest"] == 65.0
        # revenue = guests * avg
        assert abs(d["estimated_revenue"] - d["total_guests"] * 65.0) < 0.01


# ---------- Public booking with/without deposit ----------
class TestPublicDeposit:
    def _find_slot(self, dt, persons):
        r = requests.get(
            f"{API}/public/{SUBDOMAIN}/availability/day",
            params={"date": dt, "persons": persons},
        )
        assert r.status_code == 200, r.text
        slots = r.json().get("slots", [])
        s = next((s for s in slots if s.get("available")), None)
        assert s, f"no slot for {dt} persons={persons}"
        return s["time"]

    def test_below_threshold_no_deposit(self, owner_headers):
        # set deposit enabled with threshold=8
        requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "deposit_enabled": True, "deposit_threshold_persons": 8,
            "deposit_amount_per_person": 20.0,
        })
        dt = _future_open_date()
        t = self._find_slot(dt, 2)
        r = requests.post(f"{API}/public/{SUBDOMAIN}/book", json={
            "date": dt, "time": t, "persons": 2,
            "customer_name": "TEST_NoDep", "customer_email": "TEST_nodep@example.com",
            "customer_phone": "+390000101", "accept_terms": True,
            "origin_url": "https://example.com",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["deposit_required"] is False
        assert d.get("checkout_url") is None
        assert d["booking"]["status"] == "accepted"
        # cleanup
        requests.delete(f"{API}/bookings/{d['booking']['id']}", headers=owner_headers)

    def test_above_threshold_deposit_stripe(self, owner_headers):
        requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "deposit_enabled": True, "deposit_threshold_persons": 8,
            "deposit_amount_per_person": 20.0,
        })
        dt = _future_open_date()
        # 8 persons might exceed a single online table capacity; test with 8 and see
        # Try with 8 first, fallback to threshold=6 for smaller party
        # For clean isolated test, drop threshold to 6 so 6-person booking triggers deposit
        requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "deposit_enabled": True, "deposit_threshold_persons": 6,
            "deposit_amount_per_person": 25.0,
        })
        t = self._find_slot(dt, 6)
        r = requests.post(f"{API}/public/{SUBDOMAIN}/book", json={
            "date": dt, "time": t, "persons": 6,
            "customer_name": "TEST_Dep", "customer_email": "TEST_dep@example.com",
            "customer_phone": "+390000102", "accept_terms": True,
            "origin_url": "https://example.com",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["deposit_required"] is True, d
        assert d.get("checkout_url"), "expected checkout_url"
        assert "checkout.stripe.com" in d["checkout_url"]
        b = d["booking"]
        assert b["status"] == "pending"
        assert b["deposit_status"] == "pending"
        assert b["deposit_amount"] == 6 * 25.0
        assert b.get("deposit_session_id")
        # Persist session_id for next test
        TestPublicDeposit.session_id = b["deposit_session_id"]
        TestPublicDeposit.booking_id = b["id"]

    def test_payment_status(self, owner_headers):
        sid = getattr(TestPublicDeposit, "session_id", None)
        if not sid:
            pytest.skip("no session from previous test")
        r = requests.get(f"{API}/payments/status/{sid}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["session_id"] == sid
        assert d["deposit_status"] in ("pending", "paid")
        assert d["booking_status"] in ("pending", "accepted")
        assert d["booking_id"] == TestPublicDeposit.booking_id
        # cleanup booking
        requests.delete(
            f"{API}/bookings/{TestPublicDeposit.booking_id}", headers=owner_headers,
        )

    def test_webhook_invalid_signature(self):
        r = requests.post(
            f"{API}/stripe/webhook", data=b'{"type":"x"}',
            headers={"stripe-signature": "invalid", "Content-Type": "application/json"},
        )
        assert r.status_code == 400

    def test_reset_deposit_disabled(self, owner_headers):
        r = requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "deposit_enabled": False,
        })
        assert r.status_code == 200
        assert r.json()["deposit_enabled"] is False


# ---------- Public cancel by token ----------
class TestPublicCancel:
    def test_cancel_flow(self, owner_headers):
        # ensure no deposit interference
        requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "deposit_enabled": False,
        })
        dt = _future_open_date()
        r_av = requests.get(
            f"{API}/public/{SUBDOMAIN}/availability/day",
            params={"date": dt, "persons": 2},
        )
        t = next(s["time"] for s in r_av.json()["slots"] if s.get("available"))
        r = requests.post(f"{API}/public/{SUBDOMAIN}/book", json={
            "date": dt, "time": t, "persons": 2,
            "customer_name": "TEST_Cancel", "customer_email": "TEST_c@example.com",
            "customer_phone": "+390000200", "accept_terms": True,
            "origin_url": "https://example.com",
        })
        assert r.status_code == 200, r.text
        bid = r.json()["booking"]["id"]
        # Fetch bookings list to find cancel_token
        rg = requests.get(
            f"{API}/bookings", headers=owner_headers,
            params={"date_from": dt, "date_to": dt},
        )
        assert rg.status_code == 200
        booking = next((b for b in rg.json() if b["id"] == bid), None)
        assert booking, "booking not found in list"
        token = booking.get("cancel_token")
        assert token, "booking should have a cancel_token on creation"

        # GET
        rg2 = requests.get(f"{API}/public/cancel/{token}")
        assert rg2.status_code == 200, rg2.text
        d = rg2.json()
        assert d["persons"] == 2
        assert d["customer_name"] == "TEST_Cancel"
        assert d["already_cancelled"] is False

        # POST 1
        rp = requests.post(f"{API}/public/cancel/{token}")
        assert rp.status_code == 200
        assert rp.json()["ok"] is True

        # POST 2 - idempotent
        rp2 = requests.post(f"{API}/public/cancel/{token}")
        assert rp2.status_code == 200
        j = rp2.json()
        assert j["ok"] is True
        assert j.get("already") is True

        # cleanup
        requests.delete(f"{API}/bookings/{bid}", headers=owner_headers)


# ---------- Cron reminders ----------
class TestCronReminders:
    def test_unauthorized(self):
        r = requests.post(f"{API}/cron/send-reminders")
        assert r.status_code == 401

    def test_authorized(self, owner_headers):
        # Ensure reminder enabled with lead=24h
        requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "reminder_enabled": True, "reminder_lead_hours": 24,
            "deposit_enabled": False,
        })
        # Create booking exactly 24h from now → target date = today + 1 (UTC)
        target = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
        # If target is Monday (closed), push to Tuesday
        d_check = date.fromisoformat(target)
        if d_check.weekday() == 0:
            target = (d_check + timedelta(days=1)).isoformat()
        # Get slot
        r_av = requests.get(
            f"{API}/public/{SUBDOMAIN}/availability/day",
            params={"date": target, "persons": 2},
        )
        assert r_av.status_code == 200 and r_av.json().get("open"), r_av.text
        t = next(s["time"] for s in r_av.json()["slots"] if s.get("available"))
        # Create booking via staff endpoint (accepted)
        rb = requests.post(f"{API}/bookings", headers=owner_headers, json={
            "date": target, "time": t, "persons": 2,
            "customer_name": "TEST_Rem", "customer_email": "TEST_rem@example.com",
            "customer_phone": "+390000300", "status": "accepted", "source": "phone",
        })
        assert rb.status_code == 200, rb.text
        bid = rb.json()["id"]

        # Cron run
        r = requests.post(
            f"{API}/cron/send-reminders",
            headers={"Authorization": f"Bearer {CRON_SECRET}"},
        )
        assert r.status_code == 200, r.text
        assert "restaurants" in r.json()

        # Check booking updated
        rg = requests.get(
            f"{API}/bookings", headers=owner_headers,
            params={"date_from": target, "date_to": target},
        )
        b = next(x for x in rg.json() if x["id"] == bid)
        assert b.get("reminder_sent_at"), "reminder_sent_at should be set after cron"
        assert b.get("cancel_token"), "cancel_token should be set"
        first_sent = b["reminder_sent_at"]

        # Idempotency: second run should not update reminder_sent_at
        time.sleep(1)
        r2 = requests.post(
            f"{API}/cron/send-reminders",
            headers={"Authorization": f"Bearer {CRON_SECRET}"},
        )
        assert r2.status_code == 200
        rg2 = requests.get(
            f"{API}/bookings", headers=owner_headers,
            params={"date_from": target, "date_to": target},
        )
        b2 = next(x for x in rg2.json() if x["id"] == bid)
        assert b2["reminder_sent_at"] == first_sent

        # cleanup
        requests.delete(f"{API}/bookings/{bid}", headers=owner_headers)


# ---------- Table position ----------
class TestTablePosition:
    def test_patch_position_persists(self, owner_headers):
        rt = requests.get(f"{API}/tables", headers=owner_headers)
        assert rt.status_code == 200
        tables = rt.json()
        assert tables, "no tables to test"
        tid = tables[0]["id"]

        r = requests.patch(
            f"{API}/tables/{tid}", headers=owner_headers,
            json={"position": {"x": 120, "y": 240}},
        )
        assert r.status_code == 200, r.text
        assert r.json()["position"]["x"] == 120
        assert r.json()["position"]["y"] == 240

        # GET list — verify persisted
        rg = requests.get(f"{API}/tables", headers=owner_headers)
        found = next(t for t in rg.json() if t["id"] == tid)
        assert found["position"]["x"] == 120
        assert found["position"]["y"] == 240
