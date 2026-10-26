-- Closer display names are independent of the name supplied by Google OAuth.
-- A missing row means the member has not chosen a nickname (or has reset it).
CREATE TABLE IF NOT EXISTS closer_profiles (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  nickname varchar(40) NOT NULL CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 40),
  updated_at timestamptz NOT NULL DEFAULT now()
);
