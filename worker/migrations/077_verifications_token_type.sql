-- verifications 表 CHECK 约束扩展：type 增加 'email_change_token'
-- （责令更换邮箱流程的半登录凭证，登录时密码已验证后签发，10 分钟一次性）
-- SQLite 无法修改 CHECK，沿用 055 的表重建方式；重建后必须重创随表丢失的索引
CREATE TABLE verifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('email_verify','password_reset','password_change','twofa','email_change_token')),
  code TEXT NOT NULL,
  data TEXT DEFAULT '',
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
INSERT INTO verifications_new (id, user_id, type, code, data, expires_at, used, fail_count, created_at)
  SELECT id, user_id, type, code, data, expires_at, used, COALESCE(fail_count, 0), created_at FROM verifications;
DROP TABLE verifications;
ALTER TABLE verifications_new RENAME TO verifications;
-- 重建随旧表丢失的索引（055 教训：表重建必须补索引）
CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications(user_id, type);
