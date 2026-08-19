-- 032_add_bumped_until.sql: 提升卡到期时间列

ALTER TABLE posts ADD COLUMN bumped_until TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_bumped ON posts(bumped_until);
