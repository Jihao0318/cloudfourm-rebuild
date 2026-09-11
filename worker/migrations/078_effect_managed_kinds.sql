-- 078：帖子效果管理次数（回到 64CE101 的「固定次数」机制，次数由 1 提到 2）
--
-- 旧列 effects_managed_at 只记「用过一次」，无法表达次数与已用种类，故新增：
--   effects_used_kinds —— 已使用过效果管理的种类列表，逗号分隔（bg,bump,highlight,fortune）
-- 规则（与 worker/src/handlers/items.ts 的 consumeEffectChance 一致）：
--   · 每帖最多使用 2 次效果管理（即 4 种效果里最多选 2 种）；
--   · 同一类效果续期/替换（换背景、推荐卡续费、高亮叠加）不重复计数；
--   · 取消效果不回退次数。
--
-- 存量数据回填：老逻辑（effects_managed_at 非空）已经用掉 1 次，按其当时生效的效果种类回填，
-- 使老帖子剩余 1 次机会（不会因为改机制而凭空多出额度）。

ALTER TABLE posts ADD COLUMN effects_used_kinds TEXT;

-- 按其当时仍生效的效果种类回填（SQLite 的 trim 用两参数形式，注意别写成 TRIM(BOTH .. FROM ..)）
UPDATE posts SET effects_used_kinds = TRIM(
    CASE WHEN post_bg_id IS NOT NULL THEN 'bg,' ELSE '' END ||
    CASE WHEN highlighted_until > datetime('now') THEN 'highlight,' ELSE '' END ||
    CASE WHEN bumped_until > datetime('now') THEN 'bump,' ELSE '' END ||
    CASE WHEN fortune_expires_at > datetime('now') THEN 'fortune,' ELSE '' END
  , ',')
WHERE effects_managed_at IS NOT NULL;

-- 老帖子若用过但当时没有任何生效效果（已取消/已到期），也保住「已用 1 次」的语义
UPDATE posts SET effects_used_kinds = 'bg' WHERE effects_managed_at IS NOT NULL AND COALESCE(effects_used_kinds, '') = '';
