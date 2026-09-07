PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  host_user_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Chat',
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'scheduled', 'ended')),
  listener_count INTEGER NOT NULL DEFAULT 0 CHECK (listener_count >= 0),
  speaker_count INTEGER NOT NULL DEFAULT 0 CHECK (speaker_count BETWEEN 0 AND 8),
  cover_color TEXT NOT NULL DEFAULT '#2c3140',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  seat_index INTEGER NOT NULL CHECK (seat_index BETWEEN 0 AND 7),
  user_id TEXT,
  role TEXT NOT NULL DEFAULT 'listener' CHECK (role IN ('host', 'speaker', 'listener')),
  is_muted INTEGER NOT NULL DEFAULT 0 CHECK (is_muted IN (0, 1)),
  joined_at TEXT,
  UNIQUE (room_id, seat_index),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  room_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('daily_reward', 'purchase', 'gift_sent', 'gift_received', 'refund')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_status_updated
  ON rooms (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_seats_room
  ON seats (room_id, seat_index);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON transactions (user_id, created_at DESC);

INSERT OR IGNORE INTO users (id, username, display_name, bio, coins)
VALUES
  ('user-maya', 'mayarose', 'Maya Rose', 'Finding the good frequencies.', 2480),
  ('user-omar', 'omarsound', 'Omar Sound', 'Producer, listener, night owl.', 920),
  ('user-jules', 'julesafterdark', 'Jules After Dark', 'Late-night conversations.', 1540);

INSERT OR IGNORE INTO rooms
  (id, slug, title, description, host_user_id, category, status, listener_count, speaker_count, cover_color)
VALUES
  ('room-late-check-in', 'late-check-in', 'Late Check-In', 'A soft place to land after a long day.', 'user-maya', 'Chill', 'live', 1842, 5, '#5e6579'),
  ('room-behind-the-beat', 'behind-the-beat', 'Behind the Beat', 'Unreleased loops, honest opinions, zero skips.', 'user-omar', 'Music', 'live', 936, 4, '#7c5948'),
  ('room-tiny-joys', 'tiny-joys', 'Tiny Joys Club', 'Share the small things keeping you going.', 'user-jules', 'Community', 'live', 428, 3, '#526d64');

INSERT OR IGNORE INTO seats (room_id, seat_index, user_id, role, is_muted, joined_at)
VALUES
  ('room-late-check-in', 0, 'user-maya', 'host', 0, CURRENT_TIMESTAMP),
  ('room-late-check-in', 1, 'user-omar', 'speaker', 0, CURRENT_TIMESTAMP),
  ('room-late-check-in', 2, 'user-jules', 'speaker', 1, CURRENT_TIMESTAMP);
