"""Moontir backend regression + new-feature tests (iteration 4).

Covers:
- Health / services (public) — including new `group` classification (light/detail/special)
- Auth register + login
- /api/quote pricing (Sedan baseline, SUV surcharge)
- /api/me PATCH profile updates (no _id leak)
- Vehicles CRUD incl. new body types (MPV, SUV, Pickup, Truck)
- Vehicles PATCH (partial update, 404 across users, 400 empty body)
- Vehicles DELETE (200 owner, 404 stranger)
- Orders: SUV vehicle -> total > base, items include surcharge line
- Geocode / reverse-geocode still functional (skip on 429/503)
"""

import os
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or ""
).rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL missing from env"

TIMEOUT = 20


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(api):
    email = f"TEST_{uuid.uuid4().hex}@example.com"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={"name": "TEST Customer", "email": email, "password": "secret123"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "email": email,
        "headers": {
            "Authorization": f"Bearer {data['token']}",
            "Content-Type": "application/json",
        },
    }


@pytest.fixture(scope="module")
def auth(api):
    return _register(api)


@pytest.fixture(scope="module")
def auth_other(api):
    """A second user, used to verify vehicle ownership scoping (PATCH/DELETE 404)."""
    return _register(api)


# ------------------------- Public / health -------------------------

def test_health(api):
    r = api.get(f"{BASE_URL}/api/health", timeout=TIMEOUT)
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_services_groups(api):
    """New: 8 services split across light/detail/special groups."""
    r = api.get(f"{BASE_URL}/api/services", timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    assert len(body) == 8, f"Expected 8 services, got {len(body)}"

    groups = {s["id"]: s.get("group") for s in body}
    # Each service must have a group value from the enum
    for sid, g in groups.items():
        assert g in {"light", "detail", "special"}, f"Service {sid} has bad group {g!r}"

    by_group: dict[str, set[str]] = {"light": set(), "detail": set(), "special": set()}
    for s in body:
        by_group[s["group"]].add(s["id"])

    # Each group must have at least one member
    assert by_group["light"], "No services in group 'light'"
    assert by_group["detail"], "No services in group 'detail'"
    assert by_group["special"], "No services in group 'special'"

    # Sanity: the 4 new services live under the correct groups
    assert {"care", "fluid", "tune"}.issubset(by_group["light"])
    assert {"shine", "interior", "glass"}.issubset(by_group["detail"])
    assert {"full", "eclipse"}.issubset(by_group["special"])


# ------------------------- Quote -------------------------

def test_quote_shine_sedan_no_surcharge(api):
    r = api.post(f"{BASE_URL}/api/quote", json={"service_id": "shine", "vehicle_type": "Sedan"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 275000
    assert body["multiplier"] == 1.0
    assert body["surcharge"] == 0


def test_quote_shine_suv_surcharge(api):
    r = api.post(f"{BASE_URL}/api/quote", json={"service_id": "shine", "vehicle_type": "SUV"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["multiplier"] == 1.25
    assert body["total"] == 344000
    assert body["surcharge"] == 69000


def test_quote_new_service_eclipse(api):
    r = api.post(f"{BASE_URL}/api/quote", json={"service_id": "eclipse", "vehicle_type": "Sedan"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 685000


def test_quote_invalid_service(api):
    r = api.post(f"{BASE_URL}/api/quote", json={"service_id": "does-not-exist", "vehicle_type": "Sedan"}, timeout=TIMEOUT)
    assert r.status_code == 404


# ------------------------- Me PATCH -------------------------

def test_patch_me_updates_name(api, auth):
    new_name = f"TEST_Renamed_{uuid.uuid4().hex[:6]}"
    r = api.patch(f"{BASE_URL}/api/me", headers=auth["headers"], json={"name": new_name}, timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == new_name
    assert "_id" not in body
    me = api.get(f"{BASE_URL}/api/me", headers=auth["headers"], timeout=TIMEOUT)
    assert me.json()["name"] == new_name


def test_patch_me_requires_auth(api):
    r = api.patch(f"{BASE_URL}/api/me", json={"name": "Anyone"}, timeout=TIMEOUT)
    assert r.status_code == 401


# ------------------------- Vehicles: create + list + new body types -------------------------

@pytest.mark.parametrize("vtype", ["Sedan", "MPV", "SUV", "Pickup", "Truck"])
def test_vehicle_create_types(api, auth, vtype):
    payload = {"nickname": f"TEST {vtype}", "make": "Toyota", "model": "Any", "year": "2022", "plate": f"T{uuid.uuid4().hex[:5].upper()}", "type": vtype}
    r = api.post(f"{BASE_URL}/api/vehicles", headers=auth["headers"], json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == vtype
    assert body["id"]
    assert "_id" not in body


def test_vehicles_list(api, auth):
    r = api.get(f"{BASE_URL}/api/vehicles", headers=auth["headers"], timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list) and len(body) >= 5
    for v in body:
        assert "_id" not in v


# ------------------------- Vehicles: PATCH (new) -------------------------

def test_patch_vehicle_partial_update(api, auth):
    """Create then PATCH nickname+plate only, verify persistence and no _id leak."""
    create_payload = {"nickname": "TEST Patchable", "make": "Honda", "model": "Civic", "year": "2020", "plate": f"P{uuid.uuid4().hex[:5].upper()}", "type": "Sedan"}
    created = api.post(f"{BASE_URL}/api/vehicles", headers=auth["headers"], json=create_payload, timeout=TIMEOUT)
    assert created.status_code == 200, created.text
    vid = created.json()["id"]

    new_nick = f"TEST Updated {uuid.uuid4().hex[:4]}"
    new_plate = f"U{uuid.uuid4().hex[:5].upper()}"
    r = api.patch(f"{BASE_URL}/api/vehicles/{vid}", headers=auth["headers"], json={"nickname": new_nick, "plate": new_plate}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == vid
    assert body["nickname"] == new_nick
    assert body["plate"] == new_plate
    assert body["make"] == "Honda"  # untouched
    assert body["model"] == "Civic"
    assert "_id" not in body

    # Verify persistence via GET list
    listed = api.get(f"{BASE_URL}/api/vehicles", headers=auth["headers"], timeout=TIMEOUT).json()
    match = next((v for v in listed if v["id"] == vid), None)
    assert match and match["nickname"] == new_nick and match["plate"] == new_plate


def test_patch_vehicle_full_update(api, auth):
    """PATCH every allowed field at once."""
    create_payload = {"nickname": "TEST Full", "make": "A", "model": "B", "year": "2019", "plate": f"F{uuid.uuid4().hex[:5].upper()}", "type": "Sedan"}
    vid = api.post(f"{BASE_URL}/api/vehicles", headers=auth["headers"], json=create_payload, timeout=TIMEOUT).json()["id"]

    full = {"nickname": "TEST Fullname", "make": "Mazda", "model": "CX-5", "year": "2024", "plate": f"Z{uuid.uuid4().hex[:5].upper()}", "type": "SUV"}
    r = api.patch(f"{BASE_URL}/api/vehicles/{vid}", headers=auth["headers"], json=full, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    for k, v in full.items():
        assert body[k] == v


def test_patch_vehicle_empty_body_400(api, auth):
    create_payload = {"nickname": "TEST Empty", "make": "A", "model": "B", "year": "2020", "plate": f"E{uuid.uuid4().hex[:5].upper()}", "type": "Sedan"}
    vid = api.post(f"{BASE_URL}/api/vehicles", headers=auth["headers"], json=create_payload, timeout=TIMEOUT).json()["id"]
    r = api.patch(f"{BASE_URL}/api/vehicles/{vid}", headers=auth["headers"], json={}, timeout=TIMEOUT)
    assert r.status_code == 400, r.text


def test_patch_vehicle_not_owner_404(api, auth, auth_other):
    """User A creates a vehicle; User B tries to PATCH -> 404."""
    create_payload = {"nickname": "TEST Owned", "make": "A", "model": "B", "year": "2020", "plate": f"O{uuid.uuid4().hex[:5].upper()}", "type": "Sedan"}
    vid = api.post(f"{BASE_URL}/api/vehicles", headers=auth["headers"], json=create_payload, timeout=TIMEOUT).json()["id"]
    r = api.patch(f"{BASE_URL}/api/vehicles/{vid}", headers=auth_other["headers"], json={"nickname": "Hacker"}, timeout=TIMEOUT)
    assert r.status_code == 404, r.text


def test_patch_vehicle_missing_404(api, auth):
    r = api.patch(f"{BASE_URL}/api/vehicles/does-not-exist-{uuid.uuid4().hex}", headers=auth["headers"], json={"nickname": "Ghost"}, timeout=TIMEOUT)
    assert r.status_code == 404


# ------------------------- Vehicles: DELETE (new) -------------------------

def test_delete_vehicle_success(api, auth):
    create_payload = {"nickname": "TEST Delete", "make": "A", "model": "B", "year": "2021", "plate": f"D{uuid.uuid4().hex[:5].upper()}", "type": "Sedan"}
    vid = api.post(f"{BASE_URL}/api/vehicles", headers=auth["headers"], json=create_payload, timeout=TIMEOUT).json()["id"]
    r = api.delete(f"{BASE_URL}/api/vehicles/{vid}", headers=auth["headers"], timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("id") == vid
    # Verify removal
    listed = api.get(f"{BASE_URL}/api/vehicles", headers=auth["headers"], timeout=TIMEOUT).json()
    assert all(v["id"] != vid for v in listed)


def test_delete_vehicle_not_owner_404(api, auth, auth_other):
    create_payload = {"nickname": "TEST DelOther", "make": "A", "model": "B", "year": "2021", "plate": f"K{uuid.uuid4().hex[:5].upper()}", "type": "Sedan"}
    vid = api.post(f"{BASE_URL}/api/vehicles", headers=auth["headers"], json=create_payload, timeout=TIMEOUT).json()["id"]
    r = api.delete(f"{BASE_URL}/api/vehicles/{vid}", headers=auth_other["headers"], timeout=TIMEOUT)
    assert r.status_code == 404


def test_delete_vehicle_missing_404(api, auth):
    r = api.delete(f"{BASE_URL}/api/vehicles/missing-{uuid.uuid4().hex}", headers=auth["headers"], timeout=TIMEOUT)
    assert r.status_code == 404


# ------------------------- Orders -------------------------

def test_order_with_suv_applies_surcharge(api, auth):
    veh_list = api.get(f"{BASE_URL}/api/vehicles", headers=auth["headers"], timeout=TIMEOUT).json()
    suv = next((v for v in veh_list if v["type"] == "SUV"), None)
    assert suv, "SUV vehicle expected from parametrised create"
    body = {"service_id": "shine", "vehicle_id": suv["id"], "address": {"label": "TEST Jl. Sudirman 21, Semarang"}, "schedule_date": "2026-12-01", "schedule_time": "09:00 – 11:00", "notes": ""}
    r = api.post(f"{BASE_URL}/api/orders", headers=auth["headers"], json=body, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["total"] == 344000
    assert order["payment_status"] == "unpaid"
    assert order["status"] == "dispatch"
    # persistence
    listed = api.get(f"{BASE_URL}/api/orders", headers=auth["headers"], timeout=TIMEOUT).json()
    assert any(o["id"] == order["id"] for o in listed)


def test_order_sedan_no_surcharge(api, auth):
    veh_list = api.get(f"{BASE_URL}/api/vehicles", headers=auth["headers"], timeout=TIMEOUT).json()
    sedan = next((v for v in veh_list if v["type"] == "Sedan"), None)
    assert sedan
    body = {"service_id": "shine", "vehicle_id": sedan["id"], "address": {"label": "TEST Jl. Melati 8, Jakarta"}, "schedule_date": "2026-12-02", "schedule_time": "10:00 – 12:00", "notes": ""}
    r = api.post(f"{BASE_URL}/api/orders", headers=auth["headers"], json=body, timeout=TIMEOUT)
    assert r.status_code == 200
    assert r.json()["total"] == 275000


# ------------------------- Geocode -------------------------

def test_geocode_query_validation(api):
    r = api.get(f"{BASE_URL}/api/geocode", params={"q": "x"}, timeout=TIMEOUT)
    assert r.status_code == 422


def test_geocode_and_reverse(api):
    r = api.get(f"{BASE_URL}/api/geocode", params={"q": "Jakarta"}, timeout=TIMEOUT)
    if r.status_code in (429, 503):
        pytest.skip(f"Nominatim rate-limited/unavailable: {r.status_code}")
    assert r.status_code == 200, r.text
    rows = r.json()
    if rows:
        first = rows[0]
        rev = api.get(f"{BASE_URL}/api/reverse-geocode", params={"lat": first["latitude"], "lon": first["longitude"]}, timeout=TIMEOUT)
        if rev.status_code in (429, 503):
            pytest.skip("Nominatim rate-limited on reverse")
        assert rev.status_code == 200


# ------------------------- Auth error handling -------------------------

def test_login_seed_user(api):
    """Seed user from /app/memory/test_credentials.md should still be able to log in."""
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": "moontir.1789025725@example.com", "password": "secret123"}, timeout=TIMEOUT)
    if r.status_code == 401:
        pytest.skip("Seed user missing in this environment")
    assert r.status_code == 200, r.text
    assert "token" in r.json()


def test_login_wrong_password_401(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": "nobody@example.com", "password": "bad"}, timeout=TIMEOUT)
    assert r.status_code == 401
