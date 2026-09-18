-- 积分榜改为实时读取 user_balances（不再读每日物化的 leaderboard_cache），
-- 为「按 coins 倒序取页」补一个索引：排行榜查询 ORDER BY coins DESC, user_id ASC LIMIT n
CREATE INDEX IF NOT EXISTS idx_user_balances_coins ON user_balances(coins DESC);
