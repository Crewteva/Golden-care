-- Accounting (requirement 6): chart of accounts, a double-entry journal posted automatically from billing
-- (and later from salaries and stock), expenses, transfers and card / InstaPay settlements, doctor payouts,
-- lab payments and month closing. Journal entries are never edited or deleted: a mistake is reversed.

CREATE TABLE accounts (
  id           serial PRIMARY KEY,
  code         text NOT NULL UNIQUE CHECK (code ~ '^[0-9]{3,6}$'),
  name_ar      text NOT NULL,
  name_en      text NOT NULL,
  type         text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  system_key   text UNIQUE,                       -- used by automatic postings: can be renamed, not retyped or switched off
  is_money     boolean NOT NULL DEFAULT false,    -- cash, bank or a card / wallet holding account: money is paid from it
  is_active    boolean NOT NULL DEFAULT true,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_money OR type = 'asset')
);

-- ---------- months: open → close requested (accountant) → closed (management) ----------

CREATE TABLE periods (
  month          date PRIMARY KEY CHECK (extract(day FROM month) = 1),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'close_requested', 'closed')),
  requested_by   uuid REFERENCES users (id),
  requested_at   timestamptz,
  request_note   text,
  decided_by     uuid REFERENCES users (id),
  decided_at     timestamptz,
  decision_note  text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- the journal ----------

CREATE SEQUENCE journal_entries_ref_seq START 1;

CREATE TABLE journal_entries (
  id           bigserial PRIMARY KEY,
  ref          text NOT NULL UNIQUE DEFAULT ('JE-' || lpad(nextval('journal_entries_ref_seq')::text, 6, '0')),
  entry_date   date NOT NULL,
  memo         text NOT NULL,
  source_type  text NOT NULL,      -- invoice, receipt, refund, shift, expense, transfer, payout, manual, reversal …
  source_id    text,               -- the record it came from (one entry per record and kind; empty for manual entries)
  source_ref   text,               -- that record's number, shown to people (INV-…, RC-…)
  branch_id    int REFERENCES branches (id),
  amount       numeric(14, 2) NOT NULL CHECK (amount >= 0),     -- total of the debits
  reverses_id  bigint REFERENCES journal_entries (id),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);
CREATE INDEX journal_entries_date_idx ON journal_entries (entry_date, id);
CREATE UNIQUE INDEX journal_entries_one_reversal ON journal_entries (reverses_id) WHERE reverses_id IS NOT NULL;

CREATE TABLE journal_lines (
  id                  bigserial PRIMARY KEY,
  entry_id            bigint NOT NULL REFERENCES journal_entries (id),
  account_id          int NOT NULL REFERENCES accounts (id),
  debit               numeric(14, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit              numeric(14, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo                text,
  -- analysis: income and costs by branch, doctor, service and specialty; balances by patient
  branch_id           int REFERENCES branches (id),
  doctor_id           uuid REFERENCES users (id),
  service_id          int REFERENCES services (id),
  specialty_id        int REFERENCES specialties (id),
  patient_id          uuid REFERENCES patients (id),
  CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX journal_lines_entry_idx ON journal_lines (entry_id);
CREATE INDEX journal_lines_account_idx ON journal_lines (account_id);
CREATE INDEX journal_lines_doctor_idx ON journal_lines (doctor_id) WHERE doctor_id IS NOT NULL;

CREATE FUNCTION journal_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'record_locked: journal entries are never changed; post a reversal instead';
END
$$;
CREATE TRIGGER journal_entries_lock BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_lock();
CREATE TRIGGER journal_lines_lock BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION journal_lock();

-- Nothing is dated inside a closed month.
CREATE FUNCTION journal_period_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM periods WHERE month = date_trunc('month', NEW.entry_date)::date AND status = 'closed') THEN
    RAISE EXCEPTION 'record_locked: % falls in a closed month', NEW.entry_date;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER journal_entries_period BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_period_check();

-- Every entry balances (checked when the transaction commits, after all its lines are in).
CREATE FUNCTION journal_balance_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d numeric;
  c numeric;
BEGIN
  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0) INTO d, c FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c OR d <> (SELECT amount FROM journal_entries WHERE id = NEW.entry_id) THEN
    RAISE EXCEPTION 'journal entry % does not balance (debit %, credit %)', NEW.entry_id, d, c;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_balance_check();

-- ---------- expenses (paid from cash, petty cash or the bank) ----------

CREATE SEQUENCE expenses_ref_seq START 1;

CREATE TABLE expenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              text NOT NULL UNIQUE DEFAULT ('EX-' || lpad(nextval('expenses_ref_seq')::text, 6, '0')),
  spent_on         date NOT NULL,
  account_id       int NOT NULL REFERENCES accounts (id),      -- the expense category
  paid_from_id     int NOT NULL REFERENCES accounts (id),      -- a money account
  branch_id        int REFERENCES branches (id),
  amount           numeric(12, 2) NOT NULL CHECK (amount > 0),
  payee            text,
  description      text NOT NULL,
  reference        text,
  file_key         text,
  file_name        text,
  file_mime        text,
  status           text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  void_reason      text,
  voided_by        uuid REFERENCES users (id),
  voided_at        timestamptz,
  created_by       uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'void' OR void_reason IS NOT NULL)
);
CREATE INDEX expenses_date_idx ON expenses (spent_on DESC);

-- ---------- money moved between accounts; a settlement moves card / InstaPay / wallet takings to the bank ----------

CREATE SEQUENCE transfers_ref_seq START 1;

CREATE TABLE transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE DEFAULT ('TR-' || lpad(nextval('transfers_ref_seq')::text, 6, '0')),
  kind          text NOT NULL DEFAULT 'transfer' CHECK (kind IN ('transfer', 'settlement')),
  moved_on      date NOT NULL,
  from_id       int NOT NULL REFERENCES accounts (id),
  to_id         int NOT NULL REFERENCES accounts (id),
  amount        numeric(12, 2) NOT NULL CHECK (amount > 0),     -- what left the first account
  fee           numeric(12, 2) NOT NULL DEFAULT 0 CHECK (fee >= 0 AND fee < amount),   -- kept by the bank / provider
  reference     text,
  note          text,
  branch_id     int REFERENCES branches (id),
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_id <> to_id)
);
CREATE INDEX transfers_date_idx ON transfers (moved_on DESC);

-- The card / InstaPay / wallet payments a settlement covers (each payment is settled once).
CREATE TABLE settlement_items (
  transfer_id         uuid NOT NULL REFERENCES transfers (id),
  receipt_payment_id  bigint NOT NULL UNIQUE REFERENCES receipt_payments (id),
  PRIMARY KEY (transfer_id, receipt_payment_id)
);

CREATE TRIGGER transfers_append_only BEFORE UPDATE OR DELETE ON transfers FOR EACH ROW EXECUTE FUNCTION journal_lock();
CREATE TRIGGER settlement_items_append_only BEFORE UPDATE OR DELETE ON settlement_items FOR EACH ROW EXECUTE FUNCTION journal_lock();

-- ---------- doctor payouts: prepared by the accountant, approved by management, then paid ----------

CREATE SEQUENCE doctor_payouts_ref_seq START 1;

CREATE TABLE doctor_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text NOT NULL UNIQUE DEFAULT ('DP-' || lpad(nextval('doctor_payouts_ref_seq')::text, 6, '0')),
  doctor_id       uuid NOT NULL REFERENCES users (id),
  month           date NOT NULL CHECK (extract(day FROM month) = 1),
  shares          numeric(12, 2) NOT NULL,          -- the doctor's shares of the month (less voided invoices)
  lab_deduction   numeric(12, 2) NOT NULL DEFAULT 0 CHECK (lab_deduction >= 0),
  net             numeric(12, 2) NOT NULL CHECK (net >= 0),
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'approved', 'rejected', 'paid')),
  note            text,
  prepared_by     uuid REFERENCES users (id),
  prepared_at     timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users (id),
  decided_at      timestamptz,
  decision_note   text,
  paid_by         uuid REFERENCES users (id),
  paid_at         timestamptz,
  paid_on         date,
  paid_from_id    int REFERENCES accounts (id),
  reference       text,
  CHECK (net = shares - lab_deduction),
  CHECK (status <> 'paid' OR (paid_on IS NOT NULL AND paid_from_id IS NOT NULL))
);
CREATE UNIQUE INDEX doctor_payouts_one_per_month ON doctor_payouts (doctor_id, month) WHERE status <> 'rejected';

-- ---------- payments to dental labs (their cost is posted when the work comes back) ----------

CREATE SEQUENCE lab_payments_ref_seq START 1;

CREATE TABLE lab_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE DEFAULT ('LP-' || lpad(nextval('lab_payments_ref_seq')::text, 6, '0')),
  lab_id        int NOT NULL REFERENCES dental_labs (id),
  paid_on       date NOT NULL,
  amount        numeric(12, 2) NOT NULL CHECK (amount > 0),
  paid_from_id  int NOT NULL REFERENCES accounts (id),
  reference     text,
  note          text,
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER lab_payments_append_only BEFORE UPDATE OR DELETE ON lab_payments FOR EACH ROW EXECUTE FUNCTION journal_lock();

-- ---------- the starting chart (the accountant adds, renames and switches off accounts) ----------

INSERT INTO accounts (code, name_ar, name_en, type, system_key, is_money, description) VALUES
  ('1100', 'نقدية الخزينة', 'Cash drawers', 'asset', 'cash_drawer', true, 'Cash taken by cashiers, by branch'),
  ('1110', 'العهدة النثرية', 'Petty cash', 'asset', 'petty_cash', true, 'Small expenses paid in cash'),
  ('1120', 'البنك', 'Bank', 'asset', 'bank', true, 'The clinic''s bank account'),
  ('1130', 'مدفوعات البطاقات تحت التسوية', 'Card payments to settle', 'asset', 'card_clearing', true, 'Held by the card provider until paid into the bank'),
  ('1131', 'إنستاباي تحت التسوية', 'InstaPay to settle', 'asset', 'instapay_clearing', true, 'InstaPay payments until matched with the bank'),
  ('1132', 'المحافظ تحت التسوية', 'Mobile wallets to settle', 'asset', 'wallet_clearing', true, 'Wallet payments until moved to the bank'),
  ('1200', 'مستحقات المرضى', 'Patient receivables', 'asset', 'receivables', false, 'Issued invoices not yet paid'),
  ('2100', 'أرصدة المرضى الدائنة', 'Patient credit', 'liability', 'patient_credit', false, 'Money held for patients (deposits, overpayments)'),
  ('2110', 'جلسات باقات لم تُستخدم', 'Unused package sessions', 'liability', 'deferred_packages', false, 'Package sales not yet earned; recognised as sessions are used'),
  ('2200', 'مستحقات الأطباء', 'Doctors payable', 'liability', 'doctors_payable', false, 'Doctor shares not yet paid'),
  ('2210', 'مستحقات المعامل', 'Labs payable', 'liability', 'labs_payable', false, 'Lab work received, not yet paid'),
  ('2300', 'ضريبة القيمة المضافة المستحقة', 'VAT payable', 'liability', 'vat_payable', false, 'VAT charged on invoices'),
  ('3100', 'رأس المال', 'Capital', 'equity', 'capital', false, NULL),
  ('3200', 'الأرباح المحتجزة', 'Retained earnings', 'equity', 'retained', false, NULL),
  ('4100', 'إيرادات الخدمات', 'Service income', 'income', 'service_income', false, 'Analysed by specialty, service, doctor and branch'),
  ('4200', 'إيرادات الباقات', 'Package income', 'income', 'package_income', false, 'Package sessions as they are used'),
  ('4900', 'زيادة نقدية', 'Cash over', 'income', 'cash_over', false, 'Drawer counted above the expected cash'),
  ('5100', 'حصص الأطباء', 'Doctor fees', 'expense', 'doctor_fees', false, 'Doctor shares of invoices'),
  ('5110', 'تكاليف المعامل', 'Lab costs', 'expense', 'lab_costs', false, 'Dental lab work, less what doctors carry'),
  ('5200', 'الإيجار', 'Rent', 'expense', NULL, false, NULL),
  ('5210', 'الكهرباء والمياه والإنترنت', 'Utilities', 'expense', NULL, false, NULL),
  ('5220', 'مستلزمات ومستهلكات', 'Supplies & consumables', 'expense', NULL, false, NULL),
  ('5230', 'الرواتب', 'Salaries', 'expense', 'salaries', false, 'Posted from payroll later'),
  ('5240', 'الصيانة', 'Maintenance', 'expense', NULL, false, NULL),
  ('5250', 'التسويق والإعلان', 'Marketing', 'expense', NULL, false, NULL),
  ('5260', 'عمولات البنوك والبطاقات', 'Bank & card fees', 'expense', 'bank_fees', false, NULL),
  ('5290', 'مصروفات أخرى', 'Other expenses', 'expense', NULL, false, NULL),
  ('5900', 'عجز نقدية', 'Cash short', 'expense', 'cash_short', false, 'Drawer counted below the expected cash');

INSERT INTO app_settings (key, value) VALUES ('accounting.year_start_month', '1') ON CONFLICT (key) DO NOTHING;
