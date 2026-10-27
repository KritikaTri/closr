CREATE TABLE journal_recordings (
  id uuid PRIMARY KEY,
  page_id uuid UNIQUE REFERENCES journal_pages(id) ON DELETE CASCADE,
  owner_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  couple_id uuid REFERENCES couples(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES journal_folders(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('audio', 'video')),
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 25165824),
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 600000),
  title varchar(120) NOT NULL,
  entry_date date NOT NULL,
  note varchar(3000) NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','ready','discarded')),
  object_path text,
  upload_token uuid,
  upload_attempts integer NOT NULL DEFAULT 0 CHECK (upload_attempts BETWEEN 0 AND 5),
  lease_until timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (couple_id IS NOT NULL)),
  CHECK ((status = 'ready') = (page_id IS NOT NULL)),
  CHECK (kind <> 'video' OR duration_ms <= 180000)
);
CREATE INDEX journal_recordings_upload_budget ON journal_recordings(uploaded_by, created_at DESC);
CREATE INDEX journal_recordings_pending_cleanup ON journal_recordings(expires_at) WHERE status IN ('pending','uploading');
