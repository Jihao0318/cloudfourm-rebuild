-- AI 审核日志：巡查台「AI 审核日志」栏目数据源（moderation.ts GET /ai-logs 只读展示）
-- 由 aiReview.ts 消费端在每次真正调用 judge 后写入（跳过类场景不记），只保留最近 20 条：
-- 每次插入后同批次修剪（DELETE WHERE id NOT IN (SELECT ... LIMIT 20)），表恒 ≤20 行，无需定时清理
CREATE TABLE IF NOT EXISTS ai_review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER,              -- 帖子 id（帖子可能已被硬删，故不设外键）
  post_title TEXT,                 -- 冗余标题（帖子删除后日志仍可读）
  author_id  INTEGER,              -- 作者
  verdict    TEXT,                 -- AI 判定：pass / flag
  confidence REAL,                 -- 置信度 0-1（judge 失败时为 NULL）
  reasons    TEXT,                 -- 原因枚举 JSON 数组（illegal/porn/ads/abuse/fraud/privacy/spam）
  summary    TEXT,                 -- AI 摘要
  action     TEXT NOT NULL,        -- 实际处置：approved(通过) / uncertain(AI不确定转待复核) / takedown(AI下架) / failed(审核失败)
  error      TEXT,                 -- failed 时的失败原因
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_review_logs_created ON ai_review_logs(created_at DESC);
