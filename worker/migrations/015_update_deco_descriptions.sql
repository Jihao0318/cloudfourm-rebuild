-- 015_update_deco_descriptions.sql: 更新装饰品描述, 去除购买限制

-- 更新描述
UPDATE shop_items SET data = '{"css_class":"decoration-border-simple","description":"帖子卡片添加天蓝色边框"}' WHERE id = 2;
UPDATE shop_items SET data = '{"css_class":"decoration-tag-colorful","description":"帖子卡片增加流动彩色渐变边框"}' WHERE id = 3;
UPDATE shop_items SET data = '{"css_class":"decoration-title-gold","description":"帖子标题变为金色渐变文字"}' WHERE id = 4;
