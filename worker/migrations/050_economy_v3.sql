-- 050_economy_v3.sql
-- 经济系统 v3（docs/economy-v3-plan.md 阶段 A）：
-- 经验等级 / 每日任务 / 成就 / 感谢 + 奖池负期望化 + 新手初始 200

-- 1. users 加经验列（等级纯计算不存列；last_rewarded_level 防重复发放升级礼包）
ALTER TABLE users ADD COLUMN exp INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_rewarded_level INTEGER DEFAULT 0;

-- 2. 每日任务表（UTC+8 日窗；UNIQUE 幂等防重复计数）
CREATE TABLE IF NOT EXISTS daily_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  task_type TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  claimed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date, task_type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. 成就表（一次性；UNIQUE 防重复发放）
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  unlocked_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. 感谢表（免费、每日限 5 次；UNIQUE 防重复感谢同一内容）
CREATE TABLE IF NOT EXISTS thanks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
  target_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, target_type, target_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 5. 奖池更新：v3 负期望奖池（成本 40 → EV≈32），移除改名卡/改名卡×2（保商城唯一）
DELETE FROM lottery_coin_prizes;
INSERT INTO lottery_coin_prizes (id, name, emoji, type, value, weight, rarity) VALUES
  -- N 级 50%（权重 500）
  (1,  '3积分',    '🪙', 'coins',         '3',    200, 'N'),
  (2,  '7积分',    '🪙', 'coins',         '7',    150, 'N'),
  (3,  '10积分',   '🪙', 'coins',         '10',   100, 'N'),
  (4,  '今日运势', '🔮', 'fortune',       '1',    50,  'N'),
  -- R 级 30%（权重 300）
  (5,  '20积分',   '💰', 'coins',         '20',   100, 'R'),
  (6,  '提升卡',   '🚀', 'bump',          '1',    50,  'R'),
  (7,  '高亮卡',   '✨', 'highlight',     '1',    50,  'R'),
  (8,  '35积分',   '💰', 'coins',         '35',   40,  'R'),
  (9,  'VIP体验卡1天', '⭐', 'vip',       'vip:1', 30,  'R'),
  (10, '头像框7天', '🖼️', 'avatar_frame', '7',    30,  'R'),
  -- SR 级 15%（权重 150）
  (11, '70积分',   '💎', 'coins',         '70',   40,  'SR'),
  (12, '称号7天',  '🏅', 'title_badge',   '7',    35,  'SR'),
  (13, '炫彩3天',  '🌈', 'rainbow_title', '3',    35,  'SR'),
  (14, '100积分',  '💎', 'coins',         '100',  40,  'SR'),
  -- SSR 级 5%（权重 50）
  (15, '350积分',  '👑', 'coins',         '350',  15,  'SSR'),
  (16, 'S-VIP3天', '🌟', 'vip',          's-vip:3', 10, 'SSR'),
  (17, '炫彩标题7天', '🌈', 'rainbow_title', '7', 10, 'SSR'),
  (18, '全服公告', '📢', 'announce',      '1',    7,   'SSR'),
  (19, '称号30天', '🏅', 'title_badge',   '30',   8,   'SSR');

-- 6. 新手初始积分 100 → 200（仅影响新注册用户）
INSERT INTO settings (key, value) VALUES ('default_user_coins', '200')
  ON CONFLICT(key) DO UPDATE SET value = '200';

-- 7. 抽奖价格 30/280 → 40/360（048 迁移旧值覆盖）
UPDATE settings SET value = '40' WHERE key = 'lottery_draw_cost';
UPDATE settings SET value = '360' WHERE key = 'lottery_draw10_cost';

-- 8. 感谢计数列（列表/详情直接取列，避免 COUNT 子查询）
ALTER TABLE posts ADD COLUMN thanks_count INTEGER DEFAULT 0;
ALTER TABLE comments ADD COLUMN thanks_count INTEGER DEFAULT 0;
