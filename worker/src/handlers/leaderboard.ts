import { Hono } from 'hono';
import type { Env } from '../types';

const leaderboard = new Hono<{ Bindings: Env }>();

// 每日物化排行榜：清空缓存表 → 全量重灌，并把总人数写入 settings，
// 避免接口每次请求 DENSE_RANK 全表排序 + COUNT 全扫（线上 10 万用户时单次请求读 10 万行）。
// 排名滞后 ≤24h（由 index.ts 的 scheduled 任务每日调用本函数重算），论坛场景可接受。
// 与 GET /coins 现状保持一致：只统计/展示未软删用户（原查询 JOIN users 且 u.deleted_at IS NULL）。
export async function recalculateLeaderboard(db: D1Database): Promise<void> {
  // total 语义与现状一致：未软删用户总数（原接口 SELECT COUNT(*) FROM users WHERE deleted_at IS NULL）。
  // batch 内无法引用前序查询结果，所以先单独 COUNT，再写入 settings。
  const totalRow = await db
    .prepare('SELECT COUNT(*) AS cnt FROM users WHERE deleted_at IS NULL')
    .first<{ cnt: number }>();
  const total = totalRow?.cnt || 0;

  await db.batch([
    db.prepare('DELETE FROM leaderboard_cache'),
    // 全量重灌（按 coins 排序消费）：仅灌入未软删用户的积分行。
    // 注册即建 user_balances 行（auth.ts）+ 056 回填，未软删用户均有对应行；软删用户在此过滤，
    // 与接口读路径 JOIN users ... deleted_at IS NULL 保持同一口径，避免缓存中出现死行。
    db.prepare(`
      INSERT INTO leaderboard_cache (user_id, coins, total_earned)
      SELECT b.user_id, b.coins, b.total_earned
      FROM user_balances b
      JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL
    `),
    // settings.value 为 TEXT，需转字符串；key 为 PRIMARY KEY，ON CONFLICT 幂等可重跑
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('leaderboard_total', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(String(total)),
  ]);
}

// 积分总榜 TOP 50（只读物化表 leaderboard_cache，排名滞后 ≤24h）
leaderboard.get('/coins', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const list = await c.env.DB
    .prepare(`
      SELECT u.id, u.username, u.avatar_url, u.role, u.custom_title, u.custom_title_expires_at, u.nick_theme,
             c.coins, c.total_earned,
             v.tier as vip_tier
      FROM leaderboard_cache c
      JOIN users u ON u.id = c.user_id AND u.deleted_at IS NULL
      LEFT JOIN user_vips v ON v.user_id = u.id AND v.expires_at > datetime('now')
      ORDER BY c.coins DESC, c.user_id ASC
      LIMIT ? OFFSET ?
    `)
    .bind(pageSize, offset)
    .all();

  // rank 语义与原 DENSE_RANK 等价（coins 相同则并列同 rank，coins 变化才 +1），改由 JS 按物化顺序推演。
  // 首行 rank = 1 + 高于其 coins 的去重档位数：page=1 时首行即全榜最高（rank 直接为 1）；
  // page>1 时补查一次 COUNT(DISTINCT coins)（仅扫 cache 单列，无排序/无 JOIN，远低于原全表 DENSE_RANK）。
  // 并列跨页（coins 相同且分属两页）时，各页基于首行基数独立计算，仍得到同一 rank。
  const rows = list.results as Array<{ id: number; coins: number } & Record<string, unknown>>;
  let rank = 1;
  if (rows.length > 0) {
    if (page > 1) {
      const higher = await c.env.DB
        .prepare('SELECT COUNT(DISTINCT coins) AS cnt FROM leaderboard_cache WHERE coins > ?')
        .bind(rows[0].coins)
        .first<{ cnt: number }>();
      rank = (higher?.cnt || 0) + 1;
    }
    for (let i = 0; i < rows.length; i++) {
      if (i > 0 && rows[i].coins !== rows[i - 1].coins) rank++;
      rows[i].rank = rank;
    }
  }

  // total 由每日物化写入 settings；未重算过时 key 不存在，parseInt 兜底 0
  const totalRow = await c.env.DB
    .prepare("SELECT value FROM settings WHERE key = 'leaderboard_total'")
    .first<{ value: string }>();
  const total = parseInt(totalRow?.value || '0', 10) || 0;

  return c.json({
    success: true,
    data: rows,
    total,
    page,
    pageSize,
  });
});

export default leaderboard;
