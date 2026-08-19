import { Hono } from 'hono';
import type { Env, JWTPayload, User } from '../types';
import { requireAuth } from '../middleware/auth';
import { parseId } from '../utils/validation';
import { getSetting } from '../db/queries';
import { patrolLevelFromExp } from '../utils/patrol';

// 已下架复审（069 迁移）：作者对软删帖提交申诉 → 达标巡查员单人判定（恢复重新巡查 / 维持下架）
// 等级门槛：settings appeal_review_level（默认 5 级）；管理员无限制
// 一帖一条申诉（UNIQUE post_id），驳回即终局（管理员仍可后台直接恢复）
const appeals = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

appeals.use('*', requireAuth);

// 复审等级门槛（settings appeal_review_level 可配，默认 5）
async function reviewLevelLimit(db: D1Database): Promise<number> {
  const v = await getSetting(db, 'appeal_review_level');
  const n = parseInt(v || '');
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : 5;
}

// 当前用户是否有复审权限：管理员无限制；巡查员需巡查等级 >= 门槛
async function canReview(db: D1Database, dbUser: User): Promise<boolean> {
  if (dbUser.role === 'admin') return true;
  if (dbUser.role !== 'moderator') return false;
  const limit = await reviewLevelLimit(db);
  const row = await db.prepare('SELECT patrol_exp FROM user_patrol_stats WHERE user_id = ?')
    .bind(dbUser.id).first<{ patrol_exp: number }>();
  return patrolLevelFromExp(row?.patrol_exp || 0).level >= limit;
}

// ─── 复审权限查询（前端用于控制 Tab 显隐）───
appeals.get('/access', async (c) => {
  const dbUser: User | undefined = c.get('dbUser');
  if (!dbUser) return c.json({ success: false, error: '未登录' }, 401);
  const requiredLevel = await reviewLevelLimit(c.env.DB);
  let level = 0;
  if (dbUser.role === 'moderator') {
    const row = await c.env.DB.prepare('SELECT patrol_exp FROM user_patrol_stats WHERE user_id = ?')
      .bind(dbUser.id).first<{ patrol_exp: number }>();
    level = patrolLevelFromExp(row?.patrol_exp || 0).level;
  }
  const allowed = dbUser.role === 'admin' || level >= requiredLevel;
  return c.json({ success: true, data: { allowed, level, requiredLevel, isAdmin: dbUser.role === 'admin' } });
});

// ─── 提交申诉（仅帖子作者本人；帖子须处于软删状态且无重复申诉）───
appeals.post('/', async (c) => {
  const user: JWTPayload = c.get('user');
  const { post_id, reason } = await c.req.json();
  const postId = parseId(post_id);
  const reasonText = typeof reason === 'string' ? reason.trim() : '';

  if (postId === null || reasonText.length < 2 || reasonText.length > 1000) {
    return c.json({ success: false, error: '参数无效：请填写申诉理由（2-1000 字）' }, 400);
  }

  // 帖子须存在且已软删（deleted_at 非空），且当前用户是作者
  const post = await c.env.DB
    .prepare('SELECT id, user_id, title FROM posts WHERE id = ? AND deleted_at IS NOT NULL')
    .bind(postId)
    .first<{ id: number; user_id: number; title: string }>();
  if (!post) return c.json({ success: false, error: '帖子不存在或未处于下架状态' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能申诉自己的帖子' }, 403);

  // 一帖一条申诉：已存在（含已驳回）则不可重复申诉
  const exist = await c.env.DB.prepare('SELECT id, status FROM appeals WHERE post_id = ?')
    .bind(postId).first<{ id: number; status: string }>();
  if (exist) {
    return c.json({
      success: false,
      error: exist.status === 'pending' ? '该帖子已有待复审的申诉' : '该帖子已申诉过（复审已结束）',
    }, 409);
  }

  await c.env.DB.prepare('INSERT INTO appeals (post_id, user_id, reason) VALUES (?, ?, ?)')
    .bind(postId, user.userId, reasonText).run();

  return c.json({ success: true, message: '申诉已提交，等待巡查员复审' });
});

// ─── 待复审列表（达标巡查员 / 管理员）───
// 返回软删帖内容（供复审查看）+ 作者申诉理由 + 下架时间
appeals.get('/pending', async (c) => {
  const dbUser: User | undefined = c.get('dbUser');
  if (!dbUser) return c.json({ success: false, error: '未登录' }, 401);
  if (!(await canReview(c.env.DB, dbUser))) {
    return c.json({ success: false, error: '巡查等级不足，无法使用已下架复审' }, 403);
  }
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '10')));
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(`
    SELECT a.id AS appeal_id, a.post_id, a.reason AS appeal_reason, a.created_at AS appeal_created_at,
           p.title, p.content, p.category_id, p.created_at, p.deleted_at,
           p.flagged_reason, p.is_anonymous,
           c.name AS category_name,
           CASE WHEN p.is_anonymous = 1 THEN '匿名同学' ELSE u.username END AS username
    FROM appeals a
    JOIN posts p ON p.id = a.post_id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN users u ON p.user_id = u.id
    WHERE a.status = 'pending'
    ORDER BY a.created_at ASC
    LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all<any>();

  const totalRow = await c.env.DB
    .prepare("SELECT COUNT(*) AS cnt FROM appeals WHERE status = 'pending'")
    .first<{ cnt: number }>();

  return c.json({
    success: true,
    data: rows.results || [],
    total: totalRow?.cnt || 0,
    page,
    pageSize,
  });
});

// ─── 单人判定：approve=恢复并重新巡查 / reject=维持下架 ───
appeals.post('/:id/decide', async (c) => {
  const user: JWTPayload = c.get('user');
  const dbUser: User | undefined = c.get('dbUser');
  if (!dbUser) return c.json({ success: false, error: '未登录' }, 401);
  if (!(await canReview(c.env.DB, dbUser))) {
    return c.json({ success: false, error: '巡查等级不足，无法使用已下架复审' }, 403);
  }
  const appealId = parseId(c.req.param('id'));
  if (appealId === null) return c.json({ success: false, error: '无效的申诉ID' }, 400);
  const { action } = await c.req.json();
  if (action !== 'approve' && action !== 'reject') return c.json({ success: false, error: '参数无效' }, 400);

  const appeal = await c.env.DB
    .prepare('SELECT id, post_id, user_id, status FROM appeals WHERE id = ?')
    .bind(appealId).first<{ id: number; post_id: number; user_id: number; status: string }>();
  if (!appeal) return c.json({ success: false, error: '申诉不存在' }, 404);
  if (appeal.status !== 'pending') return c.json({ success: false, error: '该申诉已处理' }, 409);

  // 自审自决拦截：作者本人不得判定自己的申诉（管理员豁免）
  if (appeal.user_id === dbUser.id && dbUser.role !== 'admin') {
    return c.json({ success: false, error: '不能处理自己的申诉' }, 403);
  }

  if (action === 'approve') {
    // 帖子须仍处于软删状态（管理员可能已后台恢复）：UPDATE 带 deleted_at IS NOT NULL 守卫并检查 changes，
    // 避免把已恢复帖强制塞回巡查队列（恢复流程已自动关闭 pending 申诉）
    const res = await c.env.DB
      .prepare("UPDATE posts SET deleted_at = NULL, review_status = 'pending', review_round = review_round + 1, rejected_at = NULL, flagged_by = NULL, flagged_reason = NULL, violation_count = 0 WHERE id = ? AND deleted_at IS NOT NULL")
      .bind(appeal.post_id).run();
    if (!res.meta.changes) return c.json({ success: false, error: '帖子已被恢复，该申诉无需处理' }, 409);
  }

  const stmts: any[] = [
    // 标记申诉已处理（单人判定，立即生效）
    c.env.DB.prepare("UPDATE appeals SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?")
      .bind(action === 'approve' ? 'approved' : 'rejected', user.userId, appeal.id),
  ];

  if (action === 'approve') {
    // 帖子已在上面恢复；通知作者
    stmts.push(
      c.env.DB.prepare("INSERT INTO notifications (user_id, type, post_id, content, read) VALUES (?, 'system', ?, ?, 0)")
        .bind(appeal.user_id, appeal.post_id, '你的申诉已通过：帖子已恢复并重新进入待巡查'),
    );
  } else {
    // 驳回：维持下架
    stmts.push(
      c.env.DB.prepare("INSERT INTO notifications (user_id, type, post_id, content, read) VALUES (?, 'system', ?, ?, 0)")
        .bind(appeal.user_id, appeal.post_id, '你的申诉未通过：帖子维持下架'),
    );
  }

  await c.env.DB.batch(stmts);
  return c.json({
    success: true,
    message: action === 'approve' ? '已恢复帖子并重新进入待巡查队列' : '已驳回申诉，帖子维持下架',
  });
});

// ─── 申诉页信息（通知点击申诉进入）：帖子是否可申诉 + 已有申诉状态 ───
appeals.get('/post/:postId', async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);

  const post = await c.env.DB
    .prepare('SELECT id, user_id, title, deleted_at FROM posts WHERE id = ?')
    .bind(postId).first<{ id: number; user_id: number; title: string; deleted_at: string | null }>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能查看自己的帖子' }, 403);

  const appeal = await c.env.DB.prepare('SELECT id, status, reason FROM appeals WHERE post_id = ?')
    .bind(postId).first<{ id: number; status: string; reason: string }>();

  return c.json({
    success: true,
    data: {
      post_id: post.id,
      title: post.title,
      deleted: !!post.deleted_at,
      appeal: appeal || null,
    },
  });
});

export default appeals;
