-- 048_lottery_settings.sql
-- 抽奖全部数值改为后台可配（settings 键；INSERT OR IGNORE 保持幂等，不覆盖已有值）
-- 奖品本身在 lottery_coin_prizes 表，直接 CRUD 即可

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('lottery_draw_cost', '30'),      -- 单抽价格（积分）
  ('lottery_draw10_cost', '280'),   -- 十连价格（积分）
  ('lottery_rate_ssr', '5'),        -- SSR 基础概率 %
  ('lottery_rate_ssr_boost', '25'), -- 软保底区间 SSR 概率 %
  ('lottery_rate_sr', '15'),        -- SR 概率 %
  ('lottery_rate_r', '30'),         -- R 概率 %
  ('lottery_rate_n', '50'),         -- N 概率 %（实际按剩余自动分配，此值仅展示参考）
  ('lottery_pity_soft', '50'),      -- 软保底抽数
  ('lottery_pity_hard', '80');      -- 硬保底抽数