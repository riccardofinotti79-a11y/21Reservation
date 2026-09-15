-- 21Reservation: PostgreSQL schema (Supabase)
-- Run once: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ========================================================
-- 1. restaurants
-- ========================================================
CREATE TABLE IF NOT EXISTS restaurants (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    subdomain     TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    address       TEXT,
    phone         TEXT,
    email         TEXT,
    description   TEXT,
    hero_image_url TEXT,
    theme_preset  TEXT,
    accent_color  TEXT NOT NULL DEFAULT '#D97706',
    language      TEXT NOT NULL DEFAULT 'it',
    currency      TEXT NOT NULL DEFAULT 'EUR',
    timezone      TEXT NOT NULL DEFAULT 'Europe/Rome',
    deposit_enabled          BOOL NOT NULL DEFAULT FALSE,
    deposit_threshold_persons INT NOT NULL DEFAULT 8,
    deposit_amount_per_person NUMERIC(10,2) NOT NULL DEFAULT 20.00,
    avg_ticket_per_guest      NUMERIC(10,2) NOT NULL DEFAULT 55.00,
    reminder_enabled     BOOL NOT NULL DEFAULT TRUE,
    reminder_lead_hours  INT NOT NULL DEFAULT 24,
    whatsapp_enabled  BOOL NOT NULL DEFAULT FALSE,
    whatsapp_provider TEXT,
    whatsapp_from     TEXT,
    whatsapp_twilio_sid        TEXT,
    whatsapp_twilio_auth_token TEXT,
    whatsapp_meta_phone_id     TEXT,
    whatsapp_meta_access_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_subdomain ON restaurants(subdomain);

-- ========================================================
-- 2. users
-- ========================================================
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    restaurant_id   TEXT,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'staff',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_restaurant_id ON users(restaurant_id);

-- ========================================================
-- 3. areas
-- ========================================================
CREATE TABLE IF NOT EXISTS areas (
    id              TEXT PRIMARY KEY,
    restaurant_id   TEXT NOT NULL,
    name            TEXT NOT NULL,
    priority        INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_areas_restaurant_id ON areas(restaurant_id);

-- ========================================================
-- 4. tables
-- ========================================================
CREATE TABLE IF NOT EXISTS tables (
    id              TEXT PRIMARY KEY,
    restaurant_id   TEXT NOT NULL,
    area_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    seats_min       INT NOT NULL,
    seats_max       INT NOT NULL,
    priority        INT NOT NULL DEFAULT 0,
    bookable_staff  BOOL NOT NULL DEFAULT TRUE,
    bookable_online BOOL NOT NULL DEFAULT TRUE,
    internal_note   TEXT,
    shape           TEXT NOT NULL DEFAULT 'square',
    position_x      FLOAT NOT NULL DEFAULT 0,
    position_y      FLOAT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tables_restaurant_id ON tables(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tables_area_id ON tables(area_id);

-- ========================================================
-- 5. opening_hours
-- ========================================================
CREATE TABLE IF NOT EXISTS opening_hours (
    id                      TEXT PRIMARY KEY,
    restaurant_id           TEXT NOT NULL,
    weekday                 INT,
    specific_date           TEXT,
    open_time               TEXT NOT NULL,
    close_time              TEXT NOT NULL,
    title                   TEXT,
    service_type            TEXT,
    slot_interval_minutes   INT NOT NULL DEFAULT 15,
    default_duration_minutes INT NOT NULL DEFAULT 120,
    duration_rules          JSONB NOT NULL DEFAULT '[]',
    is_closed               BOOL NOT NULL DEFAULT FALSE,
    requires_payment        BOOL NOT NULL DEFAULT FALSE,
    payment_amount          NUMERIC(10,2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_opening_hours_restaurant_id ON opening_hours(restaurant_id);

-- ========================================================
-- 6. booking_limits
-- ========================================================
CREATE TABLE IF NOT EXISTS booking_limits (
    id                    TEXT PRIMARY KEY,
    opening_hour_id       TEXT NOT NULL,
    max_bookings_total    INT,
    max_guests_total      INT,
    max_bookings_per_slot INT,
    max_guests_per_slot   INT
);

CREATE INDEX IF NOT EXISTS idx_booking_limits_opening_hour_id ON booking_limits(opening_hour_id);

-- ========================================================
-- 7. customers
-- ========================================================
CREATE TABLE IF NOT EXISTS customers (
    id               TEXT PRIMARY KEY,
    restaurant_id    TEXT NOT NULL,
    name             TEXT NOT NULL,
    phone            TEXT,
    email            TEXT,
    tags             JSONB NOT NULL DEFAULT '[]',
    notes            TEXT,
    bad_guest_flag   BOOL NOT NULL DEFAULT FALSE,
    total_bookings   INT NOT NULL DEFAULT 0,
    no_show_count    INT NOT NULL DEFAULT 0,
    cancelled_count  INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_restaurant_id ON customers(restaurant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_restaurant_email
    ON customers(restaurant_id, LOWER(email))
    WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_restaurant_phone
    ON customers(restaurant_id, phone)
    WHERE phone IS NOT NULL;

-- ========================================================
-- 8. bookings
-- ========================================================
CREATE TABLE IF NOT EXISTS bookings (
    id                       TEXT PRIMARY KEY,
    restaurant_id            TEXT NOT NULL,
    customer_id              TEXT NOT NULL,
    date                     TEXT NOT NULL,
    time                     TEXT NOT NULL,
    duration_minutes         INT NOT NULL,
    persons                  INT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'pending',
    source                   TEXT NOT NULL DEFAULT 'online',
    guest_message            TEXT,
    internal_note            TEXT,
    deposit_required         BOOL NOT NULL DEFAULT FALSE,
    deposit_amount           NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    deposit_status           TEXT,
    deposit_session_id       TEXT,
    reminder_sent_at         TEXT,
    cancel_token             TEXT,
    cancel_token_expires_at  TIMESTAMPTZ,
    reminder_channels        JSONB,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_restaurant_date
    ON bookings(restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_restaurant_customer
    ON bookings(restaurant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_deposit_session
    ON bookings(deposit_session_id)
    WHERE deposit_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_cancel_token
    ON bookings(cancel_token)
    WHERE cancel_token IS NOT NULL;

-- ========================================================
-- 9. booking_tables (pont table — serves EXCLUDE constraint)
-- ========================================================
CREATE TABLE IF NOT EXISTS booking_tables (
    booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    table_id    TEXT NOT NULL REFERENCES tables(id)    ON DELETE CASCADE,
    start_ts    TIMESTAMPTZ NOT NULL,
    end_ts      TIMESTAMPTZ NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    -- no double-booking of same table for overlapping time ranges (active slots only)
    EXCLUDE USING gist (table_id WITH =, tstzrange(start_ts, end_ts) WITH &&) WHERE (active)
);

-- ========================================================
-- 10. booking_status_history
-- ========================================================
CREATE TABLE IF NOT EXISTS booking_status_history (
    id           BIGSERIAL PRIMARY KEY,
    booking_id   TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    status       TEXT NOT NULL,
    at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    by_user_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_booking_status_history_booking_id
    ON booking_status_history(booking_id);

-- ========================================================
-- 11. waitlist
-- ========================================================
CREATE TABLE IF NOT EXISTS waitlist (
    id              TEXT PRIMARY KEY,
    restaurant_id   TEXT NOT NULL,
    date            TEXT NOT NULL,
    service         TEXT,
    persons         INT NOT NULL,
    preferred_time  TEXT,
    customer_id     TEXT,
    customer_name   TEXT NOT NULL,
    customer_email  TEXT NOT NULL,
    customer_phone  TEXT NOT NULL,
    message         TEXT,
    status          TEXT NOT NULL DEFAULT 'waiting',
    notified_at     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_restaurant_date_status
    ON waitlist(restaurant_id, date, status);
