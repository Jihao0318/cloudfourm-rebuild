-- 029_shop_price_rebalance.sql
-- 商城调价 + 新商品表（绕过 shop_items CHECK 约束）

-- 新建扩展商品表
CREATE TABLE IF NOT EXISTS shop_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  price INTEGER NOT NULL,
  data TEXT DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 旧商品调价
UPDATE shop_items SET price = 1000 WHERE id = 1 AND name = '改名卡';  -- 500→1000
UPDATE shop_items SET price = 2000 WHERE id = 4 AND name = '鎏金标题'; -- 1000→2000
UPDATE shop_items SET price = 500 WHERE id = 2 AND name = '简约边框';  -- 300→500

-- 新商品
INSERT OR IGNORE INTO shop_extras (id, name, type, price, data, sort_order) VALUES
  (1, '自定义称号', 'custom_title', 3000, '{"usage":"自定义文字显示在昵称旁，持续10天"}', 10),
  (2, '炫彩昵称(30天)', 'rainbow_nick', 5000, '{"usage":"昵称全站彩虹渐变动画30天"}', 11),
  (3, '置顶卡(24h)', 'pin_card', 2000, '{"usage":"将自己的帖子置顶24小时"}', 12),
  (4, '彩色评论框(30天)', 'colored_comment', 1500, '{"usage":"评论框彩色边框30天"}', 13),
  (5, '隐身卡(24h)', 'stealth_card', 800, '{"usage":"24小时内你的帖子不出现在首页"}', 14);
