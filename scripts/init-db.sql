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
  gems INTEGER NOT NULL DEFAULT 0 CHECK (gems >= 0),
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

-- Triple-Currency / Admin / Support (spec)
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('master_admin','finance','support')),
  password_hash TEXT NOT NULL,
  firebase_uid TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS admin_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('ADD_COINS','DEDUCT_COINS','ADD_GEMS','DEDUCT_GEMS','ADD_XP','DEDUCT_XP')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('recharge','account','technical','moderation','other')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  assigned_admin_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS ticket_replies (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author_admin_id TEXT,
  author_user_id TEXT,
  message TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pricing_tiers (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL UNIQUE CHECK (tier IN ('starter','growth','pro','enterprise')),
  standard_coins INTEGER NOT NULL,
  standard_price_cents INTEGER NOT NULL,
  app_coins INTEGER NOT NULL,
  app_price_cents INTEGER NOT NULL,
  bonus_percent REAL NOT NULL DEFAULT 10.0
);
INSERT OR IGNORE INTO admin_users (id, username, display_name, role, password_hash) VALUES
  ('admin-master', 'master', 'Master Admin', 'master_admin', '3eb3fe66b31e0ea2f5892c6daf441a28f9013d07c3a5a3c5d1b9b4f3a8a3c5e3b4'),
  ('admin-finance', 'finance', 'Finance Agent', 'finance', '3eb3fe66b31e0ea2f5892c6daf441a28f9013d07c3a5a3c5d1b9b4f3a8a3c5e3b4'),
  ('admin-support', 'support', 'Support Agent', 'support', '3eb3fe66b31e0ea2f5892c6daf441a28f9013d07c3a5a3c5d1b9b4f3a8a3c5e3b4');
INSERT OR IGNORE INTO pricing_tiers (id, tier, standard_coins, standard_price_cents, app_coins, app_price_cents, bonus_percent) VALUES
  ('tier-starter', 'starter', 25000, 500, 27500, 500, 10.0),
  ('tier-growth', 'growth', 50000, 1000, 55000, 1000, 10.0),
  ('tier-pro', 'pro', 100000, 2000, 110000, 2000, 10.0),
  ('tier-enterprise', 'enterprise', 500000, 10000, 550000, 10000, 10.0);

INSERT OR IGNORE INTO users (id, username, display_name, avatar_url, frame_style, id_tag, bio, xp, level, coins, gems, streak)
VALUES
  ('user-maya', 'mayarose', 'Maya Rose', 'https://i.pravatar.cc/200?img=5', 'aurora', 'MAYA#1842', 'Finding the good frequencies.', 2400, 12, 2480, 150, 5),
  ('user-omar', 'omarsound', 'Omar Sound', 'https://i.pravatar.cc/200?img=12', 'neon', 'OMAR#936', 'Producer, listener, night owl.', 1180, 7, 920, 80, 2),
  ('user-jules', 'julesafterdark', 'Jules After Dark', 'https://i.pravatar.cc/200?img=9', 'glow', 'JULES#428', 'Late-night conversations.', 860, 5, 1540, 40, 3);

-- No seeded rooms: rooms are only opened by users for others to join (per spec)
-- Rooms are created via POST /api/rooms and appear in lobby only when live

-- Feature 5: Chat/Messaging System
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group', 'room')),
  room_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_at TEXT,
  muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0,1)),
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'audio', 'file', 'system')),
  reply_to_id TEXT,
  metadata TEXT, -- JSON for extra data (translations, AI summaries, etc.)
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_room ON conversations (room_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage_events (feature, created_at DESC);
