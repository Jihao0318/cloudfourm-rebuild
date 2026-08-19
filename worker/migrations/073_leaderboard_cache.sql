-- 排行榜物化缓存：每日由 scheduled 任务重算（recalculateLeaderboard），
-- 避免每次请求 DENSE_RANK 全表排序（线上 10 万用户时单次请求读 10 万行）
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  user_id INTEGER PRIMARY KEY,
  coins INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0
);
