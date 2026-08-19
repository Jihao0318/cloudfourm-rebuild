-- 将 last_read_at（TEXT，实际存的是消息ID）改为语义正确的 last_read_message_id（INTEGER）
ALTER TABLE conversation_participants ADD COLUMN last_read_message_id INTEGER DEFAULT NULL;

-- 迁移现有数据：last_read_at 列中存储的是消息 ID（SQLite 弱类型）
-- 只迁移看起来像整数的值
UPDATE conversation_participants
SET last_read_message_id = CAST(last_read_at AS INTEGER)
WHERE last_read_at IS NOT NULL
  AND last_read_at != ''
  AND CAST(last_read_at AS INTEGER) > 0;
