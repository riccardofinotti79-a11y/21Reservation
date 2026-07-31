#!/usr/bin/env python3
"""Focused backend verification for startup seed/data repair bug.

This script intentionally resets the preview Mongo database to exercise a fresh
startup seed, then verifies the reported repair invariants through real backend
restarts. It cleans up QA rows it inserts before exiting.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient


APP_DIR = Path("/app")
BACKEND_ENV = APP_DIR / "backend" / ".env"
RAW_REPORT = APP_DIR / "test_reports" / "backend_data_repair_iter6_raw.json"
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")


def load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key] = value.strip().strip('"').strip("'")
    return env


def wait_for_demo_api(timeout_seconds: int = 60) -> None:
    url = f"{BACKEND_URL}/api/public/restaurant/demo"
    deadline = time.time() + timeout_seconds
    last_error: str | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last_error = repr(exc)
        time.sleep(1)
    raise RuntimeError(f"Backend demo API did not become ready at {url}; last_error={last_error}")


def restart_backend(reason: str) -> None:
    print(f"Restarting backend: {reason}")
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, timeout=45)
    wait_for_demo_api()


def oid() -> str:
    return str(uuid.uuid4())


def pos_tuple(doc: dict[str, Any]) -> tuple[float, float]:
    pos = doc.get("position") or {}
    return (pos.get("x"), pos.get("y"))


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    env = load_env_file(BACKEND_ENV)
    mongo_url = env["MONGO_URL"]
    db_name = env["DB_NAME"]
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")

    checks: list[dict[str, Any]] = []
    failures: list[str] = []
    evidence: dict[str, Any] = {}
    qa_table_ids: list[str] = []
    qa_customer_ids: list[str] = []

    def check(name: str, condition: bool, details: Any) -> None:
        record = {"name": name, "passed": bool(condition), "details": details}
        checks.append(record)
        status = "PASS" if condition else "FAIL"
        print(f"{status}: {name} :: {details}")
        if not condition:
            failures.append(name)

    try:
        print(f"Dropping database {db_name!r} for fresh seed verification")
        client.drop_database(db_name)
        db = client[db_name]
        restart_backend("fresh seed + startup repair")

        restaurant = db.restaurants.find_one({"subdomain": "demo"}, {"_id": 0})
        check("demo restaurant seeded", restaurant is not None, restaurant)
        if not restaurant:
            raise RuntimeError("Demo restaurant was not seeded; cannot continue")
        rid = restaurant["id"]

        areas = list(db.areas.find({"restaurant_id": rid}, {"_id": 0}))
        area_by_id = {area["id"]: area for area in areas}
        area_by_name = {area["name"]: area for area in areas}
        tables = list(db.tables.find({"restaurant_id": rid}, {"_id": 0}).sort("name", 1))
        check("fresh seed has exactly 11 tables", len(tables) == 11, {"count": len(tables), "names": [t["name"] for t in tables]})

        per_area: dict[str, list[dict[str, Any]]] = {}
        for table in tables:
            per_area.setdefault(table["area_id"], []).append(table)
        distinct_area_details: dict[str, Any] = {}
        all_area_positions_ok = True
        for area_id, area_tables in per_area.items():
            positions = [pos_tuple(t) for t in area_tables]
            non_zero = [p for p in positions if p != (0, 0)]
            distinct = len(set(positions)) == len(positions)
            area_name = area_by_id.get(area_id, {}).get("name", area_id)
            distinct_area_details[area_name] = {
                "count": len(area_tables),
                "positions": positions,
                "all_not_0_0": len(non_zero) == len(positions),
                "distinct": distinct,
            }
            all_area_positions_ok = all_area_positions_ok and len(non_zero) == len(positions) and distinct
        check("fresh seed positions are non-zero and distinct within each area", all_area_positions_ok, distinct_area_details)

        andrea = db.customers.find_one({"restaurant_id": rid, "name": "Andrea Verdi"}, {"_id": 0})
        andrea_booking_count = db.bookings.count_documents({"restaurant_id": rid, "customer_id": andrea["id"]}) if andrea else None
        check(
            "Andrea Verdi total_bookings coherent and >= 1",
            bool(andrea and andrea.get("total_bookings") == andrea_booking_count and andrea.get("total_bookings", 0) >= 1),
            {"customer": andrea, "actual_booking_count": andrea_booking_count},
        )

        metric_mismatches = []
        for customer in db.customers.find({"restaurant_id": rid}, {"_id": 0}):
            booking_docs = list(db.bookings.find({"restaurant_id": rid, "customer_id": customer["id"]}, {"_id": 0, "status": 1}))
            expected = {
                "total_bookings": len(booking_docs),
                "no_show_count": sum(1 for b in booking_docs if b.get("status") == "no_show"),
                "cancelled_count": sum(1 for b in booking_docs if b.get("status") == "cancelled"),
            }
            actual = {k: customer.get(k) for k in expected}
            if actual != expected:
                metric_mismatches.append({"customer": customer["name"], "actual": actual, "expected": expected})
        check("all customer metrics match bookings after fresh seed", not metric_mismatches, metric_mismatches)

        suffix = f"ITER6_{uuid.uuid4().hex[:8]}"
        delete_names = [f"TEST_{suffix}_DELETE_A", f"TEST_{suffix}_DELETE_B"]
        keep_names = [f"AUDIT_TEST_{suffix}_KEEP", f"Test {suffix} Keep", f"test_{suffix}_keep"]
        for name in delete_names + keep_names:
            cid = oid()
            qa_customer_ids.append(cid)
            db.customers.insert_one({
                "id": cid,
                "restaurant_id": rid,
                "name": name,
                "phone": None,
                "email": None,
                "tags": [],
                "notes": None,
                "bad_guest_flag": False,
                "total_bookings": 123,
                "no_show_count": 45,
                "cancelled_count": 6,
                "created_at": iso_now(),
            })

        restart_backend("TEST_ customer cleanup verification")
        deleted_remaining = list(db.customers.find({"restaurant_id": rid, "name": {"$in": delete_names}}, {"_id": 0, "name": 1}))
        kept_remaining = list(db.customers.find({"restaurant_id": rid, "name": {"$in": keep_names}}, {"_id": 0, "name": 1}))
        check(
            "startup repair deletes only names starting with uppercase TEST_",
            not deleted_remaining and sorted(k["name"] for k in kept_remaining) == sorted(keep_names),
            {"delete_names": delete_names, "deleted_remaining": deleted_remaining, "keep_names": keep_names, "kept_remaining": kept_remaining},
        )
        check(
            "no customer currently has name starting with TEST_",
            db.customers.count_documents({"name": {"$regex": "^TEST_"}}) == 0,
            {"count": db.customers.count_documents({"name": {"$regex": "^TEST_"}})},
        )

        sala = area_by_name.get("Sala Principale") or db.areas.find_one({"restaurant_id": rid, "name": "Sala Principale"}, {"_id": 0})
        check("Sala Principale exists", sala is not None, sala)
        if not sala:
            raise RuntimeError("Sala Principale not found; cannot run collision edge case")

        manual_id = oid()
        stuck_id = oid()
        qa_table_ids.extend([manual_id, stuck_id])
        manual_table = {
            "id": manual_id,
            "restaurant_id": rid,
            "area_id": sala["id"],
            "name": f"QA_{suffix}_MANUAL_SLOT_0_2",
            "seats_min": 2,
            "seats_max": 4,
            "priority": -101,
            "bookable_staff": True,
            "bookable_online": False,
            "internal_note": "iter6 collision manual slot 0,2",
            "shape": "square",
            "position": {"x": 40, "y": 240},
        }
        stuck_table = {
            "id": stuck_id,
            "restaurant_id": rid,
            "area_id": sala["id"],
            "name": f"QA_{suffix}_STUCK_0_0",
            "seats_min": 2,
            "seats_max": 4,
            "priority": -102,
            "bookable_staff": True,
            "bookable_online": False,
            "internal_note": "iter6 collision stuck table",
            "shape": "square",
            "position": {"x": 0, "y": 0},
        }
        db.tables.insert_many([manual_table, stuck_table])
        restart_backend("collision edge case repair")
        manual_after = db.tables.find_one({"id": manual_id}, {"_id": 0})
        stuck_after = db.tables.find_one({"id": stuck_id}, {"_id": 0})
        manual_pos = pos_tuple(manual_after) if manual_after else None
        stuck_pos = pos_tuple(stuck_after) if stuck_after else None
        check(
            "collision edge: stuck table moved away from (0,0) and manual slot 0,2",
            bool(stuck_after and manual_after and stuck_pos != (0, 0) and stuck_pos != manual_pos),
            {"manual_position": manual_pos, "stuck_position": stuck_pos, "manual": manual_after, "stuck": stuck_after},
        )

        sala_tables_after_collision = list(db.tables.find({"restaurant_id": rid, "area_id": sala["id"]}, {"_id": 0}))
        sala_positions = [pos_tuple(t) for t in sala_tables_after_collision]
        check(
            "Sala Principale has no position collisions after edge repair",
            len(sala_positions) == len(set(sala_positions)) and (0, 0) not in set(sala_positions),
            {"positions": sorted(sala_positions), "table_count": len(sala_tables_after_collision)},
        )

        baseline_tables = list(db.tables.find({"restaurant_id": rid}, {"_id": 0}))
        baseline_customers = list(db.customers.find({"restaurant_id": rid}, {"_id": 0}))
        baseline_table_ids = sorted(t["id"] for t in baseline_tables)
        baseline_customer_ids = sorted(c["id"] for c in baseline_customers)
        baseline_positions = {t["id"]: pos_tuple(t) for t in baseline_tables}

        restart_backend("idempotence restart 1")
        restart_backend("idempotence restart 2")

        final_tables = list(db.tables.find({"restaurant_id": rid}, {"_id": 0}))
        final_customers = list(db.customers.find({"restaurant_id": rid}, {"_id": 0}))
        final_table_ids = sorted(t["id"] for t in final_tables)
        final_customer_ids = sorted(c["id"] for c in final_customers)
        final_positions = {t["id"]: pos_tuple(t) for t in final_tables}
        shifted = {
            table_id: {"before": baseline_positions[table_id], "after": final_positions.get(table_id)}
            for table_id in baseline_positions
            if final_positions.get(table_id) != baseline_positions[table_id]
        }
        check(
            "two consecutive restarts do not duplicate tables or customers",
            baseline_table_ids == final_table_ids and baseline_customer_ids == final_customer_ids,
            {
                "baseline_table_count": len(baseline_table_ids),
                "final_table_count": len(final_table_ids),
                "baseline_customer_count": len(baseline_customer_ids),
                "final_customer_count": len(final_customer_ids),
                "table_id_delta": sorted(set(final_table_ids).symmetric_difference(baseline_table_ids)),
                "customer_id_delta": sorted(set(final_customer_ids).symmetric_difference(baseline_customer_ids)),
            },
        )
        check(
            "two consecutive restarts do not shift already placed table positions",
            not shifted,
            shifted,
        )

        final_core_tables = db.tables.count_documents({"restaurant_id": rid, "name": {"$not": {"$regex": "^QA_"}}})
        evidence.update({
            "restaurant_id": rid,
            "fresh_seed_table_count": len(tables),
            "final_table_count_before_cleanup": len(final_tables),
            "final_core_table_count_before_cleanup": final_core_tables,
            "andrea_total_bookings": andrea.get("total_bookings") if andrea else None,
            "collision_manual_position": manual_pos,
            "collision_stuck_position": stuck_pos,
            "kept_customer_names_verified": keep_names,
        })

    finally:
        try:
            db = client[db_name]
            cleanup_tables = db.tables.delete_many({"$or": [{"id": {"$in": qa_table_ids}}, {"name": {"$regex": "^QA_"}}]})
            cleanup_customers = db.customers.delete_many({"$or": [{"id": {"$in": qa_customer_ids}}, {"name": {"$regex": "ITER6_"}}]})
            evidence["cleanup"] = {"qa_tables_deleted": cleanup_tables.deleted_count, "qa_customers_deleted": cleanup_customers.deleted_count}
        except Exception as cleanup_exc:  # noqa: BLE001 - evidence only
            evidence["cleanup_error"] = repr(cleanup_exc)

    report = {
        "script": str(Path(__file__)),
        "backend_url": BACKEND_URL,
        "db_name": db_name,
        "checks": checks,
        "failures": failures,
        "evidence": evidence,
        "passed": not failures,
    }
    RAW_REPORT.parent.mkdir(parents=True, exist_ok=True)
    RAW_REPORT.write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report, indent=2, default=str))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())