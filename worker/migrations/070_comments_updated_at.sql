-- 评论编辑时间：comments 表（000 定义）一直缺 updated_at 列，
-- 而 queries.ts updateComment 会 UPDATE comments SET content=?, updated_at=datetime('now')，
-- 导致编辑评论接口必然报 "no such column: updated_at"（历史迁移仅 050 给 comments 加过 thanks_count）
-- 此处补列，并回填历史评论的 updated_at = created_at，保证已有评论可被正常编辑
ALTER TABLE comments ADD COLUMN updated_at TEXT;
UPDATE comments SET updated_at = created_at;
