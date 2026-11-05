-- Identity and access: branches, roles, permissions, accounts, sessions, temporary cover,
-- password reset requests, patient registrations and the append-only activity log.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE branches (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,6}$'),
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  address_ar  text,
  address_en  text,
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  code          text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('staff', 'patient')),
  name_ar       text NOT NULL,
  name_en       text NOT NULL,
  requires_mfa  boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0
);

CREATE TABLE permissions (
  code     text PRIMARY KEY,
  module   text NOT NULL,
  name_ar  text NOT NULL,
  name_en  text NOT NULL
);

CREATE TABLE role_permissions (
  role_code        text NOT NULL REFERENCES roles (code) ON DELETE CASCADE,
  permission_code  text NOT NULL REFERENCES permissions (code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                  text NOT NULL CHECK (kind IN ('staff', 'patient')),
  full_name_ar          text NOT NULL,
  full_name_en          text,
  name_search           text NOT NULL,
  email                 citext UNIQUE,
  phone                 text UNIQUE,
  password_hash         text NOT NULL,
  must_change_password  boolean NOT NULL DEFAULT false,
  password_changed_at   timestamptz,
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_secret            text,
  mfa_pending_secret    text,
  mfa_last_step         bigint,
  failed_attempts       int NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  is_active             boolean NOT NULL DEFAULT true,
  deactivated_at        timestamptz,
  deactivated_reason    text,
  preferred_lang        text NOT NULL DEFAULT 'ar' CHECK (preferred_lang IN ('ar', 'en')),
  last_login_at         timestamptz,
  last_login_ip         text,
  previous_login_at     timestamptz,
  previous_login_ip     text,
  created_by            uuid REFERENCES users (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK (kind = 'patient' OR email IS NOT NULL)
);
CREATE INDEX users_kind_idx ON users (kind);
CREATE INDEX users_name_search_idx ON users (name_search);

-- A role held permanently. branch_id NULL means "all branches".
CREATE TABLE user_roles (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id),
  role_code   text NOT NULL REFERENCES roles (code),
  branch_id   int REFERENCES branches (id),
  granted_by  uuid REFERENCES users (id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, role_code, branch_id)
);
CREATE INDEX user_roles_user_idx ON user_roles (user_id);

-- Temporary cover: from_user's role is lent to to_user between starts_at and ends_at.
CREATE TABLE delegations (
  id            bigserial PRIMARY KEY,
  from_user_id  uuid NOT NULL REFERENCES users (id),
  to_user_id    uuid NOT NULL REFERENCES users (id),
  role_code     text NOT NULL REFERENCES roles (code),
  branch_id     int REFERENCES branches (id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reason        text NOT NULL,
  created_by    uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users (id),
  CHECK (ends_at > starts_at),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX delegations_to_idx ON delegations (to_user_id) WHERE revoked_at IS NULL;

-- Server-side sessions. Only a SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash        text NOT NULL UNIQUE,
  user_id           uuid NOT NULL REFERENCES users (id),
  active_role       text REFERENCES roles (code),
  active_branch_id  int REFERENCES branches (id),
  mfa_passed        boolean NOT NULL DEFAULT false,
  mfa_failures      int NOT NULL DEFAULT 0,
  ip                text,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- "Forgot password" requests, handled by an admin after verifying the person's identity.
CREATE TABLE password_reset_requests (
  id          bigserial PRIMARY KEY,
  identifier  text NOT NULL,
  user_id     uuid REFERENCES users (id),
  ip          text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  handled_by  uuid REFERENCES users (id),
  handled_at  timestamptz
);
CREATE INDEX password_reset_requests_status_idx ON password_reset_requests (status, created_at DESC);

CREATE SEQUENCE patients_mrn_seq START 1;

CREATE TABLE patients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn                text NOT NULL UNIQUE DEFAULT ('GC-' || lpad(nextval('patients_mrn_seq')::text, 6, '0')),
  user_id            uuid UNIQUE REFERENCES users (id),
  full_name_ar       text NOT NULL,
  full_name_en       text,
  name_search        text NOT NULL,
  phone              text NOT NULL,
  email              citext,
  date_of_birth      date NOT NULL,
  gender             text NOT NULL CHECK (gender IN ('female', 'male')),
  consent_terms_at   timestamptz NOT NULL,
  consent_messages   boolean NOT NULL DEFAULT false,
  registered_via     text NOT NULL DEFAULT 'self' CHECK (registered_via IN ('self', 'reception')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_name_search_idx ON patients (name_search);
CREATE INDEX patients_phone_idx ON patients (phone);

-- Activity log: who did what, when, from where. Rows can never be changed or removed.
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid REFERENCES users (id),
  actor_label  text,
  actor_role   text,
  action       text NOT NULL,
  entity       text,
  entity_id    text,
  branch_id    int REFERENCES branches (id),
  ip           text,
  user_agent   text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_action_idx ON audit_log (action);

CREATE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END
$$;

CREATE TRIGGER audit_log_no_change
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
