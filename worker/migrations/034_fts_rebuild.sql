-- 034_fts_rebuild.sql
-- 重建 FTS5 全文搜索索引
-- 确保所有已有帖子（包括迁移 018 之后创建的）都能被搜索到

INSERT OR REPLACE INTO posts_fts(rowid, title, content)
SELECT id, title, content FROM posts WHERE deleted_at IS NULL;
