-- 064_achievement_fixes.sql
-- 成就系统结构性修复（配合 063 巡查战绩回填）：
-- a) thanks 增加 target_user_id 冗余列：感谢计数不再依赖「目标内容仍存在」反查归属，
--    目标被硬删除后感谢依然计入作者成就（孤儿记录保持 NULL，属预期）
-- b) user_patrol_stats 按 post_review_actions 全量回填（063 晚于历史巡查动作，战绩从未结算）；
--    INSERT OR IGNORE，不覆盖已有行

-- a. thanks 冗余作者列 + 存量回填
ALTER TABLE thanks ADD COLUMN target_user_id INTEGER;
UPDATE thanks SET target_user_id = (SELECT user_id FROM posts WHERE id = thanks.target_id)
  WHERE target_type = 'post' AND target_user_id IS NULL;
UPDATE thanks SET target_user_id = (SELECT user_id FROM comments WHERE id = thanks.target_id)
  WHERE target_type = 'comment' AND target_user_id IS NULL;

-- b. 巡查战绩回填：按 reviewer_id 聚合 post_review_actions
--    total_takedowns = 该巡查员对「最终被下架帖子」(deleted_at 非空且 review_status='violation')
--    投过 violation/confirm 的去重帖子数；patrol_exp = 动作经验 + 40 × total_takedowns
INSERT OR IGNORE INTO user_patrol_stats
  (user_id, patrol_exp, last_rewarded_patrol_level, total_reviews, total_passes,
   total_questions, total_violations, total_confirms, total_clears, total_takedowns,
   today_count, today_date, updated_at)
SELECT
  pra.reviewer_id,
  SUM(CASE pra.action WHEN 'pass' THEN 6 WHEN 'question' THEN 10 WHEN 'violation' THEN 12 WHEN 'confirm' THEN 12 WHEN 'clear' THEN 10 ELSE 0 END)
    + 40 * (SELECT COUNT(DISTINCT pra2.post_id) FROM post_review_actions pra2 JOIN posts p2 ON p2.id = pra2.post_id
            WHERE pra2.reviewer_id = pra.reviewer_id AND pra2.action IN ('violation','confirm')
              AND p2.deleted_at IS NOT NULL AND p2.review_status = 'violation'),
  0,
  COUNT(*),
  SUM(CASE WHEN pra.action = 'pass' THEN 1 ELSE 0 END),
  SUM(CASE WHEN pra.action = 'question' THEN 1 ELSE 0 END),
  SUM(CASE WHEN pra.action = 'violation' THEN 1 ELSE 0 END),
  SUM(CASE WHEN pra.action = 'confirm' THEN 1 ELSE 0 END),
  SUM(CASE WHEN pra.action = 'clear' THEN 1 ELSE 0 END),
  (SELECT COUNT(DISTINCT pra3.post_id) FROM post_review_actions pra3 JOIN posts p3 ON p3.id = pra3.post_id
    WHERE pra3.reviewer_id = pra.reviewer_id AND pra3.action IN ('violation','confirm')
      AND p3.deleted_at IS NOT NULL AND p3.review_status = 'violation'),
  0, '', datetime('now')
FROM post_review_actions pra
GROUP BY pra.reviewer_id;
