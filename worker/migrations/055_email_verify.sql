-- 邮箱验证全链路：verifications 重建（加 data 列暂存待改邮箱 + 新类型 password_change）
-- 注：SQLite 无法修改 CHECK 约束/加列到现有表（参照 051 教训），verifications 是子表不被引用，
-- DROP 后重建安全；旧数据带 data 默认 '' 原样搬入
CREATE TABLE verifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('email_verify','password_reset','password_change','twofa')),
  code TEXT NOT NULL,
  data TEXT DEFAULT '',
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
INSERT INTO verifications_new (id, user_id, type, code, data, expires_at, used, created_at)
  SELECT id, user_id, type, code, '', expires_at, used, created_at FROM verifications;
DROP TABLE verifications;
ALTER TABLE verifications_new RENAME TO verifications;
