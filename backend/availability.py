"""Availability calculation and auto-assignment of tables."""
from __future__ import annotations

from datetime import datetime, timedelta, date as date_cls
from typing import List, Optional, Tuple


def parse_hhmm(s: str) -> Tuple[int, int]:
    h, m = s.split(":")
    return int(h), int(m)


def hhmm_to_minutes(s: str) -> int:
    h, m = parse_hhmm(s)
    return h * 60 + m


def minutes_to_hhmm(m: int) -> str:
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def weekday_from_date(date_str: str) -> int:
    """0=Mon..6=Sun (Python .weekday())"""
    return date_cls.fromisoformat(date_str).weekday()


def pick_opening_hour(
    date_str: str, opening_hours: List[dict], service: Optional[str] = None,
) -> Optional[dict]:
    """Given all opening_hours for a restaurant, pick the one matching date_str.

    Priority: specific_date match wins over weekday match. Returns None if the
    day is closed (either no match, or a specific_date exception with is_closed).
    If `service` is provided ("lunch"/"dinner"/"other"), restrict to that service.
    """
    def match_service(oh):
        if service is None:
            return True
        return (oh.get("service_type") or "").lower() == service.lower()

    # First: check specific date exceptions
    for oh in opening_hours:
        if oh.get("specific_date") == date_str and match_service(oh):
            if oh.get("is_closed"):
                return None
            return oh
    # Then: weekday rule
    wd = weekday_from_date(date_str)
    for oh in opening_hours:
        if oh.get("weekday") == wd and not oh.get("specific_date") and match_service(oh):
            if oh.get("is_closed"):
                return None
            return oh
    return None


def services_available_on(date_str: str, opening_hours: List[dict]) -> List[str]:
    """Return the list of distinct service_types open on that date (e.g. ['lunch','dinner'])."""
    wd = weekday_from_date(date_str)
    # specific_date exception takes precedence: if any exception matches the date and is_closed, day is closed
    date_exceptions = [oh for oh in opening_hours if oh.get("specific_date") == date_str]
    if date_exceptions and any(x.get("is_closed") for x in date_exceptions):
        return []
    if date_exceptions:
        return sorted({(x.get("service_type") or "other") for x in date_exceptions})
    return sorted({
        (oh.get("service_type") or "other")
        for oh in opening_hours
        if oh.get("weekday") == wd and not oh.get("specific_date") and not oh.get("is_closed")
    })


def duration_for_persons(oh: dict, persons: int) -> int:
    for rule in oh.get("duration_rules", []) or []:
        if rule["min_persons"] <= persons <= rule["max_persons"]:
            return rule["duration_minutes"]
    return oh.get("default_duration_minutes", 120)


def generate_slots(oh: dict, persons: int) -> List[str]:
    """Slots between open_time and (close_time - duration), stepping by interval."""
    interval = oh.get("slot_interval_minutes", 15)
    duration = duration_for_persons(oh, persons)
    open_min = hhmm_to_minutes(oh["open_time"])
    close_min = hhmm_to_minutes(oh["close_time"])
    if close_min <= open_min:  # overnight not supported for MVP
        close_min += 24 * 60
    last = close_min - duration
    if last < open_min:
        return []
    slots = []
    t = open_min
    while t <= last:
        slots.append(minutes_to_hhmm(t))
        t += interval
    return slots


def bookings_overlap(
    a_start: int, a_end: int, b_start: int, b_end: int
) -> bool:
    return not (a_end <= b_start or b_end <= a_start)


def find_available_tables(
    persons: int,
    date_str: str,
    time_str: str,
    duration_minutes: int,
    tables: List[dict],
    existing_bookings: List[dict],
    online_only: bool = False,
) -> List[dict]:
    """Return tables that can host `persons` and are not occupied at the interval."""
    req_start = hhmm_to_minutes(time_str)
    req_end = req_start + duration_minutes

    # Build occupied tables set for this date, considering only ACTIVE statuses
    active = {"pending", "accepted", "seated"}
    occupied = set()
    for b in existing_bookings:
        if b.get("date") != date_str:
            continue
        if b.get("status") not in active:
            continue
        b_start = hhmm_to_minutes(b["time"])
        b_end = b_start + b.get("duration_minutes", 120)
        if bookings_overlap(req_start, req_end, b_start, b_end):
            for tid in b.get("table_ids", []):
                occupied.add(tid)

    candidates = []
    for t in tables:
        if t["id"] in occupied:
            continue
        if online_only and not t.get("bookable_online", True):
            continue
        if not online_only and not t.get("bookable_staff", True):
            continue
        if t["seats_min"] <= persons <= t["seats_max"]:
            candidates.append(t)
    return candidates


def auto_assign_table(
    persons: int,
    date_str: str,
    time_str: str,
    duration_minutes: int,
    tables: List[dict],
    areas: List[dict],
    existing_bookings: List[dict],
    online_only: bool = False,
) -> Optional[str]:
    """Return the id of the best-fit table. Best = closest capacity, respecting area priority."""
    candidates = find_available_tables(
        persons, date_str, time_str, duration_minutes, tables, existing_bookings, online_only
    )
    if not candidates:
        return None
    area_priority = {a["id"]: a.get("priority", 0) for a in areas}
    # Sort by (area priority asc = higher priority first if we consider lower number = higher),
    # actually we use higher number = higher priority. Then by fitness (seats_max - persons).
    candidates.sort(
        key=lambda t: (
            -area_priority.get(t["area_id"], 0),
            (t["seats_max"] - persons),
            -t.get("priority", 0),
            t["name"],
        )
    )
    return candidates[0]["id"]


def slot_within_limits(
    date_str: str,
    time_str: str,
    persons: int,
    oh: dict,
    limits: Optional[dict],
    existing_bookings: List[dict],
    slot_bucket_minutes: int = 15,
) -> Tuple[bool, Optional[str]]:
    """Two-level check: aggregate for the opening window AND for the 15-min slot bucket."""
    if not limits:
        return True, None
    active = {"pending", "accepted", "seated"}
    open_min = hhmm_to_minutes(oh["open_time"])
    close_min = hhmm_to_minutes(oh["close_time"])
    if close_min <= open_min:
        close_min += 24 * 60

    total_bookings = 0
    total_guests = 0
    req_min = hhmm_to_minutes(time_str)
    slot_bookings = 0
    slot_guests = 0
    bucket_start = (req_min // slot_bucket_minutes) * slot_bucket_minutes
    bucket_end = bucket_start + slot_bucket_minutes

    for b in existing_bookings:
        if b.get("date") != date_str:
            continue
        if b.get("status") not in active:
            continue
        b_min = hhmm_to_minutes(b["time"])
        if open_min <= b_min < close_min:
            total_bookings += 1
            total_guests += b.get("persons", 0)
        if bucket_start <= b_min < bucket_end:
            slot_bookings += 1
            slot_guests += b.get("persons", 0)

    mbt = limits.get("max_bookings_total")
    if mbt is not None and total_bookings + 1 > mbt:
        return False, "aggregate_bookings"
    mgt = limits.get("max_guests_total")
    if mgt is not None and total_guests + persons > mgt:
        return False, "aggregate_guests"
    mbs = limits.get("max_bookings_per_slot")
    if mbs is not None and slot_bookings + 1 > mbs:
        return False, "slot_bookings"
    mgs = limits.get("max_guests_per_slot")
    if mgs is not None and slot_guests + persons > mgs:
        return False, "slot_guests"
    return True, None
