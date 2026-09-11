import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { cleanupTransactions } from './coins';
import { checkAllAchievements } from '../utils/achievement-check';
import { getOwnedTitles, getOwnedFrames, nowUtc } from '../utils/decoration';

const items = new Hono<{ Bindings: Env }>();

// 效果使用成就钩子（effect_first 等即时补解锁；checkAllAchievements 内部兜底，失败不影响道具使用结果）
async function fireEffectAchievements(db: D1Database, userId: number): Promise<void> {
  try {
    await checkAllAchievements(db, userId);
  } catch (e) {
    console.error('effect achievement hook failed', e);
  }
}

// 运气标签库
const FORTUNES = [
  '大吉 🐉', '中吉 🦅', '小吉 🐦', '吉 🍀',
  '末吉 🌿', '凶 🌧️', '大凶 ⛈️',
];

// 回收价：VIP体验卡 30、SR/SSR 25、R 10、商城道具（user_items）5

// ─── 帖子效果额度 ───
// 同一帖子同时最多叠 MAX_POST_EFFECTS 种装饰效果（帖子背景 / 推荐卡 / 高亮卡 / 今日运势），
// 避免单个帖子堆太多花哨效果。规则与前端 utils/postEffects.ts 保持一致：
//   · 同一类效果已生效时再次使用（换背景、推荐卡续费、高亮/运势叠加时长）不占新额度；
//   · 取消效果立即释放额度，取消本身不消耗任何机会；
//   · 额度按「当前生效的效果种类数」实时计算，不用一次性标记（旧 effects_managed_at 已废弃）。
const MAX_POST_EFFECTS = 2;

export type PostEffectKind = 'bg' | 'bump' | 'highlight' | 'fortune';

const EFFECT_POST_COLS = 'id, user_id, post_bg_id, bumped_until, highlighted_until, fortune_expires_at';

interface EffectPostRow {
  id: number;
  user_id: number;
  post_bg_id?: number | null;
  bumped_until?: string | null;
  highlighted_until?: string | null;
  fortune_expires_at?: string | null;
}

// D1 存的是 UTC 'YYYY-MM-DD HH:MM:SS'，比较前补时区解析
function isEffectActive(value?: string | null): boolean {
  if (!value) return false;
  const t = new Date(value.replace(' ', 'T') + 'Z').getTime();
  return !isNaN(t) && t > Date.now();
}

function activeEffectKinds(post: EffectPostRow): PostEffectKind[] {
  const kinds: PostEffectKind[] = [];
  if (post.post_bg_id) kinds.push('bg');
  if (isEffectActive(post.bumped_until)) kinds.push('bump');
  if (isEffectActive(post.highlighted_until)) kinds.push('highlight');
  if (isEffectActive(post.fortune_expires_at)) kinds.push('fortune');
  return kinds;
}

// 额度校验：可继续使用返回 null，否则返回拒绝文案
function effectQuotaError(post: EffectPostRow, applying: PostEffectKind): string | null {
  const kinds = activeEffectKinds(post);
  if (kinds.includes(applying)) return null; // 同类续期/替换不占新额度
  if (kinds.length >= MAX_POST_EFFECTS) {
    return `每个帖子最多同时使用 ${MAX_POST_EFFECTS} 种效果（本帖已有 ${kinds.length} 种），请先取消一个再试`;
  }
  return null;
}

// ─── 回收道具（支持三表 + 按稀有度定价）───
items.post('/recycle/:itemId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const itemId = parseInt(c.req.param('itemId'));
  if (!itemId) return c.json({ success: false, error: '无效的道具' }, 400);

  // 三表依次查找
  const item = await c.env.DB.prepare(`
    SELECT ui.id, 'user_items' as tbl, 'N' as rarity, si.name FROM user_items ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.id = ? AND ui.user_id = ? AND ui.used = 0 LIMIT 1
  `).bind(itemId, user.userId).first<{ id: number; tbl: string; rarity: string; name: string }>()
  || await c.env.DB.prepare(`
    SELECT id, 'user_vip_tickets' as tbl, 'SR' as rarity,
           CASE WHEN tier = 's-vip' THEN 'S-VIP体验卡' WHEN tier = 'svip+' THEN 'SVIP+体验卡' ELSE 'VIP体验卡' END || '(' || days || '天)' as name
    FROM user_vip_tickets WHERE id = ? AND user_id = ? AND used = 0 LIMIT 1
  `).bind(itemId, user.userId).first<{ id: number; tbl: string; rarity: string; name: string }>()
  || await c.env.DB.prepare(`
    SELECT id, 'user_lottery_items' as tbl, COALESCE(json_extract(item_meta, '$.rarity'), 'N') as rarity, item_name as name
    FROM user_lottery_items WHERE id = ? AND user_id = ? AND used = 0 LIMIT 1
  `).bind(itemId, user.userId).first<{ id: number; tbl: string; rarity: string; name: string }>();
  if (!item) return c.json({ success: false, error: '道具不存在或已使用' }, 400);

  const price = item.tbl === 'user_vip_tickets' ? 30
    : item.rarity === 'SSR' || item.rarity === 'SR' ? 25
    : item.rarity === 'R' ? 10 : 5;

  // 根据表名走不同分支，避免 SQL 拼接
  let updateStmt;
  if (item.tbl === 'user_items') {
    updateStmt = c.env.DB.prepare('UPDATE user_items SET used = 1 WHERE id = ? AND used = 0').bind(item.id);
  } else if (item.tbl === 'user_vip_tickets') {
    updateStmt = c.env.DB.prepare('UPDATE user_vip_tickets SET used = 1 WHERE id = ? AND used = 0').bind(item.id);
  } else if (item.tbl === 'user_lottery_items') {
    updateStmt = c.env.DB.prepare('UPDATE user_lottery_items SET used = 1 WHERE id = ? AND used = 0').bind(item.id);
  } else {
    return c.json({ success: false, error: '未知的道具类型' }, 400);
  }

  // 先单独执行标记已使用并检查 changes（与 /recycle-batch 同款写法）：
  // 若放在 batch[0]，changes=0（并发已被抢先回收）时 batch[1] 的加积分仍会执行，造成双倍回收
  const markResult = await updateStmt.run();
  if (!markResult.meta.changes) {
    return c.json({ success: false, error: '道具不存在或已使用' }, 400);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
      .bind(price, price, user.userId),
    c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'lottery_recycle', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(user.userId, price, `回收 ${item.name}`, user.userId),
  ]);
  await cleanupTransactions(c.env.DB, user.userId).catch(() => {});

  return c.json({ success: true, message: `回收成功，获得 ${price} 积分` });
});

// ─── 批量回收道具 ───
items.post('/recycle-batch', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ success: false, error: '请选择要回收的道具' }, 400);
  }
  if (ids.length > 100) {
    return c.json({ success: false, error: '单次最多回收 100 件道具' }, 400);
  }

  // 第一阶段：3 次批量 SELECT，找出每件道具归属的表和稀有度
  // D1 单条查询的绑定参数上限为 100：IN (...) 每个 id 占 1 个绑定参数，100 件时再加
  // user_id 共 101 个，必然超限报错。故把 ids 按每块 ≤80 个切块（100 件时切成 80+20 两块），
  // 每块分别执行 3 条 SELECT，结果合并进同一组集合，业务语义与原来完全一致。
  const CHUNK_SIZE = 80;
  const shopIds = new Set<number>();
  const vipIds = new Set<number>();
  const lotteryMap = new Map<number, string>();
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    // 每块单独生成占位符（块内 id 数 + 1 个 user_id ≤ 81，低于 100 上限）
    const placeholders = chunk.map(() => '?').join(',');

    // 1a. user_items（商城道具，定价 5）
    const shopRows = await c.env.DB.prepare(`
      SELECT id FROM user_items WHERE id IN (${placeholders}) AND user_id = ? AND used = 0
    `).bind(...chunk, user.userId).all<{ id: number }>();
    for (const r of shopRows.results || []) shopIds.add(r.id);

    // 1b. user_vip_tickets（VIP 体验卡，定价 30）
    const vipRows = await c.env.DB.prepare(`
      SELECT id FROM user_vip_tickets WHERE id IN (${placeholders}) AND user_id = ? AND used = 0
    `).bind(...chunk, user.userId).all<{ id: number }>();
    for (const r of vipRows.results || []) vipIds.add(r.id);

    // 1c. user_lottery_items（抽奖道具，按稀有度定价）
    const lotteryRows = await c.env.DB.prepare(`
      SELECT id, COALESCE(json_extract(item_meta, '$.rarity'), 'N') as rarity
      FROM user_lottery_items WHERE id IN (${placeholders}) AND user_id = ? AND used = 0
    `).bind(...chunk, user.userId).all<{ id: number; rarity: string }>();
    for (const r of lotteryRows.results || []) lotteryMap.set(r.id, r.rarity);
  }

  // 第二阶段：批量 UPDATE + 发积分（一次 batch）
  const stmts: any[] = [];
  const validIds: number[] = []; // 与 stmts 同序的有效道具 id（供复核循环使用，避免原始 ids 混入无效 id 导致错位）
  let totalCoins = 0;
  let recycledCount = 0;
  let skipped = 0;

  for (const id of ids) {
    if (shopIds.has(id)) {
      stmts.push(c.env.DB.prepare('UPDATE user_items SET used = 1 WHERE id = ? AND user_id = ? AND used = 0').bind(id, user.userId));
      validIds.push(id);
      totalCoins += 5;
      recycledCount++;
    } else if (vipIds.has(id)) {
      stmts.push(c.env.DB.prepare('UPDATE user_vip_tickets SET used = 1 WHERE id = ? AND user_id = ? AND used = 0').bind(id, user.userId));
      validIds.push(id);
      totalCoins += 30;
      recycledCount++;
    } else if (lotteryMap.has(id)) {
      stmts.push(c.env.DB.prepare('UPDATE user_lottery_items SET used = 1 WHERE id = ? AND user_id = ? AND used = 0').bind(id, user.userId));
      validIds.push(id);
      const r = lotteryMap.get(id)!;
      totalCoins += r === 'SSR' || r === 'SR' ? 25 : r === 'R' ? 10 : 5;
      recycledCount++;
    } else {
      skipped++;
    }
  }

  if (recycledCount === 0) {
    return c.json({ success: false, error: '没有可回收的道具' }, 400);
  }

  // 先执行 UPDATE（不混入发积分语句）。
  // D1 batch 单次最多 100 条，stmts 满 100 条时处于临界；改为按每块 ≤80 条依次执行，
  // 并把各块结果按顺序合并成一个数组——updateResults[i] 必须与 stmts[i] 严格对应，
  // 后续复核循环按 validIds[i] 对 updateResults[i].meta.changes 检查并发 used 冲突。
  const updateResults: any[] = [];
  for (let i = 0; i < stmts.length; i += CHUNK_SIZE) {
    updateResults.push(...(await c.env.DB.batch(stmts.slice(i, i + CHUNK_SIZE))));
  }

  // 检查并发冲突：UPDATE 的 meta.changes 可能为 0（被其他请求抢先标记了 used）
  // 复核循环遍历 validIds（与 stmts 同序），不再用原始 ids[i]——原始 ids 中间混入
  // 无效/已使用 id 时两者会错位，导致有效道具的回收积分被丢失
  let actualCoins = 0;
  let actualCount = 0;
  for (let i = 0; i < validIds.length; i++) {
    const id = validIds[i];
    if (updateResults[i]?.meta?.changes > 0) {
      if (shopIds.has(id)) actualCoins += 5;
      else if (vipIds.has(id)) actualCoins += 30;
      else if (lotteryMap.has(id)) {
        const r = lotteryMap.get(id)!;
        actualCoins += r === 'SSR' || r === 'SR' ? 25 : r === 'R' ? 10 : 5;
      }
      actualCount++;
    }
  }

  if (actualCount > 0) {
    // 第二步：只发实际回收到的积分，不产生多余的交易记录
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
        .bind(actualCoins, actualCoins, user.userId),
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'lottery_recycle', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(user.userId, actualCoins, `批量回收 ${actualCount} 件道具`, user.userId),
    ]);
    await cleanupTransactions(c.env.DB, user.userId).catch(() => {});
  }

  const skippedTotal = skipped + (recycledCount - actualCount);
  const msg = `回收成功，获得 ${actualCoins} 积分` + (skippedTotal > 0 ? `（${skippedTotal} 件跳过）` : '');
  return c.json({ success: true, message: msg });
});

// ─── 我的道具列表 ───
items.get('/my-items', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const [items, tickets, lotteryItems] = await Promise.all([
    c.env.DB.prepare(`
      SELECT ui.id, 'shop_item' as kind, ui.used, ui.applied_to, ui.created_at,
             si.name, si.type, si.data
      FROM user_items ui
      JOIN shop_items si ON ui.item_id = si.id
      WHERE ui.user_id = ? AND ui.used = 0
      ORDER BY ui.created_at DESC
    `).bind(user.userId).all(),
    c.env.DB.prepare(`
      SELECT id, 'vip_ticket' as kind, used, NULL as applied_to, created_at,
             CASE WHEN tier = 's-vip' THEN 'S-VIP体验卡' WHEN tier = 'svip+' THEN 'SVIP+体验卡' ELSE 'VIP体验卡' END || '(' || days || '天)' as name,
             tier || ':' || days as type,
             '{}' as data,
             CASE WHEN tier IN ('s-vip','svip+') THEN 'SSR' ELSE 'SR' END as rarity
      FROM user_vip_tickets
      WHERE user_id = ? AND used = 0
      ORDER BY created_at DESC
    `).bind(user.userId).all(),
    c.env.DB.prepare(`
      SELECT id, 'lottery_item' as kind, used, applied_to, created_at,
             item_name as name, item_type as type, item_meta as data,
             COALESCE(json_extract(item_meta, '$.rarity'), 'N') as rarity
      FROM user_lottery_items
      WHERE user_id = ? AND used = 0
      ORDER BY created_at DESC
    `).bind(user.userId).all(),
  ]);
  return c.json({ success: true, data: [...(items.results || []), ...(lotteryItems.results || []), ...(tickets.results || [])] });
});

// ─── 使用推荐卡（原提升卡）：侧边栏推荐位展示（5 个槽位），可续费，累计上限 72 小时（3 天）───
// 占用 1 个效果额度位（与背景/高亮/运势共用「同帖最多 2 种」的限制），
// 但同帖推荐位已在生效中时再次使用属续费叠加，不再另占额度
// 挤位机制：槽位满 5 时，新用户可支付「被挤者剩余时间价值 × 2」的挤人费，
// 把剩余时间最短的人挤下去；被挤者获得「剩余时间价值 × 1.15」补偿，帖子下架
const RECOMMEND_HOURS = 12;
const RECOMMEND_MAX_HOURS = 72;
const RECOMMEND_SLOTS = 5; // 推荐位槽位数
const RECOMMEND_PRICE = 100; // 推荐卡价格（与 shop_extras 一致，用于剩余价值折算）

items.post('/use/bump/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseInt(c.req.param('postId'));
  if (!postId) return c.json({ success: false, error: '无效的帖子' }, 400);

  // 检查帖子所有权
  const post = await c.env.DB
    .prepare(`SELECT ${EFFECT_POST_COLS} FROM posts WHERE id = ? AND deleted_at IS NULL`)
    .bind(postId).first<EffectPostRow>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能推荐自己的帖子' }, 403);

  // 效果额度校验（推荐位已生效时属续费叠加，不占新额度）；
  // 放在扣挤人费/消耗卡之前，避免先扣费再拒绝
  const quotaErr = effectQuotaError(post, 'bump');
  if (quotaErr) return c.json({ success: false, error: quotaErr }, 400);

  // 查找未使用的推荐卡（user_items + user_lottery_items）
  let item = await c.env.DB.prepare(`
    SELECT ui.id, 'shop' as src FROM user_items ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.user_id = ? AND si.type = 'item_bump' AND ui.used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; src: string }>();
  if (!item) {
    item = await c.env.DB.prepare(`
      SELECT id, 'lottery' as src FROM user_lottery_items
      WHERE user_id = ? AND item_type = 'item_bump' AND used = 0
      LIMIT 1
    `).bind(user.userId).first<{ id: number; src: string }>();
  }
  if (!item) return c.json({ success: false, error: '没有可用的推荐卡' }, 400);

  const markTable = item.src === 'lottery' ? 'user_lottery_items' : 'user_items';

  // ── 挤位检查：该帖不在推荐中，且推荐位已满 → 需支付挤人费 ──
  const featuredInfo = await c.env.DB.prepare(`
    SELECT id, user_id, bumped_until FROM posts
    WHERE deleted_at IS NULL AND bumped_until > datetime('now')
    ORDER BY bumped_until DESC
  `).all<{ id: number; user_id: number; bumped_until: string }>();
  const featuredList = featuredInfo.results || [];
  const alreadyFeatured = featuredList.some(f => f.id === postId);

  let knockoutFee = 0;
  let knockoutRefund = 0;
  let knockedPostId = 0;
  let knockedUserId = 0;
  if (!alreadyFeatured && featuredList.length >= RECOMMEND_SLOTS) {
    // 剩余时间最短的人（bumped_until 最早）
    const victim = featuredList[featuredList.length - 1];
    if (victim && victim.id !== postId) {
      const remainMin = Math.max(0, (new Date(victim.bumped_until.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 60000);
      // 剩余时间价值 = 100 分 × 剩余分钟 / 720 分钟（12 小时）
      const remainValue = Math.round((RECOMMEND_PRICE * remainMin) / (RECOMMEND_HOURS * 60));
      knockoutFee = remainValue * 2;            // 挤人费：剩余价值 × 2
      knockoutRefund = Math.round(remainValue * 1.15); // 被挤者补偿：剩余价值 × 1.15
      knockedPostId = victim.id;
      knockedUserId = victim.user_id;
    }
  }

  // 挤人费扣款（原子，余额不足则拒绝且不消耗卡）
  if (knockoutFee > 0) {
    const deduct = await c.env.DB
      .prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ? AND coins >= ?')
      .bind(knockoutFee, knockoutFee, user.userId, knockoutFee)
      .run();
    if (!deduct.meta.changes) {
      return c.json({ success: false, error: `推荐位已满，挤下最短推荐需额外支付 ${knockoutFee} 积分，余额不足` }, 400);
    }
    await c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'featured_knockout', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(user.userId, -knockoutFee, `挤下推荐位（补偿 ${knockedPostId} 号帖）`, user.userId).run();
  }

  // 先原子标记卡片已使用（used=0 守卫防并发双用叠加时长）：changes=0 说明已被并发请求抢先使用
  const markResult = await c.env.DB
    .prepare(`UPDATE ${markTable} SET used = 1, applied_to = ? WHERE id = ? AND used = 0`)
    .bind(postId, item.id)
    .run();
  if (!markResult.meta.changes) {
    // 卡片已被使用——回滚已扣的挤人费
    if (knockoutFee > 0) {
      await c.env.DB.prepare('INSERT INTO user_balances (user_id, coins) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET coins = coins + excluded.coins')
        .bind(user.userId, knockoutFee).run();
    }
    return c.json({ success: false, error: '道具已被使用' }, 400);
  }

  const stmts: any[] = [
    c.env.DB.prepare(`
      UPDATE posts SET bumped_until = datetime(
        CASE WHEN bumped_until > datetime('now') THEN bumped_until ELSE datetime('now') END,
        '+${RECOMMEND_HOURS} hours'
      ), updated_at = datetime('now')
      WHERE id = ?
        AND datetime(
          CASE WHEN bumped_until > datetime('now') THEN bumped_until ELSE datetime('now') END,
          '+${RECOMMEND_HOURS} hours'
        ) <= datetime('now', '+${RECOMMEND_MAX_HOURS} hours')
    `).bind(postId),
  ];

  // 被挤者：退款补偿 + 帖子下架
  if (knockoutRefund > 0 && knockedPostId > 0) {
    stmts.push(
      c.env.DB.prepare('INSERT INTO user_balances (user_id, coins) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET coins = coins + excluded.coins')
        .bind(knockedUserId, knockoutRefund),
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'featured_knockout_refund', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(knockedUserId, knockoutRefund, '推荐位被挤下补偿（含 15%）', knockedUserId),
      c.env.DB.prepare("UPDATE posts SET bumped_until = datetime('now') WHERE id = ?")
        .bind(knockedPostId),
    );
  }

  const batchResults = await c.env.DB.batch(stmts);

  // 更新影响 0 行说明时长已达 3 天上限——卡已消耗，需回滚标记
  const postUpd = batchResults[0];
  if (postUpd && !postUpd.meta.changes) {
    await c.env.DB.prepare(`UPDATE ${markTable} SET used = 0, applied_to = NULL WHERE id = ?`)
      .bind(item.id).run();
    // 挤人费已扣——回滚扣款
    if (knockoutFee > 0) {
      await c.env.DB.prepare('INSERT INTO user_balances (user_id, coins) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET coins = coins + excluded.coins')
        .bind(user.userId, knockoutFee).run();
    }
    return c.json({ success: false, error: '推荐时长已达上限（3 天），无法继续续费' }, 400);
  }

  const msg = knockoutFee > 0
    ? `帖子已进入推荐位（挤下 1 个帖子，支付挤人费 ${knockoutFee} 积分）`
    : '帖子已进入侧边栏推荐位，续费 12 小时';
  await fireEffectAchievements(c.env.DB, user.userId);
  return c.json({ success: true, message: msg });
});

// ─── 使用置顶卡 ───
items.post('/use/pin-top/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseInt(c.req.param('postId'));
  if (!postId) return c.json({ success: false, error: '无效的帖子' }, 400);

  const post = await c.env.DB
    .prepare('SELECT id, user_id FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId).first<{ id: number; user_id: number }>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能置顶自己的帖子' }, 403);

  let item = await c.env.DB.prepare(`
    SELECT ui.id, 'shop' as src FROM user_items ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.user_id = ? AND si.type = 'item_pin_top' AND ui.used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; src: string }>();
  if (!item) {
    item = await c.env.DB.prepare(`
      SELECT id, 'lottery' as src FROM user_lottery_items
      WHERE user_id = ? AND item_type = 'item_pin_top' AND used = 0
      LIMIT 1
    `).bind(user.userId).first<{ id: number; src: string }>();
  }
  if (!item) return c.json({ success: false, error: '没有可用的置顶卡' }, 400);

  const markTbl = item.src === 'lottery' ? 'user_lottery_items' : 'user_items';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${markTbl} SET used = 1, applied_to = ? WHERE id = ?`)
      .bind(postId, item.id),
    c.env.DB.prepare(`
      UPDATE posts SET bumped_until = datetime(
        CASE WHEN bumped_until > datetime('now') THEN bumped_until ELSE datetime('now') END,
        '+24 hours'
      ), updated_at = datetime('now') WHERE id = ?
    `).bind(postId),
  ]);

  await fireEffectAchievements(c.env.DB, user.userId);
  return c.json({ success: true, message: '帖子已置顶，持续24小时' });
});

// ─── 更换帖子背景 ───
items.post('/use/post-bg/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseInt(c.req.param('postId'));
  if (!postId) return c.json({ success: false, error: '无效的帖子' }, 400);
  const { bg_id } = await c.req.json();
  const bgId = parseInt(bg_id);
  if (!bgId || bgId < 1 || bgId > 6) return c.json({ success: false, error: '无效的帖子背景' }, 400);

  const post = await c.env.DB
    .prepare(`SELECT ${EFFECT_POST_COLS} FROM posts WHERE id = ? AND deleted_at IS NULL`)
    .bind(postId).first<EffectPostRow>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能更换自己帖子的背景' }, 403);

  // 效果额度校验（已有背景时属同类替换，不占新额度）
  const quotaErr = effectQuotaError(post, 'bg');
  if (quotaErr) return c.json({ success: false, error: quotaErr }, 400);

  let item = await c.env.DB.prepare(`
    SELECT ui.id, 'shop' as src FROM user_items ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.user_id = ? AND si.type = 'item_post_bg' AND ui.used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; src: string }>();
  if (!item) {
    item = await c.env.DB.prepare(`
      SELECT id, 'lottery' as src FROM user_lottery_items
      WHERE user_id = ? AND item_type = 'item_post_bg' AND used = 0
      LIMIT 1
    `).bind(user.userId).first<{ id: number; src: string }>();
  }
  if (!item) return c.json({ success: false, error: '没有可用的帖子背景卡' }, 400);

  const markTbl = item.src === 'lottery' ? 'user_lottery_items' : 'user_items';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${markTbl} SET used = 1, applied_to = ? WHERE id = ?`)
      .bind(postId, item.id),
    c.env.DB.prepare('UPDATE posts SET post_bg_id = ? WHERE id = ?').bind(bgId, postId),
  ]);

  await fireEffectAchievements(c.env.DB, user.userId);
  return c.json({ success: true, message: '帖子背景已更换' });
});

// ─── 使用高亮卡 ───
items.post('/use/highlight/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseInt(c.req.param('postId'));
  if (!postId) return c.json({ success: false, error: '无效的帖子' }, 400);

  const post = await c.env.DB
    .prepare(`SELECT ${EFFECT_POST_COLS} FROM posts WHERE id = ? AND deleted_at IS NULL`)
    .bind(postId).first<EffectPostRow>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能高亮自己的帖子' }, 403);

  // 效果额度校验（已高亮时属续期叠加，不占新额度）
  const quotaErr = effectQuotaError(post, 'highlight');
  if (quotaErr) return c.json({ success: false, error: quotaErr }, 400);

  let item = await c.env.DB.prepare(`
    SELECT ui.id, 'shop' as src FROM user_items ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.user_id = ? AND si.type = 'item_highlight' AND ui.used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; src: string }>();
  if (!item) {
    item = await c.env.DB.prepare(`
      SELECT id, 'lottery' as src FROM user_lottery_items
      WHERE user_id = ? AND item_type = 'item_highlight' AND used = 0
      LIMIT 1
    `).bind(user.userId).first<{ id: number; src: string }>();
  }
  if (!item) return c.json({ success: false, error: '没有可用的高亮卡' }, 400);

  const markTbl = item.src === 'lottery' ? 'user_lottery_items' : 'user_items';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${markTbl} SET used = 1, applied_to = ? WHERE id = ?`)
      .bind(postId, item.id),
    c.env.DB.prepare(`
      UPDATE posts SET highlighted_until = datetime(
        CASE WHEN highlighted_until > datetime('now') THEN highlighted_until ELSE datetime('now') END,
        '+24 hours'
      ) WHERE id = ?
    `).bind(postId),
  ]);

  await fireEffectAchievements(c.env.DB, user.userId);
  return c.json({ success: true, message: '帖子已高亮，持续时间叠加24小时' });
});

// ─── 使用今日运势 ───
items.post('/use/fortune/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseInt(c.req.param('postId'));
  if (!postId) return c.json({ success: false, error: '无效的帖子' }, 400);

  const post = await c.env.DB
    .prepare(`SELECT ${EFFECT_POST_COLS} FROM posts WHERE id = ? AND deleted_at IS NULL`)
    .bind(postId).first<EffectPostRow>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能给自己的帖子添加运势' }, 403);

  // 效果额度校验（已有运势时属续期叠加，不占新额度）
  const quotaErr = effectQuotaError(post, 'fortune');
  if (quotaErr) return c.json({ success: false, error: quotaErr }, 400);

  let item = await c.env.DB.prepare(`
    SELECT ui.id, 'shop' as src FROM user_items ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.user_id = ? AND si.type = 'item_fortune' AND ui.used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; src: string }>();
  if (!item) {
    item = await c.env.DB.prepare(`
      SELECT id, 'lottery' as src FROM user_lottery_items
      WHERE user_id = ? AND item_type = 'item_fortune' AND used = 0
      LIMIT 1
    `).bind(user.userId).first<{ id: number; src: string }>();
  }
  if (!item) return c.json({ success: false, error: '没有可用的运势卡' }, 400);

  const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
  const markTbl = item.src === 'lottery' ? 'user_lottery_items' : 'user_items';

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${markTbl} SET used = 1, applied_to = ? WHERE id = ?`)
      .bind(postId, item.id),
    c.env.DB.prepare(`
      UPDATE posts SET fortune = ?,
        fortune_expires_at = datetime(
          CASE WHEN fortune_expires_at > datetime('now') THEN fortune_expires_at ELSE datetime('now') END,
          '+24 hours'
        )
      WHERE id = ?
    `).bind(fortune, postId),
  ]);

  await fireEffectAchievements(c.env.DB, user.userId);
  return c.json({ success: true, data: { fortune }, message: `运势已生成：${fortune}（叠加24小时）` });
});

// ─── 使用 VIP 体验券 ───
items.post('/use/vip-ticket/:ticketId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const ticketId = parseInt(c.req.param('ticketId'));
  if (!ticketId) return c.json({ success: false, error: '无效的体验券' }, 400);

  const ticket = await c.env.DB
    .prepare('SELECT id, tier, days FROM user_vip_tickets WHERE id = ? AND user_id = ? AND used = 0')
    .bind(ticketId, user.userId).first<{ id: number; tier: string; days: number }>();
  if (!ticket) return c.json({ success: false, error: '体验券不存在或已使用' }, 400);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const existing = await c.env.DB
    .prepare('SELECT tier, expires_at FROM user_vips WHERE user_id = ?')
    .bind(user.userId).first<{ tier: string; expires_at: string }>();

  const TIER_ORDER: Record<string, number> = { '': 0, 'vip': 1, 's-vip': 2, 'svip+': 3 };
  const currentLevel = TIER_ORDER[existing?.tier || ''] || 0;
  const newLevel = TIER_ORDER[ticket.tier] || 0;

  if (newLevel < currentLevel) {
    return c.json({ success: false, error: '已有更高级别 VIP，无法使用此体验券' }, 400);
  }

  let newExpires: string;
  if (existing && existing.expires_at > now) {
    const base = new Date(existing.expires_at.replace(' ', 'T') + 'Z');
    base.setUTCDate(base.getUTCDate() + ticket.days);
    newExpires = base.toISOString().replace('T', ' ').slice(0, 19);
  } else {
    const base = new Date();
    base.setUTCDate(base.getUTCDate() + ticket.days);
    newExpires = base.toISOString().replace('T', ' ').slice(0, 19);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE user_vip_tickets SET used = 1 WHERE id = ?').bind(ticket.id),
    c.env.DB.prepare(`INSERT INTO user_vips (user_id, tier, started_at, expires_at, auto_renew)
      VALUES (?, ?, ?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET tier = ?, started_at = ?, expires_at = ?, auto_renew = 0`)
      .bind(user.userId, ticket.tier, now, newExpires, ticket.tier, now, newExpires),
  ]);

  return c.json({ success: true, message: `VIP 体验券已使用，有效期延长 ${ticket.days} 天` });
});

// ─── 使用头像框（时长可配置：data/item_meta.duration_days，默认1天）───
items.post('/use/avatar-frame', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { frame } = await c.req.json();

  let item = await c.env.DB.prepare(`
    SELECT ui.id, 'shop' as src, si.data as data FROM user_items ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.user_id = ? AND si.type = 'item_avatar_frame' AND ui.used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; src: string; data?: string }>();
  if (!item) {
    item = await c.env.DB.prepare(`
      SELECT id, 'lottery' as src, item_meta as data FROM user_lottery_items
      WHERE user_id = ? AND item_type = 'item_avatar_frame' AND used = 0
      LIMIT 1
    `).bind(user.userId).first<{ id: number; src: string; data?: string }>();
  }
  if (!item) return c.json({ success: false, error: '没有可用的头像框' }, 400);

  let days = 1;
  try { days = JSON.parse(item.data || '{}').duration_days || 1; } catch {}
  const hours = days * 24;
  const markTbl = item.src === 'lottery' ? 'user_lottery_items' : 'user_items';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${markTbl} SET used = 1 WHERE id = ?`).bind(item.id),
    c.env.DB.prepare(`
      UPDATE users SET avatar_frame = ?,
        avatar_frame_expires_at = datetime(
          CASE WHEN avatar_frame_expires_at > datetime('now') THEN avatar_frame_expires_at ELSE datetime('now') END,
          '+' || ? || ' hours'
        )
      WHERE id = ?
    `).bind(frame || 'default', hours, user.userId),
  ]);

  return c.json({ success: true, message: `头像框已应用（叠加${days}天）` });
});

// ─── 使用炫彩标题（时长可配置：data/item_meta.duration_days，默认7天；落库 expires_at 供前端判断过期）───
items.post('/use/rainbow-title/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseInt(c.req.param('postId'));
  if (!postId) return c.json({ success: false, error: '无效的帖子' }, 400);

  const post = await c.env.DB
    .prepare('SELECT id, user_id FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId).first<{ id: number; user_id: number }>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能给自己的帖子使用' }, 403);

  let item = await c.env.DB.prepare(`
    SELECT ui.id, 'shop' as src, si.data as data FROM user_items ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.user_id = ? AND si.type = 'item_rainbow_title' AND ui.used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; src: string; data?: string }>();
  if (!item) {
    item = await c.env.DB.prepare(`
      SELECT id, 'lottery' as src, item_meta as data FROM user_lottery_items
      WHERE user_id = ? AND item_type = 'item_rainbow_title' AND used = 0
      LIMIT 1
    `).bind(user.userId).first<{ id: number; src: string; data?: string }>();
  }
  if (!item) return c.json({ success: false, error: '没有可用的炫彩标题道具' }, 400);

  let days = 7;
  try { days = JSON.parse(item.data || '{}').duration_days || 7; } catch {}
  const markTbl = item.src === 'lottery' ? 'user_lottery_items' : 'user_items';

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${markTbl} SET used = 1, applied_to = ? WHERE id = ?`)
      .bind(postId, item.id),
    c.env.DB.prepare(`
      UPDATE posts SET title_effect = 'rainbow',
        title_effect_expires_at = datetime(
          CASE WHEN title_effect_expires_at > datetime('now') THEN title_effect_expires_at ELSE datetime('now') END,
          '+' || ? || ' days'
        ), updated_at = datetime('now')
      WHERE id = ?
    `).bind(days, postId),
  ]);

  await fireEffectAchievements(c.env.DB, user.userId);
  return c.json({ success: true, message: `帖子标题已启用炫彩效果，持续${days}天（叠加）` });
});

// ─── 使用大喇叭（发送全站通知） ───
items.post('/use/announce', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { content } = await c.req.json();

  let item = await c.env.DB.prepare(`
    SELECT id, 'lottery' as src FROM user_lottery_items
    WHERE user_id = ? AND item_type = 'item_announce' AND used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; src: string }>();
  if (!item) return c.json({ success: false, error: '没有可用的喇叭' }, 400);

  // 大喇叭每日限用 1 次（UTC+8 业务日，与 coins.ts 的 canEarnToday 日期口径一致）
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayDate = cst.toISOString().slice(0, 10);
  const startUtc = new Date(todayDate + 'T00:00:00Z');
  startUtc.setHours(startUtc.getHours() - 8);
  const endUtc = new Date(startUtc.getTime() + 86400000);
  const startStr = startUtc.toISOString().replace('T', ' ').slice(0, 19);
  const endStr = endUtc.toISOString().replace('T', ' ').slice(0, 19);
  const usedToday = await c.env.DB
    .prepare("SELECT COUNT(*) as cnt FROM coin_transactions WHERE user_id = ? AND type = 'announce_use' AND created_at >= ? AND created_at < ?")
    .bind(user.userId, startStr, endStr)
    .first<{ cnt: number }>();
  if ((usedToday?.cnt || 0) >= 1) {
    return c.json({ success: false, error: '大喇叭每日限用 1 次，明天再来吧' }, 400);
  }

  const announceText = (content || '').trim().slice(0, 200);

  // 从数据库读取当前用户名（JWT 中的 username 可能因改名而过期）
  const currentUser = await c.env.DB
    .prepare('SELECT username FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(user.userId)
    .first<{ username: string }>();
  const displayName = currentUser?.username || user.username;

  // 先原子标记喇叭已使用（used=0 守卫防并发双用）：changes=0 说明已被并发请求抢先使用，
  // 此时若继续发通知会重复广播且不消耗道具，故先检查再广播
  // 注：announce_use 计数落在 coin_transactions，cleanupTransactions 会保留今日 UTC 窗口内的行，
  // 当日限额统计不会被流水清理破坏（见 coins.ts cleanupTransactions）
  const markResult = await c.env.DB
    .prepare('UPDATE user_lottery_items SET used = 1 WHERE id = ? AND used = 0')
    .bind(item.id)
    .run();
  if (!markResult.meta.changes) {
    return c.json({ success: false, error: '道具已被使用' }, 400);
  }

  // 记录大喇叭当日使用次数（每日限 1 次）
  await c.env.DB
    .prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'announce_use', 0, coins, '使用大喇叭' FROM user_balances WHERE user_id = ?")
    .bind(user.userId, user.userId)
    .run();

  // D1 每请求查询数有硬上限（免费档 50 / 付费档 1000），且 db.batch 单次最多 100 条语句。
  // 原实现先 SELECT 最多 500 个用户，再连同计数语句把最多 500 条单行 INSERT 一次塞进单个
  // batch（最多 501 条语句）——免费档直接超限、付费档也吃满配额。改为单条 INSERT...SELECT
  // 一次往返完成（与 posts.ts 置顶广播同款改法）：无匹配行（目标用户均被删）时自然不插入，
  // 等价于原「results.length > 0 才插入」；全参数绑定（?），无注入面。
  const notifTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const notifyContent = `📢大喇叭  ${displayName}：${announceText}`;
  const notifResult = await c.env.DB
    .prepare(`
      INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, content, read, created_at)
      SELECT id, ?, 'system', ?, NULL, ?, 0, ?
      FROM users
      WHERE deleted_at IS NULL AND id != ?
      ORDER BY id
      LIMIT 500
    `)
    .bind(user.userId, null, notifyContent, notifTime, user.userId)
    .run();

  return c.json({ success: true, message: `大喇叭已发送至 ${notifResult.meta.changes} 位用户！` });
});

// ─── 使用自定义称号（时长可配置：item_meta.duration_days，默认3天）───
items.post('/use/custom-title', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { title } = await c.req.json();

  const titleText = (title || '').trim();
  if (!titleText || titleText.length < 1 || titleText.length > 20) {
    return c.json({ success: false, error: '称号内容为 1-20 个字符' }, 400);
  }

  // 不覆盖 VIP 永久头衔：custom_title_expires_at 为 NULL 说明当前头衔是 users.ts PUT /title
  // 写入的 VIP 永久头衔——限时道具称号覆盖后到期会丢失 VIP 头衔，故直接拒绝
  // （VIP 头衔清除走 users.ts 的 DELETE /title 端点）
  const dbUser = await c.env.DB
    .prepare('SELECT exp, custom_title, custom_title_expires_at FROM users WHERE id = ?')
    .bind(user.userId)
    .first<{ exp: number; custom_title: string | null; custom_title_expires_at: string | null }>();
  if (dbUser?.custom_title && !dbUser.custom_title_expires_at) {
    return c.json({ success: false, error: '请先清除 VIP 头衔' }, 400);
  }

  // 查找未使用的自定义称号道具
  let item = await c.env.DB.prepare(`
    SELECT id, item_meta as data FROM user_lottery_items
    WHERE user_id = ? AND item_type = 'custom_title' AND used = 0
    LIMIT 1
  `).bind(user.userId).first<{ id: number; data?: string }>();
  if (!item) return c.json({ success: false, error: '没有可用的自定义称号道具' }, 400);

  let days = 3;
  try { days = JSON.parse(item.data || '{}').duration_days || 3; } catch {}
  const hours = days * 24;

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE user_lottery_items SET used = 1 WHERE id = ?').bind(item.id),
    c.env.DB.prepare(`
      UPDATE users SET custom_title = ?,
        custom_title_expires_at = datetime(
          CASE WHEN custom_title_expires_at > datetime('now') THEN custom_title_expires_at ELSE datetime('now') END,
          '+' || ? || ' hours'
        )
      WHERE id = ?
    `).bind(titleText, hours, user.userId),
  ]);

  return c.json({ success: true, message: `自定义称号「${titleText}」已启用（叠加${days}天）` });
});

// ─── 查询所有活跃效果 ───
items.get('/active-effects', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');

  const [postEffects, userEffects, vipInfo] = await Promise.all([
    // 帖子类效果（帖子背景不在活跃效果里展示——由帖子详情页提供取消入口）
    c.env.DB.prepare(`
      SELECT id, title, bumped_until, highlighted_until, fortune, fortune_expires_at, title_effect, title_effect_expires_at, post_bg_id
      FROM posts WHERE user_id = ? AND deleted_at IS NULL
      AND (bumped_until > datetime('now') OR highlighted_until > datetime('now')
        OR fortune_expires_at > datetime('now') OR title_effect IS NOT NULL)
      ORDER BY created_at DESC
    `).bind(user.userId).all<any>(),
    // 用户类效果
    c.env.DB.prepare(`
      SELECT avatar_frame, avatar_frame_expires_at, title_badge, title_badge_expires_at,
             custom_title, custom_title_expires_at
      FROM users WHERE id = ?
    `).bind(user.userId).first<any>(),
    // VIP 状态
    c.env.DB.prepare("SELECT tier, expires_at FROM user_vips WHERE user_id = ? AND expires_at > datetime('now')")
      .bind(user.userId).first<{ tier: string; expires_at: string }>(),
  ]);

  const effects: any[] = [];

  // 帖子类
  for (const p of postEffects.results || []) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (p.bumped_until && p.bumped_until > now) {
      effects.push({ id: `bump_${p.id}`, type: 'bump', label: '推荐中', postId: p.id, postTitle: p.title, expiresAt: p.bumped_until, cancellable: true });
    }
    if (p.highlighted_until && p.highlighted_until > now) {
      effects.push({ id: `highlight_${p.id}`, type: 'highlight', label: '高亮中', postId: p.id, postTitle: p.title, expiresAt: p.highlighted_until, cancellable: true });
    }
    if (p.fortune_expires_at && p.fortune_expires_at > now && p.fortune) {
      effects.push({ id: `fortune_${p.id}`, type: 'fortune', label: `运势·${p.fortune}`, postId: p.id, postTitle: p.title, expiresAt: p.fortune_expires_at, cancellable: true });
    }
    if (p.title_effect === 'rainbow' && (!p.title_effect_expires_at || p.title_effect_expires_at > now)) {
      effects.push({ id: `rainbow_${p.id}`, type: 'rainbow_title', label: '炫彩标题', postId: p.id, postTitle: p.title, expiresAt: p.title_effect_expires_at || null, cancellable: true });
    }
  }

  // 用户类
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (userEffects) {
    if (userEffects.avatar_frame && userEffects.avatar_frame_expires_at && userEffects.avatar_frame_expires_at > now) {
      effects.push({ id: 'avatar_frame', type: 'avatar_frame', label: '头像框', postId: null, postTitle: null, expiresAt: userEffects.avatar_frame_expires_at, cancellable: true });
    }
    if (userEffects.title_badge && userEffects.title_badge_expires_at && userEffects.title_badge_expires_at > now) {
      effects.push({ id: 'title_badge', type: 'title_badge', label: `称号·${userEffects.title_badge}`, postId: null, postTitle: null, expiresAt: userEffects.title_badge_expires_at, cancellable: true });
    } else if (userEffects.title_badge && !userEffects.title_badge_expires_at) {
      // 旧数据：永久称号，不过期
      effects.push({ id: 'title_badge', type: 'title_badge', label: `称号·${userEffects.title_badge}`, postId: null, postTitle: null, expiresAt: null, cancellable: true });
    }
    if (userEffects.custom_title && userEffects.custom_title_expires_at && userEffects.custom_title_expires_at > now) {
      effects.push({ id: 'custom_title', type: 'custom_title', label: `自定义称号·${userEffects.custom_title}`, postId: null, postTitle: null, expiresAt: userEffects.custom_title_expires_at, cancellable: true });
    }
  }

  if (vipInfo) {
    effects.push({ id: 'vip', type: 'vip', label: `VIP·${vipInfo.tier}`, postId: null, postTitle: null, expiresAt: vipInfo.expires_at, cancellable: false });
  }

  return c.json({ success: true, data: effects });
});

// ─── 装饰管理数据源：称号/头像框 的拥有集与当前佩戴状态 ───
items.get('/decoration', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const now = nowUtc();

  const u = await c.env.DB.prepare(`
    SELECT title_badge, title_badge_expires_at, avatar_frame, avatar_frame_expires_at,
           custom_title, custom_title_expires_at
    FROM users WHERE id = ?
  `).bind(user.userId).first<any>();

  // 已过期的视为未佩戴（只读不清理）；custom_title 的 expires_at 为 NULL 是 VIP 永久头衔，正常展示
  const equipped = {
    titleBadge: u?.title_badge && (!u.title_badge_expires_at || u.title_badge_expires_at > now)
      ? { title: u.title_badge, expiresAt: u.title_badge_expires_at || null }
      : null,
    avatarFrame: u?.avatar_frame && u.avatar_frame_expires_at && u.avatar_frame_expires_at > now
      ? { frame: u.avatar_frame, expiresAt: u.avatar_frame_expires_at }
      : null,
    customTitle: u?.custom_title && (!u.custom_title_expires_at || u.custom_title_expires_at > now)
      ? { title: u.custom_title, expiresAt: u.custom_title_expires_at || null }
      : null,
  };

  const [ownedTitles, ownedFrames] = await Promise.all([
    getOwnedTitles(c.env.DB, user.userId),
    getOwnedFrames(c.env.DB, user.userId),
  ]);

  return c.json({ success: true, data: { equipped, ownedTitles, ownedFrames } });
});

// ─── 佩戴/切换成就称号（来源 = 成就解锁集，称号文本即成就 name）───
items.post('/equip-title-badge', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { title } = await c.req.json();
  if (!title || typeof title !== 'string') {
    return c.json({ success: false, error: '参数无效' }, 400);
  }

  const owned = await getOwnedTitles(c.env.DB, user.userId);
  const target = owned.find(t => t.title === title);
  if (!target) return c.json({ success: false, error: '未拥有该称号' }, 400);
  if (target.expiresAt && target.expiresAt <= nowUtc()) {
    return c.json({ success: false, error: '该称号已过期' }, 400);
  }

  // 永久称号 expires_at 置 NULL，与 grantTitleBadge 的永久写法一致
  await c.env.DB.prepare('UPDATE users SET title_badge = ?, title_badge_expires_at = ? WHERE id = ?')
    .bind(title, target.expiresAt, user.userId).run();
  return c.json({ success: true, message: `已佩戴称号「${title}」` });
});

// ─── 重戴成就头像框（重戴 = 剩余期直接设定，不叠加；道具头像框走 /items/use/avatar-frame）───
items.post('/equip-avatar-frame', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { frame } = await c.req.json();
  if (!frame || typeof frame !== 'string') {
    return c.json({ success: false, error: '参数无效' }, 400);
  }

  const owned = await getOwnedFrames(c.env.DB, user.userId);
  const target = owned.find(f => f.source === 'achievement' && f.frame === frame);
  if (!target) return c.json({ success: false, error: '未拥有该头像框' }, 400);
  if (target.expiresAt && target.expiresAt <= nowUtc()) {
    return c.json({ success: false, error: '该头像框已过期' }, 400);
  }

  await c.env.DB.prepare('UPDATE users SET avatar_frame = ?, avatar_frame_expires_at = ? WHERE id = ?')
    .bind(frame, target.expiresAt, user.userId).run();
  return c.json({ success: true, message: '已佩戴头像框' });
});

// ─── 我发出的红包（独立管理页用）：仅进行中的（未抢完），抢完/取消后自动消失 ───
items.get('/red-packets', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const rows = await c.env.DB.prepare(`
    SELECT rp.id, rp.post_id, rp.total_coins, rp.remaining_coins, rp.total_packets, rp.remaining_packets, rp.created_at, p.title AS post_title,
      (SELECT COUNT(*) FROM red_packet_claims rc WHERE rc.red_packet_id = rp.id AND rc.amount > 0) AS claimed_count
    FROM red_packets rp JOIN posts p ON p.id = rp.post_id
    WHERE rp.user_id = ? AND rp.remaining_packets > 0 AND p.deleted_at IS NULL
    ORDER BY rp.created_at DESC
  `).bind(user.userId).all<any>();
  return c.json({ success: true, data: (rows.results || []).map(r => ({
    id: r.id,
    postId: r.post_id,
    postTitle: r.post_title,
    totalCoins: r.total_coins,
    remainingCoins: r.remaining_coins,
    totalPackets: r.total_packets,
    remainingPackets: r.remaining_packets,
    claimedCount: r.claimed_count || 0,
    createdAt: r.created_at,
  })) });
});

// ─── 取消帖子效果 ───
items.post('/cancel-effect', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { effectId } = await c.req.json();
  if (!effectId) return c.json({ success: false, error: '参数无效' }, 400);

  // 特殊处理：非帖子效果
  // 取消红包：退还剩余金额（已领走的不可收回），删除红包记录（领取记录级联删除）
  if (effectId.startsWith('rp_')) {
    const rpId = parseInt(effectId.slice(3));
    if (!rpId || isNaN(rpId)) return c.json({ success: false, error: '无效的效果ID' }, 400);
    const rp = await c.env.DB
      .prepare('SELECT id, user_id, remaining_coins, remaining_packets FROM red_packets WHERE id = ?')
      .bind(rpId).first<{ id: number; user_id: number; remaining_coins: number; remaining_packets: number }>();
    if (!rp) return c.json({ success: false, error: '红包不存在' }, 404);
    if (rp.user_id !== user.userId) return c.json({ success: false, error: '只能取消自己发的红包' }, 403);
    if (rp.remaining_packets <= 0) return c.json({ success: false, error: '红包已抢完，无需取消' }, 400);

    // 原子退款 + 流水 + 删除红包（同 batch，与删帖退款同一模式）
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO user_balances (user_id, coins) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET coins = coins + excluded.coins')
        .bind(user.userId, rp.remaining_coins),
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'red_packet_refund', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(user.userId, rp.remaining_coins, '取消红包退款', user.userId),
      c.env.DB.prepare('DELETE FROM red_packets WHERE id = ?').bind(rpId),
    ]);
    return c.json({ success: true, message: `已取消红包，退还 ${rp.remaining_coins} 积分` });
  }
  if (effectId === 'avatar_frame') {
    await c.env.DB.prepare("UPDATE users SET avatar_frame = NULL, avatar_frame_expires_at = NULL WHERE id = ?")
      .bind(user.userId).run();
    return c.json({ success: true, message: '已取消头像框效果' });
  }
  if (effectId === 'title_badge') {
    // 摘除称号：title_badge 列默认值为 ''（非 NULL），置空保持与默认一致
    await c.env.DB.prepare("UPDATE users SET title_badge = '', title_badge_expires_at = NULL WHERE id = ?")
      .bind(user.userId).run();
    return c.json({ success: true, message: '已摘除称号' });
  }
  if (effectId === 'custom_title') {
    await c.env.DB.prepare("UPDATE users SET custom_title = NULL, custom_title_expires_at = NULL WHERE id = ?")
      .bind(user.userId).run();
    return c.json({ success: true, message: '已取消自定义称号效果' });
  }

  // 解析 effectId: "bump_123", "highlight_123", "fortune_123", "rainbow_123"
  const [type, postIdStr] = effectId.split('_');
  const postId = parseInt(postIdStr);
  if (!postId || isNaN(postId)) return c.json({ success: false, error: '无效的效果ID' }, 400);

  // 校验帖子所有权
  const post = await c.env.DB
    .prepare('SELECT id, user_id FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId).first<{ id: number; user_id: number }>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能取消自己帖子的效果' }, 403);

  switch (type) {
    case 'bump':
      await c.env.DB.prepare("UPDATE posts SET bumped_until = datetime('now') WHERE id = ? AND user_id = ?")
        .bind(postId, user.userId).run();
      return c.json({ success: true, message: '已取消推荐效果' });
    case 'highlight':
      await c.env.DB.prepare("UPDATE posts SET highlighted_until = datetime('now') WHERE id = ? AND user_id = ?")
        .bind(postId, user.userId).run();
      return c.json({ success: true, message: '已取消高亮效果' });
    case 'fortune':
      await c.env.DB.prepare("UPDATE posts SET fortune = NULL, fortune_expires_at = NULL WHERE id = ? AND user_id = ?")
        .bind(postId, user.userId).run();
      return c.json({ success: true, message: '已取消运势效果' });
    case 'rainbow':
      await c.env.DB.prepare("UPDATE posts SET title_effect = NULL, title_effect_expires_at = NULL WHERE id = ? AND user_id = ?")
        .bind(postId, user.userId).run();
      return c.json({ success: true, message: '已取消炫彩标题效果' });
    case 'bg':
      // 取消背景立即释放「效果额度」（不再消耗任何机会，改为按生效效果数量实时计算）
      await c.env.DB.prepare("UPDATE posts SET post_bg_id = NULL WHERE id = ? AND user_id = ?")
        .bind(postId, user.userId).run();
      return c.json({ success: true, message: '已取消帖子背景效果' });
    default:
      return c.json({ success: false, error: '未知的效果类型' }, 400);
  }
});

export default items;
