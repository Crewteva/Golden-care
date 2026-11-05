-- Patient records: full patient file, family links, medical alerts and private documents.
-- One file per person, shared by every branch (registered_branch_id only says where it was opened).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE patients
  ALTER COLUMN phone DROP NOT NULL,
  ADD COLUMN phone2               text,
  ADD COLUMN national_id          text UNIQUE CHECK (national_id ~ '^[23][0-9]{13}$'),
  ADD COLUMN passport_no          text,
  ADD COLUMN nationality          text NOT NULL DEFAULT 'EG',
  ADD COLUMN address              text,
  ADD COLUMN area                 text,
  ADD COLUMN emergency_name       text,
  ADD COLUMN emergency_relation   text,
  ADD COLUMN emergency_phone      text,
  ADD COLUMN registered_branch_id int REFERENCES branches (id),
  ADD COLUMN created_by           uuid REFERENCES users (id),
  ADD COLUMN updated_by           uuid REFERENCES users (id);

CREATE INDEX patients_name_trgm_idx ON patients USING gin (name_search gin_trgm_ops);
CREATE INDEX patients_dob_idx ON patients (date_of_birth);
CREATE INDEX patients_phone2_idx ON patients (phone2);

-- "relative_id is the <relationship> of patient_id". is_guardian: the relative manages this patient's file
-- (e.g. a parent for a child) and may see it in their own portal.
CREATE TABLE patient_family (
  id              bigserial PRIMARY KEY,
  patient_id      uuid NOT NULL REFERENCES patients (id),
  relative_id     uuid NOT NULL REFERENCES patients (id),
  relationship    text NOT NULL CHECK (relationship IN ('parent', 'child', 'spouse', 'sibling', 'other')),
  is_guardian     boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  removed_by      uuid REFERENCES users (id),
  removed_reason  text,
  CHECK (patient_id <> relative_id)
);
CREATE UNIQUE INDEX patient_family_pair_idx ON patient_family
  (LEAST(patient_id, relative_id), GREATEST(patient_id, relative_id)) WHERE removed_at IS NULL;
CREATE INDEX patient_family_patient_idx ON patient_family (patient_id) WHERE removed_at IS NULL;
CREATE INDEX patient_family_relative_idx ON patient_family (relative_id) WHERE removed_at IS NULL;

-- Shown at the top of the file. Never deleted: removed with a reason.
CREATE TABLE patient_alerts (
  id              bigserial PRIMARY KEY,
  patient_id      uuid NOT NULL REFERENCES patients (id),
  kind            text NOT NULL CHECK (kind IN ('allergy', 'chronic', 'medication', 'pregnancy', 'implant', 'other')),
  description     text NOT NULL,
  severity        text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  created_by      uuid NOT NULL REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  removed_by      uuid REFERENCES users (id),
  removed_reason  text
);
CREATE INDEX patient_alerts_patient_idx ON patient_alerts (patient_id) WHERE removed_at IS NULL;

-- Documents live in private storage (storage_key); only the API can read them.
CREATE TABLE patient_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients (id),
  category        text NOT NULL CHECK (category IN ('lab_result', 'report', 'photo', 'consent', 'id_copy', 'other')),
  title           text NOT NULL,
  original_name   text NOT NULL,
  mime            text NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes      int NOT NULL CHECK (size_bytes > 0),
  sha256          text NOT NULL,
  storage_key     text NOT NULL UNIQUE,
  branch_id       int REFERENCES branches (id),
  uploaded_by     uuid NOT NULL REFERENCES users (id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  -- results and reports wait for a doctor; other kinds don't need review
  review_status   text NOT NULL CHECK (review_status IN ('pending', 'reviewed', 'not_needed')),
  reviewed_by     uuid REFERENCES users (id),
  reviewed_at     timestamptz,
  internal_note   text,
  -- released = the patient can see it in their portal, with the doctor's plain-language note
  released_at     timestamptz,
  released_by     uuid REFERENCES users (id),
  patient_note    text,
  voided_at       timestamptz,
  voided_by       uuid REFERENCES users (id),
  void_reason     text
);
CREATE INDEX patient_files_patient_idx ON patient_files (patient_id, uploaded_at DESC);
CREATE INDEX patient_files_pending_idx ON patient_files (uploaded_at) WHERE review_status = 'pending' AND voided_at IS NULL;
