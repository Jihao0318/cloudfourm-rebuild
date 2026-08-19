-- 登录安全：token 版本号（踢会话）/ 账号锁定 / 安全审计日志
ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS login_attempts (
  user_id INTEGER PRIMARY KEY,
  fail_count INTEGER DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS security_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
