-- 018_fts_search.sql: FTS5 全文搜索 + 速率限制表
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, content,
  content=posts, content_rowid=id,
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
  INSERT INTO posts_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;

INSERT INTO posts_fts(rowid, title, content) SELECT id, title, content FROM posts WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 1,
  expires_at TEXT NOT NULL
);
