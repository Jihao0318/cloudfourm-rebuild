-- D1 配额优化（2026-09-19 分析报告落地）：
-- 首页/列表默认排序此前对全部过审帖子做临时 B 树排序（每次首页 = 全部帖子行读取）。
-- 本部分索引只覆盖「未删除 + 未被退回」的帖子（与前台列表 WHERE 完全一致），
-- 查询可直接按 created_at 倒序走索引取一页，读取行数 = LIMIT（20 行级别）。
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(created_at)
  WHERE deleted_at IS NULL AND review_status != 'rejected';
