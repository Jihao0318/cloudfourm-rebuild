-- 025_vip_tickets.sql
-- VIP 体验券表 — 抽中的 VIP 放入仓库，用户自行决定使用

CREATE TABLE IF NOT EXISTS user_vip_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tier TEXT NOT NULL,
  days INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vip_tickets_user ON user_vip_tickets(user_id, used);
