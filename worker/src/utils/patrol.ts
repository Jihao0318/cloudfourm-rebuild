// 巡查员战绩公共库（巡查等级/经验/成就，独立于用户等级体系）
// 与 game.ts 的 addExp/unlockAchievement 模式对齐：等级纯计算、last_rewarded_* 防重复发礼包、
// 成就幂等（UNIQUE(user_id, key)）。所有入口通过 moderation.ts 接入
import type { D1Database } from '../types';
import { todayUtc8, unlockAchievement } from './game';
import type { AchievementDef } from './game';
import { addCoins } from '../handlers/coins';

// ─── 巡查经验值（按动作结算；下架在下面对应动作基础上追加 TAKEDOWN_BONUS_XP）───
export const PATROL_XP: Record<string, number> = {
  pass: 6,
  question: 10,
  violation: 12,
  confirm: 12,
  clear: 10,
};

// 下架追加经验（管理员否决 / 票数达标确认共用）
export const TAKEDOWN_BONUS_XP = 40;

// ─── 巡查等级（5 段 20 级；等级纯计算不存列）───
// 每段 expPerLevel 为该段内「升到下一级」所需经验数组（如 Lv1→2 需 60，2→3 需 90 ...）
interface PatrolTier { maxLevel: number; name: string; expPerLevel: number[] }
const PATROL_TIERS: PatrolTier[] = [
  { maxLevel: 5, name: '见习巡查员', expPerLevel: [60, 90, 120, 150] },
  { maxLevel: 10, name: '巡查员', expPerLevel: [220, 270, 320, 370, 420] },
  { maxLevel: 15, name: '资深巡查员', expPerLevel: [550, 640, 730, 820, 910] },
  { maxLevel: 20, name: '金牌巡查员', expPerLevel: [1100, 1300, 1500, 1700, 1900] },
  { maxLevel: 20, name: '巡查队长', expPerLevel: [] }, // 封顶段
];

// user_patrol_stats 表行结构（stats 接口 / 成就检查共用）
export interface PatrolStatsRow {
  user_id: number;
  patrol_exp: number;
  last_rewarded_patrol_level: number;
  total_reviews: number;
  total_passes: number;
  total_questions: number;
  total_violations: number;
  total_confirms: number;
  total_clears: number;
  total_takedowns: number;
  today_count: number;
  today_date: string;
  updated_at: string;
}

/** 巡查等级计算（纯函数）：expInLevel=本级内已获经验；expNeededForLevel=升到下一级所需总经验（Lv20 封顶为 null，进度条满格） */
export function patrolLevelFromExp(exp: number): {
  level: number; tierName: string; expInLevel: number; expNeededForLevel: number | null;
} {
  let level = 1;
  let remaining = Math.max(0, exp);
  let tier: PatrolTier = PATROL_TIERS[0];
  let expNeededForLevel: number | null = null;

  for (const t of PATROL_TIERS) {
    tier = t;
    if (t.expPerLevel.length === 0) {
      // 封顶段（巡查队长 Lv.20）：进度条满格
      level = Math.max(level, t.maxLevel);
      remaining = 0;
      break;
    }
    let reachedEnd = true;
    for (const need of t.expPerLevel) {
      if (remaining >= need) {
        remaining -= need;
        level++;
      } else {
        expNeededForLevel = need;
        reachedEnd = false;
        break;
      }
    }
    if (!reachedEnd) break;
    // 整段经验耗尽，进入下一段（该段内最后一级的下一级即下一段首级）
    expNeededForLevel = null;
  }
  return { level, tierName: tier.name, expInLevel: remaining, expNeededForLevel };
}

// ─── 巡查专属成就（阈值判定 + 多样化奖励元信息；unlockAchievement 幂等，命中即解锁）───
export interface PatrolAchievementDef extends AchievementDef {
  check: (s: PatrolStatsRow) => boolean;
}

export const PATROL_ACHIEVEMENTS: Record<string, PatrolAchievementDef> = {
  // ── 原有 7 个：保留原积分奖励，补 name/desc/rarity ──
  first_review: { name: '巡查初体验', desc: '完成你的第一次巡查', rarity: 'bronze', rewards: [{ type: 'coins', amount: 20 }], check: (s) => s.total_reviews >= 1 },
  review_50: { name: '勤勉巡查', desc: '累计巡查 50 帖', rarity: 'silver', rewards: [{ type: 'coins', amount: 100 }], check: (s) => s.total_reviews >= 50 },
  review_200: { name: '巡查标兵', desc: '累计巡查 200 帖', rarity: 'gold', rewards: [{ type: 'coins', amount: 300 }], check: (s) => s.total_reviews >= 200 },
  first_takedown: { name: '执法先锋', desc: '首次参与下架违规帖', rarity: 'bronze', rewards: [{ type: 'coins', amount: 50 }], check: (s) => s.total_takedowns >= 1 },
  takedown_10: { name: '雷霆执法', desc: '累计参与下架 10 帖', rarity: 'gold', rewards: [{ type: 'coins', amount: 300 }], check: (s) => s.total_takedowns >= 10 },
  clear_10: { name: '慧眼识珠', desc: '平反 10 帖', rarity: 'silver', rewards: [{ type: 'coins', amount: 200 }], check: (s) => s.total_clears >= 10 },
  pass_100: { name: '把关达人', desc: '通过 100 帖', rarity: 'silver', rewards: [{ type: 'coins', amount: 200 }], check: (s) => s.total_passes >= 100 },
  // ── 巡查新增 4 个（多样化奖励）──
  review_500: { name: '巡查大将', desc: '累计巡查 500 帖', rarity: 'gold', rewards: [{ type: 'title_badge', days: 30 }], check: (s) => s.total_reviews >= 500 },
  takedown_30: { name: '清道夫', desc: '累计参与下架 30 帖', rarity: 'gold', rewards: [{ type: 'avatar_frame', days: 30 }], check: (s) => s.total_takedowns >= 30 },
  clear_50: { name: '平反官', desc: '平反 50 帖', rarity: 'silver', rewards: [{ type: 'coins', amount: 300 }], check: (s) => s.total_clears >= 50 },
  pass_500: { name: '守门人', desc: '通过 500 帖', rarity: 'legend', rewards: [{ type: 'title_badge' }], check: (s) => s.total_passes >= 500 },
};

/**
 * 巡查战绩结算：经验 + 累计/当日计数 + 升级礼包 + 成就检查
 * 只应在「首次动作」时调用（重复动作仅覆盖 post_review_actions，不结算）；
 * 内部 try/catch 兜底，任何失败不影响 review-post 主流程
 */
export async function recordPatrolAction(db: D1Database, userId: number, action: string, opts?: { takedown?: boolean }): Promise<void> {
  try {
    const xp = (PATROL_XP[action] || 0) + (opts?.takedown ? TAKEDOWN_BONUS_XP : 0);
    if (!xp && !opts?.takedown) return; // 未知动作直接忽略

    let row = await db.prepare('SELECT * FROM user_patrol_stats WHERE user_id = ?')
      .bind(userId).first<PatrolStatsRow>();

    // 主统计写入：DO UPDATE 带 WHERE patrol_exp = 旧值 做乐观锁，防并发读改写丢经验；
    // changes=0 说明被并发写入抢先，重读重算再写一次；仍失败则放弃本次结算（接受小窗口，防死循环）
    let oldLevel = 1;
    let newExp = 0;
    let newLevel = 1;
    let today = todayUtc8();
    let todayCount = 1;
    let counts = {
      total_reviews: 1, total_passes: 0, total_questions: 0,
      total_violations: 0, total_confirms: 0, total_clears: 0, total_takedowns: 0,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const oldExp = row?.patrol_exp || 0;
      // 升级前后等级（等级纯计算；先读旧 exp 再算新 exp）
      oldLevel = patrolLevelFromExp(oldExp).level;
      newExp = oldExp + xp;
      newLevel = patrolLevelFromExp(newExp).level;

      // 当日计数：UTC+8 业务日（与 game.ts todayUtc8 口径一致），跨日重置
      today = todayUtc8();
      todayCount = row && row.today_date === today ? (row.today_count || 0) + 1 : 1;

      counts = {
        total_reviews: (row?.total_reviews || 0) + 1,
        total_passes: (row?.total_passes || 0) + (action === 'pass' ? 1 : 0),
        total_questions: (row?.total_questions || 0) + (action === 'question' ? 1 : 0),
        total_violations: (row?.total_violations || 0) + (action === 'violation' ? 1 : 0),
        total_confirms: (row?.total_confirms || 0) + (action === 'confirm' ? 1 : 0),
        total_clears: (row?.total_clears || 0) + (action === 'clear' ? 1 : 0),
        total_takedowns: (row?.total_takedowns || 0) + (opts?.takedown ? 1 : 0),
      };

      const res = await db.prepare(`INSERT INTO user_patrol_stats
          (user_id, patrol_exp, total_reviews, total_passes, total_questions, total_violations,
           total_confirms, total_clears, total_takedowns, today_count, today_date, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          patrol_exp = excluded.patrol_exp,
          total_reviews = excluded.total_reviews,
          total_passes = excluded.total_passes,
          total_questions = excluded.total_questions,
          total_violations = excluded.total_violations,
          total_confirms = excluded.total_confirms,
          total_clears = excluded.total_clears,
          total_takedowns = excluded.total_takedowns,
          today_count = excluded.today_count,
          today_date = excluded.today_date,
          updated_at = datetime('now')
        WHERE patrol_exp = ?`)
        .bind(userId, newExp, counts.total_reviews, counts.total_passes, counts.total_questions,
          counts.total_violations, counts.total_confirms, counts.total_clears, counts.total_takedowns,
          todayCount, today, oldExp).run();
      if (res.meta.changes) break;
      // 并发写入抢先：重读后重算再写一次（第二次仍失败则放弃本次结算，接受小窗口）
      row = await db.prepare('SELECT * FROM user_patrol_stats WHERE user_id = ?')
        .bind(userId).first<PatrolStatsRow>();
    }

    // 升级礼包：每跨一级 +50 积分；先抢 last_rewarded_patrol_level 标记再发放（防并发重复发放；仿 game.ts addExp）
    if (newLevel > oldLevel) {
      const claimed = await db.prepare('UPDATE user_patrol_stats SET last_rewarded_patrol_level = ? WHERE user_id = ? AND last_rewarded_patrol_level < ?')
        .bind(newLevel, userId, newLevel).run();
      if (claimed.meta.changes) {
        for (let lv = oldLevel + 1; lv <= newLevel; lv++) {
          await addCoins(db, userId, 'patrol_level_up', 50, '巡查等级升级奖励');
        }
      }
    }

    // 成就检查：用累计计数与阈值比较，命中即解锁（unlockAchievement 幂等，已解锁不发）
    const stats: PatrolStatsRow = {
      user_id: userId,
      patrol_exp: newExp,
      last_rewarded_patrol_level: row?.last_rewarded_patrol_level || 0,
      ...counts,
      today_count: todayCount,
      today_date: today,
      updated_at: '',
    };
    for (const [key, def] of Object.entries(PATROL_ACHIEVEMENTS)) {
      if (def.check(stats)) await unlockAchievement(db, userId, key);
    }
  } catch (e) { console.error('recordPatrolAction failed', e); }
}
