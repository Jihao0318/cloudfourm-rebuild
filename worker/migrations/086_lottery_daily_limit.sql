-- 每日抽数上限（方案一）：lottery_pity 增加当日计数（按 UTC+8 业务日重置）。
-- 上限数值存 settings.lottery_daily_draw_limit（默认 50，后台抽奖设置可改）。
ALTER TABLE lottery_pity ADD COLUMN draws_date TEXT DEFAULT NULL;
ALTER TABLE lottery_pity ADD COLUMN draws_today INTEGER DEFAULT 0;
