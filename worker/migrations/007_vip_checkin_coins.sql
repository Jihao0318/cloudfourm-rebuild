-- 007_vip_checkin_coins.sql: VIP会员 + 每日签到 + 论坛货币

-- 用户余额表
CREATE TABLE IF NOT EXISTS user_balances (
  user_id INTEGER PRIMARY KEY,
  coins INTEGER DEFAULT 0,
  total_earned INTEGER DEFAULT 0,
  total_spent INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 签到记录表
CREATE TABLE IF NOT EXISTS check_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  check_in_date TEXT NOT NULL,
  streak INTEGER DEFAULT 1,
  coins_earned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, check_in_date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- VIP 会员表
CREATE TABLE IF NOT EXISTS user_vips (
  user_id INTEGER PRIMARY KEY,
  tier TEXT DEFAULT 'none' CHECK(tier IN ('none','vip','s-vip','svip+')),
  started_at TEXT,
  expires_at TEXT,
  auto_renew INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 积分交易记录表
CREATE TABLE IF NOT EXISTS coin_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('check_in','post','comment','liked','purchase','transfer_in','transfer_out','admin')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 为用户初始化余额（已有用户获得 100 注册积分）
INSERT OR IGNORE INTO user_balances (user_id, coins, total_earned)
  SELECT id, 100, 100 FROM users WHERE deleted_at IS NULL;

-- 索引
CREATE INDEX IF NOT EXISTS idx_check_ins_user_date ON check_ins(user_id, check_in_date);
CREATE INDEX IF NOT EXISTS idx_check_ins_date ON check_ins(check_in_date);
CREATE INDEX IF NOT EXISTS idx_coin_tx_user ON coin_transactions(user_id, created_at);
