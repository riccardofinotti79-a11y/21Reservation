#!/usr/bin/env python3
"""Focused backend verification for iteration 5 data-repair bug.

This script intentionally uses API calls for user-visible checks and direct MongoDB
only for test setup/reset and raw count verification.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values
from pymongo import MongoClient


APP_DIR = Path("/app")
BACKEND_ENV = dotenv_values(APP_DIR / "backend" / ".env")
BASE_URL = os.environ.get("BACKEND_API_URL", "http://localhost:8001/api").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL") or BACKEND_ENV.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME") or BACKEND_ENV.get("DB_NAME", "test_database")
RAW_REPORT = APP_DIR / "test_reports" / "backend_data_repair_iter5_raw.json"


class QA:
    def __init__(self) -> None:
        self.failures: list[dict] = []
        self.checks: list[dict] = []
        self.evidence: dict = {}
        self.client = MongoClient(MONGO_URL)
        self.db = self.client[DB_NAME]

    def log_check(self, label: str, passed: bool, details=None) -> None:
        item = {"label": label, "passed": bool(passed), "details": details}
        self.checks.append(item)
        marker = "PASS" if passed else "FAIL"
        print(f"[{marker}] {label}: {details}")
        if not passed:
            self.failures.append(item)

    def request(self, method: str, path: str, token: str | None = None, **kwargs):
        headers = kwargs.pop("headers", {})
        if token:
            headers["Authorization"] = f"Bearer {token}"
        res = requests.request(method, f"{BASE_URL}{path}", headers=headers, timeout=20, **kwargs)
        if res.status_code >= 400:
            raise AssertionError(f"{method} {path} -> {res.status_code}: {res.text[:500]}")
        if not res.text:
            return None
        return res.json()

    def login(self) -> tuple[str, dict]:
        data = self.request("POST", "/auth/login", json={"email": "owner@demo.com", "password": "demo1234"})
        token = data["access_token"]
        rid = data["restaurant"]["id"]
        return token, data["restaurant"]

    def wait_backend(self, timeout_s: int = 45) -> None:
        deadline = time.time() + timeout_s
        last = None
        while time.time() < deadline:
            try:
                res = requests.get(f"{BASE_URL}/config/public", timeout=5)
                last = f"{res.status_code} {res.text[:80]}"
                if res.status_code == 200:
                    return
            except Exception as exc:  # noqa: BLE001 - diagnostic only
                last = repr(exc)
            time.sleep(1)
        raise RuntimeError(f"Backend did not become ready at {BASE_URL}; last={last}")

    def restart_backend(self, reason: str) -> None:
        print(f"\n--- Restarting backend: {reason} ---")
        proc = subprocess.run(
            ["sudo", "supervisorctl", "restart", "backend"],
            cwd=str(APP_DIR),
            text=True,
            capture_output=True,
            timeout=90,
        )
        print(proc.stdout.strip())
        if proc.returncode != 0:
            print(proc.stderr.strip())
            raise RuntimeError(f"supervisorctl restart backend failed with {proc.returncode}")
        self.wait_backend()

    def drop_demo_restaurant(self) -> dict:
        """Delete the demo tenant data so startup auto-seed recreates it fresh."""
        r = self.db.restaurants.find_one({"subdomain": "demo"})
        removed = {"restaurant_found": bool(r), "collections": {}}
        old_oh_ids: list[str] = []
        rid = None
        if r:
            rid = r.get("id")
            old_oh_ids = [x.get("id") for x in self.db.opening_hours.find({"restaurant_id": rid}, {"id": 1})]
            for coll_name in self.db.list_collection_names():
                result = self.db[coll_name].delete_many({"restaurant_id": rid})
                if result.deleted_count:
                    removed["collections"][coll_name] = result.deleted_count
            rr = self.db.restaurants.delete_many({"id": rid})
            if rr.deleted_count:
                removed["collections"]["restaurants_by_id_extra"] = rr.deleted_count
        # Defensive cleanup for demo singleton credentials and dependent limits without restaurant_id.
        user_result = self.db.users.delete_many({"email": {"$in": ["owner@demo.com", "staff@demo.com"]}})
        if user_result.deleted_count:
            removed["collections"]["users_by_email_extra"] = user_result.deleted_count
        if old_oh_ids:
            lim_result = self.db.booking_limits.delete_many({"opening_hour_id": {"$in": old_oh_ids}})
            if lim_result.deleted_count:
                removed["collections"]["booking_limits_by_opening_hour"] = lim_result.deleted_count
        return removed

    @staticmethod
    def pos_tuple(table: dict) -> tuple[float, float]:
        p = table.get("position") or {}
        return (float(p.get("x", 0)), float(p.get("y", 0)))

    def verify_tables_positions(self, token: str, label: str, expect_exact_seed_grid: bool = False) -> list[dict]:
        tables = self.request("GET", "/tables", token=token)
        areas = self.request("GET", "/areas", token=token)
        area_names = {a["id"]: a["name"] for a in areas}
        stuck = [t["name"] for t in tables if self.pos_tuple(t) == (0.0, 0.0)]
        duplicates = []
        by_area_pos: dict[tuple[str, tuple[float, float]], list[str]] = defaultdict(list)
        for t in tables:
            by_area_pos[(t["area_id"], self.pos_tuple(t))].append(t["name"])
        for (area_id, pos), names in by_area_pos.items():
            if len(names) > 1:
                duplicates.append({"area": area_names.get(area_id, area_id), "position": pos, "tables": sorted(names)})
        self.log_check(f"{label}: no table remains at (0,0)", not stuck, stuck)
        self.log_check(f"{label}: no duplicate table positions within the same area", not duplicates, duplicates)

        if expect_exact_seed_grid:
            grid_failures = []
            grouped: dict[str, list[dict]] = defaultdict(list)
            for t in tables:
                grouped[t["area_id"]].append(t)
            for area_id, group in grouped.items():
                actual = sorted(self.pos_tuple(t) for t in group)
                expected = []
                for idx in range(len(group)):
                    expected.append((float(40 + (idx % 4) * 120), float(40 + (idx // 4) * 100)))
                if actual != sorted(expected):
                    grid_failures.append({
                        "area": area_names.get(area_id, area_id),
                        "actual": actual,
                        "expected": sorted(expected),
                    })
            self.log_check(f"{label}: seeded table positions follow 4-column 120x100 grid per area", not grid_failures, grid_failures)
        self.evidence[f"{label}_tables"] = {
            "count": len(tables),
            "positions_by_name": {t["name"]: {"area": area_names.get(t["area_id"], t["area_id"]), "position": t.get("position")} for t in tables},
        }
        return tables

    def verify_customer_metrics(self, token: str, label: str, expected_seed_totals: dict[str, int] | None = None) -> list[dict]:
        customers = self.request("GET", "/customers", token=token)
        bookings = self.request("GET", "/bookings", token=token)
        counts = defaultdict(lambda: {"total_bookings": 0, "no_show_count": 0, "cancelled_count": 0})
        for b in bookings:
            cid = b.get("customer_id")
            counts[cid]["total_bookings"] += 1
            if b.get("status") == "no_show":
                counts[cid]["no_show_count"] += 1
            if b.get("status") == "cancelled":
                counts[cid]["cancelled_count"] += 1
        mismatches = []
        for c in customers:
            expected = counts[c["id"]]
            for key in ("total_bookings", "no_show_count", "cancelled_count"):
                if int(c.get(key, 0) or 0) != expected[key]:
                    mismatches.append({"customer": c["name"], "field": key, "api": c.get(key), "expected": expected[key]})
        self.log_check(f"{label}: every customer metric equals bookings history", not mismatches, mismatches)
        andreas = [c for c in customers if c.get("name") == "Andrea Verdi"]
        self.log_check(
            f"{label}: Andrea Verdi exists and total_bookings >= 1",
            bool(andreas) and int(andreas[0].get("total_bookings", 0) or 0) >= 1,
            andreas,
        )
        if expected_seed_totals is not None:
            by_name = defaultdict(list)
            for c in customers:
                by_name[c["name"]].append(c)
            seed_failures = []
            for name, total in expected_seed_totals.items():
                if len(by_name[name]) != 1:
                    seed_failures.append({"name": name, "issue": f"expected one customer, found {len(by_name[name])}"})
                elif int(by_name[name][0].get("total_bookings", -1)) != total:
                    seed_failures.append({"name": name, "api_total": by_name[name][0].get("total_bookings"), "expected": total})
            self.log_check(f"{label}: seeded named customer totals are exact", not seed_failures, seed_failures)
        names = [c["name"] for c in customers]
        dup_names = [name for name, count in Counter(names).items() if count > 1]
        self.log_check(f"{label}: no duplicate customer names", not dup_names, dup_names)
        self.evidence[f"{label}_customers"] = {"count": len(customers), "names": sorted(names)}
        return customers

    def verify_no_test_prefix(self, token: str, label: str, expected_retained: list[str] | None = None) -> None:
        customers = self.request("GET", "/customers", token=token)
        bad = [c["name"] for c in customers if c.get("name", "").startswith("TEST_")]
        self.log_check(f"{label}: no stored customer starts with literal TEST_", not bad, bad)
        search = self.request("GET", "/customers?search=TEST_", token=token)
        search_bad = [c["name"] for c in search if c.get("name", "").startswith("TEST_")]
        self.log_check(f"{label}: /customers?search=TEST_ returns no literal TEST_ prefix names", not search_bad, [c["name"] for c in search])
        if expected_retained:
            names = {c["name"] for c in customers}
            missing = [name for name in expected_retained if name not in names]
            self.log_check(f"{label}: allowed non-literal TEST_ matches are retained", not missing, missing)

    def reset_and_seed(self, label: str) -> tuple[str, dict]:
        removed = self.drop_demo_restaurant()
        self.evidence[f"{label}_drop"] = removed
        self.restart_backend(f"{label}: auto-seed demo after full drop")
        token, restaurant = self.login()
        self.log_check(f"{label}: demo login works after fresh seed", bool(token and restaurant.get("subdomain") == "demo"), restaurant)
        return token, restaurant

    def create_table(self, token: str, area_id: str, name: str, position: dict | None = None) -> dict:
        body = {
            "area_id": area_id,
            "name": name,
            "seats_min": 1,
            "seats_max": 2,
            "priority": -100,
            "bookable_staff": True,
            "bookable_online": False,
            "shape": "square",
        }
        if position is not None:
            body["position"] = position
        return self.request("POST", "/tables", token=token, json=body)

    def create_customer(self, token: str, name: str) -> dict:
        stamp = int(time.time())
        return self.request("POST", "/customers", token=token, json={
            "name": name,
            "phone": f"+39 399 {stamp % 1000000:06d}",
            "email": f"{name.lower().replace('_', '').replace(' ', '')}.{stamp}@qa.example.com",
        })

    def run(self) -> None:
        self.wait_backend()
        seed_expected = {"Luca Ferrari": 2, "Giulia Neri": 2, "Andrea Verdi": 1, "Chiara Blu": 1}

        # Seed freshness from a fully dropped demo tenant.
        token, _restaurant = self.reset_and_seed("fresh_seed")
        seed_tables = self.verify_tables_positions(token, "fresh_seed", expect_exact_seed_grid=True)
        seed_customers = self.verify_customer_metrics(token, "fresh_seed", expected_seed_totals=seed_expected)
        self.verify_no_test_prefix(token, "fresh_seed")
        self.log_check("fresh_seed: seeded table count is 11", len(seed_tables) == 11, len(seed_tables))
        self.log_check("fresh_seed: seeded customer count is 4", len(seed_customers) == 4, len(seed_customers))

        # Idempotency across two restarts: counts and positions must stay stable.
        before_tables = self.request("GET", "/tables", token=token)
        before_customers = self.request("GET", "/customers", token=token)
        before_positions = {t["id"]: self.pos_tuple(t) for t in before_tables}
        self.restart_backend("idempotency pass 1")
        self.restart_backend("idempotency pass 2")
        token, _ = self.login()
        after_tables = self.request("GET", "/tables", token=token)
        after_customers = self.request("GET", "/customers", token=token)
        after_positions = {t["id"]: self.pos_tuple(t) for t in after_tables}
        self.log_check("idempotency: table count unchanged after two restarts", len(after_tables) == len(before_tables), {"before": len(before_tables), "after": len(after_tables)})
        self.log_check("idempotency: customer count unchanged after two restarts", len(after_customers) == len(before_customers), {"before": len(before_customers), "after": len(after_customers)})
        self.log_check("idempotency: positions did not shift after two restarts", after_positions == before_positions, {"before": before_positions, "after": after_positions})
        self.verify_tables_positions(token, "idempotency")
        self.verify_customer_metrics(token, "idempotency", expected_seed_totals=seed_expected)
        self.verify_no_test_prefix(token, "idempotency")

        # Basic active repair: create corrupted data, restart, verify repair fixes it.
        areas = self.request("GET", "/areas", token=token)
        dehors = next((a for a in areas if a["name"] == "Dehors"), areas[0])
        existing_tables = self.request("GET", "/tables", token=token)
        existing_positions = {t["id"]: self.pos_tuple(t) for t in existing_tables}
        stuck = self.create_table(token, dehors["id"], "QA_STUCK_BASIC")
        self.log_check("basic_repair setup: API-created table starts at default (0,0)", self.pos_tuple(stuck) == (0.0, 0.0), stuck)
        self.create_customer(token, "TEST_DELETE_ME_ITER5")
        self.create_customer(token, "AUDIT_TEST_Comet")
        self.create_customer(token, "test_lower_case_iter5")
        andrea = next(c for c in self.request("GET", "/customers", token=token) if c["name"] == "Andrea Verdi")
        self.db.customers.update_one({"id": andrea["id"]}, {"$set": {"total_bookings": 0, "no_show_count": 99, "cancelled_count": 99}})
        self.restart_backend("basic repair should fix stuck table, metrics, and TEST_ cleanup")
        token, _ = self.login()
        repaired_tables = self.verify_tables_positions(token, "basic_repair")
        repaired_by_id = {t["id"]: self.pos_tuple(t) for t in repaired_tables}
        unchanged = {tid: {"before": pos, "after": repaired_by_id.get(tid)} for tid, pos in existing_positions.items() if repaired_by_id.get(tid) != pos}
        self.log_check("basic_repair: pre-existing non-stuck table positions were not altered", not unchanged, unchanged)
        fixed_stuck = next((t for t in repaired_tables if t["id"] == stuck["id"]), None)
        self.log_check("basic_repair: QA_STUCK_BASIC was moved off (0,0)", bool(fixed_stuck) and self.pos_tuple(fixed_stuck) != (0.0, 0.0), fixed_stuck)
        self.verify_customer_metrics(token, "basic_repair")
        self.verify_no_test_prefix(token, "basic_repair", expected_retained=["AUDIT_TEST_Comet", "test_lower_case_iter5"])

        # Clean reset before collision edge-case.
        token, _ = self.reset_and_seed("pre_collision_clean_seed")

        # Edge case: an already-placed manual table occupies a future grid slot. The repair
        # must skip occupied grid slots, not just offset by placed_count, otherwise the plan
        # still has stacked tables after repair.
        areas = self.request("GET", "/areas", token=token)
        sala = next((a for a in areas if a["name"] == "Sala Principale"), areas[0])
        manual = self.create_table(token, sala["id"], "QA_MANUAL_SLOT8", position={"x": 40, "y": 240})
        collision_stuck = self.create_table(token, sala["id"], "QA_STUCK_COLLISION")
        self.log_check("collision setup: manual table placed at grid slot 8", self.pos_tuple(manual) == (40.0, 240.0), manual)
        self.log_check("collision setup: second table starts stuck at (0,0)", self.pos_tuple(collision_stuck) == (0.0, 0.0), collision_stuck)
        self.restart_backend("collision edge repair should skip occupied grid slots")
        token, _ = self.login()
        collision_tables = self.verify_tables_positions(token, "collision_edge")
        by_name = {t["name"]: t for t in collision_tables}
        collision_detail = {
            "manual": by_name.get("QA_MANUAL_SLOT8"),
            "stuck_after_repair": by_name.get("QA_STUCK_COLLISION"),
        }
        no_collision = (
            "QA_MANUAL_SLOT8" in by_name
            and "QA_STUCK_COLLISION" in by_name
            and self.pos_tuple(by_name["QA_MANUAL_SLOT8"]) != self.pos_tuple(by_name["QA_STUCK_COLLISION"])
        )
        self.log_check("collision_edge: repaired stuck table did not overlap the existing manual grid-slot table", no_collision, collision_detail)

        # Leave the preview DB clean/fresh for the main agent after destructive tests.
        token, _ = self.reset_and_seed("final_cleanup_seed")
        self.verify_tables_positions(token, "final_cleanup_seed", expect_exact_seed_grid=True)
        self.verify_customer_metrics(token, "final_cleanup_seed", expected_seed_totals=seed_expected)

    def write_report(self) -> None:
        RAW_REPORT.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "base_url": BASE_URL,
            "db_name": DB_NAME,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "failures": self.failures,
            "checks": self.checks,
            "evidence": self.evidence,
        }
        RAW_REPORT.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        print(f"\nRaw report written to {RAW_REPORT}")


if __name__ == "__main__":
    qa = QA()
    try:
        qa.run()
    finally:
        qa.write_report()
    sys.exit(1 if qa.failures else 0)