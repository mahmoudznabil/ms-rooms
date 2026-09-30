-- WebRTC signaling relay for Cloudflare TURN media.
-- TURN supplies NAT traversal + relay, but peers still need a way to exchange
-- SDP offers/answers and ICE candidates. These rows are short-lived queue
-- entries: a publisher writes, the addressee polls and consumes.
CREATE TABLE IF NOT EXISTS rtc_signals (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);

-- Hot path is "give me everything addressed to me in this room, oldest first".
CREATE INDEX IF NOT EXISTS idx_rtc_signals_poll ON rtc_signals(room_id, to_user_id, created_at);

-- Housekeeping: drop entries nobody claimed (closed tabs, departed peers).
CREATE INDEX IF NOT EXISTS idx_rtc_signals_created ON rtc_signals(created_at);
