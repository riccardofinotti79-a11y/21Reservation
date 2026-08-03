"""Iteration 10 — Agency Portal (agency_admin) backend tests."""
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

AGENCY = ("admin@21agency.com", "agency123")
OWNER = ("owner@demo.com", "demo1234")
STAFF = ("staff@demo.com", "demo1234")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    return r


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def agency_token():
    r = _login(*AGENCY)
    assert r.status_code == 200, f"agency login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def owner_token():
    r = _login(*OWNER)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def staff_token():
    r = _login(*STAFF)
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_id(agency_token):
    r = requests.get(f"{API}/admin/restaurants", headers=_h(agency_token), timeout=15)
    assert r.status_code == 200
    lst = r.json()
    demo = next((x for x in lst if x["subdomain"] == "demo"), None)
    assert demo is not None, "demo restaurant not found"
    return demo["id"]


# --- Seed / login shape ---

def test_agency_login_shape():
    r = _login(*AGENCY)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("access_token")
    assert d["user"]["role"] == "agency_admin"
    assert d["user"].get("restaurant_id") in (None, "")
    assert d.get("restaurant") is None


def test_owner_login_shape():
    r = _login(*OWNER)
    assert r.status_code == 200
    d = r.json()
    assert d["user"]["role"] == "owner"
    assert d.get("restaurant") is not None
    assert d["restaurant"]["subdomain"] == "demo"


def test_staff_login_shape():
    r = _login(*STAFF)
    assert r.status_code == 200
    d = r.json()
    assert d["user"]["role"] in ("staff", "owner")
    assert d.get("restaurant") is not None


# --- Authorization ---

@pytest.mark.parametrize("method,path", [
    ("GET", "/admin/restaurants"),
    ("POST", "/admin/restaurants"),
    ("GET", "/admin/restaurants/xxx"),
    ("PATCH", "/admin/restaurants/xxx"),
    ("POST", "/admin/restaurants/xxx/users"),
    ("DELETE", "/admin/users/xxx"),
])
def test_admin_requires_auth(method, path):
    r = requests.request(method, f"{API}{path}", json={}, timeout=10)
    assert r.status_code in (401, 403), f"{method} {path} expected 401/403 got {r.status_code}"


def test_admin_owner_forbidden(owner_token):
    r = requests.get(f"{API}/admin/restaurants", headers=_h(owner_token), timeout=10)
    assert r.status_code == 403


def test_admin_staff_forbidden(staff_token):
    r = requests.get(f"{API}/admin/restaurants", headers=_h(staff_token), timeout=10)
    assert r.status_code == 403


def test_admin_agency_ok(agency_token):
    r = requests.get(f"{API}/admin/restaurants", headers=_h(agency_token), timeout=10)
    assert r.status_code == 200
    lst = r.json()
    assert isinstance(lst, list) and len(lst) >= 1
    for f in ("id", "name", "subdomain", "status", "user_count"):
        assert f in lst[0], f"missing field {f} in {lst[0]}"


# --- Suspend/resume demo ---

def test_suspend_blocks_owner_login(agency_token, demo_id):
    # suspend
    r = requests.patch(f"{API}/admin/restaurants/{demo_id}",
                       json={"status": "suspended"}, headers=_h(agency_token), timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "suspended"

    # owner login blocked
    r2 = _login(*OWNER)
    try:
        assert r2.status_code == 403, f"expected 403 got {r2.status_code} {r2.text}"
        assert "sospeso" in r2.text.lower() or "sospes" in r2.text.lower()
    finally:
        # restore
        rr = requests.patch(f"{API}/admin/restaurants/{demo_id}",
                            json={"status": "active"}, headers=_h(agency_token), timeout=10)
        assert rr.status_code == 200
    # owner can login again
    r3 = _login(*OWNER)
    assert r3.status_code == 200


# --- Provisioning ---

VILLA_EMAIL = "rosa+ph1@example.com"
VILLA_SUBDOMAIN = "villa-rosa"


@pytest.fixture(scope="module")
def villa(agency_token):
    payload = {
        "restaurant_name": "Villa Rosa",
        "subdomain": VILLA_SUBDOMAIN,
        "owner_name": "Rosa Bianchi",
        "owner_email": VILLA_EMAIL,
        "owner_password": "test123",
        "language": "it",
    }
    r = requests.post(f"{API}/admin/restaurants", json=payload,
                      headers=_h(agency_token), timeout=15)
    if r.status_code not in (200, 201):
        # If subdomain/email already exists from a previous run, get it
        if r.status_code == 400:
            lst = requests.get(f"{API}/admin/restaurants", headers=_h(agency_token)).json()
            existing = next((x for x in lst if x["subdomain"] == VILLA_SUBDOMAIN), None)
            if existing:
                return {"restaurant": existing, "created": False}
        pytest.skip(f"cannot create villa: {r.status_code} {r.text}")
    return {"payload": payload, "response": r.json(), "created": True}


def test_provisioning_creates_restaurant(villa, agency_token):
    lst = requests.get(f"{API}/admin/restaurants", headers=_h(agency_token)).json()
    assert any(x["subdomain"] == VILLA_SUBDOMAIN for x in lst)


def test_provisioning_duplicate_subdomain(agency_token, villa):
    r = requests.post(f"{API}/admin/restaurants", json={
        "restaurant_name": "Other",
        "subdomain": VILLA_SUBDOMAIN,
        "owner_name": "X",
        "owner_email": "other-unique@example.com",
        "owner_password": "test123",
        "language": "it",
    }, headers=_h(agency_token), timeout=10)
    assert r.status_code == 400


def test_provisioning_duplicate_email(agency_token, villa):
    r = requests.post(f"{API}/admin/restaurants", json={
        "restaurant_name": "Other2",
        "subdomain": "other-sub-xyz",
        "owner_name": "X",
        "owner_email": VILLA_EMAIL,
        "owner_password": "test123",
        "language": "it",
    }, headers=_h(agency_token), timeout=10)
    assert r.status_code == 400


def test_new_owner_can_login_and_isolation(villa):
    r = _login(VILLA_EMAIL, "test123")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["restaurant"]["subdomain"] == VILLA_SUBDOMAIN
    tok = d["access_token"]
    # GET /restaurant -> own
    rr = requests.get(f"{API}/restaurant", headers=_h(tok), timeout=10)
    assert rr.status_code == 200
    assert rr.json()["subdomain"] == VILLA_SUBDOMAIN
    # bookings empty
    b = requests.get(f"{API}/bookings", headers=_h(tok), timeout=10)
    assert b.status_code == 200
    assert b.json() == [] or b.json() == {"items": []} or (isinstance(b.json(), list) and len(b.json()) == 0)
    # customers empty
    c = requests.get(f"{API}/customers", headers=_h(tok), timeout=10)
    assert c.status_code == 200
    data = c.json()
    if isinstance(data, list):
        assert len(data) == 0
    else:
        assert data.get("items", []) == [] or data.get("total", 0) == 0


# --- Detail + user management ---

def test_detail_returns_users(agency_token, demo_id):
    r = requests.get(f"{API}/admin/restaurants/{demo_id}", headers=_h(agency_token), timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert "restaurant" in d and "users" in d
    assert len(d["users"]) >= 2


def test_add_and_delete_user(agency_token, demo_id):
    email = f"extrastaff+{int(time.time())}@example.com"
    r = requests.post(f"{API}/admin/restaurants/{demo_id}/users", json={
        "email": email, "name": "Extra Staff", "password": "test123", "role": "staff"
    }, headers=_h(agency_token), timeout=10)
    assert r.status_code in (200, 201), r.text
    uid = r.json()["id"]
    # delete
    rd = requests.delete(f"{API}/admin/users/{uid}", headers=_h(agency_token), timeout=10)
    assert rd.status_code in (200, 204)


def test_delete_agency_admin_forbidden(agency_token):
    # find the agency admin id
    who = requests.post(f"{API}/auth/login", json={"email": AGENCY[0], "password": AGENCY[1]}).json()
    uid = who["user"]["id"]
    r = requests.delete(f"{API}/admin/users/{uid}", headers=_h(agency_token), timeout=10)
    assert r.status_code == 400


# --- Seed idempotency (login still works after multiple calls) ---

def test_seed_idempotent_login_still_works():
    for _ in range(2):
        assert _login(*AGENCY).status_code == 200
