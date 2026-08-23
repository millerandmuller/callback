-- Callback schema. One migration file (Section 13: "deliberately quick and dirty").
-- namespace: 'own' is the persona test channel (posting-enabled); any other value is a
-- dry-run channel handle (read-only, E5). This keeps posting mechanically impossible
-- outside the 'own' namespace -- see src/posting/posting.js.

CREATE TABLE IF NOT EXISTS namespaces (
  name TEXT PRIMARY KEY,           -- 'own' or the dry-run channel handle
  kind TEXT NOT NULL CHECK (kind IN ('own', 'dryrun')),
  channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT NOT NULL,                -- YouTube video id
  namespace TEXT NOT NULL REFERENCES namespaces(name),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  comments_enabled INTEGER NOT NULL DEFAULT 1, -- 0 = "comments off" row (D-19), not an error
  captions_available INTEGER NOT NULL DEFAULT 0,
  last_harvested_at TEXT,
  last_polled_at TEXT,
  PRIMARY KEY (id, namespace)
);

-- Raw harvested comments (F1). is_ask / is_abusive are filled in by the Mind's
-- extraction pass (F2); NULL means "not yet classified".
CREATE TABLE IF NOT EXISTS comments (
  id TEXT NOT NULL,                -- YouTube comment id
  namespace TEXT NOT NULL REFERENCES namespaces(name),
  video_id TEXT NOT NULL,
  author_channel_id TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  text TEXT NOT NULL,
  published_at TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  is_owner_reply INTEGER NOT NULL DEFAULT 0,  -- harvested creator replies, used as E2 voice examples
  is_ask INTEGER,                              -- NULL until classified, then 0/1
  is_abusive INTEGER,                           -- NULL until classified, then 0/1
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id, namespace),
  FOREIGN KEY (video_id, namespace) REFERENCES videos(id, namespace)
);

-- One row per person, per namespace (Principle 2: the asker is the unit).
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asker_channel_id TEXT NOT NULL,
  namespace TEXT NOT NULL REFERENCES namespaces(name),
  display_name TEXT NOT NULL,
  is_creator INTEGER NOT NULL DEFAULT 0,        -- E4 cached flag
  creator_subscriber_count INTEGER,
  creator_checked_at TEXT,
  UNIQUE (asker_channel_id, namespace)
);

-- One logical ask per (person, topic). UNIQUE(person_id, topic) is the never-twice
-- guard at the schema level (E3): a second raw comment about the same topic from the
-- same person adds an ask_events row (below), never a second asks row.
CREATE TABLE IF NOT EXISTS asks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id),
  namespace TEXT NOT NULL REFERENCES namespaces(name),
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  first_asked_at TEXT NOT NULL,
  last_asked_at TEXT NOT NULL,
  reply_id TEXT,                                -- YouTube reply comment id once posted
  replied_at TEXT,
  reply_url TEXT,
  UNIQUE (person_id, topic)
);

-- Every raw instance of an ask (first time and every "again"). Drives the ledger row's
-- "asked Sun · again Tue" display and the ask's last_asked_at.
CREATE TABLE IF NOT EXISTS ask_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ask_id INTEGER NOT NULL REFERENCES asks(id),
  comment_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  quote TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (comment_id, namespace) REFERENCES comments(id, namespace)
);

-- One approval batch per matched video (F5). id is an unguessable token (crypto random),
-- not an autoincrement int, because the approval page has no auth (Section 14).
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL REFERENCES namespaces(name),
  video_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'posted', 'partial')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  approved_at TEXT
);

-- One drafted reply per ask inside a batch (F4 draft, F5 approve/strike, F6 post outcome).
CREATE TABLE IF NOT EXISTS batch_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  ask_id INTEGER NOT NULL REFERENCES asks(id),
  reply_text TEXT NOT NULL,
  timestamp_pointer TEXT,                        -- m:ss, only ever set when captions existed (E7)
  status TEXT NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted', 'struck', 'approved', 'posted', 'failed')),
  reply_comment_id TEXT,
  reply_published_at TEXT,
  error TEXT
);

-- Quota units spent per Pacific calendar day (F7). Reads cost 1, inserts cost 50 (D-09).
CREATE TABLE IF NOT EXISTS quota_ledger (
  day TEXT PRIMARY KEY,                          -- YYYY-MM-DD in America/Los_Angeles
  units_used INTEGER NOT NULL DEFAULT 0
);

-- Replies that could not be posted because quota ran out before the Pacific-midnight
-- reset; queued instead of failed (T-04).
CREATE TABLE IF NOT EXISTS post_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_reply_id INTEGER NOT NULL REFERENCES batch_replies(id),
  queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asks_status ON asks(namespace, status);
CREATE INDEX IF NOT EXISTS idx_ask_events_ask ON ask_events(ask_id);
CREATE INDEX IF NOT EXISTS idx_batch_replies_batch ON batch_replies(batch_id);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id, namespace);
