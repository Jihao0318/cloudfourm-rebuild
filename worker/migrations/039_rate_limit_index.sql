-- 限流表过期时间索引
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
