// 装饰管理公共库（称号/头像框 的「拥有集」计算）
// 供 items.ts 的 GET /decoration、POST /equip-title-badge、POST /equip-avatar-frame 共用，
// 避免「查询拥有集」与「佩戴校验」两处逻辑分裂。
// 拥有来源：成就注册表（ACHIEVEMENTS + PATROL_ACHIEVEMENTS 的 rewards）+ 道具（商城/抽奖头像框）
import type { D1Database } from '../types';
import { ACHIEVEMENTS } from './game';
import { PATROL_ACHIEVEMENTS } from './patrol';

// 成就头像框固定款式：成就 rewards 的 avatar_frame 奖励当前未带 frame 字段，统一 'default'；
// 未来支持多款式时在 rewards 里加 frame 字段，在此扩展读取即可
export const ACHIEVEMENT_FRAME = 'default';

// 道具头像框类型（user_items 经 shop_items.type、user_lottery_items 经 item_type，两表一致）
export const ITEM_AVATAR_FRAME_TYPE = 'item_avatar_frame';

export interface OwnedTitle {
  title: string;
  expiresAt: string | null; // 永久为 null；限时 = 解锁时间 + days（已过期原样返回，由佩戴端点拒绝）
  permanent: boolean;
}

export interface OwnedFrame {
  frame: string;
  expiresAt: string | null;
  source: 'achievement' | 'item';
  // 道具来源附加字段（前端对道具项显示「使用」按钮，走现有 /items/use/avatar-frame）
  itemId?: number;
  itemType?: 'user_items' | 'user_lottery_items';
  durationDays?: number;
}

/** 当前 UTC 时间，与 SQLite datetime('now') 同格式（'YYYY-MM-DD HH:MM:SS'） */
export function nowUtc(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** unlocked_at（'YYYY-MM-DD HH:MM:SS' UTC）+ days 天，返回同格式（与 SQLite date(+N days) 口径一致） */
function addDaysUtc(dt: string, days: number): string {
  const d = new Date(dt.replace(' ', 'T') + 'Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// 全部成就定义（校园 + 巡查），只取装饰奖励需要的字段
function allAchievementDefs(): { key: string; name: string; rewards: { type: string; days?: number }[] }[] {
  return [
    ...Object.entries(ACHIEVEMENTS).map(([key, def]) => ({ key, name: def.name, rewards: def.rewards })),
    ...Object.entries(PATROL_ACHIEVEMENTS).map(([key, def]) => ({ key, name: def.name, rewards: def.rewards })),
  ];
}

/** 用户已解锁成就（key → unlocked_at） */
async function fetchUnlockedAt(db: D1Database, userId: number): Promise<Map<string, string>> {
  const rows = await db.prepare('SELECT key, unlocked_at FROM achievements WHERE user_id = ?')
    .bind(userId).all<{ key: string; unlocked_at: string }>();
  const map = new Map<string, string>();
  for (const r of rows.results || []) map.set(r.key, r.unlocked_at || '');
  return map;
}

/**
 * 拥有称号列表（成就奖励 title_badge 来源；称号文本 = 成就 name）。
 * 已过期的保留在列表、expiresAt 原样返回（前端灰显，佩戴端点拒绝）。
 */
export async function getOwnedTitles(db: D1Database, userId: number): Promise<OwnedTitle[]> {
  const unlocked = await fetchUnlockedAt(db, userId);
  const titles: OwnedTitle[] = [];
  for (const def of allAchievementDefs()) {
    const reward = def.rewards.find(r => r.type === 'title_badge');
    if (!reward) continue;
    const unlockedAt = unlocked.get(def.key);
    if (!unlockedAt) continue;
    const days = reward.days && reward.days > 0 ? reward.days : undefined; // 省略 days 视为永久
    titles.push({
      title: def.name,
      expiresAt: days ? addDaysUtc(unlockedAt, days) : null,
      permanent: !days,
    });
  }
  return titles;
}

/**
 * 拥有头像框列表：
 *  - 成就来源（avatar_frame 奖励，固定款式 ACHIEVEMENT_FRAME；限时 = 解锁时间 + days）
 *  - 道具来源（user_items/user_lottery_items 未使用的头像框；时长不预置，使用后由
 *    /items/use/avatar-frame 生效叠加，此处 expiresAt 恒为 null）
 */
export async function getOwnedFrames(db: D1Database, userId: number): Promise<OwnedFrame[]> {
  const unlocked = await fetchUnlockedAt(db, userId);
  const frames: OwnedFrame[] = [];

  // 成就来源
  for (const def of allAchievementDefs()) {
    const reward = def.rewards.find(r => r.type === 'avatar_frame');
    if (!reward) continue;
    const unlockedAt = unlocked.get(def.key);
    if (!unlockedAt) continue;
    const days = reward.days && reward.days > 0 ? reward.days : undefined;
    frames.push({
      frame: ACHIEVEMENT_FRAME,
      expiresAt: days ? addDaysUtc(unlockedAt, days) : null,
      source: 'achievement',
    });
  }

  // 道具来源（未使用；商城 user_items + 抽奖 user_lottery_items）
  const [shopRows, lotteryRows] = await Promise.all([
    db.prepare(`
      SELECT ui.id, si.data AS data FROM user_items ui
      JOIN shop_items si ON ui.item_id = si.id
      WHERE ui.user_id = ? AND si.type = ? AND ui.used = 0
    `).bind(userId, ITEM_AVATAR_FRAME_TYPE).all<{ id: number; data?: string | null }>(),
    db.prepare(`
      SELECT id, item_meta AS data FROM user_lottery_items
      WHERE user_id = ? AND item_type = ? AND used = 0
    `).bind(userId, ITEM_AVATAR_FRAME_TYPE).all<{ id: number; data?: string | null }>(),
  ]);
  for (const r of shopRows.results || []) {
    const meta = parseMeta(r.data);
    frames.push({
      frame: meta.frame || ACHIEVEMENT_FRAME,
      expiresAt: null,
      source: 'item',
      itemId: r.id,
      itemType: 'user_items',
      durationDays: meta.duration_days,
    });
  }
  for (const r of lotteryRows.results || []) {
    const meta = parseMeta(r.data);
    frames.push({
      frame: meta.frame || ACHIEVEMENT_FRAME,
      expiresAt: null,
      source: 'item',
      itemId: r.id,
      itemType: 'user_lottery_items',
      durationDays: meta.duration_days,
    });
  }
  return frames;
}

/** 解析道具 data/item_meta JSON（非法 JSON 视为空对象，各字段按默认兜底） */
function parseMeta(data?: string | null): { frame?: string; duration_days?: number } {
  try {
    const m = JSON.parse(data || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}
