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

## Iteration 5 (2026-02-15) — Embeddable widget
- Serve `/widget.js` static from `frontend/public/widget.js` — script scans for `[data-21r-widget]` elements and mounts either an inline auto-resizing iframe or a floating "Prenota" button that opens an overlay modal.
- `PublicBooking` supports `?embed=1`: page chrome (header/footer, hero image) is stripped, transparent background, and it posts height via `window.parent.postMessage({source:'21reservation', type:'height', ...})` for parent auto-resize.
- Settings → new "Widget embed" section with tab toggle Inline/Button, copy-to-clipboard snippet, and live preview iframe (inline) or button.

## Iteration 6 (2026-02-15) — Data repair on startup
- `server.py` startup runs an idempotent `_repair_data` routine that (a) re-lays tables stuck at (0,0) on a per-area grid without colliding with manually-placed tables, (b) recomputes all customer metrics from the current bookings collection, (c) deletes stray `TEST_` customers left by past QA runs.
- `FloorPlan.js` dark-mode: canvas + area titles + snap grid apply `dark:` classes so tables stay visible in dark theme.
- Verified backend-only via `/app/tests/backend_data_repair_iter6.py` — 100%.

## Iteration 7 (2026-02-15) — Edit Booking from Lista / Timeline
- Backend: new `PATCH /api/bookings/{bid}` accepting `BookingUpdate` (date, time, duration_minutes, persons, table_ids, guest_message, internal_note, status, source). On status change it appends to `status_history`, recomputes customer metrics and, if the new status frees a seat (cancelled/declined/no_show), triggers `_try_notify_waitlist`.
- Frontend: `NewBookingModal` accepts a `booking` prop and switches to Edit mode (title "Modifica prenotazione", form pre-filled, `nb-submit` calls `PATCH /api/bookings/{id}`).
- `BookingsList`: clicking a row (`booking-row-<id>`) opens the modal in edit; quick-action cells (`action-accept/decline/seated/noshow-<id>`) call `stopPropagation` so they do NOT open the modal.
- `BookingsTimeline`: clicking a `tl-block-<id>` opens the same modal in edit mode.
- Verified end-to-end: 7/7 backend pytest + 5/5 frontend flows — report `/app/test_reports/iteration_7.json`.

## Known non-blocking notes (Feb 2026)
- `NewBookingModal` shows customer_* inputs also in edit mode but the PATCH ignores them (no customer swap yet) — UX-only.
- `BookingsTimeline` relies on the 5s polling to refresh after an edit (no explicit refresh call).
- `server.py` LOC = 1319; split into routers deferred (P1 backlog).

## Iteration 9 (2026-02-15) — BookingsList search & filters
- `BookingsList.js`: nuova barra client-side con ricerca full-text su nome/telefono cliente (`list-search`), select stato (`list-filter-status`, 6 valori: all/pending/accepted/seated/declined/no_show/cancelled) e select sorgente (`list-filter-source`: all/phone/online/walkin). Combinabili tra loro e con il selettore data esistente. Chip `list-filter-clear` visibile quando c'è almeno un filtro attivo. Contatore `list-filter-count` mostra `filtered / total`.
- Contatori KPI in alto (`stat-bookings`, `stat-guests`, `stat-pending`, `stat-seated`) restano sul totale del giorno, invariati.
- Comportamento riga (apre modale in edit) e quick-action (accept/decline/seated/no_show con `stopPropagation`) invariati.
- Nuove chiavi i18n IT+EN: `common.search_placeholder`, `common.all_statuses`, `common.all_sources`, `common.clear_filters`, `common.no_results`.
- Scope: solo `BookingsList.js` + `i18n.js`. Nessun cambio backend, nessun reload.

## Iteration 11 (2026-02-15) — Mobile responsive tables
- `BookingsList`, `Customers`, `Tables`: aggiunto hook `matchMedia("(max-width: 639px)")` con listener che switcha tra vista tabella (sm+) e card impilate (mobile). Solo una vista è renderizzata alla volta → i data-testid restano unici.
- Su desktop le tabelle sono ora dentro un wrapper `overflow-x-auto` che confina lo scroll orizzontale dentro il box (mai a livello di pagina).
- Toolbar (heading + azioni + filtri): `flex-wrap`, larghezze `w-full sm:w-auto` sugli input/select e `text-base sm:text-sm` (16px su mobile per evitare zoom iOS). Padding pagina `p-4 sm:p-8`.
- Icone azione su mobile: tap area ≥40x40px (`min-w-[40px] min-h-[40px]`), bordo colorato di stato per leggibilità, spaziatura `gap-2`.
- Verificato con screenshot a 375px e 320px: `document.documentElement.scrollWidth === clientWidth` su tutte e tre le pagine. Row/card tap → apre il modale (BookingsList), quick-action non lo apre, filtri combinabili funzionano, i customers link a `/customers/:id`.

## Iteration 12 (2026-02-15) — Calendar → List date passthrough + mobile calendar
- `BookingsCalendar.js`: il click su una cella navigava sempre a `/bookings/list` senza data → List si apriva sempre su oggi. Ora naviga a `/bookings/list?date=YYYY-MM-DD` per il giorno cliccato.
- `BookingsList.js`: ora legge `?date=` da `useSearchParams` per inizializzare lo stato (fallback a `todayStr()` se assente). Sync bidirezionale: cambiare data manualmente aggiorna il query param (o lo rimuove se torna a oggi).
- `BookingsCalendar` responsive: outer `p-4 sm:p-8`, header title `text-4xl sm:text-5xl`, prev/next `min-w-[40px] min-h-[40px]`, month title `min-w-0 sm:min-w-[220px]`, celle giorno `p-2 sm:p-3 min-h-[64px] sm:min-h-[110px]` con font `text-base sm:text-lg` e labels "prenotazioni/ospiti" nascoste sotto sm (`hidden sm:inline`), header giorni `px-1 sm:px-3`.
- Verificato: 375px + 320px → nessun overflow orizzontale; click 2/5 agosto → URL e date-picker si aggiornano correttamente; default List (senza query) → oggi.

## Iteration 13 (2026-02-15) — Dark mode sweep
- Sostituzioni idempotenti (perl con negative lookahead per `dark:`) su BookingsList, Customers, Tables, OpeningHours, CustomerDetail, Reports, Dashboard, BookingsCalendar, StatusBadge:
  * `bg-white` → `+ dark:bg-zinc-900`, `border-zinc-200` → `+ dark:border-zinc-800`, `border-zinc-100` → `+ dark:border-zinc-800`
  * `bg-zinc-50` → `+ dark:bg-zinc-800/60`, `bg-zinc-50/50` → `+ dark:bg-zinc-800/40`
  * `text-zinc-500/400/600/900` → varianti dark coerenti, `hover:bg-zinc-100/50` → varianti dark
- `StatusBadge`: aggiunte varianti `dark:bg-{color}-950/60 dark:text-{color}-200 dark:border-{color}-800/60` per tutti i 6 status (pending/accepted/seated/declined/no_show/cancelled).
- Contrasto: date/time input in BookingsList, CustomerDetail, Reports ora forzano `dark:text-zinc-100` per superare l'auto-color nero del native picker su bg scuro.
- Verificato a 375px in dark mode: `docSW==docCW` su tutte le 7 pagine; sfondo card `rgb(24,24,27)` (zinc-900); testi/badge leggibili; light mode invariato.

## Iteration 14 (2026-02-15) — Timeline: dark + mobile scroll
- `BookingsTimeline.js` riscritta:
  * Layout ora usa una griglia oraria a larghezza fissa (`PX_PER_HOUR=56`) invece del layout percentuale che comprimeva le ore su schermo stretto.
  * Contenitore interno `overflow-x-auto` con `-webkit-overflow-scrolling: touch` per lo scroll fluido; mai overflow di pagina.
  * Colonna tavoli/aree `sticky left-0 z-10 bg-white dark:bg-zinc-900` per restare visibile durante lo scroll orizzontale.
  * Header ore, righe area, righe tavolo con varianti `dark:` (`bg-zinc-900`, `border-zinc-800`, `text-zinc-100/300/400`); righe area `bg-zinc-50 dark:bg-zinc-800/60`.
  * Blocchi prenotazione ora usano coordinate/width in `px` (non %) — nessuna dipendenza da ResizeObserver.
- Verifica a 375px in dark: `docSW==docCW=375`, inner `scrollWidth=418 vs clientWidth=341`, grid bg `rgb(24,24,27)`, ore `19:00 20:00 21:00 22:00` distinte, tap su `tl-block-*` apre il modale, sticky column resta fissa durante `scrollLeft=200`.
