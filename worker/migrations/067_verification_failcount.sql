-- 验证码防爆破：失败尝试计数，连续 5 次错误即作废该验证码（配合 IP 限流双重防护）
ALTER TABLE verifications ADD COLUMN fail_count INTEGER DEFAULT 0;
