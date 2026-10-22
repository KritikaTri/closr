-- Apply after Better Auth's own PostgreSQL schema migration.
-- Each user can belong to one couple, and each couple has at most two members.
CREATE TABLE IF NOT EXISTS couples (
  id uuid PRIMARY KEY,
  name text NOT NULL DEFAULT 'Our space',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS couple_members (
  couple_id uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, user_id)
);

CREATE TABLE IF NOT EXISTS couple_invites (
  id uuid PRIMARY KEY,
  couple_id uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS couple_invites_open_idx
  ON couple_invites(couple_id, expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS couple_statuses (
  couple_id uuid NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'quiet', 'away', 'custom')),
  custom_message varchar(120) NOT NULL DEFAULT '',
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, user_id),
  FOREIGN KEY (couple_id, user_id) REFERENCES couple_members(couple_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS couple_messages (
  id uuid PRIMARY KEY,
  couple_id uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  body varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (couple_id, sender_id) REFERENCES couple_members(couple_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS couple_messages_recent_idx ON couple_messages(couple_id, created_at DESC);

-- Only conversations explicitly sent to the shared Closer space are persisted.
-- Private Closer conversations remain outside this table.
CREATE TABLE IF NOT EXISTS couple_closer_messages (
  id uuid PRIMARY KEY,
  couple_id uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  sender_id text,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  body varchar(4000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (couple_id, sender_id) REFERENCES couple_members(couple_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS couple_closer_messages_recent_idx ON couple_closer_messages(couple_id, created_at DESC);

CREATE TABLE IF NOT EXISTS couple_pings (
  id uuid PRIMARY KEY,
  couple_id uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  recipient_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  FOREIGN KEY (couple_id, sender_id) REFERENCES couple_members(couple_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (couple_id, recipient_id) REFERENCES couple_members(couple_id, user_id) ON DELETE CASCADE,
  CHECK (sender_id <> recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS couple_pings_one_pending_idx
  ON couple_pings(couple_id, sender_id, recipient_id) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS couple_pings_inbox_idx ON couple_pings(couple_id, recipient_id, created_at DESC);
