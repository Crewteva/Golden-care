-- Complaints & requests desk: every complaint, request or suggestion is logged, assigned, answered within a
-- deadline that depends on its priority, and followed until it is resolved. Its history is never edited.

CREATE SEQUENCE tickets_ref_seq START 1;

CREATE TABLE tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            text NOT NULL UNIQUE DEFAULT ('CR-' || lpad(nextval('tickets_ref_seq')::text, 6, '0')),
  kind           text NOT NULL CHECK (kind IN ('complaint', 'request', 'suggestion', 'compliment')),
  channel        text NOT NULL CHECK (channel IN ('in_person', 'phone', 'whatsapp', 'portal', 'website', 'social', 'other')),
  category       text NOT NULL DEFAULT 'other'
                 CHECK (category IN ('waiting', 'staff', 'doctor', 'treatment', 'billing', 'booking', 'cleanliness', 'results', 'other')),
  priority       text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  patient_id     uuid REFERENCES patients (id),
  contact_name   text,
  contact_phone  text,
  subject        text NOT NULL,
  details        text NOT NULL,
  appointment_id uuid REFERENCES appointments (id),
  assigned_to    uuid REFERENCES users (id),
  due_at         timestamptz NOT NULL,
  resolution     text,                -- what was done; shown to the patient
  resolved_at    timestamptz,
  closed_at      timestamptz,
  created_by     uuid REFERENCES users (id),   -- empty when the patient sent it from the portal
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (patient_id IS NOT NULL OR contact_name IS NOT NULL),
  CHECK (status NOT IN ('resolved', 'closed') OR resolution IS NOT NULL)
);
CREATE INDEX tickets_status_idx ON tickets (status, due_at);
CREATE INDEX tickets_patient_idx ON tickets (patient_id, created_at DESC);
CREATE INDEX tickets_assignee_idx ON tickets (assigned_to, status);

CREATE TABLE ticket_events (
  id           bigserial PRIMARY KEY,
  ticket_id    uuid NOT NULL REFERENCES tickets (id),
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid REFERENCES users (id),
  actor_label  text,
  action       text NOT NULL,           -- created, assigned, status, priority, comment
  from_value   text,
  to_value     text,
  body         text
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, at);
CREATE TRIGGER ticket_events_append_only BEFORE UPDATE OR DELETE ON ticket_events FOR EACH ROW EXECUTE FUNCTION append_only();
