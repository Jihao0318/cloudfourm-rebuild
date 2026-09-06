-- 责令更换邮箱：管理员要求用户更换绑定邮箱（旧邮箱不可信场景），未完成前登录被拦
-- 状态记录在 users 行（当前态单一）；操作历史走 security_logs，不建独立表
ALTER TABLE users ADD COLUMN email_change_ordered INTEGER DEFAULT 0;   -- 1 = 责令中（下次登录需先完成更换）
ALTER TABLE users ADD COLUMN email_change_reason TEXT;                 -- 责令原因（展示给用户）
ALTER TABLE users ADD COLUMN email_change_ordered_at TEXT;             -- 发起时间
