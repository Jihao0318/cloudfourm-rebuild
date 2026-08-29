import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { unlockAchievement } from '../utils/game';

const lotteryCoins = new Hono<{ Bindings: Env }>();

// 抽奖默认值（settings 覆盖；后台可修改全部数值）
const DEFAULT_CFG = {
  drawCost: 40, draw10Cost: 360,
  ssrBase: 5, ssrBoost: 25, srRate: 15, rRate: 30, nRate: 50,
  softPity: 50, hardPity: 80,
};

// 读取抽奖配置（settings 键，缺失时用默认值）
async function getLotteryConfig(db: D1Database): Promise<typeof DEFAULT_CFG> {
  const keys = ['lottery_draw_cost', 'lottery_draw10_cost', 'lottery_rate_ssr', 'lottery_rate_ssr_boost',
    'lottery_rate_sr', 'lottery_rate_r', 'lottery_rate_n', 'lottery_pity_soft', 'lottery_pity_hard'];
  const rows = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ key: string; value: string }>();
  const m: Record<string, string> = {};
  for (const r of rows.results || []) m[r.key] = r.value;
  const num = (k: string, d: number) => { const v = parseInt(m[k] ?? ''); return Number.isFinite(v) && v >= 0 ? v : d; };
  return {
    drawCost: num('lottery_draw_cost', DEFAULT_CFG.drawCost),
    draw10Cost: num('lottery_draw10_cost', DEFAULT_CFG.draw10Cost),
    ssrBase: num('lottery_rate_ssr', DEFAULT_CFG.ssrBase),
    ssrBoost: num('lottery_rate_ssr_boost', DEFAULT_CFG.ssrBoost),
    srRate: num('lottery_rate_sr', DEFAULT_CFG.srRate),
    rRate: num('lottery_rate_r', DEFAULT_CFG.rRate),
    nRate: num('lottery_rate_n', DEFAULT_CFG.nRate),
    softPity: num('lottery_pity_soft', DEFAULT_CFG.softPity),
    hardPity: num('lottery_pity_hard', DEFAULT_CFG.hardPity),
  };
}

// 价格限流
const drawRateLimit = rateLimit({ windowSeconds: 10, maxRequests: 3, keyPrefix: 'lottery_draw' });

// ─── 工具函数 ───

// 按稀有度计算实际概率（考虑保底；cfg 由后台配置）
function calcRarityChances(pullsSinceSSR: number, cfg: typeof DEFAULT_CFG): Record<string, number> {
  const ssrRate = pullsSinceSSR >= cfg.hardPity ? 100
    : pullsSinceSSR >= cfg.softPity ? cfg.ssrBoost
    : cfg.ssrBase;

  if (ssrRate >= 100) return { SSR: 100, SR: 0, R: 0, N: 0 };

  const remaining = 100 - ssrRate;
  const srRate = cfg.srRate;
  const rRate = cfg.rRate;
  const nRate = cfg.nRate;
  const totalBase = srRate + rRate + nRate;

  return {
    SSR: ssrRate,
    SR: Math.round((srRate / totalBase) * remaining),
    R: Math.round((rRate / totalBase) * remaining),
    N: remaining - Math.round((srRate / totalBase) * remaining) - Math.round((rRate / totalBase) * remaining),
  };
}

// 按稀有度随机抽一个奖品（从高到低迭代，避免硬保底 rand=0 时误判）
function pickByRarity(chances: Record<string, number>): string {
  const rand = Math.random() * 100;
  let cum = 0;
  for (const r of ['SSR', 'SR', 'R', 'N']) {
    cum += chances[r] || 0;
    if (rand <= cum) return r;
  }
  return 'N';
}

// 从奖池中按稀有度和权重轮盘随机选一个奖品
function pickPrize(prizes: any[], rarity: string): any {
  const pool = prizes.filter(p => p.rarity === rarity);
  if (pool.length === 0) return undefined;
  // 权重轮盘赌：按 weight 列分配概率
  const totalWeight = pool.reduce((s, p) => s + (p.weight || 1), 0);
  let rand = Math.random() * totalWeight;
  for (const p of pool) {
    rand -= (p.weight || 1);
    if (rand <= 0) return p;
  }
  return pool[pool.length - 1]; // 兜底
}

// ─── 查询状态 ───
lotteryCoins.get('/status', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const [balanceRow, prizes, pityRow, cfg] = await Promise.all([
    c.env.DB.prepare('SELECT coins FROM user_balances WHERE user_id = ?').bind(user.userId).first<{ coins: number }>(),
    c.env.DB.prepare('SELECT * FROM lottery_coin_prizes ORDER BY id ASC').all<any>(),
    c.env.DB.prepare('SELECT pulls_since_ssr, total_pulls FROM lottery_pity WHERE user_id = ?').bind(user.userId).first<{ pulls_since_ssr: number; total_pulls: number }>(),
    getLotteryConfig(c.env.DB),
  ]);

  const pullsSinceSSR = pityRow?.pulls_since_ssr || 0;
  const totalPulls = pityRow?.total_pulls || 0;
  const chances = calcRarityChances(pullsSinceSSR, cfg);

  return c.json({
    success: true,
    data: {
      draw_cost: cfg.drawCost,
      draw10_cost: cfg.draw10Cost,
      balance: balanceRow?.coins || 0,
      prizes: (prizes.results || []).map(p => ({
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        type: p.type,
        value: p.value,
        rarity: p.rarity,
        weight: p.weight,
      })),
      pity: {
        pulls_since_ssr: pullsSinceSSR,
        total_pulls: totalPulls,
        ssr_chance: chances.SSR,
        // 保底配置值（前端进度条分母：soft_pity / hard_pity 来自 lottery_pity_soft / lottery_pity_hard）
        soft_pity: cfg.softPity,
        hard_pity: cfg.hardPity,
        to_soft_pity: Math.max(0, cfg.softPity - pullsSinceSSR),
        to_hard_pity: Math.max(0, cfg.hardPity - pullsSinceSSR),
      },
    },
  });
});

// ─── 单抽 ───
lotteryCoins.post('/draw', requireAuth, drawRateLimit, async (c) => {
  const user: JWTPayload = c.get('user');
  try {
    return await handleDraw(c, user, 1, false);
  } catch (err: any) {
    console.error('draw error:', err, err?.stack);
    return c.json({ success: false, error: `抽奖失败: ${err?.message || '未知错误'}` }, 500);
  }
});

// ─── 十连 ───
lotteryCoins.post('/draw10', requireAuth, drawRateLimit, async (c) => {
  const user: JWTPayload = c.get('user');
  try {
    return await handleDraw(c, user, 10, true);
  } catch (err: any) {
    console.error('draw10 error:', err, err?.stack);
    return c.json({ success: false, error: `抽奖失败: ${err?.message || '未知错误'}` }, 500);
  }
});

// ─── 核心抽奖逻辑 ───
async function handleDraw(c: any, user: JWTPayload, count: number, isTenPull: boolean) {
  const cfg = await getLotteryConfig(c.env.DB);
  const cost = isTenPull ? cfg.draw10Cost : cfg.drawCost;

  // 先检查积分
  const balanceRow = await c.env.DB
    .prepare('SELECT coins FROM user_balances WHERE user_id = ?')
    .bind(user.userId).first<{ coins: number }>();
  const currentCoins = balanceRow?.coins || 0;
  if (currentCoins < cost) {
    return c.json({ success: false, error: `积分不足，需要 ${cost} 积分` }, 400);
  }

  // 读取奖池
  const prizes = (await c.env.DB.prepare('SELECT * FROM lottery_coin_prizes').all<any>()).results || [];
  if (prizes.length === 0) {
    return c.json({ success: false, error: '奖池为空，请联系管理员' }, 500);
  }

  // 读取保底
  const pityRow = await c.env.DB
    .prepare('SELECT pulls_since_ssr, total_pulls FROM lottery_pity WHERE user_id = ?')
    .bind(user.userId).first<{ pulls_since_ssr: number; total_pulls: number }>();
  let pullsSinceSSR = pityRow?.pulls_since_ssr || 0;

  // 执行抽奖
  const results: any[] = [];
  let hasSSR = false;
  let hasSRorAbove = false;

  for (let i = 0; i < count; i++) {
    const chances = calcRarityChances(pullsSinceSSR, cfg);
    const rarity = pickByRarity(chances);
    const prize = pickPrize(prizes, rarity);
    if (!prize) { // 保底：如果该稀有度无奖品，回退到N（回退也算一次抽数，保底计数不被吞）
      const fallback = pickPrize(prizes, 'N');
      if (fallback) results.push(fallback);
      pullsSinceSSR++;
      continue;
    }
    results.push(prize);
    if (prize.rarity === 'SSR') {
      hasSSR = true;
      pullsSinceSSR = 0;
    } else {
      pullsSinceSSR++;
    }
    if (prize.rarity === 'SR' || prize.rarity === 'SSR') hasSRorAbove = true;
  }

  // 十连保底：至少 1 个 SR+
  if (isTenPull && !hasSRorAbove) {
    // 优先替换最后一个 N，没有 N 则替换最后一个 R
    let replaceIdx = results.map((r, i) => r.rarity === 'N' ? i : -1).filter(i => i >= 0).pop();
    if (replaceIdx === undefined) {
      replaceIdx = results.map((r, i) => r.rarity === 'R' ? i : -1).filter(i => i >= 0).pop();
    }
    if (replaceIdx !== undefined) {
      const srPrize = pickPrize(prizes, 'SR') || pickPrize(prizes, 'R');
      if (srPrize) results[replaceIdx] = srPrize;
    }
  }

  // 处理所有奖品（积分累加，道具收集）
  let totalCoinsGain = 0;
  const itemGrants: { type: string; name: string; value?: string; _meta?: any }[] = [];
  const vipTickets: { tier: string; days: number }[] = [];
  let shouldAnnounce = false;
  let announceName = '';

  for (const prize of results) {
    switch (prize.type) {
      case 'coins': {
        const val = parseInt(prize.value) || 0;
        totalCoinsGain += val;
        break;
      }
      case 'rename': {
        const val = parseInt(prize.value) || 1;
        for (let i = 0; i < val; i++) itemGrants.push({ type: 'rename_card', name: '改名卡', value: prize.value, rarity: prize.rarity });
        break;
      }
      case 'vip': {
        const [tier, dur] = (prize.value as string).split(':');
        const days = parseInt(dur) || 3;
        vipTickets.push({ tier, days, rarity: prize.rarity });
        break;
      }
      case 'bump':
        itemGrants.push({ type: 'item_bump', name: '提升卡', value: prize.value, rarity: prize.rarity });
        break;
      case 'highlight':
        itemGrants.push({ type: 'item_highlight', name: '高亮卡', value: prize.value, rarity: prize.rarity });
        break;
      case 'fortune':
        itemGrants.push({ type: 'item_fortune', name: '今日运势', value: prize.value, rarity: prize.rarity });
        break;
      case 'avatar_frame':
        // 头像框直接写入 users 表
        itemGrants.push({ type: 'item_avatar_frame', name: '头像框', value: prize.value, rarity: prize.rarity });
        break;
      case 'title_badge':
        // 改为发放自定义称号道具，中奖者可在仓库自定义称号文字
        itemGrants.push({ type: 'custom_title', name: '自定义称号', value: prize.value, rarity: prize.rarity });
        break;
      case 'rainbow_title':
        itemGrants.push({ type: 'item_rainbow_title', name: '炫彩标题', value: prize.value, rarity: prize.rarity });
        break;
      case 'announce': {
        shouldAnnounce = true;
        announceName = prize.name;
        itemGrants.push({ type: 'item_announce', name: '大喇叭', value: prize.value, rarity: prize.rarity });
        break;
      }
    }
  }

  // 批量写入数据库
  const stmts: any[] = [];

  // 1. 原子扣款（带余额检查防止并发超扣，扣不到则后续写入不执行）
  const deductResult = await c.env.DB
    .prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ? AND coins >= ?')
    .bind(cost, cost, user.userId, cost)
    .run();
  if (!deductResult.meta.changes) {
    return c.json({ success: false, error: '积分不足' }, 400);
  }

  // 2. 记录扣款交易
  stmts.push(
    c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'lottery_draw', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(user.userId, -cost, isTenPull ? `积分抽奖十连` : `积分抽奖`, user.userId),
  );

  // 3. 加积分
  if (totalCoinsGain > 0) {
    stmts.push(
      c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
        .bind(totalCoinsGain, totalCoinsGain, user.userId),
    );
    stmts.push(
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'lottery_win', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(user.userId, totalCoinsGain, `抽奖获得 ${totalCoinsGain} 积分`, user.userId),
    );
  }

  // 4. 发道具（新类型走 user_lottery_items，rename_card 走 user_items）
  // 道具配置缓存：key = 道具 type，value = shop_items.id（null 表示缺配）。
  // D1 每次查询都是一次 worker↔D1 网络往返，原实现对每张 rename_card 都重复查一次库，
  // 十连抽出 N 张同类道具就是 N 次往返；用本 Map 把同类道具的 N 次查询降为 1 次。
  // 注意：缓存作用域仅限本次抽奖函数体内（不跨请求），避免 Worker 全局态跨请求脏读。
  const itemCache = new Map<string, { id: number } | null>();
  for (const item of itemGrants) {
    if (item.type === 'rename_card') {
      // rename_card 有 shop_items 记录，走原路径
      // 用 === undefined 判「未查过」：查到 null（缺配）也要写入缓存，
      // 这样十连多次命中缺配类型时不会重复查库，每次都走原有的跳过分支
      let renameItem = itemCache.get(item.type);
      if (renameItem === undefined) {
        renameItem = await c.env.DB
          .prepare("SELECT id FROM shop_items WHERE type = 'rename_card' LIMIT 1")
          .first<{ id: number }>();
        itemCache.set(item.type, renameItem);
      }
      if (renameItem) {
        stmts.push(
          c.env.DB.prepare('INSERT INTO user_items (user_id, item_id) VALUES (?, ?)')
            .bind(user.userId, renameItem.id),
        );
      }
    } else {
      // 限时道具记录有效天数（itemGrants 里的 type 已带 item_ 前缀；custom_title 由 title_badge 映射而来）
      const durationMap: Record<string, number> = { item_avatar_frame: 1, custom_title: 3, item_rainbow_title: 7 };
      const duration = durationMap[(item as any).type] || 1;
      const meta = JSON.stringify({ rarity: (item as any).rarity || 'N', duration_days: parseInt((item as any).value) || duration });
      stmts.push(
        c.env.DB.prepare('INSERT INTO user_lottery_items (user_id, item_type, item_name, item_meta) VALUES (?, ?, ?, ?)')
          .bind(user.userId, item.type, item.name, meta),
      );
    }
  }

  // 5. VIP 体验券入库（加入 batch 原子提交）
  for (const ticket of vipTickets) {
    stmts.push(
      c.env.DB.prepare('INSERT INTO user_vip_tickets (user_id, tier, days) VALUES (?, ?, ?)')
        .bind(user.userId, ticket.tier, ticket.days),
    );
  }

  // 6. 更新保底（使用 SQL 级增量避免并发覆盖）
  if (hasSSR) {
    stmts.push(
      c.env.DB.prepare(`INSERT INTO lottery_pity (user_id, pulls_since_ssr, total_pulls)
        VALUES (?, 0, ?) ON CONFLICT(user_id) DO UPDATE SET pulls_since_ssr = 0, total_pulls = total_pulls + ?`)
        .bind(user.userId, count, count),
    );
  } else {
    stmts.push(
      c.env.DB.prepare(`INSERT INTO lottery_pity (user_id, pulls_since_ssr, total_pulls)
        VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET pulls_since_ssr = pulls_since_ssr + ?, total_pulls = total_pulls + ?`)
        .bind(user.userId, count, count, count, count),
    );
  }

  // 7. 全服公告
  if (shouldAnnounce) {
    stmts.push(
      c.env.DB.prepare('INSERT INTO lottery_announcements (user_id, prize_name) VALUES (?, ?)')
        .bind(user.userId, announceName),
    );
  }

  // 原子提交
  await c.env.DB.batch(stmts);

  // 欧皇成就（SSR 出货；钩子失败不影响抽奖主流程）
  if (hasSSR) {
    await unlockAchievement(c.env.DB, user.userId, 'ssr').catch((e) => { console.error('lottery ssr achievement hook failed', e); });
  }

  // 构建返回结果
  const resultItems = results.map(r => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    type: r.type,
    value: r.value,
    rarity: r.rarity,
    coins: r.type === 'coins' ? parseInt(r.value) || 0 : 0,
  }));

  return c.json({
    success: true,
    data: {
      items: resultItems,
      summary: {
        total_coins_gain: totalCoinsGain,
        item_count: itemGrants.length,
        vip_granted: vipTickets.length > 0,
        has_ssr: hasSSR,
        has_announce: shouldAnnounce,
      },
      cost,
    },
  });
}

export default lotteryCoins;
