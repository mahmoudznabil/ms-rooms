PRAGMA foreign_keys = ON;

-- Feature 1.1: Guest & Social Auth Engine + Profile Foundation
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  frame_style TEXT NOT NULL DEFAULT 'default' CHECK (frame_style IN ('default','glow','neon','gold','aurora')),
  id_tag TEXT NOT NULL UNIQUE,
  bio TEXT NOT NULL DEFAULT '',
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  last_checkin TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Feature 2.1: Room Creation & Lobby Feed (custom titles, locking, capacity tags)
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  host_user_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Chat',
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'scheduled', 'ended')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  capacity INTEGER NOT NULL DEFAULT 8 CHECK (capacity IN (4,8,12)),
  listener_count INTEGER NOT NULL DEFAULT 0 CHECK (listener_count >= 0),
  speaker_count INTEGER NOT NULL DEFAULT 0 CHECK (speaker_count BETWEEN 0 AND 12),
  cover_color TEXT NOT NULL DEFAULT '#2c3140',
  pk_active INTEGER NOT NULL DEFAULT 0 CHECK (pk_active IN (0,1)),
  pk_started_at TEXT,
  pk_ends_at TEXT,
  game_active TEXT CHECK (game_active IN ('none','ludo','reaction')) DEFAULT 'none',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- Feature 2.2: 8-Seat Interactive Speaker Grid (scales to 12)
CREATE TABLE IF NOT EXISTS seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  seat_index INTEGER NOT NULL CHECK (seat_index BETWEEN 0 AND 11),
  user_id TEXT,
  role TEXT NOT NULL DEFAULT 'listener' CHECK (role IN ('host', 'speaker', 'listener')),
  is_muted INTEGER NOT NULL DEFAULT 0 CHECK (is_muted IN (0, 1)),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0,1)),
  joined_at TEXT,
  UNIQUE (room_id, seat_index),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Feature 3.1/3.2: Economy & Gifting
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  room_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('daily_reward', 'streak_bonus', 'purchase', 'gift_sent', 'gift_received', 'refund', 'xp_boost')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

-- Feature 1.2: XP + Level Badges, Feature 1.1: Sessions (persistent Guest IDs)
CREATE TABLE IF NOT EXISTS xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  reason TEXT NOT NULL DEFAULT '',
  room_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Feature 4.2: Room-to-Room PK Battle System
CREATE TABLE IF NOT EXISTS pk_battles (
  id TEXT PRIMARY KEY,
  room_a_id TEXT NOT NULL,
  room_b_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  score_a INTEGER NOT NULL DEFAULT 0 CHECK (score_a >= 0),
  score_b INTEGER NOT NULL DEFAULT 0 CHECK (score_b >= 0),
  winner_room_id TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_a_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (room_b_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (winner_room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

-- Feature 4.1: Embedded HTML5 Casual Games
CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  game_type TEXT NOT NULL CHECK (game_type IN ('ludo','reaction','none')),
  state_json TEXT NOT NULL DEFAULT '{}',
  current_turn_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','finished')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (current_turn_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_status_updated ON rooms (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_seats_room ON seats (room_id, seat_index);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_user_created ON xp_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_pk_status ON pk_battles (status, ends_at);
CREATE INDEX IF NOT EXISTS idx_game_room ON game_sessions (room_id, status);

INSERT OR IGNORE INTO users (id, username, display_name, avatar_url, frame_style, id_tag, bio, xp, level, coins, streak)
VALUES
  ('user-maya', 'mayarose', 'Maya Rose', 'https://i.pravatar.cc/200?img=5', 'aurora', 'MAYA#1842', 'Finding the good frequencies.', 2400, 12, 2480, 5),
  ('user-omar', 'omarsound', 'Omar Sound', 'https://i.pravatar.cc/200?img=12', 'neon', 'OMAR#936', 'Producer, listener, night owl.', 1180, 7, 920, 2),
  ('user-jules', 'julesafterdark', 'Jules After Dark', 'https://i.pravatar.cc/200?img=9', 'glow', 'JULES#428', 'Late-night conversations.', 860, 5, 1540, 3);

INSERT OR IGNORE INTO rooms
  (id, slug, title, description, host_user_id, category, status, locked, capacity, listener_count, speaker_count, cover_color)
VALUES
  ('room-late-check-in', 'late-check-in', 'Late Check-In', 'A soft place to land after a long day.', 'user-maya', 'Chill', 'live', 0, 8, 1842, 5, '#5e6579'),
  ('room-behind-the-beat', 'behind-the-beat', 'Behind the Beat', 'Unreleased loops, honest opinions, zero skips.', 'user-omar', 'Music', 'live', 0, 8, 936, 4, '#7c5948'),
  ('room-tiny-joys', 'tiny-joys', 'Tiny Joys Club', 'Share the small things keeping you going.', 'user-jules', 'Community', 'live', 0, 12, 428, 3, '#526d64'),
  ('room-night-owl', 'night-owl', 'Night Owl Radio', 'Lo-fi beats for sleepless minds.', 'user-maya', 'Chill', 'live', 1, 4, 312, 2, '#4a5568');

INSERT OR IGNORE INTO seats (room_id, seat_index, user_id, role, is_muted, is_locked, joined_at)
VALUES
  ('room-late-check-in', 0, 'user-maya', 'host', 0, 0, CURRENT_TIMESTAMP),
  ('room-late-check-in', 1, 'user-omar', 'speaker', 0, 0, CURRENT_TIMESTAMP),
  ('room-late-check-in', 2, 'user-jules', 'speaker', 1, 0, CURRENT_TIMESTAMP),
  ('room-late-check-in', 3, NULL, 'listener', 0, 0, NULL),
  ('room-behind-the-beat', 0, 'user-omar', 'host', 0, 0, CURRENT_TIMESTAMP),
  ('room-tiny-joys', 0, 'user-jules', 'host', 0, 0, CURRENT_TIMESTAMP);
