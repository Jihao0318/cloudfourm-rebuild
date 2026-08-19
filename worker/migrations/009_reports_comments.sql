-- 举报系统支持帖子+评论
ALTER TABLE reports ADD COLUMN target_type TEXT DEFAULT 'post';
ALTER TABLE reports ADD COLUMN target_id INTEGER;

-- 迁移现有数据
UPDATE reports SET target_type = 'post', target_id = post_id WHERE target_id IS NULL;
