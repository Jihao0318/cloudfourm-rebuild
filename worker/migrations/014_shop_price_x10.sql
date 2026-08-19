-- 014_shop_price_x10.sql: 商城价格翻 10 倍

UPDATE shop_items SET price = price * 10 WHERE id IN (1, 2, 3, 4);
