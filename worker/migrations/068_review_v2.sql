-- 巡查体系 v2：打回重新编辑 + 轮次隔离 + 双计数竞争 + 配置化阈值
-- posts 新增：
--   rejected_at：打回时间（1 天超时软删判断）
--   review_round：当前巡查轮次（打回重提 +1，票数清零重来）
ALTER TABLE posts ADD COLUMN rejected_at TEXT;
ALTER TABLE posts ADD COLUMN review_round INTEGER DEFAULT 0;

-- post_review_actions 新增 round：投票归属轮次
-- 计票与「已审过不显示」均按 round 过滤；UNIQUE(post_id, reviewer_id) 保留
-- （隐藏规则保证同一巡查员同轮不会重复投）
ALTER TABLE post_review_actions ADD COLUMN round INTEGER DEFAULT 0;
