-- 051_shop_redesign.sql
-- 商店 & 装饰体系重设计：新商品统一进 shop_extras（无 CHECK 约束，购买进 user_lottery_items，
-- 与 items.ts 各 use 端点的双表查询天然兼容）+ 死道具下架 + 新增 4 道具
-- 注：shop_items 的 CHECK(type IN ('rename_card','post_decoration')) 无法修改，故不重建；
-- 提升卡/高亮卡/头像框/炫彩标题等历史商品本就不在 shop_items 中（被 CHECK 拒绝），无迁移负担

-- 1. shop_extras 加 is_active（软下架开关）
ALTER TABLE shop_extras ADD COLUMN is_active INTEGER DEFAULT 1;

-- 2. 软下架无使用端点的死道具（炫彩昵称/彩色评论框/旧置顶卡/隐身卡）
UPDATE shop_extras SET is_active = 0 WHERE type IN ('rainbow_nick', 'colored_comment', 'pin_card', 'stealth_card');

-- 3. 补上在售商品（此前被 shop_items CHECK 静默拒绝）+ 新增 4 卡
--    价格按 v3 计划书：头像框 1200/30天、提升 50、高亮 80、置顶 500
INSERT OR IGNORE INTO shop_extras (name, type, price, data, sort_order, is_active) VALUES
  ('头像框(30天)', 'item_avatar_frame', 1200, '{"duration_days":30,"description":"专属头像框，持续30天"}', 20, 1),
  ('炫彩标题(7天)', 'item_rainbow_title', 300, '{"duration_days":7,"description":"帖子标题炫彩渐变，持续7天"}', 21, 1),
  ('提升卡', 'item_bump', 50, '{"description":"帖子顶到列表顶部，持续2小时"}', 22, 1),
  ('高亮卡', 'item_highlight', 80, '{"description":"帖子列表金色高亮，持续24小时"}', 23, 1),
  ('置顶卡(24h)', 'item_pin_top', 500, '{"description":"自己的帖子置顶24小时"}', 24, 1),
  ('积分红包卡', 'item_red_packet', 300, '{"description":"发帖时挂一个积分红包，评论区可抢"}', 25, 1),
  ('匿名卡', 'item_anonymous_card', 200, '{"description":"在不支持匿名的板块匿名发帖"}', 26, 1),
  ('帖子背景卡', 'item_post_bg', 400, '{"description":"给帖子设置专属背景"}', 27, 1);

-- 4. 积分红包表（发帖挂红包，评论原子抢）
CREATE TABLE IF NOT EXISTS red_packets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  total_coins INTEGER NOT NULL,
  remaining_coins INTEGER NOT NULL,
  total_packets INTEGER NOT NULL,
  remaining_packets INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_red_packets_post ON red_packets(post_id);

-- 5. 帖子背景列（背景卡使用后落库，前端按 id 渲染背景样式）
ALTER TABLE posts ADD COLUMN post_bg_id INTEGER DEFAULT NULL;
