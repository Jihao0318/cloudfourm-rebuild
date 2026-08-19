-- 索引补全与清理（全部 IF NOT EXISTS / IF EXISTS，幂等可重跑）
-- 建索引：
--   idx_verifications_user    verifications(user_id,type) —— 055 重建表时丢失（原索引随 DROP 消失），生产库必须补回
--   idx_posts_list            posts(deleted_at,review_status,category_id,created_at) —— 首页列表核心过滤
--   idx_posts_hot             posts(comment_count) —— hot 排序
--   idx_posts_views           posts(view_count) —— most_viewed 排序
--   idx_reports_pending       reports(status,created_at) —— 管理后台待审队列
--   idx_reports_target        reports(target_type,target_id) —— 举报查重/硬删清理
--   idx_thanks_target         thanks(target_type,target_id) —— 评论 thanks_count 子查询
--   idx_notifications_post    notifications(post_id) —— 硬删帖清理
--   idx_messages_sender       messages(sender_id) —— 删号清理
--   idx_security_logs_created security_logs(created_at) —— 管理端安全日志
-- 删冗余索引（被 UNIQUE 约束 / 复合索引前导列覆盖，已逐一核实）：
--   idx_likes_user            likes 的 UNIQUE(user_id,target_id,target_type) 覆盖
--   idx_check_ins_user_date   check_ins 的 UNIQUE(user_id,check_in_date) 覆盖
--   idx_refresh_tokens_hash   refresh_tokens 的 token_hash UNIQUE 覆盖
--   idx_user_items_user       idx_user_items_unused(user_id,used) 前导列 user_id 覆盖
--   idx_push_tokens_user      push_tokens 的 UNIQUE(user_id,platform) 覆盖
--   idx_page_views_post       idx_page_views_dedup(post_id,visitor_id,viewed_at) 前导列 post_id 覆盖
CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications(user_id, type);
CREATE INDEX IF NOT EXISTS idx_posts_list ON posts(deleted_at, review_status, category_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_hot ON posts(comment_count);
CREATE INDEX IF NOT EXISTS idx_posts_views ON posts(view_count);
CREATE INDEX IF NOT EXISTS idx_reports_pending ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_thanks_target ON thanks(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_notifications_post ON notifications(post_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs(created_at);

DROP INDEX IF EXISTS idx_likes_user;
DROP INDEX IF EXISTS idx_check_ins_user_date;
DROP INDEX IF EXISTS idx_refresh_tokens_hash;
DROP INDEX IF EXISTS idx_user_items_user;
DROP INDEX IF EXISTS idx_push_tokens_user;
DROP INDEX IF EXISTS idx_page_views_post;
