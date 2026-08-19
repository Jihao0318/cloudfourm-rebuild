-- 006_scheduled_deletion.sql: 为用户注销添加 3 天冷静期
-- 用户请求注销时先标记 scheduled_deleted_at，三天后自动删除

ALTER TABLE users ADD COLUMN scheduled_deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_scheduled_delete ON users(scheduled_deleted_at);
