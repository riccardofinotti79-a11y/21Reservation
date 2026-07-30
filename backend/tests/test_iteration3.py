"""
21Reservation Iteration 3 backend tests — services split (lunch/dinner) + WhatsApp config API.
"""
import os
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "owner@demo.com", "password": "demo1234"}
STAFF = {"email": "staff@demo.com", "password": "demo1234"}
SUB = "demo"


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


def _next_weekday(target_wd: int) -> date:
    d = date.today() + timedelta(days=1)
    while d.weekday() != target_wd:
        d += timedelta(days=1)
    return d


# ---------- Services endpoint ----------
class TestServices:
    def test_services_list(self):
        r = requests.get(f"{API}/public/{SUB}/services")
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d["services"]) == {"dinner", "lunch"}, d


# ---------- Day availability with service param ----------
class TestDayAvailability:
    def test_saturday_lunch(self):
        sat = _next_weekday(5).isoformat()
        r = requests.get(f"{API}/public/{SUB}/availability/day",
                         params={"date": sat, "persons": 2, "service": "lunch"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["open"] is True
        times = [s["time"] for s in d["slots"]]
        assert times, "expected lunch slots"
        # first lunch slot at 12:30
        assert times[0] == "12:30", times
        # all lunch slots should be in early-afternoon window
        for t in times:
            hh = int(t.split(":")[0])
            assert 12 <= hh <= 15, f"lunch slot out of window: {t}"

    def test_saturday_dinner(self):
        sat = _next_weekday(5).isoformat()
        r = requests.get(f"{API}/public/{SUB}/availability/day",
                         params={"date": sat, "persons": 2, "service": "dinner"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["open"] is True
        times = [s["time"] for s in d["slots"]]
        assert times
        assert times[0] == "19:00", times
        for t in times:
            hh = int(t.split(":")[0])
            assert hh >= 19, f"dinner slot out of window: {t}"

    def test_weekday_lunch_closed(self):
        # Tuesday should be dinner-only per spec
        tue = _next_weekday(1).isoformat()
        r = requests.get(f"{API}/public/{SUB}/availability/day",
                         params={"date": tue, "persons": 2, "service": "lunch"})
        assert r.status_code == 200
        d = r.json()
        assert d["open"] is False

    def test_no_service_param_defaults(self):
        sat = _next_weekday(5).isoformat()
        r = requests.get(f"{API}/public/{SUB}/availability/day",
                         params={"date": sat, "persons": 2})
        assert r.status_code == 200
        assert r.json()["open"] is True


# ---------- Month availability with service param ----------
class TestMonthAvailability:
    def _fetch(self, service):
        # Use next month to guarantee full window
        today = date.today()
        y, m = (today.year, today.month + 1) if today.month < 12 else (today.year + 1, 1)
        r = requests.get(f"{API}/public/{SUB}/availability/month",
                         params={"year": y, "month": m, "persons": 2, "service": service})
        assert r.status_code == 200, r.text
        return r.json()["days"], y, m

    def test_lunch_weekends_only(self):
        days, _, _ = self._fetch("lunch")
        for day in days:
            wd = date.fromisoformat(day["date"]).weekday()
            if wd in (5, 6):
                assert day["open"] is True, f"Sat/Sun should be open for lunch: {day}"
            else:
                assert day["open"] is False, f"Weekday should be closed for lunch: {day}"

    def test_dinner_tue_to_sun(self):
        days, _, _ = self._fetch("dinner")
        for day in days:
            wd = date.fromisoformat(day["date"]).weekday()
            if wd == 0:  # Monday
                assert day["open"] is False, f"Monday should be closed for dinner: {day}"
            else:
                assert day["open"] is True, f"Tue..Sun should be open for dinner: {day}"


# ---------- Public book with service ----------
class TestPublicBookService:
    def test_book_lunch_on_saturday(self, owner_headers):
        # Ensure deposit disabled
        requests.patch(f"{API}/restaurant", headers=owner_headers,
                       json={"deposit_enabled": False})
        sat = _next_weekday(5).isoformat()
        r = requests.post(f"{API}/public/{SUB}/book", json={
            "date": sat, "time": "13:00", "persons": 2, "service": "lunch",
            "customer_name": "TEST_Lunch", "customer_email": "TEST_lunch@example.com",
            "customer_phone": "+390000501", "accept_terms": True,
            "origin_url": "https://example.com",
        })
        assert r.status_code == 200, r.text
        bid = r.json()["booking"]["id"]
        requests.delete(f"{API}/bookings/{bid}", headers=owner_headers)

    def test_book_lunch_on_weekday_400(self):
        tue = _next_weekday(1).isoformat()
        r = requests.post(f"{API}/public/{SUB}/book", json={
            "date": tue, "time": "13:00", "persons": 2, "service": "lunch",
            "customer_name": "TEST_LunchFail", "customer_email": "TEST_lf@example.com",
            "customer_phone": "+390000502", "accept_terms": True,
            "origin_url": "https://example.com",
        })
        assert r.status_code == 400, r.text
        assert "chiuso" in r.json().get("detail", "").lower()


# ---------- Restaurant PATCH accepts WhatsApp creds ----------
class TestRestaurantWhatsAppFields:
    def test_patch_and_echo(self, owner_headers):
        payload = {
            "whatsapp_twilio_sid": "ACxxxxxTEST",
            "whatsapp_twilio_auth_token": "twilio-token-test",
            "whatsapp_meta_phone_id": "1234567890",
            "whatsapp_meta_access_token": "meta-token-test",
        }
        r = requests.patch(f"{API}/restaurant", headers=owner_headers, json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        for k, v in payload.items():
            assert d.get(k) == v, f"echoed {k} mismatch: {d.get(k)!r}"

        # GET verify persistence
        rg = requests.get(f"{API}/restaurant", headers=owner_headers)
        assert rg.status_code == 200
        g = rg.json()
        for k, v in payload.items():
            assert g.get(k) == v, f"persisted {k} mismatch"


# ---------- /whatsapp/status ----------
class TestWhatsAppStatus:
    def test_initial_not_configured(self, owner_headers):
        # Ensure disabled + no from
        requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "whatsapp_enabled": False,
            "whatsapp_provider": None,
            "whatsapp_from": None,
        })
        r = requests.get(f"{API}/whatsapp/status", headers=owner_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d.keys()) >= {"enabled", "provider", "configured"}
        assert d["configured"] is False

    def test_configured_after_twilio_setup(self, owner_headers):
        r = requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "whatsapp_enabled": True,
            "whatsapp_provider": "twilio",
            "whatsapp_from": "whatsapp:+14155238886",
            "whatsapp_twilio_sid": "ACtestsid",
            "whatsapp_twilio_auth_token": "testtoken",
        })
        assert r.status_code == 200
        rs = requests.get(f"{API}/whatsapp/status", headers=owner_headers)
        assert rs.status_code == 200
        d = rs.json()
        assert d["enabled"] is True
        assert d["provider"] == "twilio"
        assert d["configured"] is True
        # reset to disabled to avoid affecting other tests
        requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "whatsapp_enabled": False,
        })


# ---------- /whatsapp/test ----------
class TestWhatsAppTest:
    def test_disabled_returns_400(self, owner_headers):
        requests.patch(f"{API}/restaurant", headers=owner_headers, json={
            "whatsapp_enabled": False,
        })
        r = requests.post(f"{API}/whatsapp/test", headers=owner_headers,
                          json={"to": "+391234567890"})
        assert r.status_code == 400, r.text
        assert "non configurato" in r.json().get("detail", "").lower()

    def test_staff_forbidden(self, staff_headers):
        r = requests.post(f"{API}/whatsapp/test", headers=staff_headers,
                          json={"to": "+391234567890"})
        assert r.status_code == 403


# ---------- OpeningHour service_type populated ----------
class TestOpeningHoursServiceType:
    def test_service_types_present(self, owner_headers):
        r = requests.get(f"{API}/opening-hours", headers=owner_headers)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert rows, "expected opening hours"
        services = {row.get("service_type") for row in rows}
        assert services & {"lunch", "dinner"}, f"expected lunch/dinner, got {services}"
        # each row should have a service_type populated
        missing = [r for r in rows if not r.get("service_type")]
        assert not missing, f"rows missing service_type: {missing}"
