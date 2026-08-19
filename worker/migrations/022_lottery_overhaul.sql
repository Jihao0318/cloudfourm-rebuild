-- 022_lottery_overhaul.sql
-- 抽奖系统全面重构：稀有度体系 + 保底 + 新道具

-- 1. 重建奖品表（旧的 CHECK 约束不支持新 type，故 drop + recreate）
DROP TABLE IF EXISTS lottery_coin_prizes;
CREATE TABLE lottery_coin_prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('coins', 'rename', 'vip', 'bump', 'highlight', 'fortune', 'avatar_frame', 'title_badge', 'rainbow_title', 'announce')),
  value TEXT NOT NULL,
  weight INTEGER NOT NULL,
  rarity TEXT NOT NULL DEFAULT 'N' CHECK(rarity IN ('N', 'R', 'SR', 'SSR')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 新奖品数据（权重总和 = 1000，各稀有度分别计算）
-- N 级: 500 (50%), R 级: 300 (30%), SR 级: 150 (15%), SSR 级: 50 (5%)
INSERT INTO lottery_coin_prizes (id, name, emoji, type, value, weight, rarity) VALUES
  -- N 级 50%（权重 500）
  (1,  '5积分',     '🪙', 'coins',          '5',   200, 'N'),
  (2,  '10积分',    '🪙', 'coins',          '10',  150, 'N'),
  (3,  '15积分',    '🪙', 'coins',          '15',  100, 'N'),
  (4,  '今日运势',  '🔮', 'fortune',        '1',   50,  'N'),
  -- R 级 30%（权重 300）
  (5,  '30积分',    '💰', 'coins',          '30',  100, 'R'),
  (6,  '改名卡',    '🃏', 'rename',         '1',   60,  'R'),
  (7,  '提升卡',    '🚀', 'bump',           '1',   50,  'R'),
  (8,  '高亮卡',    '✨', 'highlight',      '1',   50,  'R'),
  (9,  '50积分',    '💰', 'coins',          '50',  40,  'R'),
  -- SR 级 15%（权重 150）
  (10, '100积分',   '💎', 'coins',          '100', 40,  'SR'),
  (11, 'VIP 3天',   '⭐', 'vip',            'vip:3', 40, 'SR'),
  (12, '头像框',    '🖼️', 'avatar_frame',   '1',   35,  'SR'),
  (13, '改名卡×2',  '🃏', 'rename',         '2',   35,  'SR'),
  -- SSR 级 5%（权重 50）
  (14, '500积分',   '👑', 'coins',          '500', 15,  'SSR'),
  (15, '限定称号',  '🏅', 'title_badge',    '欧皇', 10, 'SSR'),
  (16, '炫彩标题',  '🌈', 'rainbow_title',  '7',   10,  'SSR'),
  (17, 'S-VIP 7天', '🌟', 'vip',            's-vip:7', 8, 'SSR'),
  (18, '全服公告',  '📢', 'announce',       '1',   7,   'SSR');

-- 2. 保底计数器表
CREATE TABLE IF NOT EXISTS lottery_pity (
  user_id INTEGER PRIMARY KEY,
  pulls_since_ssr INTEGER DEFAULT 0,
  total_pulls INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. 全服公告记录表
CREATE TABLE IF NOT EXISTS lottery_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  prize_name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. 帖子新增列（道具系统用）
ALTER TABLE posts ADD COLUMN highlighted_until TEXT;
ALTER TABLE posts ADD COLUMN fortune TEXT;
ALTER TABLE posts ADD COLUMN title_effect TEXT;

-- 5. 用户新增列（外观道具用）
ALTER TABLE users ADD COLUMN avatar_frame TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN title_badge TEXT DEFAULT '';

-- 6. 商城增加新道具商品（使用型和外观型）
INSERT OR IGNORE INTO shop_items (id, name, type, price, data, sort_order) VALUES
  (5,  '提升卡',   'rename_card', 50,  '{"description":"将帖子顶到首页顶部，持续2小时","usage":"在帖子详情页使用"}', 5),
  (6,  '高亮卡',   'rename_card', 80,  '{"description":"帖子列表金色背景高亮24小时","usage":"在帖子详情页使用"}', 6);
