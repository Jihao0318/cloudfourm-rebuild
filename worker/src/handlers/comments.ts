import { Hono } from 'hono';
import type { Env, JWTPayload, User } from '../types';
import { parseId, validateContent } from '../utils/validation';
import { requireAuth, optionalAuth, checkNotBanned } from '../middleware/auth';
import {
  getPaginatedComments,
  getTopLevelCommentCount,
  createComment,
  updateComment,
  hardDeleteComment,
  postExists,
  getLike,
  createNotification,
} from '../db/queries';
import { canEarnToday, addCoins } from './coins';
import { addExp, markTaskDone, todayWindowUtc8 } from '../utils/game';
import { checkAllAchievements } from '../utils/achievement-check';

const comments = new Hono<{ Bindings: Env }>();

// 构建评论树
function buildCommentTree(comments: any[]): any[] {
  const map = new Map<number, any>();
  const roots: any[] = [];

  for (const c of comments) {
    map.set(c.id, { ...c, children: [] });
  }

  for (const c of map.values()) {
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children.push(c);
    } else if (!c.parent_id) {
      roots.push(c);
    }
  }

  return roots;
}

// 获取评论 (树形结构，分页)
comments.get('/post/:postId', optionalAuth, async (c) => {
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));

  const [flat, total] = await Promise.all([
    getPaginatedComments(c.env.DB, postId, page, pageSize),
    getTopLevelCommentCount(c.env.DB, postId),
  ]);

  const user: JWTPayload | undefined = c.get('user');
  const db = c.env.DB;
  let likedIds: number[] = [];
  if (user && flat.length > 0) {
    // 批量查询点赞，避免 N+1
    const ids = flat.map((cmt: any) => cmt.id);
    const placeholders = ids.map(() => '?').join(',');
    const likesResult = await db
      .prepare(`SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'comment' AND target_id IN (${placeholders})`)
      .bind(user.userId, ...ids)
      .all<{ target_id: number }>();
    likedIds = likesResult.results.map((l: any) => l.target_id);
  }

  // 格式化作者信息
  const formatted = flat.map((c: any) => ({
    id: c.id,
    post_id: c.post_id,
    user_id: c.user_id,
    parent_id: c.parent_id,
    content: c.content,
    like_count: c.like_count,
    thanks_count: c.thanks_count || 0,
    created_at: c.created_at,
    liked: likedIds.includes(c.id),
    author: {
      id: c.author_id,
      username: c.username,
      avatar_url: c.author_avatar,
      role: c.author_role,
      banned_until: c.author_banned_until,
      vip_tier: c.author_vip_tier,
      nick_theme: c.author_nick_theme,
    },
  }));

  const tree = buildCommentTree(formatted);

  return c.json({ success: true, data: tree, total, page, pageSize });
});

// 发表评论
comments.post('/post/:postId', requireAuth, checkNotBanned, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const { content, parent_id } = await c.req.json();

  const contentCheck = validateContent(content);
  if (!contentCheck.valid) return c.json({ success: false, error: contentCheck.error }, 400);

  const exists = await postExists(c.env.DB, postId);
  if (!exists) return c.json({ success: false, error: '帖子不存在' }, 404);

  // 验证 parent_id 属于同一帖子
  if (parent_id) {
    const parentComment = await c.env.DB
      .prepare('SELECT post_id FROM comments WHERE id = ? AND deleted_at IS NULL')
      .bind(parent_id).first<{ post_id: number }>();
    if (!parentComment || parentComment.post_id !== postId) {
      return c.json({ success: false, error: '回复的评论不存在或不属于此帖子' }, 400);
    }
  }

  const comment = await createComment(c.env.DB, postId, user.userId, content, parent_id);
  if (!comment) return c.json({ success: false, error: '评论失败' }, 500);

  // 抢红包（评论创建成功后、通知之前）：每人每红包限抢一次（red_packet_claims 占位防并发连抢），一次扣一个名额
  let redPacketResult: { won: boolean; amount?: number } = { won: false };
  const rp = await c.env.DB
    .prepare('SELECT id, remaining_coins, remaining_packets, user_id FROM red_packets WHERE post_id = ? AND remaining_packets > 0 ORDER BY id DESC LIMIT 1')
    .bind(postId)
    .first<{ id: number; remaining_coins: number; remaining_packets: number; user_id: number }>();
  if (rp && rp.user_id !== user.userId) {
    // 微信式随机金额（二倍均值法）：每包在 [1, min(剩余均值×2, 保证后面每人≥1分)] 内随机，最后一包拿完剩余
    // 用 crypto.getRandomValues 生成均匀随机数（业务随机，非安全用途）
    const randInt = (max: number): number => {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] % max;
    };
    let amount: number;
    if (rp.remaining_packets <= 1) {
      amount = rp.remaining_coins;
    } else {
      const needKeep = rp.remaining_packets - 1;                       // 后面每包至少留 1 分
      const maxByRemain = Math.max(1, rp.remaining_coins - needKeep);  // 本包可取的金额上限
      const avgDouble = Math.floor((rp.remaining_coins / rp.remaining_packets) * 2);
      const cap = Math.min(maxByRemain, Math.max(1, avgDouble));
      amount = Math.min(Math.max(1, 1 + randInt(cap)), rp.remaining_coins);
    }
    if (amount > 0) {
      // 先占位（UNIQUE 拦同人连抢），抢到后回填金额；没抢到（并发耗尽）释放占位
      const claimed = await c.env.DB
        .prepare('INSERT OR IGNORE INTO red_packet_claims (red_packet_id, user_id, amount) VALUES (?, ?, 0)')
        .bind(rp.id, user.userId)
        .run();
      if (claimed.meta.changes > 0) {
        // 扣款同时守卫剩余包数与剩余金额（金额计算全程整数：randInt/remaining_coins 均为整数）：
        // 仅守卫 remaining_packets 时，并发请求可在余额不足的情况下把红包池扣成负数（凭空铸币）
        const upd = await c.env.DB
          .prepare('UPDATE red_packets SET remaining_packets = remaining_packets - 1, remaining_coins = remaining_coins - ? WHERE id = ? AND remaining_packets > 0 AND remaining_coins >= ?')
          .bind(amount, rp.id, amount)
          .run();
        if (upd.meta.changes > 0) {
          await c.env.DB.batch([
            c.env.DB.prepare('UPDATE red_packet_claims SET amount = ? WHERE red_packet_id = ? AND user_id = ?')
              .bind(amount, rp.id, user.userId),
            c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
              .bind(amount, amount, user.userId),
            c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'red_packet', ?, coins, ? FROM user_balances WHERE user_id = ?")
              .bind(user.userId, amount, '抢到积分红包', user.userId),
          ]);
          redPacketResult = { won: true, amount };
        } else {
          // 并发下红包已抢完/金额不足：释放占位并返回失败（不需要重试）
          await c.env.DB.prepare('DELETE FROM red_packet_claims WHERE red_packet_id = ? AND user_id = ?')
            .bind(rp.id, user.userId)
            .run();
          return c.json({ success: false, error: '红包已被抢完' }, 400);
        }
      }
    }
  }

  // 通知帖子作者有人评论（软删帖不应再触发通知）
  const post = await c.env.DB.prepare('SELECT user_id, title FROM posts WHERE id = ? AND deleted_at IS NULL').bind(postId).first<{ user_id: number; title: string }>();
  if (post) {
    createNotification(c.env.DB, post.user_id, user.userId, 'reply', postId, comment.id, `评论了你的帖子「${post.title?.slice(0, 30)}」`);
  }

  // 如果是回复某条评论 → 通知被回复的评论作者
  if (parent_id) {
    const repliedComment = await c.env.DB
      .prepare('SELECT user_id FROM comments WHERE id = ? AND deleted_at IS NULL')
      .bind(parent_id).first<{ user_id: number }>();
    if (repliedComment && repliedComment.user_id !== post?.user_id) {
      createNotification(c.env.DB, repliedComment.user_id, user.userId, 'reply', postId, comment.id, `回复了你的评论`);
    }
  }

  // 评论奖励（品类限额 + 每日总积分上限）
  if (await canEarnToday(c.env.DB, user.userId, 'comment')) {
    await addCoins(c.env.DB, user.userId, 'comment', 3, '发表评论');
  }

  // 评论游戏化钩子（失败不影响主流程）：+2 经验，当日评论 ≥2 完成每日任务，成就惰性补解锁（首评即时解锁 first_comment）
  try {
    await Promise.all([
      addExp(c.env.DB, user.userId, 2),
      (async () => {
        const w = todayWindowUtc8();
        // 软删评论不计入当日评论数（每日任务完成判定）
        const cnt = await c.env.DB
          .prepare('SELECT COUNT(*) as c FROM comments WHERE user_id = ? AND created_at >= ? AND created_at < ? AND deleted_at IS NULL')
          .bind(user.userId, w.start, w.end)
          .first<{ c: number }>();
        if ((cnt?.c || 0) >= 2) await markTaskDone(c.env.DB, user.userId, 'comment');
      })(),
      checkAllAchievements(c.env.DB, user.userId),
    ]);
  } catch (e) { console.error('comment game hook failed', e); }

  return c.json({ success: true, data: { ...comment, red_packet: redPacketResult }, message: '评论成功' }, 201);
});

// 编辑评论
comments.put('/:id', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的评论ID' }, 400);
  const { content } = await c.req.json();

  const contentCheck = validateContent(content);
  if (!contentCheck.valid) return c.json({ success: false, error: contentCheck.error }, 400);

  // 仅作者可编辑
  const existing = await c.env.DB
    .prepare('SELECT user_id FROM comments WHERE id = ?')
    .bind(id).first<{ user_id: number }>();
  if (!existing) return c.json({ success: false, error: '评论不存在' }, 404);
  if (existing.user_id !== user.userId) {
    return c.json({ success: false, error: '无权编辑此评论' }, 403);
  }

  await updateComment(c.env.DB, id, content);
  return c.json({ success: true, message: '评论已更新' });
});

// 删除评论
comments.delete('/:id', requireAuth, checkNotBanned, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的评论ID' }, 400);

  // 仅作者本人或管理员可删除自己的评论；巡查员不可删他人评论（走举报审核流程）；role 从 dbUser 读
  const comment = await c.env.DB
    .prepare('SELECT user_id FROM comments WHERE id = ?')
    .bind(id).first<{ user_id: number }>();
  if (!comment) return c.json({ success: false, error: '评论不存在' }, 404);
  const dbUser = c.get('dbUser') as User;
  if (comment.user_id !== user.userId && dbUser.role !== 'admin') {
    return c.json({ success: false, error: '只能删除自己的评论；他人违规评论请使用举报' }, 403);
  }

  await hardDeleteComment(c.env.DB, id);
  return c.json({ success: true, message: '评论已删除' });
});

export default comments;
