-- 改名冷却（方案 2）：记录最近一次改名时间；NULL = 从未改过，视为可免费改名。
-- 规则：距上次改名 ≥14 天免费改；冷却期内需改名卡（优先消耗仓库库存，否则一键购卡按商城现价扣款）
ALTER TABLE users ADD COLUMN username_changed_at TEXT;
