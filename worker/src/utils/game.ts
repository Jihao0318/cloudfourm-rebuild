// 经济 v3 游戏化公共库（docs/economy-v3-plan.md）
// 等级/经验/每日任务/成就 的公共实现，各 handler 通过这里接入，保证口径一致
import type { D1Database } from '../types';
import { addCoins } from '../handlers/coins';
// 巡查成就注册表在 patrol.ts（patrol.ts 反向 import 本模块，构成循环依赖；
// 两边对彼此符号的引用都发生在函数体内，模块初始化顺序无关，无 TDZ 风险）
import { PATROL_ACHIEVEMENTS } from './patrol';

// ─── UTC+8 业务日（与 coins.ts canEarnToday 口径一致）───
export function todayUtc8(): string {
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  return cst.toISOString().slice(0, 10);
}

export function todayWindowUtc8(): { start: string; end: string } {
  const today = todayUtc8();
  const start = new Date(today + 'T00:00:00Z');
  start.setHours(start.getHours() - 8);
  const end = new Date(start.getTime() + 86400000);
  return {
    start: start.toISOString().replace('T', ' ').slice(0, 19),
    end: end.toISOString().replace('T', ' ').slice(0, 19),
  };
}

// ─── 经验等级（30 级校园称号，等级纯计算不存列）───
// unlockLevel：该解锁生效的最低等级（道具/装饰 use 端点按此校验门槛）
interface LevelTier { maxLevel: number; name: string; expPerLevel: number; unlock?: string; unlockLevel?: number }
const LEVEL_TIERS: LevelTier[] = [
  { maxLevel: 4, name: '初学乍练', expPerLevel: 100 },
  { maxLevel: 9, name: '崭露头角', expPerLevel: 300 },
  { maxLevel: 14, name: '小有名气', expPerLevel: 500 },
  { maxLevel: 24, name: '声名鹊起', expPerLevel: 800 },
  { maxLevel: 30, name: '名震一方', expPerLevel: 1200, unlock: '鎏金标题', unlockLevel: 24 },
];

/** 按功能取解锁等级（等级表单一数据源；无该功能或未配置时返回 undefined）。
 *  注：自定义称号/头像框的等级门槛已随功能调整移除（2026-08-13），仅剩鎏金标题 */
export function unlockLevelFor(feature: 'gold_title'): number | undefined {
  const labels: Record<string, string> = {
    gold_title: '鎏金标题',
  };
  return LEVEL_TIERS.find(t => t.unlock === labels[feature])?.unlockLevel;
}

export function levelFromExp(exp: number): {
  level: number; tierName: string; unlock?: string; unlockLevel?: number;
  expInLevel: number; expForNextLevel: number; progress: number; // 0-100
} {
  let level = 1;
  let remaining = Math.max(0, exp);
  let tier: LevelTier = LEVEL_TIERS[0];
  for (const t of LEVEL_TIERS) {
    const tierStart = LEVEL_TIERS[LEVEL_TIERS.indexOf(t) - 1]?.maxLevel || 0;
    const count = t.maxLevel - tierStart;
    const need = count * t.expPerLevel;
    if (remaining >= need && t.maxLevel < 30) {
      remaining -= need;
      level = t.maxLevel;
      tier = t;
      continue;
    }
    // 落在本段内
    tier = t;
    level += Math.floor(remaining / t.expPerLevel);
    remaining = remaining % t.expPerLevel;
    if (level > t.maxLevel) level = t.maxLevel;
    break;
  }
  // 30 级封顶
  if (level >= 30) {
    level = 30;
    tier = LEVEL_TIERS[4];
    remaining = Math.min(remaining, tier.expPerLevel);
  }
  return {
    level,
    tierName: tier.name,
    unlock: tier.unlock,
    unlockLevel: tier.unlockLevel,
    expInLevel: remaining,
    expForNextLevel: tier.expPerLevel,
    progress: Math.min(100, Math.round((remaining / tier.expPerLevel) * 100)),
  };
}

/** 加经验 + 升级礼包（每跨一级 +50 积分，last_rewarded_level 防重复发放） */
export async function addExp(db: D1Database, userId: number, amount: number): Promise<void> {
  if (!amount) return;
  const row = await db
    .prepare('SELECT exp, last_rewarded_level FROM users WHERE id = ?')
    .bind(userId)
    .first<{ exp: number; last_rewarded_level: number }>();
  if (!row) return;
  const newExp = (row.exp || 0) + amount;
  const newLevel = levelFromExp(newExp).level;

  // exp 是累计值语义，改为增量写（exp = exp + ?）：并发 addExp 时无条件覆盖（exp = ?）
  // 会互相覆盖丢经验；增量写天然合并所有并发加成。newLevel 按读取值估算，
  // 升级礼包由下方 last_rewarded_level 门槛守卫——并发下重复触发影响 0 行，不会多发，
  // 漏发的礼包也会在下次 addExp 时按 last_rewarded_level 差值补发
  const stmts: any[] = [db.prepare('UPDATE users SET exp = exp + ? WHERE id = ?').bind(amount, userId)];
  if (newLevel > (row.last_rewarded_level || 0)) {
    const gained = (newLevel - (row.last_rewarded_level || 0)) * 50;
    // 并发防重复：礼包发放与 last_rewarded_level 推进放同一 batch 原子执行，
    // 发积分/流水语句均以 `last_rewarded_level < newLevel` 为门槛——
    // 并发请求重复触发时这些语句影响 0 行，不会重复发礼包积分
    stmts.push(
      db.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ? AND (SELECT last_rewarded_level FROM users WHERE id = ?) < ?')
        .bind(gained, gained, userId, userId, newLevel),
      db.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'level_up', ?, coins, ? FROM user_balances WHERE user_id = ? AND (SELECT last_rewarded_level FROM users WHERE id = ?) < ?")
        .bind(userId, gained, `升级礼包（升至 Lv.${newLevel}）`, userId, userId, newLevel),
      db.prepare('UPDATE users SET last_rewarded_level = ? WHERE id = ? AND last_rewarded_level < ?')
        .bind(newLevel, userId, newLevel),
    );
  }
  await db.batch(stmts);
}

// ─── 每日任务（标记幂等：UNIQUE(user_id, date, task_type)）───
export async function markTaskDone(db: D1Database, userId: number, taskType: string): Promise<void> {
  await db
    .prepare(`INSERT INTO daily_tasks (user_id, date, task_type, done) VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, date, task_type) DO UPDATE SET done = 1`)
    .bind(userId, todayUtc8(), taskType)
    .run();
}

// ─── 成就（一次性：UNIQUE(user_id, key)，存在即不发）───
// 难度/稀有度：🟢 bronze 入门 / 🔵 silver 进阶 / 🟣 gold 资深 / 🟡 legend 传说
export type Rarity = 'bronze' | 'silver' | 'gold' | 'legend';

// 成就奖励（多样化：不限于积分）：
//  - coins/exp：amount 为数量；exp 走 addExp（含升级礼包）
//  - title_badge/avatar_frame：days 为时长（天），省略 days 视为永久（expires_at 置 NULL）
//  - vip：发放 VIP 体验券（tier + days），用户去仓库自行使用
export type AchievementReward = {
  type: 'coins' | 'exp' | 'title_badge' | 'avatar_frame' | 'vip';
  amount?: number;
  days?: number;
  tier?: string;
};

export interface AchievementDef {
  name: string;
  desc: string;
  rarity: Rarity;
  rewards: AchievementReward[];
}

// 校园成就注册表（巡查成就定义见 patrol.ts PATROL_ACHIEVEMENTS）
export const ACHIEVEMENTS: Record<string, AchievementDef> = {
  // ── 原有 6 个：保留原积分奖励，补 rarity ──
  first_post: { name: '初来乍到', desc: '发布第一个帖子', rarity: 'bronze', rewards: [{ type: 'coins', amount: 50 }] },
  likes_100: { name: '人气王', desc: '被点赞累计 100 次', rarity: 'silver', rewards: [{ type: 'coins', amount: 200 }, { type: 'title_badge', days: 7 }] },
  posts_100: { name: '笔耕不辍', desc: '发布帖子累计 100 篇', rarity: 'gold', rewards: [{ type: 'coins', amount: 300 }, { type: 'title_badge', days: 7 }] },
  checkin_30: { name: '全勤王', desc: '连续签到 30 天', rarity: 'silver', rewards: [{ type: 'coins', amount: 300 }, { type: 'title_badge', days: 30 }] },
  thanks_50: { name: '热心肠', desc: '被感谢累计 50 次', rarity: 'silver', rewards: [{ type: 'coins', amount: 200 }] },
  ssr: { name: '欧皇', desc: '抽中 SSR 奖品', rarity: 'legend', rewards: [{ type: 'coins', amount: 100 }] },
  // ── 校园新增 13 个（多样化奖励）──
  first_comment: { name: '妙语连珠', desc: '发表你的第一条评论', rarity: 'bronze', rewards: [{ type: 'coins', amount: 30 }] },
  comments_100: { name: '评论大师', desc: '累计发表 100 条评论', rarity: 'silver', rewards: [{ type: 'coins', amount: 200 }, { type: 'exp', amount: 50 }] },
  likes_1000: { name: '校园红人', desc: '收到 1000 次点赞', rarity: 'gold', rewards: [{ type: 'title_badge', days: 30 }] },
  checkin_7: { name: '持之以恒', desc: '连续签到 7 天', rarity: 'bronze', rewards: [{ type: 'coins', amount: 50 }] },
  checkin_100: { name: '铁杆粉丝', desc: '连续签到 100 天', rarity: 'gold', rewards: [{ type: 'avatar_frame', days: 30 }] },
  favorites_50: { name: '收藏达人', desc: '累计收藏 50 篇帖子', rarity: 'silver', rewards: [{ type: 'coins', amount: 200 }] },
  follows_10: { name: '人气新星', desc: '被 10 位同学关注', rarity: 'silver', rewards: [{ type: 'coins', amount: 150 }] },
  invite_1: { name: '校园大使', desc: '成功邀请 1 位同学注册', rarity: 'bronze', rewards: [{ type: 'coins', amount: 100 }] },
  invite_5: { name: '金牌大使', desc: '成功邀请 5 位同学注册', rarity: 'gold', rewards: [{ type: 'title_badge', days: 30 }] },
  wealth_2000: { name: '小富翁', desc: '累计赚取 2000 积分', rarity: 'gold', rewards: [{ type: 'title_badge', days: 30 }] },
  level_10: { name: '小有名气', desc: '用户等级达到 Lv.10', rarity: 'silver', rewards: [{ type: 'coins', amount: 200 }] },
  level_20: { name: '校园传奇', desc: '用户等级达到 Lv.20', rarity: 'legend', rewards: [{ type: 'title_badge' }] },
  effect_first: { name: '才华初现', desc: '首次使用帖子效果道具', rarity: 'bronze', rewards: [{ type: 'coins', amount: 30 }] },
};

/**
 * 发放成就奖励（普通/巡查注册表都查）。逐项兜底：单项失败只记日志，
 * 不影响其他奖励发放；整体失败也不影响成就行已解锁的事实。
 */
export async function grantRewards(db: D1Database, userId: number, key: string): Promise<void> {
  try {
    const def = ACHIEVEMENTS[key] || PATROL_ACHIEVEMENTS[key];
    if (!def) return;
    const name = def.name;
    for (const r of def.rewards) {
      try {
        switch (r.type) {
          case 'coins':
            await addCoins(db, userId, 'achievement', r.amount || 0, '成就奖励：' + name);
            break;
          case 'exp':
            await addExp(db, userId, r.amount || 0);
            break;
          case 'title_badge':
            // 称号只入库、不自动佩戴：拥有关系由「已解锁成就 + 奖励定义」推导
            // （utils/decoration.ts 的 getOwnedTitles，到期时间 = 解锁时间 + days），
            // 用户可到「活跃效果」页自行佩戴（POST /items/equip-title-badge）。
            // 因此这里不需要写 users.title_badge —— 那会让称号强行顶掉用户当前的佩戴。
            break;
          case 'avatar_frame':
            await grantAvatarFrame(db, userId, r.days || 1);
            break;
          case 'vip':
            // 发 VIP 体验券（用户去仓库使用）；当前暂无成就配置 vip 奖励，先实现通道
            await db.prepare('INSERT INTO user_vip_tickets (user_id, tier, days, used) VALUES (?, ?, ?, 0)')
              .bind(userId, r.tier || 'vip', r.days || 1).run();
            break;
        }
      } catch (e) {
        console.error(`grantRewards ${key} 发放 ${r.type} 奖励失败`, e);
      }
    }
  } catch (e) {
    console.error(`grantRewards failed: ${key}`, e);
  }
}

// 头像框奖励：仿 items.ts /use/avatar-frame 的叠加时长写法
async function grantAvatarFrame(db: D1Database, userId: number, days: number): Promise<void> {
  const hours = days * 24;
  await db.prepare(`
    UPDATE users SET avatar_frame = ?,
      avatar_frame_expires_at = datetime(
        CASE WHEN avatar_frame_expires_at > datetime('now') THEN avatar_frame_expires_at ELSE datetime('now') END,
        '+' || ? || ' hours'
      )
    WHERE id = ?
  `).bind('default', hours, userId).run();
}

/**
 * 解锁成就：INSERT OR IGNORE 幂等，仅新解锁（changes>0）才调用 grantRewards 发放奖励；
 * 发放失败由 grantRewards 内部兜底，不影响成就行已插入的事实。
 */
export async function unlockAchievement(db: D1Database, userId: number, key: string): Promise<void> {
  try {
    const def = ACHIEVEMENTS[key] || PATROL_ACHIEVEMENTS[key];
    if (!def) return; // 未知成就忽略
    const res = await db
      .prepare('INSERT OR IGNORE INTO achievements (user_id, key) VALUES (?, ?)')
      .bind(userId, key)
      .run();
    if (!res.meta.changes) return; // 已解锁（幂等：不重复发奖）
    await grantRewards(db, userId, key);
  } catch (e) {
    console.error(`unlockAchievement failed: ${key}`, e);
  }
}
