-- 043_post_access_views.sql
-- 付费/密码解锁后可用查看次数（默认3次，每次查看扣1次，归零后需重新解锁）

ALTER TABLE post_access ADD COLUMN views_left INTEGER NOT NULL DEFAULT 3;
