-- 提升卡 → 推荐卡：100 分 / 12 小时，帖子在首页侧边栏推荐位展示（不再插队主页列表）
-- 可续费叠加，累计上限 72 小时（3 天）——上限校验在 items.ts use/bump 端点
UPDATE shop_extras
SET name = '推荐卡',
    price = 100,
    data = '{"description":"帖子在首页侧边栏推荐位展示 12 小时，可续费叠加（上限 3 天）"}'
WHERE type = 'item_bump';
