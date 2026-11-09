-- Stock, purchasing & medical devices (requirement 7).
-- Stock is kept by lot (batch, expiry, cost) per store; every movement is in stock_moves (append-only) and posts its
-- journal entry in the same transaction, so the Inventory account always equals the value of what's on the shelves.

-- ---------- setup lists (anything already used is switched off, not deleted) ----------

CREATE TABLE item_categories (
  id          serial PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE units (
  id          serial PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id             serial PRIMARY KEY,
  name_ar        text NOT NULL,
  name_en        text NOT NULL,
  category_id    int REFERENCES item_categories (id),
  unit_id        int NOT NULL REFERENCES units (id),
  min_qty        numeric(12, 2) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  tracks_expiry  boolean NOT NULL DEFAULT false,
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX items_name_en_key ON items (lower(name_en));

CREATE TABLE stores (
  id          serial PRIMARY KEY,
  branch_id   int NOT NULL REFERENCES branches (id),
  name_ar     text NOT NULL,
  name_en     text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id                  serial PRIMARY KEY,
  name                text NOT NULL,
  contact_name        text,
  phone               text,
  email               text,
  address             text,
  payment_terms_days  int NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  notes               text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_key ON suppliers (lower(name));

CREATE TABLE device_types (
  id          serial PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL UNIQUE,
  is_laser    boolean NOT NULL DEFAULT false,   -- devices of this type are picked in laser session records
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO device_types (name_ar, name_en, is_laser) VALUES
  ('جهاز ليزر', 'Laser', true),
  ('جهاز تعقيم (أوتوكلاف)', 'Sterilizer (autoclave)', false),
  ('أخرى', 'Other', false);

-- ---------- devices: the register, status and maintenance plan ----------

ALTER TABLE devices
  ADD COLUMN type_id                 int REFERENCES device_types (id),
  ADD COLUMN status                  text NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'maintenance', 'out_of_service')),
  ADD COLUMN status_note             text,
  ADD COLUMN supplier_id             int REFERENCES suppliers (id),
  ADD COLUMN purchase_date           date,
  ADD COLUMN purchase_price          numeric(12, 2) CHECK (purchase_price >= 0),
  ADD COLUMN warranty_end            date,
  ADD COLUMN maintenance_every_days  int CHECK (maintenance_every_days BETWEEN 1 AND 1095),
  ADD COLUMN last_maintenance_on     date,
  ADD COLUMN notes                   text,
  ADD COLUMN updated_at              timestamptz NOT NULL DEFAULT now();
UPDATE devices SET type_id = (SELECT id FROM device_types WHERE is_laser ORDER BY id LIMIT 1) WHERE kind = 'laser';
UPDATE devices SET type_id = (SELECT id FROM device_types WHERE name_en = 'Other') WHERE type_id IS NULL;

-- ---------- purchasing ----------

CREATE SEQUENCE purchase_orders_ref_seq START 1;

CREATE TABLE purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text NOT NULL UNIQUE DEFAULT ('PO-' || lpad(nextval('purchase_orders_ref_seq')::text, 6, '0')),
  supplier_id     int NOT NULL REFERENCES suppliers (id),
  store_id        int NOT NULL REFERENCES stores (id),
  status          text NOT NULL CHECK (status IN ('pending_approval', 'approved', 'rejected', 'partial', 'received', 'cancelled')),
  ordered_on      date NOT NULL,
  expected_on     date,
  note            text,
  total           numeric(12, 2) NOT NULL CHECK (total >= 0),
  approval_limit  numeric(12, 2),                 -- the limit in force when it was ordered (0 = every order needs approval)
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users (id),
  decided_at      timestamptz,
  decision_note   text,
  cancel_reason   text
);
CREATE INDEX purchase_orders_status_idx ON purchase_orders (status, ordered_on DESC);

CREATE TABLE purchase_order_lines (
  id            bigserial PRIMARY KEY,
  po_id         uuid NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  position      int NOT NULL DEFAULT 0,
  item_id       int NOT NULL REFERENCES items (id),
  qty           numeric(12, 2) NOT NULL CHECK (qty > 0),
  unit_cost     numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
  received_qty  numeric(12, 2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0 AND received_qty <= qty)
);
CREATE INDEX purchase_order_lines_po_idx ON purchase_order_lines (po_id);

CREATE SEQUENCE supplier_bills_ref_seq START 1;

-- The supplier's invoice, matched to the goods received (and maintenance done on credit). Due date from the payment terms.
CREATE TABLE supplier_bills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref          text NOT NULL UNIQUE DEFAULT ('SB-' || lpad(nextval('supplier_bills_ref_seq')::text, 6, '0')),
  supplier_id  int NOT NULL REFERENCES suppliers (id),
  bill_no      text NOT NULL,
  bill_date    date NOT NULL,
  due_date     date NOT NULL,
  amount       numeric(12, 2) NOT NULL CHECK (amount > 0),
  note         text,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, bill_no),
  CHECK (due_date >= bill_date)
);

-- ---------- stock ----------

CREATE SEQUENCE goods_receipts_ref_seq START 1;

CREATE TABLE goods_receipts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            text NOT NULL UNIQUE DEFAULT ('GR-' || lpad(nextval('goods_receipts_ref_seq')::text, 6, '0')),
  supplier_id    int NOT NULL REFERENCES suppliers (id),
  store_id       int NOT NULL REFERENCES stores (id),
  po_id          uuid REFERENCES purchase_orders (id),
  received_on    date NOT NULL,
  delivery_note  text,
  note           text,
  total          numeric(12, 2) NOT NULL CHECK (total >= 0),
  bill_id        uuid REFERENCES supplier_bills (id),
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goods_receipts_supplier_idx ON goods_receipts (supplier_id, received_on);

-- One lot per item received: what's left of it, at the cost it came in at. Never below zero.
CREATE TABLE stock_lots (
  id           bigserial PRIMARY KEY,
  store_id     int NOT NULL REFERENCES stores (id),
  item_id      int NOT NULL REFERENCES items (id),
  receipt_id   uuid REFERENCES goods_receipts (id),
  lot_no       text,
  expiry       date,
  unit_cost    numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
  qty_in       numeric(12, 2) NOT NULL CHECK (qty_in >= 0),
  qty_on_hand  numeric(12, 2) NOT NULL CHECK (qty_on_hand >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_lots_item_idx ON stock_lots (item_id, store_id) WHERE qty_on_hand > 0;

CREATE TABLE goods_receipt_lines (
  id          bigserial PRIMARY KEY,
  receipt_id  uuid NOT NULL REFERENCES goods_receipts (id),
  po_line_id  bigint REFERENCES purchase_order_lines (id),
  item_id     int NOT NULL REFERENCES items (id),
  qty         numeric(12, 2) NOT NULL CHECK (qty > 0),
  unit_cost   numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
  lot_no      text,
  expiry      date,
  lot_id      bigint REFERENCES stock_lots (id)
);

CREATE SEQUENCE stock_issues_ref_seq START 1;

-- Stock going out: used in a room / for a patient's visit, or written off (expired, damaged, lost) with a reason.
CREATE TABLE stock_issues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text NOT NULL UNIQUE DEFAULT ('SI-' || lpad(nextval('stock_issues_ref_seq')::text, 6, '0')),
  kind            text NOT NULL CHECK (kind IN ('use', 'write_off')),
  store_id        int NOT NULL REFERENCES stores (id),
  issued_on       date NOT NULL,
  room_id         int REFERENCES rooms (id),
  appointment_id  uuid REFERENCES appointments (id),
  patient_id      uuid REFERENCES patients (id),
  reason          text,
  note            text,
  total_cost      numeric(12, 2) NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'write_off' OR reason IS NOT NULL)
);

CREATE SEQUENCE stock_counts_ref_seq START 1;

-- Blind count: the counter doesn't see the expected quantities; differences post only once management approves.
CREATE TABLE stock_counts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               text NOT NULL UNIQUE DEFAULT ('SC-' || lpad(nextval('stock_counts_ref_seq')::text, 6, '0')),
  store_id          int NOT NULL REFERENCES stores (id),
  status            text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'submitted', 'approved', 'rejected')),
  note              text,
  started_by        uuid REFERENCES users (id),
  started_at        timestamptz NOT NULL DEFAULT now(),
  submitted_by      uuid REFERENCES users (id),
  submitted_at      timestamptz,
  decided_by        uuid REFERENCES users (id),
  decided_at        timestamptz,
  decision_note     text,
  difference_value  numeric(12, 2)
);
CREATE UNIQUE INDEX stock_counts_one_open ON stock_counts (store_id) WHERE status IN ('counting', 'submitted');

CREATE TABLE stock_count_lines (
  count_id   uuid NOT NULL REFERENCES stock_counts (id) ON DELETE CASCADE,
  item_id    int NOT NULL REFERENCES items (id),
  counted    numeric(12, 2) CHECK (counted >= 0),
  expected   numeric(12, 2),            -- filled when the count is submitted
  unit_cost  numeric(12, 2),
  PRIMARY KEY (count_id, item_id)
);

-- Every movement in or out of a lot. Never changed.
CREATE TABLE stock_moves (
  id          bigserial PRIMARY KEY,
  moved_on    date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('receive', 'use', 'write_off', 'count')),
  store_id    int NOT NULL REFERENCES stores (id),
  item_id     int NOT NULL REFERENCES items (id),
  lot_id      bigint NOT NULL REFERENCES stock_lots (id),
  qty         numeric(12, 2) NOT NULL CHECK (qty <> 0),
  unit_cost   numeric(12, 2) NOT NULL,
  doc_type    text NOT NULL CHECK (doc_type IN ('receipt', 'issue', 'count')),
  doc_id      uuid NOT NULL,
  doc_ref     text NOT NULL,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_moves_item_idx ON stock_moves (item_id, moved_on, id);
CREATE TRIGGER stock_moves_append_only BEFORE UPDATE OR DELETE ON stock_moves FOR EACH ROW EXECUTE FUNCTION journal_lock();

-- ---------- paying suppliers ----------

CREATE SEQUENCE supplier_payments_ref_seq START 1;

CREATE TABLE supplier_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE DEFAULT ('SP-' || lpad(nextval('supplier_payments_ref_seq')::text, 6, '0')),
  supplier_id   int NOT NULL REFERENCES suppliers (id),
  bill_id       uuid REFERENCES supplier_bills (id),
  paid_on       date NOT NULL,
  amount        numeric(12, 2) NOT NULL CHECK (amount > 0),
  paid_from_id  int NOT NULL REFERENCES accounts (id),
  reference     text,
  note          text,
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER supplier_payments_append_only BEFORE UPDATE OR DELETE ON supplier_payments FOR EACH ROW EXECUTE FUNCTION journal_lock();

-- ---------- device faults & maintenance ----------

CREATE SEQUENCE device_faults_ref_seq START 1;

CREATE TABLE device_faults (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            text NOT NULL UNIQUE DEFAULT ('DF-' || lpad(nextval('device_faults_ref_seq')::text, 6, '0')),
  device_id      int NOT NULL REFERENCES devices (id),
  description    text NOT NULL,
  stops_use      boolean NOT NULL DEFAULT false,   -- the device can't be used: it goes out of service
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed')),
  reported_by    uuid REFERENCES users (id),
  reported_role  text,
  reported_at    timestamptz NOT NULL DEFAULT now(),
  fixed_by       uuid REFERENCES users (id),
  fixed_at       timestamptz,
  resolution     text,
  CHECK (status <> 'fixed' OR resolution IS NOT NULL)
);

CREATE SEQUENCE device_maintenance_ref_seq START 1;

CREATE TABLE device_maintenance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE DEFAULT ('MT-' || lpad(nextval('device_maintenance_ref_seq')::text, 6, '0')),
  device_id     int NOT NULL REFERENCES devices (id),
  kind          text NOT NULL CHECK (kind IN ('preventive', 'repair')),
  done_on       date NOT NULL,
  description   text NOT NULL,
  technician    text,
  supplier_id   int REFERENCES suppliers (id),
  cost          numeric(12, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  paid_from_id  int REFERENCES accounts (id),     -- paid now from bank / petty cash; empty = on credit with the supplier
  bill_id       uuid REFERENCES supplier_bills (id),
  fault_id      uuid REFERENCES device_faults (id),
  file_key      text,
  file_name     text,
  file_mime     text,
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (cost = 0 OR paid_from_id IS NOT NULL OR supplier_id IS NOT NULL)
);
CREATE INDEX device_maintenance_device_idx ON device_maintenance (device_id, done_on DESC);

-- ---------- accounts and settings ----------

INSERT INTO accounts (code, name_ar, name_en, type, system_key, is_money, description) VALUES
  ('1300', 'المخزون', 'Inventory', 'asset', 'inventory', false, 'Stock on the shelves at cost; moves only with stock'),
  ('2400', 'مستحقات الموردين', 'Suppliers payable', 'liability', 'suppliers_payable', false, 'Goods and services received, not yet paid'),
  ('5120', 'مستهلكات مستخدمة', 'Consumables used', 'expense', 'consumables_used', false, 'Stock used in rooms and visits'),
  ('5130', 'خسائر المخزون', 'Stock losses', 'expense', 'stock_losses', false, 'Write-offs and count differences'),
  ('5245', 'صيانة الأجهزة الطبية', 'Device maintenance', 'expense', 'device_maintenance', false, 'Maintenance and repairs of medical devices')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app_settings (key, value) VALUES ('purchasing.approval_limit', '5000') ON CONFLICT (key) DO NOTHING;
