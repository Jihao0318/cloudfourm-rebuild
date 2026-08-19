-- 举报审核多人复核制：巡查员对「被举报内容」投票，达到阈值才确认下架/驳回（仿帖子巡查 062）
-- action: confirm(确认违规) / pass(没问题驳回)；阈值复用 settings review_violation_limit(默认3) / review_pass_limit(默认1)
-- 管理员一票否决/一票通过（与帖子巡查一致）
CREATE TABLE IF NOT EXISTS report_review_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
  target_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('confirm','pass')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(target_type, target_id, reviewer_id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_report_review_target ON report_review_actions(target_type, target_id);
