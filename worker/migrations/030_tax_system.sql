-- 030_tax_system.sql
-- 积分个税系统

-- users 表新增字段
ALTER TABLE users ADD COLUMN usr_tax_arrears INT DEFAULT 0;
ALTER TABLE users ADD COLUMN usr_yearly_tax INT DEFAULT 0;
ALTER TABLE users ADD COLUMN usr_sign_days INT DEFAULT 0;
ALTER TABLE users ADD COLUMN usr_tax_month TEXT;  -- '2026-06' 标记当月已扣

-- 精华帖计数（在 posts 表加标记）
ALTER TABLE posts ADD COLUMN is_essence INT DEFAULT 0;

-- 税务流水表
CREATE TABLE IF NOT EXISTS tax_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INT NOT NULL,           -- 正=扣税 负=退税
  tax_type TEXT NOT NULL,        -- 'monthly' 月度汇缴 / 'occasional' 偶然所得 / 'refund' 退税
  month TEXT,                    -- '2026-06' 所属月份
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tax_logs_user ON tax_logs(user_id, month);
