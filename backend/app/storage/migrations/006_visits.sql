-- Doctor's work, part A: the visit record, vitals, prescriptions, addenda and what the patient sees.
-- A signed visit is locked by the database itself: its medical content can never change again,
-- corrections are added as addenda (which can't be changed either).

-- Starter lists the medical director edits: diagnoses and drugs.
CREATE TABLE diagnoses (
  id            serial PRIMARY KEY,
  specialty_id  int REFERENCES specialties (id) ON DELETE SET NULL,
  code          text,                       -- optional ICD-10 code, e.g. L70.0
  name_ar       text NOT NULL,
  name_en       text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name_en)
);

CREATE TABLE drugs (
  id                 serial PRIMARY KEY,
  name               text NOT NULL,          -- brand name as written on the box, e.g. Augmentin 1 g
  generic_name       text NOT NULL,          -- active ingredient(s)
  form               text NOT NULL CHECK (form IN ('tablet', 'capsule', 'syrup', 'suspension', 'drops', 'cream', 'gel',
                                                   'ointment', 'lotion', 'solution', 'shampoo', 'spray', 'mouthwash',
                                                   'injection', 'vaginal', 'sachet', 'other')),
  strength           text,
  default_dose       text,
  default_frequency  text,
  default_duration   text,
  restricted         boolean NOT NULL DEFAULT false,   -- controlled / special-programme medicines
  allergy_tags       text[] NOT NULL DEFAULT '{}',     -- words matched against the patient's allergy alerts
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE SEQUENCE visits_ref_seq START 1;

-- One visit per appointment, written by the treating doctor.
CREATE TABLE visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text NOT NULL UNIQUE DEFAULT ('VS-' || lpad(nextval('visits_ref_seq')::text, 6, '0')),
  appointment_id  uuid UNIQUE REFERENCES appointments (id),
  patient_id      uuid NOT NULL REFERENCES patients (id),
  doctor_id       uuid NOT NULL REFERENCES users (id),
  branch_id       int REFERENCES branches (id),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed')),
  complaint       text,
  history         text,
  examination     text,
  diagnoses       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{diagnosis_id, code, name_ar, name_en, text}]
  plan            text,
  follow_up_days  int CHECK (follow_up_days BETWEEN 1 AND 365),
  follow_up_note  text,                                 -- for reception, e.g. "bring the lab results"
  patient_summary text,                                 -- the only text the patient ever sees
  started_at      timestamptz NOT NULL DEFAULT now(),
  signed_at       timestamptz,
  released_at     timestamptz,
  released_by     uuid REFERENCES users (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR signed_at IS NOT NULL),
  CHECK (released_at IS NULL OR status = 'signed')
);
CREATE INDEX visits_patient_idx ON visits (patient_id, started_at DESC);
CREATE INDEX visits_doctor_idx ON visits (doctor_id, started_at DESC);

CREATE FUNCTION visits_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signed' THEN
      RAISE EXCEPTION 'visit_locked: a signed visit cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'signed' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
    OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
    OR NEW.complaint IS DISTINCT FROM OLD.complaint OR NEW.history IS DISTINCT FROM OLD.history
    OR NEW.examination IS DISTINCT FROM OLD.examination OR NEW.diagnoses IS DISTINCT FROM OLD.diagnoses
    OR NEW.plan IS DISTINCT FROM OLD.plan OR NEW.follow_up_days IS DISTINCT FROM OLD.follow_up_days
    OR NEW.follow_up_note IS DISTINCT FROM OLD.follow_up_note OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
  ) THEN
    RAISE EXCEPTION 'visit_locked: a signed visit cannot be changed; add an addendum';
  END IF;
  IF OLD.released_at IS NOT NULL AND (
       NEW.patient_summary IS DISTINCT FROM OLD.patient_summary OR NEW.released_at IS DISTINCT FROM OLD.released_at
  ) THEN
    RAISE EXCEPTION 'visit_locked: what the patient sees cannot change after release';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER visits_lock BEFORE UPDATE OR DELETE ON visits FOR EACH ROW EXECUTE FUNCTION visits_lock();

-- The prescription of a visit: one line per drug, copied from the drug list at the time of writing.
CREATE TABLE visit_rx_items (
  id                    bigserial PRIMARY KEY,
  visit_id              uuid NOT NULL REFERENCES visits (id),
  position              smallint NOT NULL,
  drug_id               int REFERENCES drugs (id) ON DELETE SET NULL,
  drug_name             text NOT NULL,
  generic_name          text,
  form                  text,
  strength              text,
  dose                  text NOT NULL,
  frequency             text NOT NULL,
  duration              text NOT NULL,
  instructions          text,
  restricted            boolean NOT NULL DEFAULT false,
  restricted_reason     text,
  allergy_alert         text,      -- the allergy alert the doctor confirmed past, if any
  allergy_reason        text,
  UNIQUE (visit_id, position),
  CHECK (NOT restricted OR restricted_reason IS NOT NULL),
  CHECK (allergy_alert IS NULL OR allergy_reason IS NOT NULL)
);

CREATE FUNCTION visit_rx_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM visits WHERE id = COALESCE(NEW.visit_id, OLD.visit_id);
  IF v_status = 'signed' THEN
    RAISE EXCEPTION 'visit_locked: the prescription of a signed visit cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER visit_rx_lock BEFORE INSERT OR UPDATE OR DELETE ON visit_rx_items FOR EACH ROW EXECUTE FUNCTION visit_rx_lock();

-- Rows that are written once and never changed (addenda, vitals).
CREATE FUNCTION append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;

-- Dated corrections under a signed visit. The original note never changes.
CREATE TABLE visit_addenda (
  id          bigserial PRIMARY KEY,
  visit_id    uuid NOT NULL REFERENCES visits (id),
  author_id   uuid NOT NULL REFERENCES users (id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visit_addenda_visit_idx ON visit_addenda (visit_id, created_at);
CREATE TRIGGER visit_addenda_append_only BEFORE UPDATE OR DELETE ON visit_addenda FOR EACH ROW EXECUTE FUNCTION append_only();

-- Vital signs, usually taken by the nurse when the patient arrives. A mistake is corrected by recording again.
CREATE TABLE vitals (
  id               bigserial PRIMARY KEY,
  patient_id       uuid NOT NULL REFERENCES patients (id),
  appointment_id   uuid REFERENCES appointments (id),
  recorded_by      uuid NOT NULL REFERENCES users (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  bp_systolic      smallint CHECK (bp_systolic BETWEEN 50 AND 260),
  bp_diastolic     smallint CHECK (bp_diastolic BETWEEN 30 AND 160),
  pulse            smallint CHECK (pulse BETWEEN 25 AND 250),
  temperature      numeric(4, 1) CHECK (temperature BETWEEN 33 AND 43),
  resp_rate        smallint CHECK (resp_rate BETWEEN 5 AND 60),
  spo2             smallint CHECK (spo2 BETWEEN 50 AND 100),
  weight_kg        numeric(5, 1) CHECK (weight_kg BETWEEN 0.5 AND 350),
  height_cm        numeric(5, 1) CHECK (height_cm BETWEEN 30 AND 250),
  note             text,
  CHECK ((bp_systolic IS NULL) = (bp_diastolic IS NULL)),
  CHECK (COALESCE(bp_systolic, pulse, temperature, resp_rate, spo2, weight_kg, height_cm) IS NOT NULL)
);
CREATE INDEX vitals_patient_idx ON vitals (patient_id, recorded_at DESC);
CREATE INDEX vitals_appointment_idx ON vitals (appointment_id);
CREATE TRIGGER vitals_append_only BEFORE UPDATE OR DELETE ON vitals FOR EACH ROW EXECUTE FUNCTION append_only();
