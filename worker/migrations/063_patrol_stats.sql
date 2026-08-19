-- 巡查员战绩统计表（等级 + 累计计数 + 当日计数）
-- 巡查等级纯计算不存列（patrol_exp 推等级），last_rewarded_patrol_level 防并发重复发放升级礼包
CREATE TABLE IF NOT EXISTS user_patrol_stats (
  user_id INTEGER PRIMARY KEY,
  patrol_exp INTEGER NOT NULL DEFAULT 0,
  last_rewarded_patrol_level INTEGER NOT NULL DEFAULT 0,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  total_passes INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  total_violations INTEGER NOT NULL DEFAULT 0,
  total_confirms INTEGER NOT NULL DEFAULT 0,
  total_clears INTEGER NOT NULL DEFAULT 0,
  total_takedowns INTEGER NOT NULL DEFAULT 0,
  today_count INTEGER NOT NULL DEFAULT 0,
  today_date TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
