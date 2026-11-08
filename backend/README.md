# Golden Care OS — Backend (Python · FastAPI · PostgreSQL)

## Layout

```
app/
  main.py            starts the API: database pool, migrations, starting data, /api routes
  config.py          settings from environment variables
  routes/            the frontend connection: mounts every API under /api
  storage/           database: connection (db.py), migrate.py, migrations/*.sql, seed.py
  auth/              login for everyone: login, logout, me, 2-step verification, passwords, role choice
  core/              shared tools: sessions & permissions, password/TOTP security, activity log,
                     Arabic name / Egyptian phone cleanup, rate limits, error format, and the
                     patient file shared by several roles:
                       patients.py      search, duplicate detection, create/edit, alerts, family, portal access
                       files.py         private document storage, review & release to the patient
                       national_id.py   Egyptian national ID → birth date, sex, governorate
                       patients_api.py  /patients endpoints that each patient-facing role mounts
                     and the clinic setup:
                       catalog.py       specialties, services, prices (start dates, per-doctor), room types, rooms
                       schedules.py     doctor profiles & services, weekly hours, leave, holidays, week view
                       settings_api.py  /settings endpoints mounted by the roles that see or manage the setup
                     and appointments:
                       clinic_time.py      clinic clock (Africa/Cairo): today, local times
                       app_settings.py     booking rules (slot step, late after, online booking & cancel window)
                       slots.py            free times from weekly hours − leave − holidays − bookings; room choice
                       appointments.py     book (several services), squeeze-in, reschedule, confirm, arrive
                                           (queue number), call in, finish, cancel, no-show, day/week views
                       appointments_api.py /appointments endpoints mounted by the roles that see the schedule
                     and the doctor's work:
                       visits.py           visit note, diagnoses, prescription (allergy / restricted checks), sign
                                           (locks it), addenda, release to the patient, vital signs, follow-ups
                       clinical_lists.py   the drug list and the diagnosis list (medical director)
                       visits_api.py       /visits endpoints mounted by doctor, nurse, medical director, reception
                       laser.py            laser devices and session records (checklist, areas, pulse counter, sign)
                       dental.py           FDI tooth chart, treatment plans (quotation, acceptance, installments,
                                           work done → ready to bill), dental labs and lab cases
                       complaints.py       the complaints & requests desk (assign, deadline by priority, resolve)
                       laser_api.py, dental_api.py, complaints_api.py   the matching endpoints
                     and billing (requirement 5, part A):
                       billing.py          invoices: draft from a visit or from scratch, lines (service, package
                                           sale, package session, plan item), server prices, VAT, discount limit,
                                           issue (numbered, locked), installments, void, approvals, doctor shares
                       payments.py         cashier shifts (open / expected cash / close with difference), receipts
                                           with split methods, patient credit, refunds
                       billing_setup.py    packages, doctor share rules, billing rules (discount limit, installments)
                       billing_schemas.py  request models
                       billing_api.py      /billing endpoints mounted by cashier, reception, management, accountant,
                                           auditor (what each may do comes from billing.* permissions)
  users/<role>/      one folder per role with that role's APIs (routes.py, service.py, schemas.py)
                     admin, management (owner / general manager), medical_director, reception,
                     patient_relations, doctor, nurse, cashier, accountant, hr, inventory, marketing,
                     auditor, patient
tests/               unit tests (pytest)
tests/e2e/           end-to-end checks against the running system, e.g.
                     python tests/e2e/appointments_e2e.py http://web:3000 <demo password>
                     python tests/e2e/visits_e2e.py http://web:3000 <demo password>
                     python tests/e2e/dental_laser_e2e.py http://web:3000 <demo password>
                     python tests/e2e/billing_e2e.py http://web:3000 <demo password>
```

Each role's API lives at `/api/<role>` (underscores become dashes, e.g. `/api/medical-director`).
`core.workspace.role_router("doctor")` builds a router that refuses anyone not working as a doctor;
endpoints can additionally require a permission with `require_permission("users.manage")`.

Patient files: reception, doctor, nurse, medical director and patient relations each mount
`core/patients_api.py` (e.g. `/api/reception/patients`, `/api/doctor/patients`). What each role may do
there comes from its permissions (`patients.*`, `patient_files.*`), editable in the admin's
Roles & permissions page; defaults are in `storage/seed.py` (`PERMISSION_DEFAULTS`).

## Rules built in

- Sessions are server-side; the browser only holds an httpOnly cookie. Staff sessions end after
  12 h or 60 min idle; patients stay signed in 7 days.
- 2-step verification (authenticator app) is enforced for roles marked `requires_mfa`
  (admin, management, medical director, accountant, HR, auditor by default — editable by the admin).
- 5 wrong passwords lock the account for 15 minutes. Every sign-in and account change goes to
  `audit_log`, which the database refuses to update or delete.
- Staff accounts are created only by the admin, with a temporary password that must be changed.
  Patients register themselves.
- Mutating requests must carry `X-Requested-With: GoldenCare` (CSRF protection).
- One patient file per person, shared by all branches. A national ID can't be used twice; a mobile can
  only be shared by linked family members; similar name + birth date needs a written reason.
- Patient documents live in the private `patient-files` volume (only the backend mounts it), are checked
  by content (PDF/JPG/PNG, 15 MB), and every opening is logged. Patients see results only after a doctor
  releases them with a plain-language note; signed consents are always visible to them.
- Doctors only see the files of patients who have an appointment with them.
- A doctor or a room can never be double-booked: PostgreSQL exclusion constraints refuse overlapping
  active appointments, even when two receptionists book the same minute. The only exception is a
  squeeze-in, which needs the `appointments.overbook` permission and a written reason.
- Every appointment change (booked, rescheduled, arrived, cancelled…) is kept in `appointment_events`.
- Patients book online within the rules Management sets (how far ahead, how many upcoming visits,
  optional confirmation by reception) and can cancel online up to 12 hours before (editable).
- A visit opens when the doctor calls the patient in. Only its doctor writes it; other doctors see that it
  exists, not what is in it; the medical director reads every visit (each reading is logged).
- Signing locks the visit in the database itself (trigger `visits_lock`): the note, diagnoses and prescription
  can never change again; corrections are addenda, which are append-only too. Vital signs are append-only.
- A drug matching one of the patient's allergy alerts, or a restricted medicine, is only kept with a written
  reason; both are recorded in the activity log when the visit is signed.
- Patients see a visit only after the doctor releases it, and then only the plain-language summary and the
  prescription — never the medical note.
- A laser session is signed only with every safety question answered, a signed consent, and a written reason
  for any "stop" answer. The device counter before/after must equal the recorded pulses (+ test pulses), or the
  difference is explained; signing locks the record and moves the device counter forward.
- The tooth chart is a history (append-only; a wrong entry is voided with a reason). Plan prices come from the
  price list and are frozen by the database once quoted; an expired quotation can't be accepted. Work marked done
  becomes "ready to bill" for billing (requirement 5); installments are scheduled, payments come with billing.
- Complaints get a response deadline from their priority (urgent 4 h, high 24 h, normal 48 h, low 72 h); their
  history is append-only. Patients see the status and the resolution, never internal comments.
- Invoice prices come from the price list on the server. Once issued, an invoice is numbered (`INV-…`) and locked
  by the database (trigger `invoices_lock`); a mistake is fixed by voiding it with a reason and a manager's
  approval, and what was paid goes to the patient's credit. Receipts, credit movements and closed shifts are
  append-only too.
- A discount needs a reason; above the limit in Billing rules (10% by default) it waits for a manager. Voids and
  refunds always do. Every decision is in the activity log.
- Payments are only taken in the cashier's open shift; card, InstaPay and wallet need a reference. Overpayment
  goes to credit; refunds come out of credit only. Closing a shift with a cash difference needs a reason.
- A package sale creates the patient's package; later visits for that service use a session at 0 EGP. A package
  that was sold can't be deleted (only switched off), and a sale can't be voided once a session was used.
- Doctor shares (percent or fixed, optionally after the service's direct cost) are stored per line when issued
  and only returned to management, never to the cashier or the patient.
- Not built yet: Paymob online payment and Tax Authority e-receipts (invoices carry an `eta_status` column for later).

## Database changes

Add a new numbered file in `app/storage/migrations/` (e.g. `002_patients_files.sql`). It is applied
automatically at startup. Never edit a file that has already been applied.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | set in compose.yaml | PostgreSQL connection |
| `POSTGRES_PASSWORD` | `goldencare` | **set a strong value in production** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@goldencare.local` / generated | first admin, created only when there is no staff yet; the generated password is printed in the backend log |
| `SEED_DEMO` | `true` in compose | synthetic demo accounts (one per role); **turn off for real data** |
| `DEMO_PASSWORD` | generated, printed in the log | password for all demo accounts |
| `COOKIE_SECURE` | `true` | set `false` only for local http development |
| `STAFF_SESSION_HOURS`, `STAFF_IDLE_MINUTES`, `PATIENT_SESSION_DAYS` | 12, 60, 7 | session lifetimes |
| `APP_TIMEZONE` | `Africa/Cairo` | |
| `API_DOCS` | `false` | `true` serves interactive docs at `/api/docs` |
| `FILES_DIR` / `MAX_UPLOAD_MB` | `/data/files` / 15 | private document storage and upload limit |

## Run locally without Docker

```bash
pip install -r requirements.txt
DATABASE_URL=postgresql://user:pass@localhost:5432/goldencare COOKIE_SECURE=false SEED_DEMO=true \
  uvicorn app.main:app --reload --port 8000
pip install pytest && pytest -q        # unit tests
```
