-- 通知系统
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,        -- 接收通知的用户
  actor_id INTEGER,                 -- 触发通知的用户（可为空，系统通知）
  type TEXT NOT NULL,               -- reply / like_post / like_comment / system
  post_id INTEGER,
  comment_id INTEGER,
  content TEXT,                     -- 简短摘要
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = 0;
