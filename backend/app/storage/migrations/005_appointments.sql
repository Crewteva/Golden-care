-- Appointments: one visit of one patient with one doctor, possibly several services back to back.
-- The database itself refuses two active appointments for the same doctor or the same room at
-- overlapping times (squeeze-ins approved with a reason are the only exception).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Clinic-wide rules that Management can change (key → JSON value).
CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users (id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES
  ('booking.slot_step_min', '15'),
  ('booking.late_after_min', '15'),
  ('booking.portal_enabled', 'true'),
  ('booking.portal_needs_confirmation', 'false'),
  ('booking.portal_cancel_hours', '12'),
  ('booking.portal_days_ahead', '30'),
  ('booking.portal_max_upcoming', '3');

CREATE SEQUENCE appointments_ref_seq START 1;

CREATE TABLE appointments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                text NOT NULL UNIQUE DEFAULT ('AP-' || lpad(nextval('appointments_ref_seq')::text, 6, '0')),
  patient_id         uuid NOT NULL REFERENCES patients (id),
  doctor_id          uuid NOT NULL REFERENCES users (id),
  branch_id          int NOT NULL REFERENCES branches (id),
  room_id            int REFERENCES rooms (id) ON DELETE SET NULL,
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'booked'
                     CHECK (status IN ('requested', 'booked', 'confirmed', 'arrived', 'in_room', 'completed', 'cancelled', 'no_show')),
  source             text NOT NULL DEFAULT 'walk_in'
                     CHECK (source IN ('walk_in', 'phone', 'whatsapp', 'social', 'website', 'portal', 'other')),
  notes              text,
  overbooked         boolean NOT NULL DEFAULT false,
  overbook_reason    text,
  estimated_price    numeric(12, 2),
  queue_no           int,
  arrived_at         timestamptz,
  in_room_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  cancelled_by_kind  text CHECK (cancelled_by_kind IN ('patient', 'clinic')),
  booked_by          uuid REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (NOT overbooked OR overbook_reason IS NOT NULL),
  CONSTRAINT appointments_no_doctor_overlap EXCLUDE USING gist (
    doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show') AND NOT overbooked),
  CONSTRAINT appointments_no_room_overlap EXCLUDE USING gist (
    room_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (room_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show') AND NOT overbooked)
);
CREATE INDEX appointments_day_idx ON appointments (starts_at);
CREATE INDEX appointments_doctor_idx ON appointments (doctor_id, starts_at);
CREATE INDEX appointments_patient_idx ON appointments (patient_id, starts_at DESC);

-- The services of the visit, in order, with the duration and price at booking time.
CREATE TABLE appointment_services (
  appointment_id  uuid NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  position        smallint NOT NULL,
  service_id      int NOT NULL REFERENCES services (id),
  duration_min    int NOT NULL,
  price           numeric(12, 2),
  PRIMARY KEY (appointment_id, position)
);
CREATE INDEX appointment_services_service_idx ON appointment_services (service_id);

-- Everything that happened to an appointment (booked, confirmed, arrived, moved, cancelled...).
CREATE TABLE appointment_events (
  id              bigserial PRIMARY KEY,
  appointment_id  uuid NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid REFERENCES users (id),
  actor_label     text,
  action          text NOT NULL,
  from_status     text,
  to_status       text,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX appointment_events_appt_idx ON appointment_events (appointment_id, at);
