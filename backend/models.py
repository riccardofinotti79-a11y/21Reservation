"""Pydantic models for 21Reservation."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional, Literal

from pydantic import BaseModel, Field, ConfigDict, EmailStr


def new_id() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


BookingStatus = Literal[
    "pending", "accepted", "seated", "declined", "no_show", "cancelled"
]
BookingSource = Literal["phone", "online", "walkin"]
UserRole = Literal["owner", "staff"]
TableShape = Literal["square", "round", "rect"]


# -------------------- Restaurant / Users --------------------
class Restaurant(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    subdomain: str  # used in /book/{subdomain}
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    language: str = "it"
    currency: str = "EUR"
    timezone: str = "Europe/Rome"
    # Deposit / large group Stripe config
    deposit_enabled: bool = False
    deposit_threshold_persons: int = 8
    deposit_amount_per_person: float = 20.0  # EUR
    # Revenue estimation
    avg_ticket_per_guest: float = 55.0
    # Reminder / WhatsApp config
    reminder_enabled: bool = True
    reminder_lead_hours: int = 24
    whatsapp_enabled: bool = False
    whatsapp_provider: Optional[str] = None  # "twilio" | "meta" | null
    whatsapp_from: Optional[str] = None
    # Twilio credentials
    whatsapp_twilio_sid: Optional[str] = None
    whatsapp_twilio_auth_token: Optional[str] = None
    # Meta Cloud API credentials
    whatsapp_meta_phone_id: Optional[str] = None
    whatsapp_meta_access_token: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class RestaurantUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    language: Optional[str] = None
    currency: Optional[str] = None
    timezone: Optional[str] = None
    deposit_enabled: Optional[bool] = None
    deposit_threshold_persons: Optional[int] = None
    deposit_amount_per_person: Optional[float] = None
    avg_ticket_per_guest: Optional[float] = None
    reminder_enabled: Optional[bool] = None
    reminder_lead_hours: Optional[int] = None
    whatsapp_enabled: Optional[bool] = None
    whatsapp_provider: Optional[str] = None
    whatsapp_from: Optional[str] = None
    whatsapp_twilio_sid: Optional[str] = None
    whatsapp_twilio_auth_token: Optional[str] = None
    whatsapp_meta_phone_id: Optional[str] = None
    whatsapp_meta_access_token: Optional[str] = None


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    restaurant_id: str
    name: str
    email: EmailStr
    password_hash: str
    role: UserRole = "staff"
    created_at: datetime = Field(default_factory=utc_now)


class UserPublic(BaseModel):
    id: str
    restaurant_id: str
    name: str
    email: EmailStr
    role: UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    user: UserPublic
    restaurant: Restaurant


# -------------------- Areas / Tables --------------------
class Area(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    restaurant_id: str
    name: str
    priority: int = 0


class AreaCreate(BaseModel):
    name: str
    priority: int = 0


class Position(BaseModel):
    x: float = 0
    y: float = 0


class Table(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    restaurant_id: str
    area_id: str
    name: str
    seats_min: int
    seats_max: int
    priority: int = 0
    bookable_staff: bool = True
    bookable_online: bool = True
    internal_note: Optional[str] = None
    shape: TableShape = "square"
    position: Position = Field(default_factory=Position)


class TableCreate(BaseModel):
    area_id: str
    name: str
    seats_min: int
    seats_max: int
    priority: int = 0
    bookable_staff: bool = True
    bookable_online: bool = True
    internal_note: Optional[str] = None
    shape: TableShape = "square"
    position: Position = Field(default_factory=Position)


class TableUpdate(BaseModel):
    area_id: Optional[str] = None
    name: Optional[str] = None
    seats_min: Optional[int] = None
    seats_max: Optional[int] = None
    priority: Optional[int] = None
    bookable_staff: Optional[bool] = None
    bookable_online: Optional[bool] = None
    internal_note: Optional[str] = None
    shape: Optional[TableShape] = None
    position: Optional[Position] = None


# -------------------- Opening hours --------------------
class DurationRule(BaseModel):
    min_persons: int
    max_persons: int
    duration_minutes: int


class OpeningHour(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    restaurant_id: str
    # Either weekday (0=Mon..6=Sun) OR specific_date (YYYY-MM-DD)
    weekday: Optional[int] = None
    specific_date: Optional[str] = None
    open_time: str  # "HH:MM"
    close_time: str  # "HH:MM"
    title: Optional[str] = None
    service_type: Optional[str] = None  # "lunch" | "dinner" | "other"
    slot_interval_minutes: int = 15
    default_duration_minutes: int = 120
    duration_rules: List[DurationRule] = []
    is_closed: bool = False  # only meaningful for specific_date exceptions
    # Payment placeholder fields (future)
    requires_payment: bool = False
    payment_amount: float = 0.0


class OpeningHourCreate(BaseModel):
    weekday: Optional[int] = None
    specific_date: Optional[str] = None
    open_time: str
    close_time: str
    title: Optional[str] = None
    service_type: Optional[str] = None
    slot_interval_minutes: int = 15
    default_duration_minutes: int = 120
    duration_rules: List[DurationRule] = []
    is_closed: bool = False
    requires_payment: bool = False
    payment_amount: float = 0.0


# -------------------- Booking limits --------------------
class BookingLimit(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    opening_hour_id: str
    max_bookings_total: Optional[int] = None
    max_guests_total: Optional[int] = None
    max_bookings_per_slot: Optional[int] = None
    max_guests_per_slot: Optional[int] = None


# -------------------- Customers --------------------
class Customer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    restaurant_id: str
    name: str
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    tags: List[str] = []
    notes: Optional[str] = None
    bad_guest_flag: bool = False
    # metrics (auto-updated)
    total_bookings: int = 0
    no_show_count: int = 0
    cancelled_count: int = 0
    created_at: datetime = Field(default_factory=utc_now)


class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    tags: List[str] = []
    notes: Optional[str] = None
    bad_guest_flag: bool = False


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    bad_guest_flag: Optional[bool] = None


# -------------------- Bookings --------------------
class StatusChange(BaseModel):
    status: BookingStatus
    at: datetime = Field(default_factory=utc_now)
    by_user_id: Optional[str] = None


class Booking(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    restaurant_id: str
    customer_id: str
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    duration_minutes: int
    persons: int
    status: BookingStatus = "pending"
    source: BookingSource = "online"
    table_ids: List[str] = []
    guest_message: Optional[str] = None
    internal_note: Optional[str] = None
    status_history: List[StatusChange] = []
    # Deposit tracking
    deposit_required: bool = False
    deposit_amount: float = 0.0
    deposit_status: Optional[str] = None  # None | "pending" | "paid" | "failed"
    deposit_session_id: Optional[str] = None
    # Reminders
    reminder_sent_at: Optional[str] = None
    cancel_token: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class BookingCreateStaff(BaseModel):
    date: str
    time: str
    duration_minutes: Optional[int] = None
    persons: int
    source: BookingSource = "phone"
    status: BookingStatus = "accepted"
    table_ids: Optional[List[str]] = None  # if None -> auto assign
    guest_message: Optional[str] = None
    internal_note: Optional[str] = None
    # customer
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[EmailStr] = None


class BookingCreatePublic(BaseModel):
    date: str
    time: str
    persons: int
    customer_name: str
    customer_email: EmailStr
    customer_phone: str
    guest_message: Optional[str] = None
    accept_terms: bool = True
    origin_url: Optional[str] = None  # for Stripe deposit redirect URLs
    service: Optional[str] = None  # "lunch" | "dinner" | "other"


class BookingUpdate(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    duration_minutes: Optional[int] = None
    persons: Optional[int] = None
    table_ids: Optional[List[str]] = None
    guest_message: Optional[str] = None
    internal_note: Optional[str] = None


class BookingStatusUpdate(BaseModel):
    status: BookingStatus


class BookingWithCustomer(Booking):
    customer: Optional[Customer] = None


# -------------------- Waitlist --------------------
WaitlistStatus = Literal["waiting", "notified", "converted", "expired", "cancelled"]


class WaitlistEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    restaurant_id: str
    date: str
    service: Optional[str] = None
    persons: int
    preferred_time: Optional[str] = None  # optional preference
    customer_id: Optional[str] = None
    customer_name: str
    customer_email: EmailStr
    customer_phone: str
    message: Optional[str] = None
    status: WaitlistStatus = "waiting"
    notified_at: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class WaitlistCreate(BaseModel):
    date: str
    persons: int
    service: Optional[str] = None
    preferred_time: Optional[str] = None
    customer_name: str
    customer_email: EmailStr
    customer_phone: str
    message: Optional[str] = None


# -------------------- Availability responses --------------------
class SlotAvailability(BaseModel):
    time: str
    available: bool
    reason: Optional[str] = None


class DayAvailability(BaseModel):
    date: str
    open: bool
    slots: List[SlotAvailability] = []


class PublicRestaurantInfo(BaseModel):
    id: str
    name: str
    subdomain: str
    address: Optional[str] = None
    phone: Optional[str] = None
    language: str
    currency: str
    timezone: str
