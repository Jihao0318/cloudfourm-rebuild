-- 唯一索引兜底（并发幂等）：应用层「预查+插入」两步非原子，并发双提交可绕过 409。
-- UNIQUE 索引使 INSERT OR IGNORE 原子裁定冲突（changes=0 → 409）。
-- 注意：建唯一索引前若存量有重复行会失败——本项目存量数据量小（reports 迁移时为空、
-- unban_requests 仅 2 行），已在导入侧核实无重复；如在其他环境应用失败，先手工去重再重跑。

-- 举报防重：同一用户对同一目标只能举报一次（保留首次）
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_reporter_target ON reports(reporter_id, target_type, target_id);

-- 解封申请：每人至多一条待审申请（部分唯一索引，仅约束 pending 行；已驳回/已批准的历史记录不受限）
CREATE UNIQUE INDEX IF NOT EXISTS idx_unban_pending_user ON unban_requests(user_id) WHERE status = 'pending';
