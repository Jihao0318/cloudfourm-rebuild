import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { addCoins, canEarnToday, cleanupTransactions } from './coins';
import { addExp, markTaskDone, unlockAchievement } from '../utils/game';

// 统一使用 UTC+8 业务时区计算"今天"
function getServerToday(): string {
  const now = new Date();
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shanghai.toISOString().slice(0, 10);
}

function getDate(_provided?: string): string {
  // 始终使用服务器日期，不接受客户端传入的日期
  // 防止用户篡改日期绕过每日签到限制
  return getServerToday();
}

function getYesterday(today: string): string {
  const d = new Date(today + 'T00:00:00Z');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getMonthStr(today?: string): string {
  return today ? today.slice(0, 7) : getServerToday().slice(0, 7);
}

const checkIn = new Hono<{ Bindings: Env }>();

// 签到
checkIn.post('/', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { date } = await c.req.json<{ date?: string }>();
  const today = getDate(date);
  const yesterday = getYesterday(today);

  // 检查今天是否已签到 — 用 INSERT OR IGNORE 原子化处理竞态
  const insertResult = await c.env.DB
    .prepare('INSERT OR IGNORE INTO check_ins (user_id, check_in_date, streak, coins_earned) VALUES (?, ?, 0, 0)')
    .bind(user.userId, today)
    .run();

  // 如果影响行数为 0，说明今日已签到（唯一约束冲突）
  if (insertResult.meta.changes === 0) {
    return c.json({ success: false, error: '今日已签到' }, 409);
  }

  // 查询昨日签到，计算连续天数
  const prevCheckIn = await c.env.DB
    .prepare('SELECT streak FROM check_ins WHERE user_id = ? AND check_in_date = ?')
    .bind(user.userId, yesterday)
    .first<{ streak: number }>();

  const streak = prevCheckIn ? prevCheckIn.streak + 1 : 1;

  // 根据连续天数计算积分（7 天一轮回的阶梯奖励）
  const CHECKIN_REWARDS = [1, 2, 3, 5, 8, 13, 20];
  let coinsEarned = CHECKIN_REWARDS[(streak - 1) % CHECKIN_REWARDS.length];

  // VIP 签到加成
  const vipInfo = await c.env.DB
    .prepare("SELECT tier FROM user_vips WHERE user_id = ? AND expires_at > datetime('now')")
    .bind(user.userId)
    .first<{ tier: string }>();
  const bonusMap: Record<string, number> = { vip: 2, 's-vip': 3, 'svip+': 5 };
  const bonus = (vipInfo && bonusMap[vipInfo.tier]) || 0;
  coinsEarned += bonus;

  // 检查日上限 50 分：超限则签到不加积分（仅记录）
  const canEarn = await canEarnToday(c.env.DB, user.userId, 'check_in');
  const actualCoins = canEarn ? coinsEarned : 0;

  // 原子更新签到记录 + 加积分
  const batchStmts: any[] = [
    c.env.DB.prepare('UPDATE check_ins SET streak = ?, coins_earned = ? WHERE user_id = ? AND check_in_date = ?').bind(streak, actualCoins, user.userId, today),
  ];
  if (actualCoins > 0) {
    batchStmts.push(
      c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?').bind(actualCoins, actualCoins, user.userId),
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'check_in', ?, coins, ? FROM user_balances WHERE user_id = ?").bind(user.userId, actualCoins, `签到第 ${streak} 天${bonus > 0 ? `（VIP加成 ${bonus}）` : ''}`, user.userId),
    );
  }
  await c.env.DB.batch(batchStmts);
  // 写入新流水后立即收敛：每用户只保留最近 15 条
  if (actualCoins > 0) await cleanupTransactions(c.env.DB, user.userId);

  // 引擎一/二/三：签到 +10 经验、标记"签到"任务、全勤王成就（钩子失败不影响签到主流程）
  await Promise.all([
    addExp(c.env.DB, user.userId, 10),
    markTaskDone(c.env.DB, user.userId, 'checkin'),
    streak >= 30 ? unlockAchievement(c.env.DB, user.userId, 'checkin_30') : Promise.resolve(),
  ]).catch((e) => { console.error('check-in achievement hook failed', e); });

  const msg = actualCoins > 0
    ? `签到成功！连续 ${streak} 天，获得 ${actualCoins} 积分${actualCoins < coinsEarned ? `（日上限限制，少得 ${coinsEarned - actualCoins}）` : ''}`
    : `签到成功！连续 ${streak} 天（今日积分已达上限，未获得额外积分）`;

  return c.json({
    success: true,
    data: {
      streak,
      coins_earned: actualCoins,
      message: msg,
    },
  });
});

// 查询今日签到状态
checkIn.get('/today', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const today = getDate(c.req.query('date'));

  const record = await c.env.DB
    .prepare('SELECT streak, coins_earned FROM check_ins WHERE user_id = ? AND check_in_date = ?')
    .bind(user.userId, today)
    .first<{ streak: number; coins_earned: number }>();

  return c.json({
    success: true,
    data: {
      checked_in: !!record,
      streak: record?.streak || 0,
      coins_earned: record?.coins_earned || 0,
    },
  });
});

// 查询签到统计
checkIn.get('/stats', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const today = getDate(c.req.query('date'));
  const monthStr = getMonthStr(today);

  // 总签到天数
  const totalDays = await c.env.DB
    .prepare('SELECT COUNT(*) as cnt FROM check_ins WHERE user_id = ?')
    .bind(user.userId)
    .first<{ cnt: number }>();

  // 本月签到
  const monthDays = await c.env.DB
    .prepare("SELECT COUNT(*) as cnt FROM check_ins WHERE user_id = ? AND check_in_date LIKE ?")
    .bind(user.userId, `${monthStr}%`)
    .first<{ cnt: number }>();

  // 本月签到日期列表（日历展示用）
  const monthRecords = await c.env.DB
    .prepare("SELECT check_in_date FROM check_ins WHERE user_id = ? AND check_in_date LIKE ? ORDER BY check_in_date")
    .bind(user.userId, `${monthStr}%`)
    .all<{ check_in_date: string }>();

  // 当前连续签到
  const todayRecord = await c.env.DB
    .prepare('SELECT streak FROM check_ins WHERE user_id = ? AND check_in_date = ?')
    .bind(user.userId, today)
    .first<{ streak: number }>();

  return c.json({
    success: true,
    data: {
      total_days: totalDays?.cnt || 0,
      month_days: monthDays?.cnt || 0,
      current_streak: todayRecord?.streak || 0,
      month_dates: monthRecords.results.map(r => r.check_in_date),
    },
  });
});

export default checkIn;
