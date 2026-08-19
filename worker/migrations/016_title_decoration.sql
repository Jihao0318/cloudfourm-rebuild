-- 016_title_decoration.sql: 支持装饰叠加 + 删除炫彩标签

-- 帖子增加标题装饰列 (与卡片装饰独立, 可叠加)
ALTER TABLE posts ADD COLUMN title_decoration_id INTEGER;

-- 删除炫彩标签商品 (先清引用再删)
DELETE FROM user_items WHERE item_id = 3;
DELETE FROM shop_items WHERE id = 3;
