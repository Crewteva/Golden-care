-- Stock, purchasing & medical devices, completed (requirement 7): transfers between stores, returns to suppliers,
-- two-person supplier payments, calibration, laser pulse wear and device booking.

-- ---------- stock movements: new kinds ----------

ALTER TABLE stock_moves DROP CONSTRAINT IF EXISTS stock_moves_kind_check;
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_kind_check
  CHECK (kind IN ('receive', 'use', 'write_off', 'count', 'transfer_out', 'transfer_in', 'return'));
ALTER TABLE stock_moves DROP CONSTRAINT IF EXISTS stock_moves_doc_type_check;
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_doc_type_check
  CHECK (doc_type IN ('receipt', 'issue', 'count', 'transfer', 'return'));

-- ---------- transfers between stores / branches ----------
-- requested → dispatched (the stock leaves the sending store and sits in "Stock in transit") → received (what arrived goes
-- into the receiving store; any shortage is noted and written off to Stock losses). Cancelled only before dispatch.

CREATE SEQUENCE stock_transfers_ref_seq START 1;

CREATE TABLE stock_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text NOT NULL UNIQUE DEFAULT ('ST-' || lpad(nextval('stock_transfers_ref_seq')::text, 6, '0')),
  from_store_id   int NOT NULL REFERENCES stores (id),
  to_store_id     int NOT NULL REFERENCES stores (id),
  status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'dispatched', 'received', 'cancelled')),
  note            text,
  requested_by    uuid REFERENCES users (id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  dispatched_on   date,
  dispatched_by   uuid REFERENCES users (id),
  dispatched_at   timestamptz,
  sent_value      numeric(12, 2) NOT NULL DEFAULT 0,
  received_on     date,
  received_by     uuid REFERENCES users (id),
  received_at     timestamptz,
  received_value  numeric(12, 2) NOT NULL DEFAULT 0,
  shortage_value  numeric(12, 2) NOT NULL DEFAULT 0,
  shortage_note   text,
  cancel_reason   text,
  CHECK (from_store_id <> to_store_id),
  CHECK (shortage_value = 0 OR shortage_note IS NOT NULL)
);
CREATE INDEX stock_transfers_status_idx ON stock_transfers (status, requested_at DESC);

CREATE TABLE stock_transfer_lines (
  id            serial PRIMARY KEY,
  transfer_id   uuid NOT NULL REFERENCES stock_transfers (id) ON DELETE CASCADE,
  item_id       int NOT NULL REFERENCES items (id),
  qty           numeric(12, 2) NOT NULL CHECK (qty > 0),           -- requested
  UNIQUE (transfer_id, item_id)
);

-- What actually left, lot by lot (FEFO), and how much of each lot arrived.
CREATE TABLE stock_transfer_lots (
  id            serial PRIMARY KEY,
  transfer_id   uuid NOT NULL REFERENCES stock_transfers (id) ON DELETE CASCADE,
  item_id       int NOT NULL REFERENCES items (id),
  from_lot_id   bigint NOT NULL REFERENCES stock_lots (id),
  to_lot_id     bigint REFERENCES stock_lots (id),
  lot_no        text,
  expiry        date,
  unit_cost     numeric(12, 2) NOT NULL,
  qty_sent      numeric(12, 2) NOT NULL CHECK (qty_sent > 0),
  qty_received  numeric(12, 2) CHECK (qty_received >= 0 AND qty_received <= qty_sent)
);

-- ---------- returns to suppliers ----------
-- One lot (batch) per return. Requested by the stock keeper, approved by a different person; only then does the stock
-- leave and the amount owed to the supplier go down (Suppliers payable / Inventory at the lot's cost).

CREATE SEQUENCE supplier_returns_ref_seq START 1;

CREATE TABLE supplier_returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            text NOT NULL UNIQUE DEFAULT ('SR-' || lpad(nextval('supplier_returns_ref_seq')::text, 6, '0')),
  supplier_id    int NOT NULL REFERENCES suppliers (id),
  store_id       int NOT NULL REFERENCES stores (id),
  item_id        int NOT NULL REFERENCES items (id),
  lot_id         bigint NOT NULL REFERENCES stock_lots (id),
  receipt_id     uuid REFERENCES goods_receipts (id),
  qty            numeric(12, 2) NOT NULL CHECK (qty > 0),
  unit_cost      numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
  amount         numeric(12, 2) NOT NULL CHECK (amount >= 0),
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  returned_on    date,
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid REFERENCES users (id),
  decided_at     timestamptz,
  decision_note  text,
  CHECK (decided_by IS NULL OR decided_by IS DISTINCT FROM created_by),
  CHECK (status <> 'approved' OR returned_on IS NOT NULL)
);
CREATE INDEX supplier_returns_supplier_idx ON supplier_returns (supplier_id, status);

-- ---------- two-person supplier payments ----------
-- Prepared by one person, approved by another; approving writes the supplier_payments row and posts it.

CREATE SEQUENCE supplier_payment_requests_ref_seq START 1;

CREATE TABLE supplier_payment_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            text NOT NULL UNIQUE DEFAULT ('PR-' || lpad(nextval('supplier_payment_requests_ref_seq')::text, 6, '0')),
  supplier_id    int NOT NULL REFERENCES suppliers (id),
  bill_id        uuid REFERENCES supplier_bills (id),
  paid_on        date NOT NULL,
  amount         numeric(12, 2) NOT NULL CHECK (amount > 0),
  paid_from_id   int NOT NULL REFERENCES accounts (id),
  reference      text,
  note           text,
  status         text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'approved', 'rejected')),
  prepared_by    uuid REFERENCES users (id),
  prepared_at    timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid REFERENCES users (id),
  decided_at     timestamptz,
  decision_note  text,
  payment_id     uuid REFERENCES supplier_payments (id),
  CHECK (decided_by IS NULL OR decided_by IS DISTINCT FROM prepared_by),
  CHECK (status <> 'approved' OR payment_id IS NOT NULL)
);
CREATE INDEX supplier_payment_requests_status_idx ON supplier_payment_requests (status, prepared_at DESC);

-- ---------- purchase orders: every order is approved by someone other than who raised it ----------

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_decider_check
  CHECK (decided_by IS NULL OR decided_by IS DISTINCT FROM created_by) NOT VALID;

-- ---------- devices: calibration and laser pulse wear ----------

ALTER TABLE devices
  ADD COLUMN calibration_every_days  int CHECK (calibration_every_days BETWEEN 1 AND 1095),
  ADD COLUMN last_calibration_on     date,
  ADD COLUMN pulse_limit             bigint CHECK (pulse_limit > 0),        -- pulses between services (rated life of the handpiece / lamp)
  ADD COLUMN pulses_at_service       bigint NOT NULL DEFAULT 0 CHECK (pulses_at_service >= 0);

ALTER TABLE device_maintenance DROP CONSTRAINT IF EXISTS device_maintenance_kind_check;
ALTER TABLE device_maintenance ADD CONSTRAINT device_maintenance_kind_check CHECK (kind IN ('preventive', 'repair', 'calibration'));
ALTER TABLE device_maintenance
  ADD COLUMN pulses_reset  boolean NOT NULL DEFAULT false,
  ADD COLUMN pulse_counter bigint;                                       -- the counter when the service was done

-- ---------- device booking ----------
-- A device can't be booked twice for overlapping times (like rooms); only working devices can be booked.

CREATE SEQUENCE device_bookings_ref_seq START 1;

CREATE TABLE device_bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            text NOT NULL UNIQUE DEFAULT ('DB-' || lpad(nextval('device_bookings_ref_seq')::text, 6, '0')),
  device_id      int NOT NULL REFERENCES devices (id),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  purpose        text NOT NULL,
  room_id        int REFERENCES rooms (id),
  status         text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  booked_by      uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_by   uuid REFERENCES users (id),
  cancelled_at   timestamptz,
  cancel_reason  text,
  CHECK (ends_at > starts_at),
  CONSTRAINT device_bookings_no_device_overlap EXCLUDE USING gist (
    device_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'booked')
);
CREATE INDEX device_bookings_day_idx ON device_bookings (starts_at);

-- ---------- accounts ----------

INSERT INTO accounts (code, name_ar, name_en, type, system_key, is_money, description) VALUES
  ('1310', 'مخزون في الطريق', 'Stock in transit', 'asset', 'stock_in_transit', false, 'Stock dispatched from one store, not received yet by the other')
ON CONFLICT (code) DO NOTHING;
