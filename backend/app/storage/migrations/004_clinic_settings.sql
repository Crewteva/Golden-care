-- Clinic setup: specialties, services, prices with start dates, room types, rooms,
-- doctor profiles and services, weekly schedules, doctor leave, holidays, branch contact details.
-- Everything here can be added, edited and deleted while the clinic shapes its setup;
-- once appointments and invoices use a row, the database refuses the delete (archive it instead).

ALTER TABLE branches
  ADD COLUMN whatsapp  text,
  ADD COLUMN email     text,
  ADD COLUMN hours_ar  text,
  ADD COLUMN hours_en  text;

CREATE TABLE specialties (
  id          serial PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  color       text NOT NULL DEFAULT '#1A433C' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_types (
  id          serial PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id            serial PRIMARY KEY,
  specialty_id  int NOT NULL REFERENCES specialties (id),
  code          text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  name_ar       text NOT NULL,
  name_en       text NOT NULL,
  duration_min  int NOT NULL CHECK (duration_min BETWEEN 5 AND 480),
  room_type_id  int REFERENCES room_types (id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX services_specialty_idx ON services (specialty_id);

-- doctor_id NULL = the standard price; a row with a doctor overrides it for that doctor.
-- The price in force on a day is the latest row whose starts_on is on or before that day.
CREATE TABLE service_prices (
  id          serial PRIMARY KEY,
  service_id  int NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  doctor_id   uuid REFERENCES users (id),
  amount      numeric(12, 2) NOT NULL CHECK (amount >= 0 AND amount <= 1000000),
  starts_on   date NOT NULL,
  note        text,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (service_id, doctor_id, starts_on)
);
CREATE INDEX service_prices_lookup_idx ON service_prices (service_id, doctor_id, starts_on DESC);

CREATE TABLE rooms (
  id            serial PRIMARY KEY,
  branch_id     int NOT NULL REFERENCES branches (id),
  room_type_id  int REFERENCES room_types (id) ON DELETE SET NULL,
  name_ar       text NOT NULL,
  name_en       text NOT NULL,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doctor_profiles (
  user_id       uuid PRIMARY KEY REFERENCES users (id),
  specialty_id  int REFERENCES specialties (id) ON DELETE SET NULL,
  title_ar      text,
  title_en      text,
  color         text CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_by    uuid REFERENCES users (id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doctor_services (
  doctor_id   uuid NOT NULL REFERENCES users (id),
  service_id  int NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, service_id)
);

-- weekday: 0 = Sunday … 6 = Saturday. valid_to NULL = until further notice.
CREATE TABLE doctor_schedules (
  id          serial PRIMARY KEY,
  doctor_id   uuid NOT NULL REFERENCES users (id),
  branch_id   int NOT NULL REFERENCES branches (id),
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  room_id     int REFERENCES rooms (id) ON DELETE SET NULL,
  valid_from  date NOT NULL DEFAULT current_date,
  valid_to    date,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX doctor_schedules_doctor_idx ON doctor_schedules (doctor_id, weekday);

CREATE TABLE doctor_leave (
  id          serial PRIMARY KEY,
  doctor_id   uuid NOT NULL REFERENCES users (id),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  reason      text,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX doctor_leave_doctor_idx ON doctor_leave (doctor_id, starts_on);

-- branch_id NULL = every branch.
CREATE TABLE holidays (
  id          serial PRIMARY KEY,
  branch_id   int REFERENCES branches (id),
  on_date     date NOT NULL,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (branch_id, on_date)
);
