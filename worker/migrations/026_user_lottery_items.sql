-- 026_user_lottery_items.sql
-- 抽奖道具独立库存表（绕过 shop_items 的 CHECK 约束）

CREATE TABLE IF NOT EXISTS user_lottery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_meta TEXT DEFAULT '{}',
  used INTEGER DEFAULT 0,
  applied_to INTEGER DEFAULT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_lottery_items ON user_lottery_items(user_id, used);
