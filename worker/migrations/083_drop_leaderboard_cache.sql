-- 积分榜改为实时读取 user_balances 之后，每日物化的缓存表与总人数键已无任何读取方，
-- 一并清理掉，避免留下「两个数据源」的困惑。
-- 注意执行顺序：先部署新版 worker（不再读该表），再跑本迁移；否则旧代码会读到已删除的表。
DROP TABLE IF EXISTS leaderboard_cache;
DELETE FROM settings WHERE key = 'leaderboard_total';
