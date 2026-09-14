---
name: migration-supabase-fase1
description: "21Reservation → Supabase: schema Postgres proposto, indici, mapping JSONB, libreria, strategia seed. FASE 1 di 2."
metadata:
  type: project
  originSessionId: 9f3c3e94-3929-4489-af47-e1ddca24cf64
---

# Migrazione Mongo → Supabase (Postgres) — FASE 1: analisi + schema

Contesto: 21Reservation gira su Render + MongoDB Atlas M0 (Test 1 passato). Destinazione finale: Supabase Postgres. Cambia SOLO il layer dati: da motor/Mongo a Postgres. Auth, JWT, ruoli, portale agenzia, API pubbliche: intatti (firme identiche). Nessuna feature nuova.

## 0. Riepilogo scelte chiave

| Tema | Scelta | Perché |
|---|---|---|
| Libreria data access | **psycopg[async] (psycopg3)** puro | asyncpg NON gira su Windows; SQLModel/SQLAlchemy = ORM e doppio schema; questo progetto è dict-driven e puro query |
| `position` tavoli | **2 colonne** `position_x`/`position_y` | sempre presenti, semplice, specificato dal floorplan |
| `table_ids` booking | **tabella ponte** `booking_tables` | serve il vincolo anti-overlap a livello row |
| `status_history` | **tabella** `booking_status_history` | append-only, audit, evita $push |
| `duration_rules` | **JSONB** su opening_hours | letto/sostituito intero, poco, mai query parziale |
| `tags` customer | **JSONB** array | non relazionale, mai joined |
| `reminder_channels` | colonna **JSONB nullable** | campo runtime-only (appare in reminders.py, non nel model) |
| Anti double-booking | **EXCLUDE constraint** (btree_gist) + `tsrange` + `WHERE active` | l'unico vero vincolo "impossibile a livello DB" per slot di durata variabile |

## 1. Mappa collezioni Mongo → tabelle Postgres

Le 9 collezioni Mongo ([server.py](backend/server.py): 143 accessi, [seed.py](backend/seed.py): 10, [reminders.py](backend/reminders.py): 3) diventano 12 tabelle (9 base + `booking_tables` + `booking_status_history`). Tutti gli `id` sono UUID string (Pydantic `new_id()`), salvati in Mongo come stringa — in Postgres li teniamo `TEXT` (UUID nativo richiederebbe parse/cast ovunque nei 156 statement; i payload Pydantic emettono string). `created_at` in Mongo è ISO string; in Postgres `TIMESTAMPTZ` (default `now()`), e i model Pydantic già accettano datetime.

### 1.1 restaurants
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| name | TEXT | no | — |
| subdomain | TEXT | no | — |
| status | TEXT | no | `'active'` |
| address / phone / email / description / hero_image_url | TEXT | sì | NULL |
| theme_preset | TEXT | sì | NULL |
| accent_color | TEXT | no | `'#D97706'` |
| language | TEXT | no | `'it'` |
| currency | TEXT | no | `'EUR'` |
| timezone | TEXT | no | `'Europe/Rome'` |
| deposit_enabled | BOOL | no | FALSE |
| deposit_threshold_persons | INT | no | 8 |
| deposit_amount_per_person | NUMERIC(10,2) | no | 20.00 |
| avg_ticket_per_guest | NUMERIC(10,2) | no | 55.00 |
| reminder_enabled | BOOL | no | TRUE |
| reminder_lead_hours | INT | no | 24 |
| whatsapp_enabled | BOOL | no | FALSE |
| whatsapp_provider | TEXT | sì | NULL |
| whatsapp_from | TEXT | sì | NULL |
| whatsapp_twilio_sid / whatsapp_twilio_auth_token / whatsapp_meta_phone_id / whatsapp_meta_access_token | TEXT | sì | NULL |
| created_at | TIMESTAMPTZ | no | now() |

### 1.2 users
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| restaurant_id | TEXT FK→restaurants | sì (agency_admin) | NULL |
| name | TEXT | no | — |
| email | TEXT | no | — |
| password_hash | TEXT | no | — |
| role | TEXT | no | `'staff'` |
| created_at | TIMESTAMPTZ | no | now() |

### 1.3 areas
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| restaurant_id | TEXT FK | no | — |
| name | TEXT | no | — |
| priority | INT | no | 0 |

### 1.4 tables
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| restaurant_id | TEXT FK | no | — |
| area_id | TEXT FK→areas | no | — |
| name | TEXT | no | — |
| seats_min | INT | no | — |
| seats_max | INT | no | — |
| priority | INT | no | 0 |
| bookable_staff / bookable_online | BOOL | no | TRUE |
| internal_note | TEXT | sì | NULL |
| shape | TEXT | no | `'square'` |
| position_x / position_y | FLOAT | no | 0 |

### 1.5 opening_hours
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| restaurant_id | TEXT FK | no | — |
| weekday | INT | sì (specific_date x) | NULL |
| specific_date | TEXT `'YYYY-MM-DD'` | sì | NULL |
| open_time / close_time | TEXT `'HH:MM'` | no | — |
| title | TEXT | sì | NULL |
| service_type | TEXT | sì | NULL |
| slot_interval_minutes | INT | no | 15 |
| default_duration_minutes | INT | no | 120 |
| duration_rules | JSONB | no | `'[]'` |
| is_closed | BOOL | no | FALSE |
| requires_payment | BOOL | no | FALSE |
| payment_amount | NUMERIC(10,2) | no | 0.00 |

Vincolo applicativo (oggi in `create_opening_hour`): weekday XOR specific_date — lo tengo in app, optional CHECK `(weekday IS NOT NULL) <> (specific_date IS NOT NULL)` in DB (vantaggio gratis).

### 1.6 booking_limits
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| opening_hour_id | TEXT FK→opening_hours | no | — |
| max_bookings_total / max_guests_total / max_bookings_per_slot / max_guests_per_slot | INT | sì | NULL |

### 1.7 customers
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| restaurant_id | TEXT FK | no | — |
| name | TEXT | no | — |
| phone | TEXT | sì | NULL |
| email | TEXT | sì | NULL |
| tags | JSONB | no | `'[]'` |
| notes | TEXT | sì | NULL |
| bad_guest_flag | BOOL | no | FALSE |
| total_bookings / no_show_count / cancelled_count | INT | no | 0 |
| created_at | TIMESTAMPTZ | no | now() |

### 1.8 bookings
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| restaurant_id | TEXT FK | no | — |
| customer_id | TEXT FK→customers | no | — |
| date | TEXT `'YYYY-MM-DD'` | no | — |
| time | TEXT `'HH:MM'` | no | — |
| duration_minutes | INT | no | — |
| persons | INT | no | — |
| status | TEXT | no | `'pending'` |
| source | TEXT | no | `'online'` |
| guest_message / internal_note | TEXT | sì | NULL |
| deposit_required | BOOL | no | FALSE |
| deposit_amount | NUMERIC(10,2) | no | 0.00 |
| deposit_status / deposit_session_id | TEXT | sì | NULL |
| reminder_sent_at | TEXT | sì | NULL |
| cancel_token | TEXT | sì | NULL |
| cancel_token_expires_at | TIMESTAMPTZ | sì | NULL |
| created_at | TIMESTAMPTZ | no | now() |

Niente `table_ids`/`status_history` qui → tabelle sotto.

### 1.9 waitlist
| colonna | tipo | null | default |
|---|---|---|---|
| id | TEXT PK | — | — |
| restaurant_id | TEXT FK | no | — |
| date | TEXT | no | — |
| service | TEXT | sì | NULL |
| persons | INT | no | — |
| preferred_time | TEXT | sì | NULL |
| customer_id | TEXT FK (no FK constraint, può non esistere ancora) | sì | NULL |
| customer_name | TEXT | no | — |
| customer_email | TEXT | no | — |
| customer_phone | TEXT | no | — |
| message | TEXT | sì | NULL |
| status | TEXT | no | `'waiting'` |
| notified_at | TEXT | sì | NULL |
| created_at | TIMESTAMPTZ | no | now() |

Nota: date/time/cancel_token restano TEXT. Sono già stringhe in Mongo e in tutto il codice (Pydantic, availability hhmm_to_minutes); convertirli in DATE/TIME in Postgres costerebbe cast in ogni query dei 156 statement e NON dà vantaggio di funzionalità (nessuna funzione SQL su date nel codice). L'unica eccezione sono le colonne `start_ts`/`end_ts` in booking_tables (vedi §2) — necessarie SOLO per l'EXCLUDE constraint, calcolate all'insert.

### 1.10 booking_tables (nuova — tabella ponte)
| colonna | tipo | null |
|---|---|---|
| booking_id | TEXT FK→bookings | no |
| table_id | TEXT FK→tables | no |
| start_ts | TIMESTAMPTZ | no |
| end_ts | TIMESTAMPTZ | no |

Popolata all'insert del booking da una riga per element di `table_ids` (in pratica 1-2). `start_ts` = date+time ricostruito, `end_ts` = start + duration_minutes. Sorgente verità per il vincolo anti-overlap.

### 1.11 booking_status_history (nuova)
| colonna | tipo | null |
|---|---|---|
| id | BIGSERIAL | no |
| booking_id | TEXT FK | no |
| status | TEXT | no |
| at | TIMESTAMPTZ | no |
| by_user_id | TEXT | sì |

Map 1:1 da `StatusChange` (status, at, by_user_id). Append-only. L'ordine per API: ORDER BY `id` (serial = ordine di inserimento, non serve creare un timestamp artificiale).

## 2. Indici + vincolo anti double-booking

### Indici (equivalente a `_ensure_indexes` in server.py)
- restaurants: UNIQUE(subdomain), UNIQUE(id) (PK lo è già)
- users: UNIQUE(email), UNIQUE(id), INDEX(restaurant_id)
- areas: INDEX(restaurant_id) — optional FK
- tables: INDEX(restaurant_id), INDEX(area_id)
- opening_hours: INDEX(restaurant_id)
- booking_limits: INDEX(opening_hour_id)
- customers: UNIQUE(id), INDEX(restaurant_id), **UNIQUE(restaurant_id, LOWER(email)) WHERE email IS NOT NULL**, **UNIQUE(restaurant_id, phone) WHERE phone IS NOT NULL** (più sotto §2.1)
- bookings: INDEX(restaurant_id, date), INDEX(restaurant_id, customer_id), INDEX(deposit_session_id), INDEX(cancel_token)
- waitlist: INDEX(restaurant_id, date, status)
- booking_tables: EXCLUDE (sotto)
- booking_status_history: INDEX(booking_id)

### 2.1 Il vincolo anti double-booking (oggi race condition, L3 nell'audit)

Oggi: l'overlap è verificato in app (`find_available_tables` + `slot_within_limits`) leggendo i booking del giorno. Due richieste concorrenti possono entrambe passare la check e inserire — double-booking di fatto.

NOTA IMPORTANTE: per questo sistema la soluzione "UNIQUE su (table_id, date, time)" NON basta. Le durate variano (duration_rules per party size): tavolo occupato 19:30–21:00 e 20:30–22:30 hanno `time` diversi (19:30 vs 20:30) ma **overlap** — un UNIQUE semplice li lascerebbe passare.

Soluzione vera a livello DB: **EXCLUDE constraint con range** sulla tabella ponte.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE booking_tables (
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  table_id   TEXT NOT NULL REFERENCES tables(id),
  start_ts   TIMESTAMPTZ NOT NULL,
  end_ts     TIMESTAMPTZ NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE booking_tables
  ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (table_id WITH =, tsrange(start_ts, end_ts) WITH &&)
  WHERE (active);
```

Cosa fa:
- `table_id WITH =` + `tsrange(start, end) WITH &&` = non possono esistere due righe dello stesso tavolo con intervalli che si sovrappongono.
- `WHERE (active)` = il constraint vale solo per booking attivi. Quando un booking diventa `cancelled`/`declined`/`no_show`, il backend fa `UPDATE booking_tables SET active = false` per le sue righe → il tavolo si libera e il vincolo non lo blocca.
- `btree_gist` = estensione standard disponibile su Supabase.

Race condition eliminata: due INSERT concorrenti sullo stesso `(table_id, tsrange)` → il secondo fallisce con `conflicting key value violates exclusion constraint no_double_booking`. Diventa **impossibile a livello DB**.

Comportamento atteso da gestire in Fase 2:
- `INSERT` su booking_tables fallisce con l'errore EXCLUDE → backend mapper l'errore a 409 "Nessun tavolo disponibile per questo slot" invece di un 500. Pattern: try/except su `asyncpg.UniqueViolationError`/`psycopg errors.ExclusionViolation`.
- Lo "stato attivo" va sincronizzato: in `change_status`/`update_booking`/`delete_booking`/`public cancel`, oltre a aggiornare `bookings.status`, fare `UPDATE booking_tables SET active = false WHERE booking_id = $1` quando il nuovo status ∉ active.

### 2.2 UNIQUE su customer email/phone (per _find_or_create_customer)

Oggi `_find_or_create_customer` fa `$or [email, phone]` + insert con più richieste → race quando due prenotano con stessa email. In Postgres:
- UNIQUE parziale `(restaurant_id, LOWER(email)) WHERE email IS NOT NULL` — identità per email (case-insensitive, coerente col login che fa `.lower()`).
- UNIQUE parziale `(restaurant_id, phone) WHERE phone IS NOT NULL` — identità per numero (già normalizzato da `_normalize_phone`).
- Il write diventa: `INSERT ... ON CONFLICT (restaurant_id, LOWER(email)) DO NOTHING RETURNING *` → se vuoto, fallback `SELECT ... WHERE restaurant_id AND (email OR phone)`. In una transazione. Race-safe.

## 3. Strutture annidate Mongo → mapping scelto

| Campo | Oggi (Mongo) | Scelta Postgres | Motivazione |
|---|---|---|---|
| `Table.position` | `{x, y}` embedded | **2 colonne** `position_x`, `position_y` | 2 float sempre presenti, mai null, floorplan scrive intero. Colonna è più coatta e leggibile di un JSONB a 2 campi |
| `Booking.table_ids` | `List[str]` | **tabella ponte** `booking_tables` | (a) l'EXCLUDE anti-overlap deve stare a livello riga, (b) query "quale booking occupa tavolo X" = JOIN naturale, (c) FK a tables per integrità |
| `Booking.status_history` | `List[StatusChange]` | **tabella** `booking_status_history` | append-only, va in parallelo al `$set` status (in Mongo sono 2 op; in PG insert unico nella stessa tx). Audit immutabile. Read per output API |
| `OpeningHour.duration_rules` | `List[DurationRule]` (1-4 elem) | **JSONB** | sempre letto intero, sostituito intero (PATCH), mai cercato per singolo elemento → tabelle separate = zero benefici |
| `Customer.tags` | `List[str]` | **JSONB array** | non relazionale, nested, senza vincoli. JSONB cost minimo |
| `reminder_channels` | campo runtime ($set in reminders.py, NON nel model) | colonna **JSONB nullable** | oggi vive solo nello storage. Per compatibilità con PATCH (che usa model_dump), la tratto come colonna opzionale ignorata dai model Pydantic |

## 4. Query attuali → JOIN / problematiche

**admin_metrics**: oggi è GIÀ una singola pipeline `$lookup` (non più N+1 — era stato ottimizzato). In Postgres: una query sola — `SELECT r.id, r.name, ..., COALESCE(b.total,0) ... FROM restaurants r LEFT JOIN (SELECT restaurant_id, COUNT(*), SUM(CASE WHEN date>=? THEN 1 ELSE 0 END), ... FROM bookings GROUP BY restaurant_id) b ON b.restaurant_id=r.id` + subquery count customers. Zero bisogno di N+1.

**admin_list_restaurants**: oggi 2 query (restaurants + users aggregate). In PG: `LEFT JOIN users GROUP BY restaurant_id` per `user_count`, una query.

**list_booking_limits**: oggi 2 query (openings + limits $in). In PG: 1 JOIN `booking_limits b LEFT JOIN opening_hours o ON ...` e `day_of_week`/`service_type` copiate. Nota bug latente emergente: `oh.get("day_of_week")` non esiste nel model (è `weekday`) → nel PG fix con `o.weekday` (mapping corretto; il frontend legge `day_of_week`? verificare Fase 2 — oggi ritorna NULL).

**reminders.py**: oggi N+1 (per ogni booking → `find_one` customer). In PG: una `JOIN bookings b LEFT JOIN customers c` — 1 query invece di N+1.

**_recompute_customer_metrics**: oggi fetch di TUTTI i booking del customer + conteggio in Python. In PG: `SELECT status, COUNT(*) FROM bookings WHERE customer_id=$1 GROUP BY status` — 1 query.

**_find_or_create_customer**: race-safe con ON CONFLICT (vedi §2.2).

**delete_area**: `count_documents` tavoli → `SELECT COUNT(*) FROM tables WHERE area_id=$1`. Pulito.

**create_booking_staff / public_create_booking**: più letture per validazione (ohs, tables, customers, existing bookings, limits) + insert. In PG le letture restano (o si possono unire: existing bookings+occupancy in una query con EXCLUDE che fa la validazione da solo). Il grosso: l'INSERT finale con le righe booking_tables fallisce con ExclusionViolation se c'è stato un race → mappare a 409.

**reports_home / reports_summary**: oggi fetch range largo + aggregazione in Python. In PG ottimizzabile con `GROUP BY date, status` sulle stesse query WHERE restaurant/date-range — unica query per il per_day; il resto (last7, week/month buckets) resta Python sullo stesso dataset come oggi. Il calcolo settlements non cambia.

**list_customers** con search `$regex`: i tre OR email/phone/name → in PG `WHERE (name ILIKE '%x%' OR email ILIKE '%x%' OR phone ILIKE '%x%')`. ILIKE = case-insensitive, stesso comportamento di `$regex i`.

**Queries rimanenti (CRUD base)**: `find_one({id})`/`find({restaurant_id})`/`insert_one`/`update_one $set`/`delete_one` → `SELECT * FROM t WHERE id=$1`, `SELECT ... WHERE restaurant_id=$1`, `INSERT`, `UPDATE ... SET ... WHERE id=$1`, `DELETE`. Meccaniche, ~130 statement.

**Nessuna query è intrinsecamente problematica**: il set è piccolo (per-ristorante, poche migliaia di righe). Le uniche "follie" erano N+1 in reminders e admin_metrics — entrambi risolti sopra.

## 5. Scelta libreria data access

Proposte: asyncpg, SQLModel/SQLAlchemy async, psycopg[async].

| | asyncpg | SQLModel/SQLAlchemy | **psycopg[async] (psycopg3)** |
|---|---|---|---|
| **Windows** | ❌ NON supportato | ✅ (via asyncpg o psycopg3) | ✅ nativo |
| Match col codice attuale (dict-driven) | ✅ | ❌ (ORMs mappano oggetti, servirebbe 2° schema) | ✅ (riga → dict via Row factory) |
| Overhead | minimo | medio-alto (ORM mapping, session) | minimo |
| Feature Postgres | completa | completa (via driver) | completa |
| Pooling | integrato (`create_pool`) | via engine | `AsyncConnectionPool` integrato |
| Errori tipizzati per EXCLUDE | `UniqueViolationError` | mapping più indiretto | `errors.ExclusionViolation` |
| Curve in questo progetto | da imparare | da imparare + doppio modello Pydantic/SQLModel | **zero** — SQL puro, Pydantic resta unica source of truth |

Decisione: **psycopg[async] (psycopg3) puro**. Motivi principali, in ordine:
1. Sono richiesto Windows-compat → asyncpg eliminato.
2. Il progetto è interamente dict-driven: `_serialize`, `NO_ID`, i model Pydantic fanno da schema e validazione. Psycopg3 row factory → dict = stesso idiom. Con SQLModel/SQLAlchemy dovremmo replicare TUTTI i 12 modelli in classi ORM → doppio schema, drift, e il codice attuale (che accetta dict) andrebbe riscritto per oggetti.
3. I query set sono CRUD semplici: ORM non offre niente che SQL diretto non abbia.
4. Gestione pulita del vincolo EXCLUDE (solleva `psycopg.errors.ExclusionViolation` → 409).

Nota psycopg vs asyncpg: entrambi veloci. La differenza decisiva è solo Windows (asyncpg non supporta) e il pattern (psycopg va a pennello col dict-style).

## 6. Strategia di migrazione dati

CONFERMATA la premessa: **DB demo ri-seedato da zero**. Nessun dato reale da preservare (Mongo Atlas M0 è temporaneo, Test 1). In Fase 2:

1. Nuovo `schema.sql` (CREATE TABLE + indici + EXCLUDE) applicato su Supabase.
2. `seed.py` riscritto: stessi dati demo (ristorante "demo", 2 user, 3 area, 11 tavoli, opening_hours, 4 customer, 6 booking, agency_admin da env) ma con INSERT Postgres — stessi valori, quindi stessa identità col Test 1. Popola anche `booking_tables` (active=true? sì, i sample hanno status accepted/pending/seated) e `booking_status_history`.
3. Nessuno script di migrate binario dati: drop/recreate DB o nuova tabella vuota → seed.

Il consentito: `SEED_ENABLED=true` in dev/test su Supabase; `false` in prod (stessa semantica attuale).

## 7. Cosa NON tocco (elenco esplicito)

1. **auth.py** (JWT, bcrypt, `hash_password`/`verify_password`, `create_access_token`, `get_current_user`, `require_agency_admin`, ruoli owner/staff/agency_admin) — identico, dipende solo da Pydantic + libs.
2. **Logica portale agenzia** (rotte `/admin/*`) — stesse regole, solo query sotto.
3. **Endpoint pubblici** (`/public/restaurant/{sub}`, `/public/{sub}/availability/*`, `/public/{sub}/book`, `/public/{sub}/waitlist`, `/cancel/{token}`, `/config/public`) — firme, request/response identici.
4. **Tutti gli schemi Pydantic `models.py`** — non si toccano (restano la verità). Tranne le aggiunte di mapping a livello query (mai campi pubblici).
5. **Frontend** — zero modifiche. Nessun endpoint cambia signature.
6. **email_service.py, whatsapp_service.py, payments.py** — invocano API esterne, non toccano DB; restano.
7. **availability.py** — logica pura, input dict/opening_hour, nessun DB direct; resta.
8. **Rate limiting, CORS, startup/shutdown** — logica invariata.

Solo `server.py` (data access), `seed.py`, `reminders.py` vengono riscritti nel layer DB, più nuovo `db.py` (pool psycopg + helpers `fetch_one`/`fetch_all`/`execute` che restituiscono dict).

## 8. Stima dimensione FASE 2

**~156 statement DB da riscrivere** (server.py 143, seed.py 10, reminders.py 3), concentrati in:
- **~45 endpoint** server.py (CRUD aree, tavoli, orari, limits, customers, bookings, admin, reports, waitlist, public)
- **~15 query nei 2 "+2 inclusive"** helper `_get_restaurant*`, `_get_bookings_for_date/range`, `_find_or_create_customer`, `_recompute_customer_metrics`, `_slot_has_availability`
- **2 aggregation** (admin_metrics → 1 query SQL; reports → GROUP BY)
- **1 N+1 fix obbligatorio** (reminders)
- **1 task delicato**: vincolo EXCLUDE + suo error-mapping + sync `active` su status change
- **1 nuovo file**: `db.py`

Il 90% è meccanico (find_one→SELECT, insert_one→INSERT). Il 10% con attenzione: EXCLUDE, ON CONFLICT customer, aggregation, error mapping dei 409. Tempo stimato full-time: **1.5-2 giornate**, committabile in ~8-12 commit piccoli (uno per sezione di endpoint).

File toccati: `db.py` (nuovo), `schema.sql` (nuovo), `server.py`, `seed.py`, `reminders.py`, `requirements.txt` (motor → psycopg[binary,pool]).