-- 044_campus_forum.sql
-- 校园论坛：板块匿名/启用标记、匿名发帖、校园板块种子数据、公告设置

ALTER TABLE categories ADD COLUMN allow_anonymous INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE posts ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0;

-- 校园板块种子（站务公告 announcements 已存在且 sort_order=0，保留；共 8 个板块）
INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES
  ('校园生活', 'life', '日常、趣事、吐槽', 1),
  ('学习交流', 'study', '课程、考试、资料', 2),
  ('二手市场', 'market', '闲置交易、求购', 3),
  ('失物招领', 'lostfound', '寻物、招领', 4),
  ('社团活动', 'club', '社团招新、活动通知', 5),
  ('表白墙', 'confess', '匿名表白、祝福', 6),
  ('水区杂谈', 'chat', '无主题闲聊', 7);

-- 表白墙允许匿名发帖
UPDATE categories SET allow_anonymous = 1 WHERE slug IN ('confess');

-- 停用旧版非校园板块（管理员可随时恢复）
UPDATE categories SET is_active = 0 WHERE slug IN ('general', 'tech', 'resources');

-- 公告设置（空字符串 = 无公告）
INSERT OR IGNORE INTO settings (key, value) VALUES ('announcement', '');