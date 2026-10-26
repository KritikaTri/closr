-- Photo objects live in a private bucket; only the object key is stored here.
CREATE TABLE IF NOT EXISTS memory_media_assets (
  id uuid PRIMARY KEY,
  couple_id uuid REFERENCES couples(id) ON DELETE CASCADE,
  owner_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  content_type varchar(32) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 1258291),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((couple_id IS NOT NULL AND owner_user_id IS NULL) OR (couple_id IS NULL AND owner_user_id = uploaded_by)),
  FOREIGN KEY (couple_id, uploaded_by) REFERENCES couple_members(couple_id, user_id) ON DELETE CASCADE
);

-- Shared records are scoped to a couple; private reflections are scoped to
-- their author. Private records deliberately have no couple_id.
CREATE TABLE IF NOT EXISTS couple_memories (
  id uuid PRIMARY KEY,
  couple_id uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  created_by text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('important_date', 'shared_journal', 'shared_note')),
  title varchar(100) NOT NULL DEFAULT '',
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  folder varchar(40),
  body varchar(3000) NOT NULL,
  media_id uuid REFERENCES memory_media_assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (couple_id, created_by) REFERENCES couple_members(couple_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS couple_memories_browse_idx
  ON couple_memories(couple_id, kind, entry_date DESC, created_at DESC);
ALTER TABLE couple_memories ADD COLUMN IF NOT EXISTS media_id uuid REFERENCES memory_media_assets(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS couple_memories_one_media_idx ON couple_memories(media_id) WHERE media_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS private_journal_entries (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  feeling varchar(40) NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  body varchar(3000) NOT NULL,
  media_id uuid REFERENCES memory_media_assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS private_journal_owner_browse_idx
  ON private_journal_entries(owner_user_id, entry_date DESC, created_at DESC);
ALTER TABLE private_journal_entries ADD COLUMN IF NOT EXISTS media_id uuid REFERENCES memory_media_assets(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS private_journal_one_media_idx ON private_journal_entries(media_id) WHERE media_id IS NOT NULL;
