-- 079：浏览量改为「每访客每帖只计一次」（真实浏览量 = 有多少人看过）
--
-- 语义变更：
--   · 登录用户：按账号终身去重（u:<uid>），同一人再看同一帖不重复计数；
--   · 游客：按 IP 去重（ip:<IP 的加盐哈希>），同一 IP 再看同一帖不重复计数；
--   · posts.view_count = 该帖的去重访客数；settings.total_page_views = 全站计数之和。
-- 因此 page_views 不再按天存明细，也不再做 90 天清理（清理会让同一人再次被计数、
-- 且与物化计数对不上）；每访客每帖保留一行，viewed_at 记首次观看时间。

ALTER TABLE page_views ADD COLUMN viewer_key TEXT;

-- 历史数据：登录用户的 visitor_id 是 uid，游客的是 NULL（无法还原当时 IP，保留为独立访客）
UPDATE page_views
   SET viewer_key = CASE WHEN visitor_id IS NULL THEN 'legacy:' || id ELSE 'u:' || visitor_id END
 WHERE viewer_key IS NULL;

-- 同一 (帖, 访客) 可能存在多行（旧逻辑按天去重）→ 只保留最早一行，保证唯一索引可建
DELETE FROM page_views
 WHERE id NOT IN (SELECT MIN(id) FROM page_views GROUP BY post_id, viewer_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_views_unique ON page_views(post_id, viewer_key);

-- 物化计数对齐新语义（去重访客数）；同时把全站总浏览量校正为各帖之和
UPDATE posts SET view_count = (SELECT COUNT(*) FROM page_views pv WHERE pv.post_id = posts.id);

INSERT INTO settings (key, value, updated_at)
SELECT 'total_page_views', CAST((SELECT COALESCE(SUM(view_count), 0) FROM posts) AS TEXT), datetime('now')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
