import type { Env, User, Post, Comment, Category, Like, Verification, Setting, PublicUser } from '../types';
import { levelFromExp } from '../utils/game';

// ============================================================
// 用户查询
// ============================================================

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').bind(id).first<User>();
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL').bind(email).first<User>();
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL').bind(username).first<User>();
}

export async function getUserByEmailOrUsername(db: D1Database, email: string, username: string): Promise<{ emailExists: boolean; usernameExists: boolean }> {
  const result = await db
    .prepare('SELECT email, username FROM users WHERE (email = ? OR username = ?) AND deleted_at IS NULL')
    .bind(email, username)
    .first<{ email: string; username: string }>();
  if (!result) return { emailExists: false, usernameExists: false };
  return {
    emailExists: result.email === email,
    usernameExists: result.username === username,
  };
}

export async function createUser(
  db: D1Database,
  username: string,
  email: string,
  passwordHash: string
): Promise<User | null> {
  // 单条 INSERT...SELECT 原子取号：SQLite 单条语句持写锁天然串行，
  // 避免「先 SELECT MAX(id) 再 INSERT」两步在并发注册时算出相同 id 导致主键冲突
  // 空表时 MAX(id) 为 NULL，COALESCE 兜底为 99999 + 1 = 100000（与原 max(100000, max_id + 1) 逻辑等价）
  const result = await db
    .prepare(
      'INSERT INTO users (id, username, email, password_hash) SELECT COALESCE(MAX(id), 99999) + 1, ?, ?, ? FROM users RETURNING *'
    )
    .bind(username, email, passwordHash)
    .first<User>();
  return result;
}

const USER_COLUMNS = new Set(['username','email','bio','avatar_url','banner_url','notify_on_reply','notify_on_like','twofa_secret','twofa_enabled']);
const POST_COLUMNS = new Set(['title','content','category_id','price']);
const CATEGORY_COLUMNS = new Set(['name','slug','description','sort_order','allow_anonymous','is_active','allow_paid','allow_thanks']);

export async function updateUser(
  db: D1Database,
  userId: number,
  updates: Partial<Pick<User, 'username' | 'bio' | 'avatar_url' | 'banner_url' | 'notify_on_reply' | 'notify_on_like' | 'twofa_secret' | 'twofa_enabled'>>
): Promise<void> {
  const sets: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && USER_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");

  await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...values, userId).run();
}

export async function updatePassword(db: D1Database, userId: number, passwordHash: string): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(passwordHash, userId)
    .run();
}

export async function verifyUserEmail(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?")
    .bind(userId)
    .run();
}

export async function getPublicUser(db: D1Database, userId: number): Promise<(PublicUser & { exp: number; level: number; tierName: string }) | null> {
  const row = await db
    .prepare(`SELECT u.id, u.username, u.avatar_url, u.banner_url, u.bio, u.role, u.created_at, u.banned_until, u.ban_reason, u.custom_title, u.nick_theme, u.exp,
             u.title_badge, u.title_badge_expires_at, u.avatar_frame, u.avatar_frame_expires_at,
             v.tier as vip_tier
      FROM users u
      LEFT JOIN user_vips v ON u.id = v.user_id AND v.expires_at > datetime('now')
      WHERE u.id = ? AND u.deleted_at IS NULL`)
    .bind(userId)
    .first<PublicUser & { exp: number }>();
  if (!row) return null;
  const { exp, ...rest } = row;
  const lv = levelFromExp(exp || 0);
  return { ...rest, exp: exp || 0, level: lv.level, tierName: lv.tierName };
}

export async function listUsers(db: D1Database, page: number, pageSize: number): Promise<{ users: User[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const total = await db.prepare("SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL").first<{ count: number }>();
  const users = await db
    .prepare("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(pageSize, offset)
    .all<User>();
  return { users: users.results, total: total?.count || 0 };
}

export async function updateUserRole(db: D1Database, userId: number, role: string): Promise<void> {
  await db
    .prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(role, userId)
    .run();
}

// ============================================================
// 帖子查询
// ============================================================

export async function listPosts(
  db: D1Database,
  options: {
    page: number;
    pageSize: number;
    categoryId?: number;
    userId?: number;
    sort?: 'latest' | 'hot' | 'most_viewed';
    search?: string;
    feedUserId?: number;
    includeDeleted?: boolean;
    excludeAnonymous?: boolean;
    viewerUserId?: number;
    // 后台管理列表需要看真实作者（rawAuthors=true 时匿名帖也返回真名+is_anonymous 标记）
    rawAuthors?: boolean;
  }
): Promise<{ posts: Post[]; total: number }> {
  const { page, pageSize, categoryId, userId, sort = 'latest', search, feedUserId, includeDeleted = false, excludeAnonymous = false, viewerUserId, rawAuthors } = options;
  const offset = (page - 1) * pageSize;
  // 前台匿名帖一律显示「匿名同学」；后台列表（rawAuthors）返回真实作者
  const rawFlag = rawAuthors ? 1 : 0;
  let whereClause = includeDeleted ? 'WHERE 1=1' : 'WHERE p.deleted_at IS NULL';
  const params: any[] = [];

  // 前台过滤「违规待复核 / 打回待编辑」的帖子（巡查标记中不对外展示；后台 includeDeleted=true 时可见）
  if (!includeDeleted) {
    whereClause += " AND p.review_status NOT IN ('violation', 'rejected')";
  }

  // 他人主页查看时过滤匿名帖，避免泄露（本人主页传 viewerUserId 则不过滤）
  const hideAnonymous = excludeAnonymous || (userId !== undefined && viewerUserId !== userId);
  if (hideAnonymous) {
    whereClause += ' AND p.is_anonymous = 0';
  }

  if (feedUserId) {
    whereClause += ' AND p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)';
    params.push(feedUserId);
    // feed 模式下不显示自己的帖子（只显示关注的人）
    whereClause += ' AND p.user_id != ?';
    params.push(feedUserId);
  }
  if (categoryId) {
    whereClause += ' AND p.category_id = ?';
    params.push(categoryId);
  }
  if (userId) {
    whereClause += ' AND p.user_id = ?';
    params.push(userId);
  }
  // LIKE 通配符转义：防止搜索词里的 % / _ 被当作通配符（如搜「100%」会命中全部帖子）
  const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
  if (search) {
    // 尝试 FTS5 全文搜索，失败时回退到 LIKE
    try {
      // LIMIT 80 是上限余量：80 个 IN 占位符 + 其余过滤参数 + 列表查询的 rawFlag×12 + pageSize + offset，
      // 总绑定数不超过 D1 单查询 100 个参数上限
      const ftsResult = await db
        .prepare("SELECT rowid FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank LIMIT ?")
        .bind(search, 80)
        .all<{ rowid: number }>();
      if (ftsResult.results && ftsResult.results.length > 0) {
        const ids = ftsResult.results.map(r => r.rowid);
        // ids 来自数据库内部 rowid（非注入面），但保持全参数化纪律；
        // push 顺序紧跟 IN 子句的追加位置——后续 count 与两个列表查询都按 ...params 顺序绑定
        whereClause += ` AND p.id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      } else {
        // FTS 匹配无结果 → 回退到 LIKE 模糊搜索（支持逐字/中间字匹配）
        whereClause += " AND (p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')";
        const pattern = `%${escapeLike(search)}%`;
        params.push(pattern, pattern);
      }
    } catch {
      // FTS5 表不存在，回退到 LIKE
      whereClause += " AND (p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')";
      const pattern = `%${escapeLike(search)}%`;
      params.push(pattern, pattern);
    }
  }

  const SORT_MAP: Record<string, string> = {
    hot: 'p.comment_count',
    most_viewed: 'p.view_count',
    latest: 'p.created_at',
  };
  const sortField = SORT_MAP[sort] || 'p.created_at';

  const countResult = await db
    .prepare(`SELECT COUNT(*) as count FROM posts p ${whereClause}`)
    .bind(...params)
    .first<{ count: number }>();

  // 深页保护：OFFSET 超过 5000 时直接返回空列表（total 照常返回），跳过两个列表查询——
  // LIMIT ? OFFSET ? 的深 OFFSET 需要索引逐行跳过，翻到 100+ 页就是上万行的无谓扫描。
  // 正常用户翻不到这么深，管理员检索旧帖请用搜索/管理端其他路径。
  // 保护分支放在 count 之后、Promise.all 置顶+普通查询之前，不破坏其结构（置顶分支无 LIMIT，不受影响）
  if (offset > 5000) {
    return { posts: [], total: countResult?.count || 0 };
  }

  // 拆为两个查询：置顶帖（无分页，索引友好）+ 普通帖（带分页）
  // 置顶帖数量通常 ≤ 5，分开查询远优于 CASE WHEN 扼杀索引
  const baseCondition = whereClause.includes('WHERE 1=1') ? '' : ' AND p.deleted_at IS NULL';
  const extraConditions = whereClause
    .replace(/^WHERE\s+(p\.deleted_at IS NULL|1=1)\s*/i, '')
    .trim();
  const pinnedWhere = 'WHERE p.is_pinned = 1' + baseCondition + (extraConditions ? ' ' + extraConditions : '');

  const [pinnedResult, normalResult] = await Promise.all([
    db
      .prepare(`
        SELECT p.id, CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE p.user_id END AS user_id, p.is_anonymous, p.title, p.content, p.category_id, p.is_pinned, p.is_locked, p.view_count, p.like_count, p.comment_count, p.thanks_count, p.post_bg_id, p.created_at, p.updated_at, p.price, p.highlighted_until, p.fortune, p.title_effect, CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN '匿名同学' ELSE u.username END AS username, CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN '' ELSE u.avatar_url END AS author_avatar, CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.banned_until END AS author_banned_until,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.nick_theme END AS author_nick_theme,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.exp END AS author_exp,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.avatar_frame END AS author_avatar_frame,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.avatar_frame_expires_at END AS author_avatar_frame_expires_at,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.title_badge END AS author_title_badge,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.custom_title END AS author_custom_title,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.custom_title_expires_at END AS author_custom_title_expires_at,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE v.tier END AS author_vip_tier,
               c.name as category_name, c.slug as category_slug, c.allow_thanks AS category_allow_thanks,
               rp.remaining_coins AS red_packet_coins, rp.remaining_packets AS red_packet_remaining,
               p.highlighted_until, p.fortune, p.title_effect, p.title_effect_expires_at
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN user_vips v ON u.id = v.user_id AND v.expires_at > datetime('now')
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN (SELECT post_id, remaining_coins, remaining_packets FROM red_packets WHERE remaining_packets > 0) rp ON rp.post_id = p.id
        ${pinnedWhere}
        ORDER BY p.updated_at DESC
      `)
      .bind(rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, ...params)
      .all(),
    db
      .prepare(`
        SELECT p.id, CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE p.user_id END AS user_id, p.is_anonymous, p.title, p.content, p.category_id, p.is_pinned, p.is_locked, p.view_count, p.like_count, p.comment_count, p.thanks_count, p.post_bg_id, p.effects_managed_at, p.created_at, p.updated_at, p.deleted_at, p.decoration_id, p.title_decoration_id, p.highlighted_until, p.fortune, p.fortune_expires_at, p.title_effect, p.title_effect_expires_at, p.bumped_until, p.price, CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN '匿名同学' ELSE u.username END AS username, CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN '' ELSE u.avatar_url END AS author_avatar, CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.banned_until END AS author_banned_until,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.nick_theme END AS author_nick_theme,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.exp END AS author_exp,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.avatar_frame END AS author_avatar_frame,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.avatar_frame_expires_at END AS author_avatar_frame_expires_at,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.title_badge END AS author_title_badge,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.custom_title END AS author_custom_title,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE u.custom_title_expires_at END AS author_custom_title_expires_at,
               CASE WHEN p.is_anonymous = 1 AND ? = 0 THEN NULL ELSE v.tier END AS author_vip_tier,
               c.name as category_name, c.slug as category_slug, c.allow_thanks AS category_allow_thanks,
               rp.remaining_coins AS red_packet_coins, rp.remaining_packets AS red_packet_remaining,
               p.highlighted_until, p.fortune, p.title_effect, p.title_effect_expires_at
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN user_vips v ON u.id = v.user_id AND v.expires_at > datetime('now')
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN (SELECT post_id, remaining_coins, remaining_packets FROM red_packets WHERE remaining_packets > 0) rp ON rp.post_id = p.id
        ${whereClause} AND (p.is_pinned = 0 OR p.is_pinned IS NULL)
        ORDER BY ${sortField} DESC
        LIMIT ? OFFSET ?
      `)
      .bind(rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, rawFlag, ...params, pageSize, offset)
      .all(),
  ]);

  const pinnedPosts = pinnedResult.results as any[] || [];
  const normalPosts = normalResult.results as any[] || [];
  const posts = [...pinnedPosts, ...normalPosts];

  return { posts, total: countResult?.count || 0 };
}

export async function getPostById(db: D1Database, postId: number): Promise<any | null> {
  // 前台详情匿名帖一律显示「匿名同学」（真实作者仅管理后台可见）
  return db
    .prepare(`
      SELECT p.id,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE p.user_id END AS user_id,
             p.user_id AS owner_user_id, p.is_anonymous,
             p.title, p.content, p.category_id, p.is_pinned, p.is_locked, p.view_count, p.like_count, p.comment_count, p.thanks_count, p.post_bg_id,
             p.created_at, p.updated_at, p.deleted_at, p.decoration_id, p.title_decoration_id,
             p.highlighted_until, p.fortune, p.title_effect, p.title_effect_expires_at, p.fortune_expires_at, p.is_essence, p.bumped_until,
             p.price, p.review_status, p.rejected_at, p.review_round,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.id END AS author_id,
             CASE WHEN p.is_anonymous = 1 THEN '匿名同学' ELSE u.username END AS username,
             CASE WHEN p.is_anonymous = 1 THEN '' ELSE u.avatar_url END AS author_avatar,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.bio END AS author_bio,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.role END AS author_role,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.banned_until END AS author_banned_until,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.nick_theme END AS author_nick_theme,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.exp END AS author_exp,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.avatar_frame END AS author_avatar_frame,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.avatar_frame_expires_at END AS author_avatar_frame_expires_at,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.title_badge END AS author_title_badge,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.custom_title END AS author_custom_title,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.custom_title_expires_at END AS author_custom_title_expires_at,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE v.tier END AS author_vip_tier,
             c.name as category_name, c.slug as category_slug, c.allow_thanks AS category_allow_thanks,
             rp.id AS red_packet_id, rp.total_coins AS red_packet_total_coins, rp.remaining_coins AS red_packet_remaining_coins, rp.total_packets AS red_packet_total_packets, rp.remaining_packets AS red_packet_remaining_packets, rp.user_id AS red_packet_owner_id,
             si.id as decoration_id, si.name as decoration_name, si.data as decoration_data,
             tsi.id as title_decoration_id, tsi.name as title_decoration_name, tsi.data as title_decoration_data
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id AND u.deleted_at IS NULL
      LEFT JOIN user_vips v ON u.id = v.user_id AND v.expires_at > datetime('now')
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN shop_items si ON p.decoration_id = si.id
      LEFT JOIN shop_items tsi ON p.title_decoration_id = tsi.id
      LEFT JOIN red_packets rp ON rp.post_id = p.id
      WHERE p.id = ? AND p.deleted_at IS NULL AND p.review_status != 'violation'
    `)
    .bind(postId)
    .first();
}

export async function createPost(
  db: D1Database,
  userId: number,
  title: string,
  content: string,
  categoryId?: number,
  price?: number,
  isAnonymous = 0
): Promise<Post | null> {
  return db
    .prepare(
      'INSERT INTO posts (user_id, title, content, category_id, price, is_anonymous) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
    )
    .bind(userId, title, content, categoryId || null, price || null, isAnonymous ? 1 : 0)
    .first<Post>();
}

export async function updatePost(
  db: D1Database,
  postId: number,
  updates: Partial<Pick<Post, 'title' | 'content' | 'category_id'>> & { price?: number | null }
): Promise<void> {
  const sets: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && POST_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");

  await db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).bind(...values, postId).run();
}

export async function getPostOwner(db: D1Database, postId: number): Promise<{ user_id: number } | null> {
  return db
    .prepare('SELECT user_id FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId)
    .first<{ user_id: number }>();
}

export async function postExists(db: D1Database, postId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId)
    .first<{ id: number }>();
  return !!row;
}

export async function hardDeletePost(db: D1Database, postId: number): Promise<void> {
  // CAS-first 结算：清零与取剩余同一 batch（D1 batch 即事务，SELECT 与 UPDATE 间无并发插缝），
  // WHERE remaining_coins > 0 守卫——并发下先到者清零成功，后到者 SELECT 0 行（zeroed=false）跳过，
  // 绝不重复退款；反过来「先退款后清零」在两步间隙会被并发请求重复退款（双退）
  const settle = await db.batch([
    db.prepare('SELECT id, user_id, remaining_coins FROM red_packets WHERE post_id = ? AND remaining_coins > 0').bind(postId),
    db.prepare('UPDATE red_packets SET remaining_coins = 0, remaining_packets = 0 WHERE post_id = ? AND remaining_coins > 0').bind(postId),
  ]);
  const packets = (settle[0].results || []) as Array<{ id: number; user_id: number; remaining_coins: number }>;

  const coreStmts: any[] = [
    db.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').bind('post', postId),
    db.prepare('DELETE FROM likes WHERE target_type = ? AND target_id IN (SELECT id FROM comments WHERE post_id = ?)').bind('comment', postId),
    // 评论的感谢记录（thanks 无 target FK，评论被删后必须显式清理，否则永久孤儿残留）
    db.prepare("DELETE FROM thanks WHERE target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE post_id = ?)").bind(postId),
    db.prepare('DELETE FROM comments WHERE parent_id IS NOT NULL AND post_id = ?').bind(postId),
    db.prepare('DELETE FROM comments WHERE post_id = ?').bind(postId),
    db.prepare('DELETE FROM page_views WHERE post_id = ?').bind(postId),
    db.prepare("DELETE FROM reports WHERE target_id = ? AND target_type = 'post'").bind(postId),
    db.prepare("DELETE FROM reports WHERE target_id IN (SELECT id FROM comments WHERE post_id = ?) AND target_type = 'comment'").bind(postId),
    // 注意：红包行不在这里删——退款金额来自 CAS-first 的原子读数，行要等退款语句执行后才删（见下方 refundStmts 末尾）
    // 付费/密码解锁访问记录、悬空的 post_id 通知、帖子感谢记录（无级联 FK，需显式清理）
    db.prepare('DELETE FROM post_access WHERE post_id = ?').bind(postId),
    db.prepare('DELETE FROM notifications WHERE post_id = ?').bind(postId),
    db.prepare("DELETE FROM thanks WHERE target_type = 'post' AND target_id = ?").bind(postId),
    db.prepare('DELETE FROM posts WHERE id = ?').bind(postId),
  ];

  // 未抢完的红包余额退回 owner：user_balances 行可能不存在，用 ON CONFLICT DO UPDATE 兜底
  // （只加 coins，不加 total_earned——退款不是收益；流水 balance_after 取退款后余额）
  // 退款金额来自上方 CAS-first batch 的原子读数（不能退款时再查——行此时已清零，查不到）
  const refundStmts: any[] = [];
  for (const rp of packets) {
    refundStmts.push(
      db.prepare('INSERT INTO user_balances (user_id, coins) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET coins = coins + excluded.coins')
        .bind(rp.user_id, rp.remaining_coins),
      db.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'red_packet_refund', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(rp.user_id, rp.remaining_coins, '帖子删除，未抢完的红包余额退回', rp.user_id),
    );
  }
  // 红包行清零且退款入列后再删行：退款 batch 失败时异常上抛、删行不执行、行保留留痕可对账；
  // 若先删行后退款（旧实现），退款失败即资金丢失且无从核对
  refundStmts.push(db.prepare('DELETE FROM red_packets WHERE post_id = ?').bind(postId));

  // 执行顺序：CAS 清零结算 → 核心清理 batch → 退款+删行（分块 batch）。
  // 核心清理与退款拆成多个 batch：D1 单次 batch 上限 100 条语句，每个红包对应 2 条退款语句，
  // 全部塞进一个 batch 时红包数超过 43 个即超限。核心清理先单独执行，退款语句（含末尾删行）
  // 按每组 ≤90 条（即 ≤45 个红包）切块顺序执行；极端情况下失去整体原子性，但单帖红包超过
  // 43 个在现实中不会发生，且单 batch 超限报错更糟
  await db.batch(coreStmts);
  for (let i = 0; i < refundStmts.length; i += 90) {
    await db.batch(refundStmts.slice(i, i + 90));
  }
}

export async function listPinnedPosts(db: D1Database): Promise<any[]> {
  const result = await db
    .prepare(`
      SELECT p.id, p.title, p.user_id, u.username, p.view_count, p.comment_count, p.like_count, p.updated_at
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.is_pinned = 1 AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
    `)
    .all();
  return result.results as any;
}

export async function togglePinPost(db: D1Database, postId: number, isPinned: boolean): Promise<void> {
  await db
    .prepare('UPDATE posts SET is_pinned = ? WHERE id = ?')
    .bind(isPinned ? 1 : 0, postId)
    .run();
}

export async function incrementViewCount(db: D1Database, postId: number): Promise<void> {
  await db
    .prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?')
    .bind(postId)
    .run();
}

export async function incrementPostLikeCount(db: D1Database, postId: number): Promise<void> {
  await db
    .prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?')
    .bind(postId)
    .run();
}

export async function decrementPostLikeCount(db: D1Database, postId: number): Promise<void> {
  await db
    .prepare('UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = ?')
    .bind(postId)
    .run();
}

// ============================================================
// 评论查询
// ============================================================

// 获取顶层评论总数（用于分页）
export async function getTopLevelCommentCount(db: D1Database, postId: number): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM comments WHERE post_id = ? AND parent_id IS NULL AND deleted_at IS NULL")
    .bind(postId)
    .first<{ count: number }>();
  return result?.count || 0;
}

// 分页获取评论（获取指定页的顶层评论 + 其所有子评论）
// 分页由 Step 1 普通查询完成（SQLite 不允许递归 CTE 内嵌 ORDER BY/LIMIT）；
// Step 2 的递归 CTE 以本页顶层 id 为种子展开任意深度后代，绑定参数 = pageSize + 1，
// 规避 D1 单查询 100 参数上限（旧实现 3×pageSize 个占位符，pageSize>33 即超限）
export async function getPaginatedComments(
  db: D1Database,
  postId: number,
  page: number,
  pageSize: number
): Promise<any[]> {
  const offset = (page - 1) * pageSize;
  // Step 1: 先取本页顶层评论 ID（独立查询避免 CTE 重复物化）
  const topIds = await db
    .prepare('SELECT id FROM comments WHERE post_id = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY created_at ASC LIMIT ? OFFSET ?')
    .bind(postId, pageSize, offset)
    .all<{ id: number }>();

  const ids = (topIds.results || []).map(r => r.id);
  if (ids.length === 0) return [];

  // Step 2: 递归 CTE 以本页顶层 id 为种子，一次查出顶层评论 + 任意深度所有子回复
  // 匿名帖上下文中，帖子作者本人的评论脱敏（username=「楼主」、user_id/avatar/装饰信息置空），防身份泄露
  const placeholders = ids.map(() => '?').join(',');
  const comments = await db
    .prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM comments WHERE id IN (${placeholders}) AND deleted_at IS NULL
        UNION ALL
        SELECT c.id FROM comments c JOIN tree t ON c.parent_id = t.id
        WHERE c.deleted_at IS NULL
      )
      SELECT c.id, c.post_id,
             CASE WHEN p.is_anonymous = 1 AND c.user_id = p.user_id THEN NULL ELSE c.user_id END AS user_id,
             c.parent_id, c.content, c.like_count, c.created_at,
             (SELECT COUNT(*) FROM thanks t WHERE t.target_type = 'comment' AND t.target_id = c.id) AS thanks_count,
             CASE WHEN p.is_anonymous = 1 AND c.user_id = p.user_id THEN NULL ELSE u.id END AS author_id,
             CASE WHEN p.is_anonymous = 1 AND c.user_id = p.user_id THEN '楼主' ELSE u.username END AS username,
             CASE WHEN p.is_anonymous = 1 AND c.user_id = p.user_id THEN NULL ELSE u.avatar_url END AS author_avatar,
             CASE WHEN p.is_anonymous = 1 AND c.user_id = p.user_id THEN NULL ELSE u.role END AS author_role,
             CASE WHEN p.is_anonymous = 1 AND c.user_id = p.user_id THEN NULL ELSE u.banned_until END AS author_banned_until,
             CASE WHEN p.is_anonymous = 1 AND c.user_id = p.user_id THEN NULL ELSE u.nick_theme END AS author_nick_theme,
             CASE WHEN p.is_anonymous = 1 AND c.user_id = p.user_id THEN NULL ELSE v.tier END AS author_vip_tier
      FROM comments c
      JOIN tree t ON c.id = t.id
      INNER JOIN posts p ON c.post_id = p.id
      LEFT JOIN users u ON c.user_id = u.id AND u.deleted_at IS NULL
      LEFT JOIN user_vips v ON u.id = v.user_id AND v.expires_at > datetime('now')
      WHERE c.post_id = ? AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC
    `)
    .bind(...ids, postId)
    .all();
  return comments.results as any[];
}

export async function createComment(
  db: D1Database,
  postId: number,
  userId: number,
  content: string,
  parentId?: number
): Promise<Comment | null> {
  const result = await db
    .prepare(
      'INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?) RETURNING *'
    )
    .bind(postId, userId, parentId || null, content)
    .first<Comment>();

  // 更新帖子评论计数
  await db
    .prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?')
    .bind(postId)
    .run();

  return result;
}

export async function updateComment(
  db: D1Database,
  commentId: number,
  content: string
): Promise<void> {
  await db
    .prepare("UPDATE comments SET content = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(content, commentId)
    .run();
}

export async function hardDeleteComment(db: D1Database, commentId: number): Promise<void> {
  const comment = await db.prepare('SELECT post_id FROM comments WHERE id = ?').bind(commentId).first<{ post_id: number }>();
  // 递归 CTE 收集全部后代（子 → 孙 → 任意深度），用于删除与计数
  const DESC_CTE = `
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM comments WHERE parent_id = ?
      UNION ALL
      SELECT c.id FROM comments c JOIN descendants d ON c.parent_id = d.id
    )`;
  const descendantRows = await db
    .prepare(`${DESC_CTE} SELECT id FROM descendants`)
    .bind(commentId)
    .all<{ id: number }>();
  // 统计实际删除的评论数（自身 + 全部后代）
  const totalDeleted = 1 + (descendantRows.results?.length || 0);

  // 先删全部后代再删自身：单条语句一次删多级，SQLite 语句结束才检查 FK，
  // 同语句删除的父子行互不冲突——避免「先删子后删自身」时孙级仍引用子级触发 FK 500
  await db.batch([
    // 删除所有后代评论的点赞（防止孤立数据）
    db.prepare(`DELETE FROM likes WHERE target_type = 'comment' AND target_id IN (${DESC_CTE} SELECT id FROM descendants)`).bind(commentId),
    // 级联硬删除所有后代
    db.prepare(`DELETE FROM comments WHERE id IN (${DESC_CTE} SELECT id FROM descendants)`).bind(commentId),
    // 删除评论自身的点赞
    db.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').bind('comment', commentId),
    // 删除评论相关的举报
    db.prepare("DELETE FROM reports WHERE target_id = ? AND target_type = 'comment'").bind(commentId),
    // 删除评论自身
    db.prepare('DELETE FROM comments WHERE id = ?').bind(commentId),
  ]);

  if (comment) {
    // 按实际删除数扣减评论计数（含全部后代）
    await db
      .prepare("UPDATE posts SET comment_count = MAX(0, comment_count - ?) WHERE id = ?")
      .bind(totalDeleted, comment.post_id)
      .run();
  }
}

export async function incrementCommentLikeCount(db: D1Database, commentId: number): Promise<void> {
  await db
    .prepare('UPDATE comments SET like_count = like_count + 1 WHERE id = ?')
    .bind(commentId)
    .run();
}

export async function decrementCommentLikeCount(db: D1Database, commentId: number): Promise<void> {
  await db
    .prepare('UPDATE comments SET like_count = MAX(0, like_count - 1) WHERE id = ?')
    .bind(commentId)
    .run();
}

// ============================================================
// 分类查询
// ============================================================

export async function listCategories(db: D1Database, includeInactive = false): Promise<Category[]> {
  const result = await db
    .prepare(`SELECT * FROM categories ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order ASC, id ASC`)
    .all<Category>();
  return result.results;
}

export async function getCategoryById(db: D1Database, id: number): Promise<Category | null> {
  return db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<Category>();
}

export async function getCategoryBySlug(db: D1Database, slug: string): Promise<Category | null> {
  return db.prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first<Category>();
}

export async function createCategory(
  db: D1Database,
  name: string,
  slug: string,
  description: string,
  sortOrder: number,
  allowAnonymous = 0,
  allowPaid = 0,
  allowThanks = 0
): Promise<Category | null> {
  return db
    .prepare('INSERT INTO categories (name, slug, description, sort_order, allow_anonymous, allow_paid, allow_thanks) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(name, slug, description, sortOrder, allowAnonymous ? 1 : 0, allowPaid ? 1 : 0, allowThanks ? 1 : 0)
    .first<Category>();
}

export async function updateCategory(
  db: D1Database,
  id: number,
  updates: Partial<Pick<Category, 'name' | 'slug' | 'description' | 'sort_order' | 'allow_anonymous' | 'is_active'>>
): Promise<void> {
  const sets: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && CATEGORY_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return;

  await db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
}

export async function deleteCategory(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
}

// ============================================================
// 点赞查询
// ============================================================

export async function getLike(
  db: D1Database,
  userId: number,
  targetId: number,
  targetType: 'post' | 'comment'
): Promise<Like | null> {
  return db
    .prepare('SELECT * FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?')
    .bind(userId, targetId, targetType)
    .first<Like>();
}

export async function createLike(
  db: D1Database,
  userId: number,
  targetId: number,
  targetType: 'post' | 'comment'
): Promise<void> {
  const result = await db
    .prepare('INSERT OR IGNORE INTO likes (user_id, target_id, target_type) VALUES (?, ?, ?)')
    .bind(userId, targetId, targetType)
    .run();

  // 只在实际插入（非重复）时才增加计数
  if (result.meta.changes > 0) {
    if (targetType === 'post') {
      await incrementPostLikeCount(db, targetId);
    } else {
      await incrementCommentLikeCount(db, targetId);
    }
  }
}

export async function deleteLike(
  db: D1Database,
  userId: number,
  targetId: number,
  targetType: 'post' | 'comment'
): Promise<void> {
  const result = await db
    .prepare('DELETE FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?')
    .bind(userId, targetId, targetType)
    .run();

  // 只在实际删除（非重复取消/从未点赞）时才递减计数，避免计数被减成负数
  if (result.meta.changes > 0) {
    if (targetType === 'post') {
      await decrementPostLikeCount(db, targetId);
    } else {
      await decrementCommentLikeCount(db, targetId);
    }
  }
}

// ============================================================
// 验证码查询
// ============================================================

export async function createVerification(
  db: D1Database,
  userId: number,
  type: 'email_verify' | 'password_reset' | 'password_change' | 'twofa',
  code: string,
  expiresMinutes: number = 30,
  data: string = ''
): Promise<void> {
  // 标记旧验证码为已使用（每次 request 作废旧码）
  await db
    .prepare("UPDATE verifications SET used = 1 WHERE user_id = ? AND type = ? AND used = 0")
    .bind(userId, type)
    .run();

  await db
    .prepare(
      `INSERT INTO verifications (user_id, type, code, data, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+${expiresMinutes} minutes'))`
    )
    .bind(userId, type, code, data)
    .run();

  // 清理该用户已过期的验证码（已过期 + 已使用）
  try {
    await db.prepare("DELETE FROM verifications WHERE user_id = ? AND (expires_at < datetime('now') OR used = 1) AND id NOT IN (SELECT id FROM verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5)").bind(userId, userId).run();
  } catch {} // 清理失败不影响主流程
}

export async function verifyCode(
  db: D1Database,
  userId: number,
  type: 'email_verify' | 'password_reset' | 'password_change' | 'twofa',
  code: string
): Promise<boolean> {
  // 取该用户该类型最新未使用且未过期的验证码（一次只有一个生效）
  const latest = await db
    .prepare(
      `SELECT id, code, fail_count FROM verifications WHERE user_id = ? AND type = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`
    )
    .bind(userId, type)
    .first<{ id: number; code: string; fail_count: number }>();

  if (!latest) return false;

  // 防爆破：连续 5 次错误即作废该验证码（配合 IP 限流），防止 6 位数字码被暴力猜解
  if ((latest.fail_count || 0) >= 5) {
    await db.prepare('UPDATE verifications SET used = 1 WHERE id = ?').bind(latest.id).run();
    return false;
  }

  if (latest.code !== code) {
    await db.prepare('UPDATE verifications SET fail_count = fail_count + 1 WHERE id = ?').bind(latest.id).run();
    return false;
  }

  // CAS 防重放：旧实现 SELECT（used=0）与 UPDATE used=1 两步之间无原子性，并发携带同一验证码的
  // 双请求都能通过 SELECT 检查、各自 UPDATE 成功（验证码被消费两次 = 重放窗口）。
  // 改为条件更新（CAS）：UPDATE ... WHERE id = ? AND used = 0，D1 单语句原子，
  // 并发双请求只有一个 meta.changes = 1（消费成功），另一个 changes = 0 → 返回 false
  const claim = await db
    .prepare('UPDATE verifications SET used = 1 WHERE id = ? AND used = 0')
    .bind(latest.id)
    .run();

  return claim.meta.changes > 0;
}

// ============================================================
// 系统设置
// ============================================================

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const setting = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<Setting>();
  return setting?.value || null;
}

export async function getAllSettings(db: D1Database): Promise<Record<string, string>> {
  const settings = await db.prepare('SELECT * FROM settings').all<Setting>();
  const result: Record<string, string> = {};
  for (const s of settings.results) {
    result[s.key] = s.value;
  }
  return result;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value)
    .run();
}

// ============================================================
// 浏览统计
// ============================================================

export async function recordPageView(db: D1Database, postId: number, visitorId?: string): Promise<void> {
  // 每个访客每天只计一次浏览
  const today = new Date().toISOString().slice(0, 10);
  const safeVisitorId = visitorId || null;
  // 匿名访客和已登录用户分别去重。
  // visitor_id IS ?：传 NULL 时等价于 IS NULL，传字符串时等价于 =。
  // 用条件插入（INSERT ... SELECT ... WHERE NOT EXISTS）替代「先查后插」，
  // 查重与插入在同一条语句内原子完成，并发请求不会双计。
  // 同一 batch 内语句顺序可见：总浏览计数与 view_count 都只在「本次确实插入新浏览记录」时 +1，
  // 与 COUNT(page_views) 语义一致（物化计数从上线之日起计，存量 page_views 不计入，回填见迁移 073）
  await db.batch([
    db.prepare(`
      INSERT INTO page_views (post_id, visitor_id)
      SELECT ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM page_views WHERE post_id = ? AND visitor_id IS ? AND viewed_at >= ?)
    `).bind(postId, safeVisitorId, postId, safeVisitorId, today),
    // 仅当本次确实插入新浏览记录（同事务内 EXISTS 可见上一语句结果）才 +1 浏览量
    db.prepare(`
      UPDATE posts SET view_count = view_count + 1
      WHERE id = ? AND EXISTS (SELECT 1 FROM page_views WHERE post_id = ? AND visitor_id IS ? AND viewed_at >= ?)
    `).bind(postId, postId, safeVisitorId, today),
    // 总浏览计数物化到 settings（key='total_page_views'，value 为 TEXT）：管理端统计页直接读该值，
    // 避免每次打开统计页对百万行 page_views 做 COUNT(*) 全表扫描。
    // EXISTS 条件与第二条 view_count 更新完全一致（参数同为 postId/safeVisitorId/today），
    // 只有去重后确实新增浏览才 +1；首次自动建行（INSERT 分支），已存在则累加（ON CONFLICT 分支）
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      SELECT 'total_page_views', CAST(COALESCE((SELECT value FROM settings WHERE key = 'total_page_views'), '0') AS INTEGER) + 1, datetime('now')
      WHERE EXISTS (SELECT 1 FROM page_views WHERE post_id = ? AND visitor_id IS ? AND viewed_at >= ?)
      ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now')
    `).bind(postId, safeVisitorId, today),
  ]);
}

// 清理 90 天前的旧浏览记录，控制 page_views 表大小。
// 由 scheduled 每日调用（原 recordPageView 内 1% 概率触发已移除，不再挂在高频浏览路径上偶发全表 DELETE）
export async function cleanupOldPageViews(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM page_views WHERE viewed_at < datetime('now', '-90 days')").run();
}

export async function getPostViewCount(db: D1Database, postId: number): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM page_views WHERE post_id = ?')
    .bind(postId)
    .first<{ count: number }>();
  return result?.count || 0;
}

// ============================================================
// 通知查询
// ============================================================

export async function createNotification(
  db: D1Database,
  userId: number,
  actorId: number | null,
  type: 'reply' | 'like_post' | 'like_comment' | 'system',
  postId?: number,
  commentId?: number,
  content?: string
): Promise<void> {
  // 不给自己的操作发通知
  if (actorId !== null && userId === actorId) return;
  await db
    .prepare(
      'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, content) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(userId, actorId, type, postId || null, commentId || null, content || null)
    .run();
}

export async function getTotalStats(db: D1Database): Promise<{
  totalUsers: number;
  totalPosts: number;
  totalComments: number;
  totalViews: number;
}> {
  // totalViews 改读物化计数（settings key='total_page_views'，由 recordPageView 每次去重新增时 +1），
  // 不再对百万行 page_views 做 COUNT(*) 全表扫描（管理端打开一次统计页烧百万读行）。
  // 物化计数从上线之日起计，存量 page_views 数据不计入——可接受；如需精确回填在 073 迁移中一次性回填（本次不做）
  const [users, posts, comments, views] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM posts WHERE deleted_at IS NULL').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM comments WHERE deleted_at IS NULL').first<{ count: number }>(),
    db.prepare("SELECT value FROM settings WHERE key = 'total_page_views'").first<{ value: string }>(),
  ]);

  return {
    totalUsers: users?.count || 0,
    totalPosts: posts?.count || 0,
    totalComments: comments?.count || 0,
    // settings.value 为 TEXT，parseInt 解析；缺失/非法时兜底 0（首次上线尚无物化计数时统计页显示 0）
    totalViews: parseInt(views?.value || '', 10) || 0,
  };
}

