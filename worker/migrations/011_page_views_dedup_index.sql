-- 浏览量去重查询加速索引
-- 用于 recordPageView 按 (post_id, visitor_id, 当天日期) 查重
CREATE INDEX IF NOT EXISTS idx_page_views_dedup ON page_views(post_id, visitor_id, viewed_at);
