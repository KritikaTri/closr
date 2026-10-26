CREATE TABLE journal_folders (
  id uuid PRIMARY KEY,
  owner_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  couple_id uuid REFERENCES couples(id) ON DELETE CASCADE,
  name varchar(60) NOT NULL CHECK (char_length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (couple_id IS NOT NULL))
);
CREATE UNIQUE INDEX journal_folders_private_name ON journal_folders(owner_user_id, lower(name)) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX journal_folders_shared_name ON journal_folders(couple_id, lower(name)) WHERE couple_id IS NOT NULL;

CREATE TABLE journal_pages (
  id uuid PRIMARY KEY,
  owner_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  couple_id uuid REFERENCES couples(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES journal_folders(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('page', 'date')),
  title varchar(120) NOT NULL DEFAULT '',
  date_from date NOT NULL,
  date_to date NOT NULL,
  description varchar(3000) NOT NULL DEFAULT '',
  feeling varchar(40) NOT NULL DEFAULT '',
  has_canvas boolean NOT NULL DEFAULT false,
  design jsonb NOT NULL DEFAULT '{"v":1,"paper":"#fbf7ef","pattern":"plain","nodes":[]}',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((owner_user_id IS NOT NULL) <> (couple_id IS NOT NULL)),
  CHECK (date_to >= date_from)
);
CREATE INDEX journal_pages_private_browse ON journal_pages(owner_user_id, updated_at DESC, id);
CREATE INDEX journal_pages_shared_browse ON journal_pages(couple_id, updated_at DESC, id);
CREATE TABLE journal_page_media (
  page_id uuid NOT NULL REFERENCES journal_pages(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES memory_media_assets(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, media_id)
);

-- Preserve existing entries, authorship, dates, photos and private/shared scope.
INSERT INTO journal_folders(id, couple_id, name)
SELECT gen_random_uuid(), couple_id, min(folder) FROM couple_memories
 WHERE kind = 'shared_journal' AND folder IS NOT NULL AND btrim(folder) <> '' GROUP BY couple_id, lower(folder);

INSERT INTO journal_pages(id, owner_user_id, created_by, kind, title, date_from, date_to, description, feeling, has_canvas, design, created_at, updated_at)
SELECT id, owner_user_id, owner_user_id, 'page', feeling, entry_date, entry_date, body, feeling, true,
 jsonb_build_object('v',1,'paper','#fbf7ef','pattern','lined','nodes',
 jsonb_build_array(
   jsonb_build_object('id',gen_random_uuid(),'type','text','x',65,'y',65,'w',670,'h',90,'rotation',0,'text',feeling,'font','serif','fontSize',42,'color','#4b5644'),
   jsonb_build_object('id',gen_random_uuid(),'type','text','x',65,'y',if_photo,'w',670,'h',320,'rotation',0,'text',body,'font','serif','fontSize',22,'color','#5f665a'))
 || CASE WHEN media_id IS NOT NULL THEN jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'type','image','x',130,'y',180,'w',540,'h',390,'rotation',-2,'mediaId',media_id,'caption','','frame','postcard','cropX',50,'cropY',50)) ELSE '[]'::jsonb END), created_at, created_at
FROM (SELECT *, CASE WHEN media_id IS NULL THEN 190 ELSE 640 END AS if_photo FROM private_journal_entries) j;

INSERT INTO journal_pages(id, couple_id, created_by, folder_id, kind, title, date_from, date_to, description, has_canvas, design, created_at, updated_at)
SELECT m.id, m.couple_id, m.created_by, f.id, CASE WHEN m.kind = 'important_date' THEN 'date' ELSE 'page' END, m.title, m.entry_date, m.entry_date, m.body, m.kind <> 'important_date',
 jsonb_build_object('v',1,'paper','#fbf7ef','pattern','plain','nodes',
 jsonb_build_array(
   jsonb_build_object('id',gen_random_uuid(),'type','text','x',65,'y',65,'w',670,'h',90,'rotation',0,'text',m.title,'font','serif','fontSize',42,'color','#4b5644'),
   jsonb_build_object('id',gen_random_uuid(),'type','text','x',65,'y',CASE WHEN m.media_id IS NULL THEN 190 ELSE 640 END,'w',670,'h',320,'rotation',0,'text',m.body,'font','serif','fontSize',22,'color','#5f665a'))
 || CASE WHEN m.media_id IS NOT NULL THEN jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'type','image','x',130,'y',180,'w',540,'h',390,'rotation',-2,'mediaId',m.media_id,'caption','','frame','postcard','cropX',50,'cropY',50)) ELSE '[]'::jsonb END), m.created_at, m.created_at
FROM couple_memories m LEFT JOIN journal_folders f ON f.couple_id = m.couple_id AND lower(f.name) = lower(m.folder) WHERE m.kind IN ('important_date','shared_journal');

INSERT INTO journal_page_media(page_id, media_id)
SELECT id, media_id FROM private_journal_entries WHERE media_id IS NOT NULL
UNION ALL SELECT id, media_id FROM couple_memories WHERE kind IN ('important_date','shared_journal') AND media_id IS NOT NULL;
