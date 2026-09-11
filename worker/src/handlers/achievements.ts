import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { optionalAuth } from '../middleware/auth';
import { ACHIEVEMENTS } from '../utils/game';
import { PATROL_ACHIEVEMENTS } from '../utils/patrol';
import { checkAllAchievements } from '../utils/achievement-check';

const achievements = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 查询某用户当前已解锁成就集合（key 集合）
async function fetchUnlocked(db: D1Database, userId: number): Promise<Set<string>> {
  const rows = await db.prepare('SELECT key FROM achievements WHERE user_id = ?')
    .bind(userId).all<{ key: string }>();
  const set = new Set<string>();
  for (const r of rows.results || []) set.add(r.key);
  return set;
}

// 成就墙（公开；登录时显示自己的解锁状态）
achievements.get('/', optionalAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  let unlockedSet = new Set<string>();
  if (user) {
    // 惰性补解锁：修复「已达成但显示未解锁」的存量问题（内部兜底，失败不影响接口）
    try {
      await checkAllAchievements(c.env.DB, user.userId);
    } catch (e) {
      console.error('checkAllAchievements failed in GET /api/achievements', e);
    }
    // 重新查一次，确保返回补解锁后的最新状态
    unlockedSet = await fetchUnlocked(c.env.DB, user.userId);
  }

  // 校园 + 巡查 合并（老墙含巡查成就，保持一致展示）；coins 兼容旧字段 = rewards 里 coins 的 amount（无则 0）
  const list = [
    ...Object.entries(ACHIEVEMENTS).map(([key, def]) => ({ key, ...def })),
    ...Object.entries(PATROL_ACHIEVEMENTS).map(([key, def]) => ({
      key, name: def.name, desc: def.desc, rarity: def.rarity, rewards: def.rewards,
    })),
  ].map((a) => ({
    key: a.key,
    name: a.name,
    desc: a.desc,
    rarity: a.rarity,
    rewards: a.rewards,
    coins: a.rewards.find((r: { type: string }) => r.type === 'coins')?.amount || 0,
    unlocked: unlockedSet.has(a.key),
  }));

  return c.json({
    success: true,
    data: {
      achievements: list,
      unlocked_count: list.filter(a => a.unlocked).length,
      total: list.length,
    },
  });
});

// 成就殿堂（公开 + optionalAuth）：全站达成人数 + 本人解锁状态
achievements.get('/hall', optionalAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  let unlockedSet = new Set<string>();
  let myUnlocked: number | null = null;
  if (user) {
    // 与成就墙一致：先惰性补解锁再查，保证返回最新状态
    try {
      await checkAllAchievements(c.env.DB, user.userId);
    } catch (e) {
      console.error('checkAllAchievements failed in GET /api/achievements/hall', e);
    }
    unlockedSet = await fetchUnlocked(c.env.DB, user.userId);
    myUnlocked = unlockedSet.size;
  }

  // 全站达成人数（含历史所有用户）
  const countRows = await c.env.DB.prepare('SELECT key, COUNT(*) AS c FROM achievements GROUP BY key')
    .all<{ key: string; c: number }>();
  const countMap = new Map<string, number>();
  for (const r of countRows.results || []) countMap.set(r.key, r.c);

  const list = [
    ...Object.entries(ACHIEVEMENTS).map(([key, def]) => ({ key, category: 'campus' as const, ...def })),
    ...Object.entries(PATROL_ACHIEVEMENTS).map(([key, def]) => ({
      key, category: 'patrol' as const, name: def.name, desc: def.desc, rarity: def.rarity, rewards: def.rewards,
    })),
  ].map((a) => ({
    key: a.key,
    name: a.name,
    desc: a.desc,
    category: a.category,
    rarity: a.rarity,
    rewards: a.rewards,
    count: countMap.get(a.key) || 0,
    // unlocked 仅在登录时返回（未登录省略，前端按 undefined 处理）
    ...(user ? { unlocked: unlockedSet.has(a.key) } : {}),
  }));

  return c.json({
    success: true,
    data: {
      total_count: list.length,
      total_unlocks: [...countMap.values()].reduce((s, n) => s + n, 0),
      my_unlocked: myUnlocked,
      achievements: list,
    },
  });
});

// 某成就的达成者名单（公开，分页）：成就殿堂点击某个成就后查看「哪些人达成了」
achievements.get('/:key/unlockers', async (c) => {
  const key = c.req.param('key');
  // 只允许查询已定义的成就，避免任意 key 探测
  const known = (ACHIEVEMENTS as Record<string, unknown>)[key] || (PATROL_ACHIEVEMENTS as Record<string, unknown>)[key];
  if (!known) return c.json({ success: false, error: '成就不存在' }, 404);

  const page = Math.max(1, parseInt(c.req.query('page') || '1') || 1);
  const pageSize = 20;

  const totalRow = await c.env.DB
    .prepare('SELECT COUNT(*) AS c FROM achievements a JOIN users u ON u.id = a.user_id WHERE a.key = ? AND u.deleted_at IS NULL')
    .bind(key).first<{ c: number }>();

  // 先达成者在前（unlocked_at 相同时按 id 稳定排序）
  const rows = await c.env.DB
    .prepare(`SELECT u.id, u.username, u.avatar_url, u.avatar_frame, u.avatar_frame_expires_at, u.exp, a.unlocked_at
      FROM achievements a
      JOIN users u ON u.id = a.user_id
      WHERE a.key = ? AND u.deleted_at IS NULL
      ORDER BY a.unlocked_at ASC, u.id ASC
      LIMIT ? OFFSET ?`)
    .bind(key, pageSize, (page - 1) * pageSize)
    .all<{ id: number; username: string; avatar_url: string; avatar_frame: string | null; avatar_frame_expires_at: string | null; exp: number; unlocked_at: string }>();

  return c.json({
    success: true,
    data: {
      users: rows.results || [],
      total: totalRow?.c || 0,
      page,
      page_size: pageSize,
    },
  });
});

export default achievements;
