"""Moontir backend regression + new-feature tests.

Covers:
- Health / services (public)
- Auth register + login
- /api/quote pricing (Sedan baseline, SUV surcharge)
- /api/me PATCH profile updates (no _id leak)
- Vehicles CRUD incl. new body types (MPV, SUV, Pickup, Truck)
- Orders: SUV vehicle -> total > base, items include surcharge line
- Geocode / reverse-geocode still functional (skip on 429/503)
"""

import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL missing from env"

TIMEOUT = 20


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth(api):
    """Register a fresh TEST_ user for authenticated tests."""
    email = f"TEST_{uuid.uuid4().hex}@example.com"
    r = api.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST Customer", "email": email, "password": "secret123"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["token"], "user": data["user"], "email": email, "headers": {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"}}


# ------------------------- Public / health -------------------------

def test_health(api):
    r = api.get(f"{BASE_URL}/api/health", timeout=TIMEOUT)
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_services_public(api):
    r = api.get(f"{BASE_URL}/api/services", timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list) and len(body) >= 4
    ids = {s["id"] for s in body}
    assert {"shine", "care", "interior", "full"}.issubset(ids)


# ------------------------- Quote (new) -------------------------

def test_quote_shine_sedan_no_surcharge(api):
    r = api.post(f"{BASE_URL}/api/quote", json={"service_id": "shine", "vehicle_type": "Sedan"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 275000
    assert body["multiplier"] == 1.0
    assert body["surcharge"] == 0
    assert body["base"] == 275000
    labels = [i["label"] for i in body["items"]]
    assert any("Moon Shine" in lbl for lbl in labels)
    assert not any("surcharge" in lbl.lower() for lbl in labels)


def test_quote_shine_suv_surcharge(api):
    r = api.post(f"{BASE_URL}/api/quote", json={"service_id": "shine", "vehicle_type": "SUV"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["multiplier"] == 1.25
    assert body["total"] == 344000, body
    assert body["surcharge"] == 69000
    surcharge_items = [i for i in body["items"] if "SUV handling surcharge" in i["label"]]
    assert len(surcharge_items) == 1
    assert surcharge_items[0]["amount"] == 69000


def test_quote_invalid_service(api):
    r = api.post(f"{BASE_URL}/api/quote", json={"service_id": "does-not-exist", "vehicle_type": "Sedan"}, timeout=TIMEOUT)
    assert r.status_code == 404


# ------------------------- Me PATCH (new) -------------------------

def test_patch_me_updates_name(api, auth):
    new_name = f"TEST_Renamed_{uuid.uuid4().hex[:6]}"
    r = api.patch(f"{BASE_URL}/api/me", headers=auth["headers"], json={"name": new_name}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == new_name
    assert body["email"] == auth["email"].lower()
    assert "_id" not in body
    # verify persistence
    me = api.get(f"{BASE_URL}/api/me", headers=auth["headers"], timeout=TIMEOUT)
    assert me.status_code == 200
    assert me.json()["name"] == new_name
    assert "_id" not in me.json()


def test_patch_me_requires_auth(api):
    r = api.patch(f"{BASE_URL}/api/me", json={"name": "Anyone"}, timeout=TIMEOUT)
    assert r.status_code == 401


# ------------------------- Vehicles (existing + new body types) -------------------------

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
    assert {v["type"] for v in body} >= {"Sedan", "MPV", "SUV", "Pickup", "Truck"}


# ------------------------- Orders with multiplier -------------------------

def test_order_with_suv_applies_surcharge(api, auth):
    # find or create an SUV vehicle
    veh_list = api.get(f"{BASE_URL}/api/vehicles", headers=auth["headers"], timeout=TIMEOUT).json()
    suv = next((v for v in veh_list if v["type"] == "SUV"), None)
    assert suv, "SUV vehicle expected from parametrised create"

    body = {
        "service_id": "shine",
        "vehicle_id": suv["id"],
        "address": {"label": "TEST Jl. Sudirman 21, Semarang"},
        "schedule_date": "2026-12-01",
        "schedule_time": "09:00 – 11:00",
        "notes": "",
    }
    r = api.post(f"{BASE_URL}/api/orders", headers=auth["headers"], json=body, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["service_id"] == "shine"
    assert order["vehicle"]["id"] == suv["id"]
    # SUV multiplier -> total > base
    assert order["total"] == 344000, order["total"]
    labels = [i["label"] for i in order["items"]]
    assert any("SUV handling surcharge" in lbl for lbl in labels)
    assert order["payment_status"] == "unpaid"
    assert order["status"] == "dispatch"
    assert isinstance(order["status_history"], list) and len(order["status_history"]) >= 1

    # verify persistence via GET
    listed = api.get(f"{BASE_URL}/api/orders", headers=auth["headers"], timeout=TIMEOUT).json()
    match = next((o for o in listed if o["id"] == order["id"]), None)
    assert match and match["total"] == 344000


def test_order_sedan_no_surcharge(api, auth):
    veh_list = api.get(f"{BASE_URL}/api/vehicles", headers=auth["headers"], timeout=TIMEOUT).json()
    sedan = next((v for v in veh_list if v["type"] == "Sedan"), None)
    assert sedan
    body = {
        "service_id": "shine",
        "vehicle_id": sedan["id"],
        "address": {"label": "TEST Jl. Melati 8, Jakarta"},
        "schedule_date": "2026-12-02",
        "schedule_time": "10:00 – 12:00",
        "notes": "",
    }
    r = api.post(f"{BASE_URL}/api/orders", headers=auth["headers"], json=body, timeout=TIMEOUT)
    assert r.status_code == 200
    order = r.json()
    assert order["total"] == 275000
    labels = [i["label"].lower() for i in order["items"]]
    assert not any("surcharge" in lbl for lbl in labels)


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
    assert isinstance(rows, list)
    if rows:
        first = rows[0]
        assert {"displayName", "latitude", "longitude"}.issubset(first)
        rev = api.get(f"{BASE_URL}/api/reverse-geocode", params={"lat": first["latitude"], "lon": first["longitude"]}, timeout=TIMEOUT)
        if rev.status_code in (429, 503):
            pytest.skip("Nominatim rate-limited on reverse")
        assert rev.status_code == 200, rev.text
        assert rev.json().get("displayName")


# ------------------------- Auth error handling -------------------------

def test_login_wrong_password_401(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": "nobody@example.com", "password": "bad"}, timeout=TIMEOUT)
    assert r.status_code == 401
