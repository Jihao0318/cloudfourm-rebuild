-- 头像框系统（管理后台直链添加 + 滑杆调参版，2026-09-19）：
-- scale = 框图宽度相对头像容器的倍数（1.0 = 与头像同大）；offset_x/offset_y = 框中心相对容器中心的偏移（占容器尺寸 %）。
-- 前端渲染：框图 absolute，left = calc(50% + offset_x%)，top = calc(50% + offset_y%)，
-- width = scale×100%，translate(-50%,-50%) 居中——装饰压在头像上属于设计效果。
CREATE TABLE IF NOT EXISTS avatar_frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  scale REAL NOT NULL DEFAULT 1.5,
  offset_x REAL NOT NULL DEFAULT 0,
  offset_y REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
-- 公开列表按 enabled 过滤；发放校验按 id（主键）——此处显式建索引满足"查询走索引"
CREATE INDEX IF NOT EXISTS idx_avatar_frames_enabled ON avatar_frames(enabled);
