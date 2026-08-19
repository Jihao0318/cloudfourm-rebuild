-- 010_lottery.sql: 签到抽奖系统

-- 抽奖记录表
CREATE TABLE IF NOT EXISTS lottery_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  prize_name TEXT NOT NULL,
  prize_coins INTEGER DEFAULT 0,
  prize_type TEXT DEFAULT 'coins',
  prize_value TEXT,
  cycle INTEGER NOT NULL,
  claimed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_lottery_user_cycle ON lottery_records(user_id, cycle);
CREATE INDEX IF NOT EXISTS idx_lottery_user_unclaimed ON lottery_records(user_id, claimed);

-- 重建 coin_transactions 移除 CHECK 约束以支持新类型
ALTER TABLE coin_transactions RENAME TO coin_transactions_old;

CREATE TABLE IF NOT EXISTS coin_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO coin_transactions (id, user_id, type, amount, balance_after, description, created_at)
  SELECT id, user_id, type, amount, balance_after, description, created_at FROM coin_transactions_old;

DROP TABLE coin_transactions_old;

CREATE INDEX IF NOT EXISTS idx_coin_tx_user ON coin_transactions(user_id, created_at);
