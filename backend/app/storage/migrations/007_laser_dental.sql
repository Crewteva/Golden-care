-- Doctor's work, part B: laser session records, the dental chart, dental treatment plans and dental lab cases.
-- Money here (plan prices, installments, lab costs) is recorded now; invoices, payments and the lab payable
-- are connected when billing and accounting are built.

-- Which clinical record a service needs, and for dental work what the tooth chart shows once it's done.
ALTER TABLE services
  ADD COLUMN clinical_record text CHECK (clinical_record IN ('laser', 'dental')),
  ADD COLUMN dental_result text CHECK (dental_result IN ('filling', 'crown', 'root_canal', 'extracted', 'implant', 'bridge',
                                                         'sealant', 'veneer'));

-- A tooth in FDI numbering: permanent 11–48, primary (milk) 51–85.
CREATE FUNCTION valid_fdi(t smallint) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (t / 10 BETWEEN 1 AND 4 AND t % 10 BETWEEN 1 AND 8) OR (t / 10 BETWEEN 5 AND 8 AND t % 10 BETWEEN 1 AND 5)
$$;

-- ---------- laser ----------

-- Medical devices. Requirement 7 (devices & maintenance) extends this table.
CREATE TABLE devices (
  id             serial PRIMARY KEY,
  kind           text NOT NULL DEFAULT 'laser' CHECK (kind IN ('laser', 'other')),
  name           text NOT NULL UNIQUE,
  model          text,
  serial_no      text,
  room_id        int REFERENCES rooms (id) ON DELETE SET NULL,
  pulse_counter  bigint NOT NULL DEFAULT 0 CHECK (pulse_counter >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE laser_sessions_ref_seq START 1;

CREATE TABLE laser_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                 text NOT NULL UNIQUE DEFAULT ('LS-' || lpad(nextval('laser_sessions_ref_seq')::text, 6, '0')),
  appointment_id      uuid REFERENCES appointments (id),
  patient_id          uuid NOT NULL REFERENCES patients (id),
  operator_id         uuid NOT NULL REFERENCES users (id),
  device_id           int REFERENCES devices (id),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed')),
  session_no          smallint CHECK (session_no BETWEEN 1 AND 60),
  skin_type           text CHECK (skin_type IN ('I', 'II', 'III', 'IV', 'V', 'VI')),
  hair_color          text,
  checklist           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {code: true/false}
  checklist_override  text,                                 -- why the session went ahead despite a stop answer
  counter_start       bigint CHECK (counter_start >= 0),
  counter_end         bigint CHECK (counter_end >= 0),
  test_pulses         int NOT NULL DEFAULT 0 CHECK (test_pulses >= 0),
  counter_note        text,                                 -- explains any difference in the pulse count
  aftercare           text,
  notes               text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  signed_at           timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR signed_at IS NOT NULL),
  CHECK (counter_start IS NULL OR counter_end IS NULL OR counter_end >= counter_start)
);
CREATE INDEX laser_sessions_patient_idx ON laser_sessions (patient_id, started_at DESC);
CREATE INDEX laser_sessions_device_idx ON laser_sessions (device_id, signed_at);

CREATE TABLE laser_session_areas (
  id            bigserial PRIMARY KEY,
  session_id    uuid NOT NULL REFERENCES laser_sessions (id),
  position      smallint NOT NULL,
  area          text NOT NULL,
  fluence       numeric(5, 1) CHECK (fluence > 0 AND fluence <= 200),       -- J/cm²
  pulse_ms      numeric(6, 1) CHECK (pulse_ms > 0 AND pulse_ms <= 1000),
  spot_mm       numeric(4, 1) CHECK (spot_mm > 0 AND spot_mm <= 50),
  frequency_hz  numeric(4, 1) CHECK (frequency_hz > 0 AND frequency_hz <= 50),
  pulses        int NOT NULL CHECK (pulses >= 0),
  reaction      text,
  UNIQUE (session_id, position)
);

CREATE FUNCTION laser_sessions_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signed' THEN RAISE EXCEPTION 'visit_locked: a signed laser session cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'visit_locked: a signed laser session cannot be changed';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER laser_sessions_lock BEFORE UPDATE OR DELETE ON laser_sessions FOR EACH ROW EXECUTE FUNCTION laser_sessions_lock();

CREATE FUNCTION laser_areas_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM laser_sessions WHERE id = COALESCE(NEW.session_id, OLD.session_id)) = 'signed' THEN
    RAISE EXCEPTION 'visit_locked: the areas of a signed laser session cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER laser_areas_lock BEFORE INSERT OR UPDATE OR DELETE ON laser_session_areas FOR EACH ROW EXECUTE FUNCTION laser_areas_lock();

-- ---------- dental chart ----------

-- The tooth chart is a history: each finding or piece of work is one row. A wrong row is voided with a reason, never deleted.
CREATE TABLE dental_chart_entries (
  id            bigserial PRIMARY KEY,
  patient_id    uuid NOT NULL REFERENCES patients (id),
  tooth         smallint NOT NULL CHECK (valid_fdi(tooth)),
  surfaces      text[] NOT NULL DEFAULT '{}' CHECK (surfaces <@ ARRAY['M', 'O', 'D', 'B', 'L', 'I']::text[]),
  condition     text NOT NULL CHECK (condition IN ('caries', 'filling', 'crown', 'root_canal', 'missing', 'extracted', 'implant',
                                                   'bridge', 'fracture', 'sealant', 'veneer', 'watch')),
  status        text NOT NULL DEFAULT 'existing' CHECK (status IN ('existing', 'done')),   -- found on exam / done here
  note          text,
  visit_id      uuid REFERENCES visits (id),
  plan_item_id  bigint,
  recorded_by   uuid NOT NULL REFERENCES users (id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  voided_at     timestamptz,
  voided_by     uuid REFERENCES users (id),
  void_reason   text,
  CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
CREATE INDEX dental_chart_patient_idx ON dental_chart_entries (patient_id, tooth, recorded_at);

CREATE FUNCTION dental_chart_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'dental_chart_entries is append-only'; END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
     OR (to_jsonb(NEW) - ARRAY['voided_at', 'voided_by', 'void_reason']) <> (to_jsonb(OLD) - ARRAY['voided_at', 'voided_by', 'void_reason']) THEN
    RAISE EXCEPTION 'dental_chart_entries is append-only (only voiding is allowed)';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER dental_chart_history BEFORE UPDATE OR DELETE ON dental_chart_entries FOR EACH ROW EXECUTE FUNCTION dental_chart_history();

-- ---------- treatment plans ----------

CREATE SEQUENCE treatment_plans_ref_seq START 1;

CREATE TABLE treatment_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                 text NOT NULL UNIQUE DEFAULT ('TP-' || lpad(nextval('treatment_plans_ref_seq')::text, 6, '0')),
  patient_id          uuid NOT NULL REFERENCES patients (id),
  doctor_id           uuid NOT NULL REFERENCES users (id),
  title               text NOT NULL,
  notes               text,          -- internal
  patient_note        text,          -- printed on the quotation
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'quoted', 'accepted', 'declined', 'completed', 'cancelled')),
  quoted_at           timestamptz,
  valid_until         date,
  quote_total         numeric(12, 2),
  down_payment        numeric(12, 2) NOT NULL DEFAULT 0 CHECK (down_payment >= 0),
  installments_count  smallint NOT NULL DEFAULT 0 CHECK (installments_count BETWEEN 0 AND 24),
  accepted_at         timestamptz,
  accepted_via        text CHECK (accepted_via IN ('portal', 'clinic')),
  accepted_by         uuid REFERENCES users (id),
  declined_at         timestamptz,
  decline_reason      text,
  cancelled_at        timestamptz,
  cancel_reason       text,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('quoted', 'accepted', 'completed') OR (quoted_at IS NOT NULL AND valid_until IS NOT NULL AND quote_total IS NOT NULL)),
  CHECK (status NOT IN ('accepted', 'completed') OR accepted_at IS NOT NULL),
  CHECK (down_payment <= COALESCE(quote_total, down_payment))
);
CREATE INDEX treatment_plans_patient_idx ON treatment_plans (patient_id, created_at DESC);
CREATE INDEX treatment_plans_doctor_idx ON treatment_plans (doctor_id, status);

CREATE TABLE treatment_plan_items (
  id              bigserial PRIMARY KEY,
  plan_id         uuid NOT NULL REFERENCES treatment_plans (id),
  position        smallint NOT NULL,
  phase           smallint NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 9),
  service_id      int NOT NULL REFERENCES services (id),
  tooth           smallint CHECK (tooth IS NULL OR valid_fdi(tooth)),
  surfaces        text[] NOT NULL DEFAULT '{}' CHECK (surfaces <@ ARRAY['M', 'O', 'D', 'B', 'L', 'I']::text[]),
  condition       text CHECK (condition IN ('filling', 'crown', 'root_canal', 'extracted', 'implant', 'bridge', 'sealant', 'veneer')),
  price           numeric(12, 2) NOT NULL CHECK (price >= 0),   -- always from the price list, never typed
  note            text,
  status          text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  done_at         timestamptz,
  done_by         uuid REFERENCES users (id),
  done_visit_id   uuid REFERENCES visits (id),
  billing_status  text NOT NULL DEFAULT 'not_billed' CHECK (billing_status IN ('not_billed', 'to_bill', 'billed')),
  UNIQUE (plan_id, position),
  CHECK (status <> 'done' OR done_at IS NOT NULL)
);

ALTER TABLE dental_chart_entries ADD FOREIGN KEY (plan_item_id) REFERENCES treatment_plan_items (id);

-- Once quoted, what the patient was offered can't change silently: price, service and tooth are frozen.
CREATE FUNCTION plan_items_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM treatment_plans WHERE id = COALESCE(NEW.plan_id, OLD.plan_id);
  IF v_status IN ('quoted', 'accepted', 'completed', 'declined', 'cancelled') THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'INSERT'
       OR NEW.price IS DISTINCT FROM OLD.price OR NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.tooth IS DISTINCT FROM OLD.tooth OR NEW.surfaces IS DISTINCT FROM OLD.surfaces THEN
      RAISE EXCEPTION 'visit_locked: a quoted plan''s items cannot change; re-issue the quotation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER plan_items_freeze BEFORE INSERT OR UPDATE OR DELETE ON treatment_plan_items FOR EACH ROW EXECUTE FUNCTION plan_items_freeze();

CREATE TABLE treatment_plan_installments (
  id        bigserial PRIMARY KEY,
  plan_id   uuid NOT NULL REFERENCES treatment_plans (id),
  seq       smallint NOT NULL,             -- 0 = down payment
  due_on    date NOT NULL,
  amount    numeric(12, 2) NOT NULL CHECK (amount > 0),
  status    text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'paid', 'cancelled')),
  UNIQUE (plan_id, seq)
);

-- ---------- dental lab work ----------

CREATE TABLE dental_labs (
  id            serial PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  contact_name  text,
  phone         text,
  address       text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE lab_cases_ref_seq START 1;

CREATE TABLE lab_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               text NOT NULL UNIQUE DEFAULT ('LC-' || lpad(nextval('lab_cases_ref_seq')::text, 6, '0')),
  patient_id        uuid NOT NULL REFERENCES patients (id),
  doctor_id         uuid NOT NULL REFERENCES users (id),
  lab_id            int NOT NULL REFERENCES dental_labs (id),
  plan_item_id      bigint REFERENCES treatment_plan_items (id),
  work_type         text NOT NULL CHECK (work_type IN ('zirconia_crown', 'pfm_crown', 'emax_crown', 'bridge', 'veneer', 'implant_crown',
                                                         'full_denture', 'partial_denture', 'night_guard', 'retainer', 'other')),
  teeth             text,
  shade             text,
  instructions      text,
  status            text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'sent', 'returned', 'remake', 'delivered', 'cancelled')),
  due_on            date,
  sent_at           timestamptz,
  returned_at       timestamptz,
  delivered_at      timestamptz,
  remake_count      smallint NOT NULL DEFAULT 0,
  lab_cost          numeric(12, 2) CHECK (lab_cost >= 0),          -- what the clinic owes the lab
  doctor_share_pct  numeric(5, 2) NOT NULL DEFAULT 0 CHECK (doctor_share_pct BETWEEN 0 AND 100),
  created_by        uuid REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_cases_status_idx ON lab_cases (status, due_on);
CREATE INDEX lab_cases_patient_idx ON lab_cases (patient_id);

CREATE TABLE lab_case_events (
  id           bigserial PRIMARY KEY,
  case_id      uuid NOT NULL REFERENCES lab_cases (id),
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid REFERENCES users (id),
  actor_label  text,
  action       text NOT NULL,
  from_status  text,
  to_status    text,
  note         text
);
CREATE INDEX lab_case_events_case_idx ON lab_case_events (case_id, at);
CREATE TRIGGER lab_case_events_append_only BEFORE UPDATE OR DELETE ON lab_case_events FOR EACH ROW EXECUTE FUNCTION append_only();
