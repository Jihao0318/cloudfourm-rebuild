-- 042_paid_posts.sql
-- 付费/密码帖子：允许发帖时设置查看价格或密码（可同时开启，密码优先）

ALTER TABLE posts ADD COLUMN price INTEGER;
ALTER TABLE posts ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS post_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('paid', 'password')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_access_post_user_type ON post_access(post_id, user_id, type);
