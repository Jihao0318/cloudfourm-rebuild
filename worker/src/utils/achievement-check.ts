// 成就惰性补解锁（审计修复：用户已达成但显示未解锁）
// 对全部 30 个成就（19 校园 + 11 巡查）做当前计数检查，达标且未解锁则调用 unlockAchievement（幂等，INSERT OR IGNORE）。
// 各查询口径与对应 handler 钩子一致（game.ts ACHIEVEMENTS 定义 / patrol.ts PATROL_ACHIEVEMENTS 阈值）。
//
// 性能说明（2026-08 合并）：D1 线上每条 prepare 都是一次 worker↔D1 网络往返，
// 原实现 17 条查询串行执行——发评论/发帖/点赞/签到等热路径每次触发就产生 17 次往返。
// 现将全部 17 条查询合并为单条 SELECT（一条语句内含 17 个标量子查询），
// 一次往返取回所有计数/取值结果；各子查询的 WHERE 条件（deleted_at 过滤、
// 时间窗口、target_type、target_user_id、reviewer_id 等）原样保留，读行数不变，
// 但网络往返次数 17 → 1，延迟降约一个数量级。
// 整体 try/catch 兜底：任何查询失败（如 thanks.target_user_id 列尚未迁移）只记日志，不影响主流程。
import type { D1Database } from '../types';
import { unlockAchievement, levelFromExp } from './game';
import { PATROL_ACHIEVEMENTS } from './patrol';
import type { PatrolStatsRow } from './patrol';

// 单条合并查询的结果行：每个字段对应一个标量子查询
// （COUNT/COUNT(DISTINCT) 恒非 NULL；MAX / 单行取值 / GROUP_CONCAT 已用 COALESCE 兜底为 0 或 ''）
interface AchievementCheckRow {
  done_keys: string;
  post_count: number;
  like_count: number;
  max_streak: number;
  thanks_count: number;
  ssr_count: number;
  comment_count: number;
  bookmark_count: number;
  follow_count: number;
  invite_count: number;
  total_earned: number;
  user_exp: number;
  effect_count: number;
  review_count: number;
  pass_count: number;
  clear_count: number;
  takedown_count: number;
}

/**
 * 惰性补解锁全部成就。返回本次新解锁数量（已解锁的不计入）。
 */
export async function checkAllAchievements(db: D1Database, userId: number): Promise<number> {
  try {
    // 单条 SELECT 一次往返取回全部结果（原 17 条 prepare 串行 → 1 条）。
    // 参数共 18 个（见下方 bind 注释），全部为 userId，顺序与子查询出现顺序严格一致。
    // 已解锁集合用 GROUP_CONCAT(key) 取回：成就 key 均为 [a-z0-9_]+（不含逗号），
    // 与原来逐行取 key 构建 Set 语义等价；该集合仅用于统计本次新增（unlockAchievement 本身幂等）。
    const row = await db
      .prepare(`
        SELECT
          (SELECT COALESCE(GROUP_CONCAT(key), '') FROM achievements WHERE user_id = ?) AS done_keys,
          (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS post_count,
          (SELECT COUNT(*) FROM likes
             WHERE (target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE user_id = ?))
                OR (target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE user_id = ?))) AS like_count,
          (SELECT COALESCE(MAX(streak), 0) FROM check_ins WHERE user_id = ?) AS max_streak,
          (SELECT COUNT(*) FROM thanks WHERE target_user_id = ?) AS thanks_count,
          (SELECT COUNT(*) FROM user_lottery_items WHERE user_id = ? AND item_meta LIKE '%"rarity":"SSR"%') AS ssr_count,
          (SELECT COUNT(*) FROM comments WHERE user_id = ? AND deleted_at IS NULL) AS comment_count,
          (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?) AS bookmark_count,
          (SELECT COUNT(*) FROM follows WHERE following_id = ?) AS follow_count,
          (SELECT COUNT(*) FROM invite_codes WHERE created_by = ? AND used_by IS NOT NULL) AS invite_count,
          (SELECT COALESCE(total_earned, 0) FROM user_balances WHERE user_id = ?) AS total_earned,
          (SELECT COALESCE(exp, 0) FROM users WHERE id = ?) AS user_exp,
          (SELECT COUNT(*) FROM posts WHERE user_id = ? AND (
              (title_effect IS NOT NULL AND title_effect != '')
              OR post_bg_id IS NOT NULL
              OR highlighted_until IS NOT NULL
              OR fortune IS NOT NULL
              OR bumped_until IS NOT NULL
            )) AS effect_count,
          (SELECT COUNT(*) FROM post_review_actions WHERE reviewer_id = ?) AS review_count,
          (SELECT COUNT(*) FROM post_review_actions WHERE reviewer_id = ? AND action = 'pass') AS pass_count,
          (SELECT COUNT(*) FROM post_review_actions WHERE reviewer_id = ? AND action = 'clear') AS clear_count,
          (SELECT COUNT(DISTINCT pra.post_id) FROM post_review_actions pra
             JOIN posts p ON p.id = pra.post_id
             WHERE pra.reviewer_id = ? AND pra.action IN ('violation','confirm')
               AND p.deleted_at IS NOT NULL AND p.review_status = 'violation') AS takedown_count
      `)
      .bind(
        userId, // 1 done_keys
        userId, // 2 post_count
        userId, // 3 like_count（posts 子查询）
        userId, // 4 like_count（comments 子查询）
        userId, // 5 max_streak
        userId, // 6 thanks_count
        userId, // 7 ssr_count
        userId, // 8 comment_count
        userId, // 9 bookmark_count
        userId, // 10 follow_count
        userId, // 11 invite_count
        userId, // 12 total_earned
        userId, // 13 user_exp
        userId, // 14 effect_count
        userId, // 15 review_count
        userId, // 16 pass_count
        userId, // 17 clear_count
        userId, // 18 takedown_count
      )
      .first<AchievementCheckRow>();

    // 已解锁集合（unlockAchievement 本身幂等；此集合仅用于统计本次新增）
    const done = new Set((row?.done_keys || '').split(',').filter(Boolean));

    let newUnlocks = 0;
    const unlockIf = async (key: string, hit: boolean): Promise<void> => {
      if (hit && !done.has(key)) {
        await unlockAchievement(db, userId, key);
        newUnlocks++;
      }
    };

    // ── 发帖成就（累计发布口径：不带 deleted_at 过滤，与 tasks.ts 一致）──
    const postCnt = row?.post_count || 0;
    await unlockIf('first_post', postCnt >= 1);
    await unlockIf('posts_100', postCnt >= 100);

    // ── 人气王（被赞累计 100；双子查询结构与 likes.ts rewardAuthor 一致）──
    const likeCnt = row?.like_count || 0;
    await unlockIf('likes_100', likeCnt >= 100);

    // ── 全勤王（历史最大连续签到，覆盖已断签的存量用户）──
    const maxStreak = row?.max_streak || 0;
    await unlockIf('checkin_30', maxStreak >= 30);

    // ── 热心肠（被感谢累计 50；依赖 thanks.target_user_id 新列，迁移未应用时查询抛错被 catch 吞掉）──
    const thanksCnt = row?.thanks_count || 0;
    await unlockIf('thanks_50', thanksCnt >= 50);

    // ── 欧皇（拥有或曾拥有过 SSR 稀有度道具；item_meta 为 JSON 文本，rarity 存于其中）──
    const ssrCnt = row?.ssr_count || 0;
    await unlockIf('ssr', ssrCnt >= 1);

    // ── 评论成就（软删评论不计入：comments 有 deleted_at 列，与评论展示口径一致）──
    const commentCnt = row?.comment_count || 0;
    await unlockIf('first_comment', commentCnt >= 1);
    await unlockIf('comments_100', commentCnt >= 100);

    // ── 校园红人（被赞累计 1000，复用 likes 双子查询）──
    await unlockIf('likes_1000', likeCnt >= 1000);

    // ── 持之以恒/铁杆粉丝（历史最大连续签到 7/100，复用 MAX(streak)）──
    await unlockIf('checkin_7', maxStreak >= 7);
    await unlockIf('checkin_100', maxStreak >= 100);

    // ── 收藏达人（累计收藏 50 篇帖子）──
    const favCnt = row?.bookmark_count || 0;
    await unlockIf('favorites_50', favCnt >= 50);

    // ── 人气新星（被 10 位同学关注；following_id 为被关注者）──
    const followCnt = row?.follow_count || 0;
    await unlockIf('follows_10', followCnt >= 10);

    // ── 校园大使/金牌大使（成功邀请注册：invite_codes.used_by 非空）──
    const inviteCnt = row?.invite_count || 0;
    await unlockIf('invite_1', inviteCnt >= 1);
    await unlockIf('invite_5', inviteCnt >= 5);

    // ── 小富翁（累计赚取积分 ≥ 2000）──
    const earned = row?.total_earned || 0;
    await unlockIf('wealth_2000', earned >= 2000);

    // ── 小有名气/校园传奇（等级 ≥ 10/20；等级纯计算）──
    const userExp = row?.user_exp || 0;
    const lv = levelFromExp(userExp).level;
    await unlockIf('level_10', lv >= 10);
    await unlockIf('level_20', lv >= 20);

    // ── 才华初现（首次使用帖子效果道具：帖子效果列任一非空）──
    const effectCnt = row?.effect_count || 0;
    await unlockIf('effect_first', effectCnt >= 1);

    // ── 巡查 11 个（直接按 post_review_actions 聚合，覆盖未结算进 user_patrol_stats 的历史动作）──
    const reviews = row?.review_count || 0;
    const passes = row?.pass_count || 0;
    const clears = row?.clear_count || 0;
    const takedowns = row?.takedown_count || 0;

    const stats: PatrolStatsRow = {
      user_id: userId,
      patrol_exp: 0,
      last_rewarded_patrol_level: 0,
      total_reviews: reviews,
      total_passes: passes,
      total_questions: 0,
      total_violations: 0,
      total_confirms: 0,
      total_clears: clears,
      total_takedowns: takedowns,
      today_count: 0,
      today_date: '',
      updated_at: '',
    };
    for (const [key, def] of Object.entries(PATROL_ACHIEVEMENTS)) {
      await unlockIf(key, def.check(stats));
    }

    return newUnlocks;
  } catch (e) {
    console.error('checkAllAchievements failed', e);
    return 0;
  }
}
