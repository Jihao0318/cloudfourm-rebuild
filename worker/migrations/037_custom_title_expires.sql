-- 037_custom_title_expires.sql
-- 自定义称号增加有效期

ALTER TABLE users ADD COLUMN custom_title_expires_at TEXT;
