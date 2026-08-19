-- 072_perf_indexes.sql
-- 性能索引补全（全部 CREATE INDEX IF NOT EXISTS，幂等可重跑）
-- 背景：线上 D1 按读行计费，以下查询此前无可用索引导致全表扫描，按需补齐：
--   idx_comments_user_created      comments(user_id, created_at)    —— 成就/每日任务按 user_id+created_at 统计（checkAllAchievements、tasks.ts、comments.ts）
--   idx_follows_following          follows(following_id)            —— 成就「关注人数」COUNT(following_id)
--     注：006 已建同名复合索引 (following_id, created_at DESC)，IF NOT EXISTS 幂等，此处无副作用
--   idx_thanks_target_user         thanks(target_user_id)           —— 成就按被感谢人统计（064 新增的冗余列，此前无索引）
--   idx_review_actions_reviewer    post_review_actions(reviewer_id) —— 巡查成就 4 条 COUNT(reviewer_id)（现仅 idx_review_actions_post）
--   idx_invite_codes_created_by    invite_codes(created_by)         —— 邀请成就 COUNT(created_by)（现仅 idx_invite_codes_used）
--   idx_likes_created              likes(created_at)                —— 每日任务被赞计数按 created_at 窗口过滤
--   idx_users_role                 users(role)                      —— 注册时 COUNT(users WHERE role='admin')
--   idx_red_packets_remaining      red_packets(remaining_packets)   —— 首页列表 LEFT JOIN 派生表 WHERE remaining_packets > 0

CREATE INDEX IF NOT EXISTS idx_comments_user_created ON comments(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_thanks_target_user ON thanks(target_user_id);
CREATE INDEX IF NOT EXISTS idx_review_actions_reviewer ON post_review_actions(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_likes_created ON likes(created_at);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_red_packets_remaining ON red_packets(remaining_packets);
