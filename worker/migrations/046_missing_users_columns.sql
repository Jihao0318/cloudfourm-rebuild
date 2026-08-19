-- 046_missing_users_columns.sql
-- 同上：生产库手工 ALTER 过的列，迁移从未补齐（新库会缺，导致 requireAuth 等 500）

ALTER TABLE users ADD COLUMN banner_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN nick_theme TEXT DEFAULT '';