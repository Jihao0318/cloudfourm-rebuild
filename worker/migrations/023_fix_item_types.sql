-- 023_fix_item_types.sql
-- 修复抽奖道具的商品类型（之前错误地用了 rename_card），
-- 确保 ensureShopItem() 能正确找到匹配的 type

-- 清理之前错误插入的提升卡/高亮卡记录
DELETE FROM shop_items WHERE name IN ('提升卡', '高亮卡') AND type = 'rename_card';
-- 用正确的 type 重新插入
INSERT OR IGNORE INTO shop_items (id, name, type, price, data, sort_order) VALUES
  (5,  '提升卡',   'item_bump',       0, '{"description":"将帖子顶到首页顶部，持续2小时"}', 5),
  (6,  '高亮卡',   'item_highlight',  0, '{"description":"帖子列表金色背景高亮24小时"}', 6);

-- 确保所有抽奖道具类型在 shop_items 中存在（让 ensureShopItem 能找到它们）
INSERT OR IGNORE INTO shop_items (name, type, price, data) VALUES
  ('今日运势',  'item_fortune',       0, '{}'),
  ('头像框',    'item_avatar_frame',  0, '{}'),
  ('限定称号',  'item_title_badge',   0, '{}'),
  ('炫彩标题',  'item_rainbow_title', 0, '{}');
