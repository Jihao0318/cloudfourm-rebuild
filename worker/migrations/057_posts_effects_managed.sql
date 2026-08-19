-- 帖子效果管理：发帖后的装饰/背景修改整个帖子仅一次机会
-- effects_managed_at IS NULL = 未使用；首次效果管理操作时置当前时间，之后拒绝
ALTER TABLE posts ADD COLUMN effects_managed_at TEXT;
