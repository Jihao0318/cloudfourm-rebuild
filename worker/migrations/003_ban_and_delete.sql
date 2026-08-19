-- 003_ban_and_delete.sql: 添加封禁和软删除支持

ALTER TABLE users ADD COLUMN banned_until TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned_until);
