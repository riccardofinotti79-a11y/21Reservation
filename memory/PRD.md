# 21Reservation — PRD & Delivery Log

## Original problem statement
Full-stack restaurant reservation system similar to Resos/OpenTable. Two areas:
private staff dashboard + public 4-step booking wizard at /book/{subdomain}.
Stack: FastAPI + MongoDB + React/Tailwind + JWT auth + 5s polling + Resend email.

## User personas
- Restaurant owner — full config (hours, tables, users, reports).
- Staff — manage bookings, mark seated / no-show / cancel.
- Guest (public) — book online via /book/{subdomain}, no login.

## Core requirements (static)
1. CRUD bookings with real availability + auto-assign tables (closest capacity, area priority).
2. Three synchronized dashboard views: List, Calendar (month), Timeline (horizontal grid).
3. Public 4-step wizard (persons → date → time → contact).
4. Opening hours weekly + specific-date exceptions with duration rules per party size.
5. Customer CRM with auto-created customer on booking + reliability score.
6. Two-level slot capacity checks (aggregate + 15-min bucket).
7. Booking state machine (pending/accepted/seated/declined/no_show/cancelled) with history.
8. Real Resend email confirmation on public booking + staff notification.
9. IT/EN UI with toggle in dashboard and public.
10. Realtime via 5-second polling.

## What's been implemented (2026-02-15)
### Backend (all endpoints prefixed /api)
- Auth: POST /auth/login, GET /auth/me (JWT + bcrypt).
- Restaurant/Public: GET /restaurant, GET /public/restaurant/{sub}.
- Areas: full CRUD.
- Tables: full CRUD with area, capacity, shape, priority, bookable flags.
- Opening hours: CRUD weekly + specific-date exceptions + duration rules.
- Customers: search list, detail, PATCH tags/notes/flag, booking history.
- Bookings: create (staff, auto-assign), list, PATCH, status change with history,
  delete, day-summary, /availability/suggest-tables.
- Public booking: /public/{sub}/availability/day, /month, /book (creates booking,
  best-effort emails guest + restaurant).
- Reports: /reports/summary with per_day, KPIs, estimated_occupancy_pct.
- Idempotent auto-seed on startup: demo restaurant + 2 users + 3 areas + 11 tables
  + weekly hours + 4 customers + 6 sample bookings.

### Frontend
- /login: split-screen (photo + form), pre-filled demo creds.
- Dashboard shell: sidebar nav, IT/EN toggle, logout.
- /bookings/list: stats cards, quick actions (accept/decline/seated/no-show), 5s polling.
- /bookings/calendar: month grid with booking + guest counts per day.
- /bookings/timeline: horizontal grid tables × time, colored blocks, legend,
  auto-scroll to dinner window.
- /tables: area + table CRUD grouped.
- /hours: weekly + exceptions form.
- /customers + /customers/:id: search, detail with reliability score + edit.
- /reports: 5 KPIs + Recharts bar chart.
- /book/{sub}: 4-step framer-motion wizard, glassmorphic dark theme, confirmation.
- NewBookingModal: auto-suggest tables, override manual, customer resolve.

### Verified by tests
- Backend: 28/28 pytest cases pass.
- Frontend: all core flows pass (login, list, calendar, timeline, tables, hours,
  customers, reports, language toggle, public wizard end-to-end).

## Backlog (P1/P2)
- P1: WebSocket real-time (replace polling for lower latency).
- P1: Visual floor-plan drag&drop editor (positions already in Table model).
- P1: Payments/deposits/no-show fees (Stripe; hooks already in opening_hours model).
- P2: SMS notifications, Google Reserve integration, in-app chat.
- P2: Post-visit feedback / review requests.
- P2: Public API for POS/Odoo integration.
- P2: Waitlist for fully-booked slots.
- P2: Multi-language beyond IT/EN.

## Next tasks list
1. Owner analytics: revenue estimate per service + top clients report.
2. Reminder emails (T-24h) and cancellation self-service link for guests.
3. Configurable booking limits per opening_hour (UI + surfacing to public availability).
4. Owner-only Users CRUD screen.
5. Optional Stripe deposit gate for large parties.

## Iteration 2 (2026-02-15) — Advanced features

### New endpoints
- `PATCH /api/restaurant` (owner-only) — restaurant settings.
- `GET /api/payments/status/{session_id}` — poll deposit status.
- `POST /api/stripe/webhook` — Stripe events (checkout.session.completed, expired, failed).
- `GET/POST /api/public/cancel/{token}` — self-cancel by guest.
- `POST /api/cron/send-reminders` — Bearer-protected daily job.
- `GET /api/config/public` — Stripe publishable key.

### New model fields
- Restaurant: `deposit_enabled`, `deposit_threshold_persons`, `deposit_amount_per_person`,
  `avg_ticket_per_guest`, `reminder_enabled`, `reminder_lead_hours`,
  `whatsapp_enabled`, `whatsapp_provider`, `whatsapp_from`.
- Booking: `deposit_required`, `deposit_amount`, `deposit_status`,
  `deposit_session_id`, `reminder_sent_at`, `cancel_token`.

### New pages
- `/settings` — owner-only config form (Generale, Revenue, Depositi, Reminder, WhatsApp).
- `/floorplan` — drag & drop MVP with 20px snap, one canvas per area.
- `/cancel/:token` — public self-cancel page.
- `/payment/success` and `/payment/cancel` — Stripe redirect handlers.

### Cron
- `.emergent/crons.yml` schedules `POST /api/cron/send-reminders` daily at 10:00 Europe/Rome.

### Verified
- Backend: 12/12 iter-2 pytest + 28/28 iter-1 all pass.
- Frontend: 100% of the 6 new features validated end-to-end (Settings persistence, Floor plan drag+save, Mobile sidebar, Public deposit → Stripe URL, Self-cancel flow, Revenue KPI + line chart).

### Backlog updates
- P1: Real WhatsApp provider wiring (Twilio or Meta Cloud) — infra ready.
- P1: Deposit refund automation after visit + partial refund on no-show.
- P2: Floor plan v2 (rotation, walls, background image).
- P2: Configurable `avg_ticket` per opening_hour (lunch vs dinner).

## Iteration 3 (2026-02-15) — Service selection + WhatsApp providers

### New endpoints
- `GET /api/public/{sub}/services` — services offered by the restaurant.
- `/api/public/{sub}/availability/{day,month}` accept optional `service` query.
- `GET /api/whatsapp/status` — enabled/provider/configured summary.
- `POST /api/whatsapp/test` — owner-only. Sends a real WhatsApp test through the configured provider; 400 if unconfigured.

### Backend
- `availability.pick_opening_hour(date, opening_hours, service=)` now filters by service.
- `whatsapp_service.py` implements real Twilio and Meta Cloud API HTTP sends when the restaurant's per-provider credentials are fully populated. Returns False otherwise (no cost incurred).
- New model fields on Restaurant: `whatsapp_twilio_sid`, `whatsapp_twilio_auth_token`, `whatsapp_meta_phone_id`, `whatsapp_meta_access_token`.
- OpeningHour has `service_type` ("lunch" | "dinner" | "other"). Seed and one-off backfill applied.
- BookingCreatePublic now carries `service` so the correct opening hour is picked.

### Frontend
- Public wizard restructured to 4 steps: Servizio → Persone → Data+Ora combinati → Contatti (with allergies placeholder).
- Sun/Moon icons for lunch/dinner; unavailable services rendered disabled.
- Settings page: dynamic provider panel (Twilio vs Meta) with credential fields, pricing info card, and "Invia test" button.

### Cost note
- Meta Cloud API: 1000 conversazioni/mese gratis, poi ~$0.005-0.10 per conversazione (setup più complesso).
- Twilio WhatsApp: nessun tier gratuito, sandbox immediato per test.

## Iteration 3 hotfix
- Cleanup: removed a stray Tuesday `lunch` opening_hours row from the demo DB (residuo di uno smoke test dell'iterazione).
- Post-cleanup checks: Tue lunch → open=false, Sat lunch → 5 slots, POST book Tue lunch → 400 "Ristorante chiuso in quella data".

## Iteration 4 (2026-02-15) — Waitlist + Home dashboard + Fluid timeline

### New endpoints
- `POST /api/public/{sub}/waitlist` — public waitlist join.
- `GET /api/waitlist?status=&date_from=&date_to=` — staff list.
- `POST /api/waitlist/{id}/notify` — manual notify.
- `DELETE /api/waitlist/{id}` — remove entry.
- `GET /api/reports/home` — today/week/month KPIs + last7 + upcoming + waitlist count.

### Backend
- Booking status/delete hooks call `_try_notify_waitlist(rid, date)` — sends email + optional WhatsApp when a matching-capacity slot becomes available. Idempotent per entry.
- New `WaitlistEntry` model + `waitlist` collection.

### Frontend
- **New /  (Home)**: KPI cards Today/Week/Month (bookings, guests, revenue), 7-day area+line chart, upcoming bookings list, live waitlist counter link.
- **New /waitlist page**: table with staff actions Notify + Remove, status filter.
- **Public wizard**: when no slots available, shows "Iscrivimi alla lista d'attesa" CTA with inline form.
- **Timeline**: rewritten to percentage-based layout — fits container width, no horizontal scroll. Booking blocks display text only when there's enough space.
- Sidebar nav updated with Home + Lista d'attesa items.

## Iteration 4 hotfix
- Removed stray weekday-lunch opening_hours row (Monday lunch 11:30-15:30) — same class of test-artefact as iter3.
- Post-cleanup: Tue-Sun dinner + Sat/Sun lunch only. iter3 test suite should now pass 15/15.

## Backlog updates (Feb 2026)
- P1: split server.py into routers (public.py, waitlist.py, whatsapp.py, payments.py, reports.py) — LOC crossed 1200.
- P2: reports_home extend range_end to today+14 for cross-month upcoming preview.
- P2: waitlist manual-notify re-check availability before sending.
- P2: PublicBooking waitlist phone validation.
