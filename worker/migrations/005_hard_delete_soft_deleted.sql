-- 005_hard_delete_soft_deleted.sql
-- 将数据库中所有软删除的记录彻底硬删除
-- 运行方式: npx wrangler d1 migrations apply forum-db --remote
-- 或: npx wrangler d1 execute forum-db --remote --file=worker/migrations/005_hard_delete_soft_deleted.sql

-- ==== 第一步：统计待删除数量 ====
SELECT '软删除用户' as item, COUNT(*) as count FROM users WHERE deleted_at IS NOT NULL;
SELECT '软删除帖子' as item, COUNT(*) as count FROM posts WHERE deleted_at IS NOT NULL;
SELECT '软删除评论' as item, COUNT(*) as count FROM comments WHERE deleted_at IS NOT NULL;

-- ==== 第二步：先清理被删除用户相关的外键数据 ====
-- 删掉已被软删除用户的所有点赞
DELETE FROM likes WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
-- 删掉已被软删除用户的所有评论
DELETE FROM comments WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
-- 删掉已被软删除用户的所有验证码
DELETE FROM verifications WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
-- 删掉被软删除帖子的所有点赞
DELETE FROM likes WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL);
-- 删掉被软删除帖子的所有浏览记录
DELETE FROM page_views WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL);
-- 删掉被软删除评论的所有点赞
DELETE FROM likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE deleted_at IS NOT NULL);

-- ==== 第三步：彻底硬删除 ====
DELETE FROM comments WHERE deleted_at IS NOT NULL;
DELETE FROM posts WHERE deleted_at IS NOT NULL;
DELETE FROM users WHERE deleted_at IS NOT NULL;

-- ==== 第四步：确认已全部清除 ====
SELECT '剩余软删除用户' as item, COUNT(*) as count FROM users WHERE deleted_at IS NOT NULL;
SELECT '剩余软删除帖子' as item, COUNT(*) as count FROM posts WHERE deleted_at IS NOT NULL;
SELECT '剩余软删除评论' as item, COUNT(*) as count FROM comments WHERE deleted_at IS NOT NULL;
