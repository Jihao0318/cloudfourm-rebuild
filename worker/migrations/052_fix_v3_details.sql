-- 052_fix_v3_details.sql
-- 审查修复补丁：
-- 1. 炫彩标题有效期列（奖池"炫彩3天"与商城"炫彩标题7天"时长不一，需落库判断过期）
-- 2. 自定义称号商城卡时长修正（data 无 duration_days → use/custom-title 按默认 3 天，与文案"持续10天"不符）
-- 3. 红包领取记录（每人每红包限抢一次，防同帖连评刷红包）

ALTER TABLE posts ADD COLUMN title_effect_expires_at TEXT;

UPDATE shop_extras SET data = json_set(data, '$.duration_days', 10) WHERE type = 'custom_title' AND is_active = 1;

CREATE TABLE IF NOT EXISTS red_packet_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  red_packet_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(red_packet_id, user_id),
  FOREIGN KEY (red_packet_id) REFERENCES red_packets(id) ON DELETE CASCADE
);
