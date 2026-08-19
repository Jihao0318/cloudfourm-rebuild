-- 031_backfill_item_rarity.sql
-- 为已有抽奖道具补上 rarity 信息（新道具已在代码中自动写入 item_meta）

UPDATE user_lottery_items
SET item_meta = json_set(item_meta, '$.rarity',
  CASE item_type
    WHEN 'item_bump'       THEN 'R'
    WHEN 'item_highlight'  THEN 'R'
    WHEN 'item_fortune'    THEN 'N'
    WHEN 'item_avatar_frame' THEN 'SR'
    WHEN 'item_title_badge' THEN 'SSR'
    WHEN 'item_rainbow_title' THEN 'SSR'
    WHEN 'item_announce'   THEN 'SSR'
    ELSE 'N'
  END
)
WHERE json_extract(item_meta, '$.rarity') IS NULL;
