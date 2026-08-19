-- 012_coin_extensions.sql: 积分系统扩展
-- 商城、打赏、悬赏、独立抽奖、排行榜、自赎

-- ============================================================
-- 1. 商城商品定义表
-- ============================================================
CREATE TABLE IF NOT EXISTS shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('rename_card', 'post_decoration')),
  price INTEGER NOT NULL,
  data TEXT DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 初始商品数据
INSERT OR IGNORE INTO shop_items (id, name, type, price, data, sort_order) VALUES
  (1, '改名卡', 'rename_card', 500, '{"description":"修改一次用户名"}', 1),
  (2, '简约边框', 'post_decoration', 300, '{"css_class":"decoration-border-simple","description":"帖子卡片添加天蓝色边框"}', 2),
  (4, '鎏金标题', 'post_decoration', 1000, '{"css_class":"decoration-title-gold","description":"帖子标题变为金色渐变文字"}', 4);

-- ============================================================
-- 2. 用户拥有的物品表
-- ============================================================
CREATE TABLE IF NOT EXISTS user_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  applied_to INTEGER DEFAULT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (item_id) REFERENCES shop_items(id)
);

CREATE INDEX IF NOT EXISTS idx_user_items_user ON user_items(user_id);
CREATE INDEX IF NOT EXISTS idx_user_items_unused ON user_items(user_id, used);

-- ============================================================
-- 3. 帖子增加装饰列
-- ============================================================
ALTER TABLE posts ADD COLUMN decoration_id INTEGER REFERENCES shop_items(id);

-- ============================================================
-- 4. 打赏记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
  target_id INTEGER NOT NULL,
  amount INTEGER NOT NULL CHECK(amount IN (5, 10, 50)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_user_id) REFERENCES users(id),
  FOREIGN KEY (to_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tips_from ON tips(from_user_id);
CREATE INDEX IF NOT EXISTS idx_tips_to ON tips(to_user_id);
CREATE INDEX IF NOT EXISTS idx_tips_target ON tips(target_type, target_id);

-- ============================================================
-- 6. 独立积分抽奖奖品配置
-- ============================================================
CREATE TABLE IF NOT EXISTS lottery_coin_prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('coins', 'rename')),
  value TEXT NOT NULL,
  weight INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO lottery_coin_prizes (id, name, emoji, type, value, weight) VALUES
  (1, '参与奖', '🥉', 'coins', '10', 350),
  (2, '幸运奖', '🥈', 'coins', '30', 250),
  (3, '好运奖', '🥇', 'coins', '50', 200),
  (4, '财富奖', '💎', 'coins', '100', 100),
  (5, '改名卡', '🃏', 'rename', '1', 60),
  (6, '好运奖+', '🎉', 'coins', '80', 25),
  (7, '大奖池+', '💎', 'coins', '150', 10),
  (8, '大奖池', '👑', 'coins', '500', 5);

-- ============================================================
-- 7. 解封自赎申请表
-- ============================================================
CREATE TABLE IF NOT EXISTS unban_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  coins_paid INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewer_id INTEGER DEFAULT NULL,
  review_note TEXT DEFAULT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_unban_status ON unban_requests(status);
CREATE INDEX IF NOT EXISTS idx_unban_user ON unban_requests(user_id);
