-- 限时兑换商店（v1）：管理员配置限时上架的道具，用户用积分兑换。
-- 发放链路与商城一致（写入 user_lottery_items，item_type 对应 shop_extras.type），
-- 回收价沿用「商城参考价 × 30%」的既有规则（按 item_type 查 shop_extras 价格）。
CREATE TABLE IF NOT EXISTS exchange_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  item_type TEXT NOT NULL,            -- 发放的道具类型（对应 shop_extras.type）
  duration_days INTEGER DEFAULT NULL, -- 时长类道具的天数（NULL = 无时长概念）
  price INTEGER NOT NULL,             -- 兑换所需积分
  stock INTEGER DEFAULT -1,           -- 库存（-1 = 不限量）
  per_user_limit INTEGER DEFAULT 0,   -- 每人限购（0 = 不限）
  ends_at TEXT DEFAULT NULL,          -- 截止时间（UTC，NULL = 长期）
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
