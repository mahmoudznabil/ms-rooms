-- Test-account cleanup. Children must go before parents: rooms/seats/sessions
-- all reference users, and D1 enforces FKs.
DELETE FROM rtc_signals WHERE from_user_id IN (
  SELECT id FROM users WHERE username IN ('sigA','sigB','qa','qb','qc','testfix','cookiechk')
);
DELETE FROM seats WHERE user_id IN (
  SELECT id FROM users WHERE username IN ('sigA','sigB','qa','qb','qc','testfix','cookiechk')
);
DELETE FROM rooms WHERE host_user_id IN (
  SELECT id FROM users WHERE username IN ('sigA','sigB','qa','qb','qc','testfix','cookiechk')
);
DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users WHERE username IN ('sigA','sigB','qa','qb','qc','testfix','cookiechk')
);
DELETE FROM conversations WHERE created_by IN (
  SELECT id FROM users WHERE username IN ('sigA','sigB','qa','qb','qc','testfix','cookiechk')
);
DELETE FROM users WHERE username IN ('sigA','sigB','qa','qb','qc','testfix','cookiechk');
DELETE FROM rtc_signals;
