-- 047_categories_allow_paid.sql
-- 付费/密码帖按板块开关：默认仅「二手市场」开放，管理后台可逐板块调整

ALTER TABLE categories ADD COLUMN allow_paid INTEGER NOT NULL DEFAULT 0;

UPDATE categories SET allow_paid = 1 WHERE slug = 'market';