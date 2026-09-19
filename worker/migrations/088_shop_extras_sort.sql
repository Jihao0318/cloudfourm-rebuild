-- 商城全局排序：shop_extras 的 sort_order 统一挪到 1000+id，
-- 使「按 sort_order 全局归并」后的展示顺序与历史顺序（shop_items 在前、extras 按 id）完全一致；
-- 之后后台「商城物价」的 ↑↓ 会直接改写各行的 sort_order
UPDATE shop_extras SET sort_order = 1000 + id;
