-- 巡查体系重构：帖子状态机 + 多人复核制
-- review_status: pending(待巡查) / cleared(已通过) / questionable(存疑) / violation(违规待复核)
-- flagged_by: 首次标记人（复核队列排除他）；violation_count: 确认违规票数（>=3 自动下架）
ALTER TABLE posts ADD COLUMN review_status TEXT DEFAULT 'pending';
ALTER TABLE posts ADD COLUMN flagged_by INTEGER;
ALTER TABLE posts ADD COLUMN flagged_reason TEXT;
ALTER TABLE posts ADD COLUMN violation_count INTEGER DEFAULT 0;

-- 每个巡查员对每篇帖子的最新裁决（幂等：同一巡查员重复操作覆盖；用于防重复投票与追溯）
CREATE TABLE IF NOT EXISTS post_review_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('pass','question','violation','confirm','clear')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, reviewer_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_review_actions_post ON post_review_actions(post_id);

-- 存量帖子全部视为已通过（历史帖不进入巡查队列，新帖默认 pending 自动进入）
UPDATE posts SET review_status = 'cleared' WHERE review_status = 'pending';
