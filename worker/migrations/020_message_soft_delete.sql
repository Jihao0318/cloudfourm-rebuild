-- 私信系统软删除：允许一方删除而不影响另一方
ALTER TABLE conversation_participants ADD COLUMN deleted_at TEXT DEFAULT NULL;

-- 索引：加速已删除参与者的查找
CREATE INDEX IF NOT EXISTS idx_cp_deleted_at ON conversation_participants(conversation_id, user_id, deleted_at);
