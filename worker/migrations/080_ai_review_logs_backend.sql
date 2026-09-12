-- AI 审核日志记录判定后端
-- 背景：审核后端可在管理后台切换（settings.ai_review_backend：workers-ai | gemini），
-- 日志带上 backend 才能追溯/对比两家的判定差异；本次改动之前写入的历史行为 NULL
-- （表示当时只有 Workers AI 一条链路）。
ALTER TABLE ai_review_logs ADD COLUMN backend TEXT;
