-- ===== 积分经济改革（2026-09-18，方案经用户确认）=====
-- 1) 商城定价：以「1 个活跃用户每天 ≈ 60 积分」为锚，效果类道具从"几天收入"降到"零点几天"
-- 2) 抽奖成本：单抽 40 → 30，十连 360 → 270（用户目标：抽奖能小赚一点，愿意抽）
-- 3) 奖池重建：同稀有度内价值差压到 2 倍以内；
--    炫彩标题7天 移出 SSR（让用户自己买）、炫彩3天 降到 R 档；
--    头像框7天 从 R 档挪到 SR 档；S-VIP3天 从 SSR 挪到 SR 档（VIP 券至高 3 天）；
--    改名卡不进奖池（保持现状，且改名卡定价暂不调整）
-- 4) 回收价在代码里改为「商城参考价 × 30%」（见 items.ts），不再用稀有度固定值

-- ── 商城定价 ──
UPDATE shop_extras SET price = 20  WHERE type = 'item_highlight';
UPDATE shop_extras SET price = 80  WHERE type = 'item_bump';
UPDATE shop_extras SET price = 60  WHERE type = 'item_anonymous_card';
UPDATE shop_extras SET price = 120 WHERE type = 'item_post_bg';
UPDATE shop_extras SET price = 60  WHERE type = 'item_red_packet';
UPDATE shop_extras SET price = 150 WHERE type = 'item_pin_top';
UPDATE shop_extras SET price = 300 WHERE type = 'custom_title';
UPDATE shop_extras SET price = 400 WHERE type = 'item_avatar_frame';
UPDATE shop_extras SET price = 200 WHERE type = 'item_rainbow_title';
UPDATE shop_items  SET price = 200 WHERE type = 'post_decoration' AND name = '简约边框';
UPDATE shop_items  SET price = 600 WHERE type = 'post_decoration' AND name = '鎏金标题';

-- ── 抽奖成本 ──
UPDATE settings SET value = '30',  updated_at = datetime('now') WHERE key = 'lottery_draw_cost';
UPDATE settings SET value = '270', updated_at = datetime('now') WHERE key = 'lottery_draw10_cost';

-- ── 奖池重建（总权重 1000；N 50% / R 30% / SR 15% / SSR 5%）──
DELETE FROM lottery_coin_prizes;
INSERT INTO lottery_coin_prizes (name, emoji, type, value, rarity, weight) VALUES
  -- N（500）：小额积分 + 趣味
  ('3积分',   '🪙', 'coins',   '3',    'N',   200),
  ('7积分',   '🪙', 'coins',   '7',    'N',   150),
  ('10积分',  '🪙', 'coins',   '10',   'N',   100),
  ('今日运势','🔮', 'fortune', '1',    'N',    50),
  -- R（300）：小额积分 + 基础道具 + 低档 VIP/炫彩
  ('20积分',      '🪙', 'coins',        '20',   'R',   70),
  ('35积分',      '🪙', 'coins',        '35',   'R',   70),
  ('50积分',      '🪙', 'coins',        '50',   'R',   50),
  ('高亮卡',      '✨', 'highlight',    '1',    'R',   50),
  ('VIP体验卡1天','🎟️', 'vip',          'vip:1','R',   30),
  ('炫彩标题3天', '🌈', 'rainbow_title','3',    'R',   25),
  -- SR（150）：中额积分 + 强道具 + 称号/头像框/S-VIP（至高 3 天）
  ('80积分',        '🪙', 'coins',        '80',    'SR',  40),
  ('120积分',       '🪙', 'coins',        '120',   'SR',  30),
  ('推荐卡',        '🔥', 'bump',         '1',     'SR',  25),
  ('称号7天',       '👑', 'title_badge',  '7',     'SR',  20),
  ('头像框7天',     '🖼️', 'avatar_frame', '7',     'SR',  20),
  ('S-VIP体验卡3天','💎', 'vip',          's-vip:3','SR', 15),
  -- SSR（50）：大额积分 + 长期称号 + 全服公告
  ('250积分',  '🪙', 'coins',   '250', 'SSR', 20),
  ('350积分',  '🪙', 'coins',   '350', 'SSR', 15),
  ('称号30天', '👑', 'title_badge', '30', 'SSR',  8),
  ('全服公告', '📢', 'announce',    '1',  'SSR',  7);
