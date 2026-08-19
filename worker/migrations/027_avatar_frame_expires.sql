-- 027_avatar_frame_expires.sql
-- 头像框使用后24小时过期

ALTER TABLE users ADD COLUMN avatar_frame_expires_at TEXT DEFAULT NULL;
