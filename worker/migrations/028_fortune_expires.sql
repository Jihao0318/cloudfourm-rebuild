-- 028_fortune_expires.sql
-- 运势有效期列 + 大喇叭公告表

ALTER TABLE posts ADD COLUMN fortune_expires_at TEXT;

CREATE TABLE IF NOT EXISTS user_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
