import { Hono } from 'hono';
import type { Env } from '../types';

const leaderboard = new Hono<{ Bindings: Env }>();

// 积分总榜 TOP 50 —— 直接读实时余额（user_balances）。
//
// 历史与改动原因：早期为扛「10 万用户」规模，把榜单做成每日物化（leaderboard_cache 表 +
// settings.leaderboard_total），导致榜单最长滞后 24 小时——用户当天赚/花的积分第二天才反映到榜上，
// 表现为「积分榜不同步」（2026-09-18 用户反馈，实测 23 个账号里 7 个数字与实时余额不一致）。
// 现在改为实时查询：
//   · 主查询 ORDER BY coins DESC LIMIT/OFFSET（走 idx_user_balances_coins 索引，只取一页）
//   · 并列名次由 JS 推演（与物化版 rank 语义一致：coins 相同并列，coins 变化才 +1）
//   · page>1 时补一次 COUNT(DISTINCT coins) WHERE coins > ?（只扫单列，用于算本页起始名次）
//   · total（页脚「共 N 位用户」）也实时 COUNT，不再滞后
leaderboard.get('/coins', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const list = await c.env.DB
    .prepare(`
      SELECT u.id, u.username, u.avatar_url, u.role, u.custom_title, u.custom_title_expires_at, u.nick_theme,
             b.coins, b.total_earned,
             v.tier as vip_tier
      FROM user_balances b
      JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL
      LEFT JOIN user_vips v ON v.user_id = u.id AND v.expires_at > datetime('now')
      ORDER BY b.coins DESC, b.user_id ASC
      LIMIT ? OFFSET ?
    `)
    .bind(pageSize, offset)
    .all();

  // rank 语义与原 DENSE_RANK 等价（coins 相同则并列同 rank，coins 变化才 +1），改由 JS 按查询顺序推演。
  // 首行 rank = 1 + 高于其 coins 的去重档位数：page=1 时首行即全榜最高（rank 直接为 1）；
  // page>1 时补查一次 COUNT(DISTINCT coins)（仅扫 coins 单列，无排序/无 JOIN）。
  // 并列跨页（coins 相同且分属两页）时，各页基于首行基数独立计算，仍得到同一 rank。
  const rows = list.results as Array<{ id: number; coins: number } & Record<string, unknown>>;
  let rank = 1;
  if (rows.length > 0) {
    if (page > 1) {
      const higher = await c.env.DB
        .prepare('SELECT COUNT(DISTINCT coins) AS cnt FROM user_balances WHERE coins > ?')
        .bind(rows[0].coins)
        .first<{ cnt: number }>();
      rank = (higher?.cnt || 0) + 1;
    }
    for (let i = 0; i < rows.length; i++) {
      if (i > 0 && rows[i].coins !== rows[i - 1].coins) rank++;
      rows[i].rank = rank;
    }
  }

  // 页脚「共 N 位用户」：实时统计（口径与列表一致：未软删用户）
  const totalRow = await c.env.DB
    .prepare('SELECT COUNT(*) AS cnt FROM users WHERE deleted_at IS NULL')
    .first<{ cnt: number }>();
  const total = totalRow?.cnt || 0;

  return c.json({
    success: true,
    data: rows,
    total,
    page,
    pageSize,
  });
});

export default leaderboard;
