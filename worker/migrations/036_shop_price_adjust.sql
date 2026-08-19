-- 036_shop_price_adjust.sql
-- 商城价格调整：降低部分道具价格

UPDATE shop_extras SET price = 800 WHERE id = 1 AND name = '自定义称号';   -- 3000 → 800
UPDATE shop_extras SET price = 2000 WHERE id = 2 AND name = '炫彩昵称(30天)'; -- 5000 → 2000
UPDATE shop_extras SET price = 500 WHERE id = 3 AND name = '置顶卡(24h)';    -- 2000 → 500
