-- 053_shop_items_is_active.sql
-- 051 重写后不再重建 shop_items（保留 CHECK），但其查询加了 WHERE is_active = 1 缺列
-- 补列：存量 3 个商品（改名卡/简约边框/鎏金标题）默认上架
ALTER TABLE shop_items ADD COLUMN is_active INTEGER DEFAULT 1;
