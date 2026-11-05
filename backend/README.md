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
                     Arabic name / Egyptian phone cleanup, rate limits, error format
  users/<role>/      one folder per role with that role's APIs (routes.py, service.py, schemas.py)
                     admin, owner, director, medical_director, reception, patient_relations, doctor,
                     nurse, cashier, accountant, hr, inventory, marketing, auditor, patient
tests/               unit tests (pytest)
```

Each role's API lives at `/api/<role>` (underscores become dashes, e.g. `/api/medical-director`).
`core.workspace.role_router("doctor")` builds a router that refuses anyone not working as a doctor;
endpoints can additionally require a permission with `require_permission("users.manage")`.

## Rules built in

- Sessions are server-side; the browser only holds an httpOnly cookie. Staff sessions end after
  12 h or 60 min idle; patients stay signed in 7 days.
- 2-step verification (authenticator app) is enforced for roles marked `requires_mfa`
  (admin, owner, director, medical director, accountant, HR, auditor by default — editable by the admin).
- 5 wrong passwords lock the account for 15 minutes. Every sign-in and account change goes to
  `audit_log`, which the database refuses to update or delete.
- Staff accounts are created only by the admin, with a temporary password that must be changed.
  Patients register themselves.
- Mutating requests must carry `X-Requested-With: GoldenCare` (CSRF protection).

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

## Run locally without Docker

```bash
pip install -r requirements.txt
DATABASE_URL=postgresql://user:pass@localhost:5432/goldencare COOKIE_SECURE=false SEED_DEMO=true \
  uvicorn app.main:app --reload --port 8000
pip install pytest && pytest -q        # unit tests
```
