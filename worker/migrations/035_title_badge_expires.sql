-- 035_title_badge_expires.sql
-- 称号增加有效期和自定义内容

ALTER TABLE users ADD COLUMN title_badge_expires_at TEXT;
