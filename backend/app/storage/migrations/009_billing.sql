-- Billing, payments & cashier (requirement 5, part A).
-- Invoices are built from the price list and, once issued, can never be edited or deleted: a mistake is voided
-- (with a reason and a manager's approval). Receipts, credit movements and closed shifts are never changed either.
-- Accounting entries (requirement 6) are posted from these records.

-- Per service: VAT (0 = exempt) and an optional direct cost deducted before a doctor's percentage share.
ALTER TABLE services
  ADD COLUMN vat_rate     numeric(5, 2) NOT NULL DEFAULT 0 CHECK (vat_rate BETWEEN 0 AND 30),
  ADD COLUMN direct_cost  numeric(12, 2) NOT NULL DEFAULT 0 CHECK (direct_cost >= 0);

INSERT INTO app_settings (key, value) VALUES
  ('billing.max_discount_pct', '10'),        -- above this a manager approves the discount
  ('billing.max_installments', '12'),
  ('billing.receipt_note_ar', '"شكرًا لاختياركم جولدن كير."'),
  ('billing.receipt_note_en', '"Thank you for choosing Golden Care."')
ON CONFLICT (key) DO NOTHING;

-- ---------- packages (configurable: add, edit, archive; a sold package can't be deleted) ----------

CREATE TABLE packages (
  id           serial PRIMARY KEY,
  service_id   int NOT NULL REFERENCES services (id),
  name_ar      text NOT NULL,
  name_en      text NOT NULL,
  sessions     smallint NOT NULL CHECK (sessions BETWEEN 1 AND 100),
  price        numeric(12, 2) NOT NULL CHECK (price >= 0),
  valid_days   int CHECK (valid_days IS NULL OR valid_days BETWEEN 7 AND 1825),   -- NULL = no expiry
  notes        text,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- doctor share rules ----------

-- service_id NULL = every service of that doctor. The rule in force is the latest one starting on or before the day.
CREATE TABLE doctor_share_rules (
  id           serial PRIMARY KEY,
  doctor_id    uuid NOT NULL REFERENCES users (id),
  service_id   int REFERENCES services (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value        numeric(12, 2) NOT NULL CHECK (value >= 0),
  deduct_cost  boolean NOT NULL DEFAULT true,
  starts_on    date NOT NULL,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100),
  UNIQUE NULLS NOT DISTINCT (doctor_id, service_id, starts_on)
);

-- ---------- invoices ----------

CREATE SEQUENCE invoices_ref_seq START 1;   -- the number is given when the invoice is issued (no gaps from drafts)

CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               text UNIQUE,
  patient_id        uuid NOT NULL REFERENCES patients (id),
  branch_id         int NOT NULL REFERENCES branches (id),
  appointment_id    uuid REFERENCES appointments (id),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'issued', 'void', 'cancelled')),
  subtotal          numeric(12, 2) NOT NULL DEFAULT 0,
  discount_amount   numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_reason   text,
  vat_total         numeric(12, 2) NOT NULL DEFAULT 0,
  total             numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_total        numeric(12, 2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  notes             text,
  issued_at         timestamptz,
  issued_by         uuid REFERENCES users (id),
  discount_approved_by uuid REFERENCES users (id),
  voided_at         timestamptz,
  voided_by         uuid REFERENCES users (id),
  void_reason       text,
  eta_status        text NOT NULL DEFAULT 'not_sent' CHECK (eta_status IN ('not_sent', 'sent', 'accepted', 'rejected')),
  created_by        uuid REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('issued', 'void') OR (ref IS NOT NULL AND issued_at IS NOT NULL)),
  CHECK (status <> 'void' OR void_reason IS NOT NULL),
  CHECK (discount_amount = 0 OR discount_reason IS NOT NULL),
  CHECK (paid_total <= total OR status = 'void')
);
CREATE INDEX invoices_patient_idx ON invoices (patient_id, created_at DESC);
CREATE INDEX invoices_status_idx ON invoices (status, issued_at);
CREATE INDEX invoices_appt_idx ON invoices (appointment_id);

CREATE TABLE invoice_lines (
  id                  bigserial PRIMARY KEY,
  invoice_id          uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position            smallint NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('service', 'package_sale', 'package_use', 'plan_item')),
  service_id          int REFERENCES services (id),
  package_id          int REFERENCES packages (id),
  patient_package_id  uuid,
  plan_item_id        bigint REFERENCES treatment_plan_items (id),
  appointment_id      uuid REFERENCES appointments (id),
  doctor_id           uuid REFERENCES users (id),
  name_ar             text NOT NULL,
  name_en             text NOT NULL,
  qty                 smallint NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 100),
  unit_price          numeric(12, 2) NOT NULL CHECK (unit_price >= 0),     -- always from the price list / package / plan
  discount            numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),  -- this line's part of the invoice discount
  vat_rate            numeric(5, 2) NOT NULL DEFAULT 0,
  vat_amount          numeric(12, 2) NOT NULL DEFAULT 0,
  line_total          numeric(12, 2) NOT NULL DEFAULT 0,
  doctor_share        numeric(12, 2) NOT NULL DEFAULT 0,
  cost                numeric(12, 2) NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, position),
  CHECK (kind <> 'service' OR service_id IS NOT NULL),
  CHECK (kind <> 'package_sale' OR package_id IS NOT NULL),
  CHECK (kind <> 'package_use' OR patient_package_id IS NOT NULL),
  CHECK (kind <> 'plan_item' OR plan_item_id IS NOT NULL)
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);
CREATE INDEX invoice_lines_appt_idx ON invoice_lines (appointment_id);
-- A plan item is billed once (drafts and voided invoices don't count; checked in code for drafts).

-- Up to the agreed schedule: seq 0 = paid now (down payment), then monthly. Paid in order from paid_total.
CREATE TABLE invoice_installments (
  invoice_id  uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  seq         smallint NOT NULL,
  due_on      date NOT NULL,
  amount      numeric(12, 2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (invoice_id, seq)
);

-- Issued invoices are frozen: only payment progress, voiding and the e-receipt status may change.
CREATE FUNCTION invoices_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('issued', 'void') THEN RAISE EXCEPTION 'record_locked: an issued invoice cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'void'
     AND (to_jsonb(NEW) - ARRAY['eta_status', 'updated_at']) <> (to_jsonb(OLD) - ARRAY['eta_status', 'updated_at']) THEN
    RAISE EXCEPTION 'record_locked: a void invoice cannot be changed';
  END IF;
  IF OLD.status = 'issued' THEN
    IF NEW.status NOT IN ('issued', 'void')
       OR (to_jsonb(NEW) - ARRAY['paid_total', 'status', 'voided_at', 'voided_by', 'void_reason', 'eta_status', 'updated_at'])
          <> (to_jsonb(OLD) - ARRAY['paid_total', 'status', 'voided_at', 'voided_by', 'void_reason', 'eta_status', 'updated_at']) THEN
      RAISE EXCEPTION 'record_locked: an issued invoice cannot be changed; void it instead';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invoices_lock BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_lock();

CREATE FUNCTION invoice_children_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id)) IN ('issued', 'void') THEN
    RAISE EXCEPTION 'record_locked: the lines of an issued invoice cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER invoice_lines_lock BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_children_lock();
CREATE TRIGGER invoice_installments_lock BEFORE INSERT OR UPDATE OR DELETE ON invoice_installments FOR EACH ROW EXECUTE FUNCTION invoice_children_lock();

-- ---------- patient packages ----------

CREATE SEQUENCE patient_packages_ref_seq START 1;

CREATE TABLE patient_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text NOT NULL UNIQUE DEFAULT ('PK-' || lpad(nextval('patient_packages_ref_seq')::text, 6, '0')),
  patient_id      uuid NOT NULL REFERENCES patients (id),
  package_id      int NOT NULL REFERENCES packages (id),
  service_id      int NOT NULL REFERENCES services (id),
  name_ar         text NOT NULL,
  name_en         text NOT NULL,
  sessions_total  smallint NOT NULL,
  price_paid      numeric(12, 2) NOT NULL,       -- after the invoice discount
  full_price      numeric(12, 2) NOT NULL,       -- one session at the price list price when sold (used by the refund rule)
  sale_line_id    bigint NOT NULL REFERENCES invoice_lines (id),
  sold_at         timestamptz NOT NULL DEFAULT now(),
  expires_on      date,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at    timestamptz,
  cancel_reason   text,
  refund_amount   numeric(12, 2)
);
CREATE INDEX patient_packages_patient_idx ON patient_packages (patient_id, status);
ALTER TABLE invoice_lines ADD FOREIGN KEY (patient_package_id) REFERENCES patient_packages (id);

-- A session used = an issued invoice line of kind package_use. Counted, never stored twice.

-- ---------- cashier shifts ----------

CREATE SEQUENCE cash_shifts_ref_seq START 1;

CREATE TABLE cash_shifts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                text NOT NULL UNIQUE DEFAULT ('SH-' || lpad(nextval('cash_shifts_ref_seq')::text, 6, '0')),
  cashier_id         uuid NOT NULL REFERENCES users (id),
  branch_id          int NOT NULL REFERENCES branches (id),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_float      numeric(12, 2) NOT NULL CHECK (opening_float >= 0),
  opened_at          timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  expected_cash      numeric(12, 2),
  counted_cash       numeric(12, 2) CHECK (counted_cash >= 0),
  difference         numeric(12, 2),
  difference_reason  text,
  totals             jsonb,                 -- by payment method, frozen at closing
  note               text,
  CHECK (status = 'open' OR (closed_at IS NOT NULL AND counted_cash IS NOT NULL)),
  CHECK (difference IS NULL OR difference = 0 OR difference_reason IS NOT NULL)
);
CREATE UNIQUE INDEX cash_shifts_one_open ON cash_shifts (cashier_id) WHERE status = 'open';

CREATE FUNCTION cash_shifts_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'closed' THEN
    RAISE EXCEPTION 'record_locked: a cashier shift cannot be changed once closed (or deleted)';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cash_shifts_lock BEFORE UPDATE OR DELETE ON cash_shifts FOR EACH ROW EXECUTE FUNCTION cash_shifts_lock();

-- ---------- receipts ----------

CREATE SEQUENCE receipts_ref_seq START 1;

CREATE TABLE receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref          text NOT NULL UNIQUE DEFAULT ('RC-' || lpad(nextval('receipts_ref_seq')::text, 6, '0')),
  patient_id   uuid NOT NULL REFERENCES patients (id),
  invoice_id   uuid REFERENCES invoices (id),        -- empty = a deposit to the patient's credit
  shift_id     uuid REFERENCES cash_shifts (id),
  branch_id    int NOT NULL REFERENCES branches (id),
  total        numeric(12, 2) NOT NULL CHECK (total > 0),
  applied      numeric(12, 2) NOT NULL CHECK (applied >= 0),      -- went to the invoice
  to_credit    numeric(12, 2) NOT NULL DEFAULT 0 CHECK (to_credit >= 0),
  note         text,
  received_by  uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (applied + to_credit = total)
);
CREATE INDEX receipts_patient_idx ON receipts (patient_id, created_at DESC);
CREATE INDEX receipts_shift_idx ON receipts (shift_id);
CREATE INDEX receipts_invoice_idx ON receipts (invoice_id);

CREATE TABLE receipt_payments (
  id          bigserial PRIMARY KEY,
  receipt_id  uuid NOT NULL REFERENCES receipts (id),
  method      text NOT NULL CHECK (method IN ('cash', 'card', 'instapay', 'wallet', 'credit')),
  amount      numeric(12, 2) NOT NULL CHECK (amount > 0),
  reference   text,
  CHECK (method IN ('cash', 'credit') OR reference IS NOT NULL)
);
CREATE INDEX receipt_payments_receipt_idx ON receipt_payments (receipt_id);

CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER receipt_payments_append_only BEFORE UPDATE OR DELETE ON receipt_payments FOR EACH ROW EXECUTE FUNCTION append_only();

-- ---------- refunds & approvals ----------

CREATE SEQUENCE refunds_ref_seq START 1;

-- Money given back always comes out of the patient's credit balance, after a manager approves.
CREATE TABLE refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE DEFAULT ('RF-' || lpad(nextval('refunds_ref_seq')::text, 6, '0')),
  patient_id    uuid NOT NULL REFERENCES patients (id),
  amount        numeric(12, 2) NOT NULL CHECK (amount > 0),
  method        text NOT NULL CHECK (method IN ('cash', 'card', 'instapay', 'wallet')),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'paid')),
  requested_by  uuid REFERENCES users (id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users (id),
  decided_at    timestamptz,
  paid_by       uuid REFERENCES users (id),
  paid_at       timestamptz,
  shift_id      uuid REFERENCES cash_shifts (id),
  reference     text,
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
CREATE INDEX refunds_status_idx ON refunds (status, requested_at);

CREATE TABLE approval_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text NOT NULL CHECK (kind IN ('discount', 'void', 'refund', 'package_cancel')),
  invoice_id          uuid REFERENCES invoices (id),
  refund_id           uuid REFERENCES refunds (id),
  patient_package_id  uuid REFERENCES patient_packages (id),
  patient_id          uuid NOT NULL REFERENCES patients (id),
  amount              numeric(12, 2) NOT NULL DEFAULT 0,
  reason              text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by        uuid REFERENCES users (id),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  decided_by          uuid REFERENCES users (id),
  decided_at          timestamptz,
  decision_note       text
);
CREATE INDEX approval_requests_status_idx ON approval_requests (status, requested_at);
CREATE UNIQUE INDEX approval_requests_one_pending_invoice ON approval_requests (invoice_id, kind) WHERE status = 'pending';

-- ---------- patient credit (a ledger: the balance is the sum) ----------

CREATE TABLE patient_credit (
  id          bigserial PRIMARY KEY,
  patient_id  uuid NOT NULL REFERENCES patients (id),
  amount      numeric(12, 2) NOT NULL CHECK (amount <> 0),     -- + money the clinic holds for the patient, − used or given back
  reason      text NOT NULL CHECK (reason IN ('deposit', 'overpayment', 'used', 'void', 'package_cancel', 'refund')),
  receipt_id  uuid REFERENCES receipts (id),
  invoice_id  uuid REFERENCES invoices (id),
  refund_id   uuid REFERENCES refunds (id),
  note        text,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_credit_patient_idx ON patient_credit (patient_id, created_at);
CREATE TRIGGER patient_credit_append_only BEFORE UPDATE OR DELETE ON patient_credit FOR EACH ROW EXECUTE FUNCTION append_only();
