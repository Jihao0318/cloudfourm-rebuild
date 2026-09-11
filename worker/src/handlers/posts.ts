import { Hono } from 'hono';
import type { Env, JWTPayload, User } from '../types';
import { parseId, validatePostTitle, validateContent } from '../utils/validation';
import { requireAuth, optionalAuth, checkNotBanned } from '../middleware/auth';
import {
  listPosts,
  getPostById,
  getPostOwner,
  postExists,
  createPost as dbCreatePost,
  updatePost as dbUpdatePost,
  hardDeletePost,
  togglePinPost,
  recordPageView,
  getLike,
  getCategoryBySlug,
  getCategoryById,
  createNotification,
} from '../db/queries';
import { canEarnToday, addCoins } from './coins';
import { addExp, markTaskDone, unlockAchievement } from '../utils/game';

const posts = new Hono<{ Bindings: Env }>();

function safeInt(val: string | undefined, defaultVal: number): number {
  if (!val) return defaultVal;
  const n = parseInt(val);
  return isNaN(n) || n < 1 ? defaultVal : n;
}

// 查未使用道具卡（商城卡在 shop_extras→user_lottery_items，抽奖/历史卡可能在 shop_items→user_items，须双表）
// 返回全部未使用卡（供多卡消耗场景，如匿名卡 1/3 张）
async function findUnusedCards(db: D1Database, userId: number, type: string): Promise<{ id: number; src: string }[]> {
  const [shop, lottery] = await Promise.all([
    db
      .prepare('SELECT ui.id, \'shop\' as src FROM user_items ui JOIN shop_items si ON ui.item_id = si.id WHERE ui.user_id = ? AND si.type = ? AND ui.used = 0')
      .bind(userId, type)
      .all<{ id: number; src: string }>(),
    db
      .prepare("SELECT id, 'lottery' as src FROM user_lottery_items WHERE user_id = ? AND item_type = ? AND used = 0")
      .bind(userId, type)
      .all<{ id: number; src: string }>(),
  ]);
  return [...(shop.results || []), ...(lottery.results || [])];
}

// 按来源表标记道具已使用
function markCardUsed(db: D1Database, card: { id: number; src: string }, appliedTo?: number) {
  const table = card.src === 'lottery' ? 'user_lottery_items' : 'user_items';
  return appliedTo
    ? db.prepare(`UPDATE ${table} SET used = 1, applied_to = ? WHERE id = ?`).bind(appliedTo, card.id)
    : db.prepare(`UPDATE ${table} SET used = 1 WHERE id = ?`).bind(card.id);
}

// 分类/付费板块校验（POST 创建与 PUT 编辑共用）：
// 1) 分类存在性；2) announcements 仅限 admin/moderator；3) 设置价格时板块须 allow_paid=1
// categoryId 可选（编辑时未提供则不校验分类本身）；wantsPaid 仅当本次请求实际设置了价格时为 true
// 返回 { error, status } 可直接作为响应；校验通过返回 null
async function validatePostCategory(
  db: D1Database,
  dbUser: User,
  categoryId: number | null | undefined,
  wantsPaid: boolean
): Promise<{ error: string; status: 400 | 403 } | null> {
  if (!categoryId) return null;
  const cat = await getCategoryById(db, categoryId);
  if (!cat) return { error: '分类不存在', status: 400 };
  // 站务公告仅限 admin/moderator 发布/修改（通过 slug 判断）；role 从 dbUser 读（payload 已精简）
  if (dbUser.role === 'user') {
    const ann = await getCategoryBySlug(db, 'announcements');
    if (ann && categoryId === ann.id) return { error: '只有管理员可以发布站务公告', status: 403 };
  }
  // 与 POST 既有写法一致：Category 类型暂缺 allow_paid 字段（见创建路由），此处断言访问
  if (wantsPaid && (cat as any).allow_paid !== 1) return { error: '该板块不支持付费帖子', status: 400 };
  return null;
}

// Feed 列表 — 独立路由，必须登录
posts.get('/feed', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const page = safeInt(c.req.query('page'), 1);
  const pageSize = Math.min(safeInt(c.req.query('pageSize'), 20), 100);
  const sort = (c.req.query('sort') as 'latest' | 'hot' | 'most_viewed') || 'latest';

  const result = await listPosts(c.env.DB, { page, pageSize, sort, feedUserId: user.userId });

  const safeFeedPosts = (result.posts || []).map((p: any) => {
    if (p.price) {
      const content = '__PAID__' + p.price;
      return { ...p, content };
    }
    return p;
  });
  return c.json({"success": true, data: safeFeedPosts, total: result.total, page, pageSize });
});

// 推荐位（原提升卡）：侧边栏展示使用了推荐卡的帖子（进行中，最多 5 条）
posts.get('/featured', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT p.id, p.title, p.bumped_until, p.user_id, p.is_anonymous,
           CASE WHEN p.is_anonymous = 1 THEN '匿名同学' ELSE u.username END AS username
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.deleted_at IS NULL AND p.bumped_until > datetime('now')
    ORDER BY p.bumped_until DESC
    LIMIT 5
  `).all();
  return c.json({
    success: true,
    data: (rows.results || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      username: r.username,
      endsAt: r.bumped_until,
    })),
  });
});

// 帖子列表
posts.get('/', optionalAuth, async (c) => {
  const page = safeInt(c.req.query('page'), 1);
  const pageSize = Math.min(safeInt(c.req.query('pageSize'), 20), 100);
  const rawCat = c.req.query('categoryId');
  const categoryId = rawCat ? safeInt(rawCat, 0) || undefined : undefined;
  const rawUser = c.req.query('userId');
  const userId = rawUser ? safeInt(rawUser, 0) || undefined : undefined;
  const sort = (c.req.query('sort') as 'latest' | 'hot' | 'most_viewed') || 'latest';
  const search = c.req.query('search') || '';
  // 道具选帖等场景显式排除匿名帖（匿名帖不显示任何装饰，使用道具是浪费）
  const excludeAnonymous = c.req.query('exclude_anonymous') === '1';

  const result = await listPosts(c.env.DB, { page, pageSize, categoryId, userId, sort, search: search || undefined, excludeAnonymous, viewerUserId: c.get('user')?.userId });

  // 付费帖子：对列表隐藏实际内容，替换为锁定标记
  const safePosts = (result.posts || []).map((p: any) => {
    if (p.price) {
      const content = '__PAID__' + p.price;
      return { ...p, content };
    }
    return p;
  });
  return c.json({
    success: true,
    data: safePosts,
    total: result.total,
    page,
    pageSize,
  });
});

// 发布帖子
posts.post('/', requireAuth, checkNotBanned, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);

  const { title, content, category_id, price, is_anonymous, red_packet_total, red_packet_count, post_bg_id } = await c.req.json();

  const titleCheck = validatePostTitle(title);
  if (!titleCheck.valid) return c.json({ success: false, error: titleCheck.error }, 400);
  const contentCheck = validateContent(content);
  if (!contentCheck.valid) return c.json({ success: false, error: contentCheck.error }, 400);

  // 板块能力校验：匿名/付费均依赖板块开关（付费在板块不允许时整体拒绝）
  const anonymous = is_anonymous ? 1 : 0;
  const wantsPaid = !!price;
  let anonymousCards: { id: number; src: string }[] | null = null;
  if (anonymous || wantsPaid) {
    const cat = category_id ? await getCategoryById(c.env.DB, category_id) : null;
    if (!cat) return c.json({ success: false, error: '分类不存在' }, 400);
    if (anonymous) {
      // 匿名卡消耗：支持匿名的板块 1 张，不支持匿名的板块 3 张（无卡/不足时拒绝）
      const cost = cat.allow_anonymous === 1 ? 1 : 3;
      const cards = await findUnusedCards(c.env.DB, user.userId, 'item_anonymous_card');
      if (cards.length < cost) {
        return c.json({ success: false, error: `匿名发帖需要 ${cost} 张匿名卡（仓库中可用 ${cards.length} 张）` }, 400);
      }
      anonymousCards = cards.slice(0, cost);
    }
    if (anonymous && wantsPaid) return c.json({ success: false, error: '匿名帖不支持付费' }, 400);
    if (wantsPaid && cat.allow_paid !== 1) return c.json({ success: false, error: '该板块不支持付费帖子' }, 400);
  }

  // 挂红包参数校验 + 红包卡检查（扣款在帖子创建成功后）
  let redPacket = { total: 0, count: 0 };
  let redPacketCard: { id: number; src: string } | null = null;
  if (red_packet_total && red_packet_count) {
    const rpTotal = parseInt(red_packet_total);
    const rpCount = parseInt(red_packet_count);
    if (!rpTotal || rpTotal < 1 || rpTotal > 10000 || !rpCount || rpCount < 1 || rpCount > 100 || rpTotal < rpCount) {
      return c.json({ success: false, error: '红包参数无效（总额1-10000，个数1-100，总额需≥个数）' }, 400);
    }
    redPacketCard = (await findUnusedCards(c.env.DB, user.userId, 'item_red_packet'))[0] || null;
    if (!redPacketCard) return c.json({ success: false, error: '需要积分红包卡' }, 400);
    redPacket = { total: rpTotal, count: rpCount };
  }

  // 帖子背景校验 + 背景卡检查
  let bgId: number | null = null;
  let bgCard: { id: number; src: string } | null = null;
  if (post_bg_id !== undefined && post_bg_id !== null && post_bg_id !== '') {
    const bId = parseInt(post_bg_id);
    if (!bId || bId < 1 || bId > 6) return c.json({ success: false, error: '无效的帖子背景' }, 400);
    bgCard = (await findUnusedCards(c.env.DB, user.userId, 'item_post_bg'))[0] || null;
    if (!bgCard) return c.json({ success: false, error: '需要帖子背景卡' }, 400);
    bgId = bId;
  }

  // 校验付费参数
  const postPrice = price ? Math.max(1, Math.min(99999, parseInt(price) || 0)) : undefined;
  if (price && (!postPrice || postPrice < 1)) {
    return c.json({ success: false, error: '请输入有效的积分金额（1-99999）' }, 400);
  }

  // 分类校验（与 PUT 编辑共用）：分类存在性 + announcements 仅 admin/moderator + 付费板块开关；
  // role 从 dbUser 读（payload 已精简）
  const dbUser = c.get('dbUser') as User;
  const catErr = await validatePostCategory(c.env.DB, dbUser, category_id, wantsPaid);
  if (catErr) return c.json({ success: false, error: catErr.error }, catErr.status);

  const post = await dbCreatePost(c.env.DB, user.userId, title, content, category_id, postPrice, anonymous);
  if (!post) return c.json({ success: false, error: '发布失败' }, 500);

  // 挂红包：帖子创建成功后原子扣款，扣款失败则回滚帖子
  if (redPacketCard) {
    const deduct = await c.env.DB
      .prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ? AND coins >= ?')
      .bind(redPacket.total, redPacket.total, user.userId, redPacket.total)
      .run();
    if (!deduct.meta.changes) {
      await hardDeletePost(c.env.DB, post.id);
      return c.json({ success: false, error: '积分不足' }, 400);
    }
  }

  // 帖子创建后的附属操作：红包落库 + 标记匿名卡/红包卡/背景卡已使用 + 设置背景
  const postStmts: any[] = [];
  if (redPacketCard) {
    postStmts.push(
      c.env.DB.prepare('INSERT INTO red_packets (post_id, user_id, total_coins, remaining_coins, total_packets, remaining_packets) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(post.id, user.userId, redPacket.total, redPacket.total, redPacket.count, redPacket.count),
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'red_packet_pool', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(user.userId, -redPacket.total, '发布红包帖', user.userId),
      markCardUsed(c.env.DB, redPacketCard),
    );
  }
  if (bgCard) {
    postStmts.push(
      c.env.DB.prepare('UPDATE posts SET post_bg_id = ? WHERE id = ?').bind(bgId, post.id),
      markCardUsed(c.env.DB, bgCard, post.id),
    );
  }
  if (anonymousCards) {
    // 消耗对应张数（支持匿名的板块 1 张 / 不支持匿名的板块 3 张）
    for (const card of anonymousCards) {
      postStmts.push(markCardUsed(c.env.DB, card, post.id));
    }
  }
  if (postStmts.length > 0) await c.env.DB.batch(postStmts);

  // 发帖奖励（品类限额 + 每日总积分上限）
  if (await canEarnToday(c.env.DB, user.userId, 'post')) {
    await addCoins(c.env.DB, user.userId, 'post', 10, '发布帖子');
  }

  // 发帖游戏化钩子（失败不影响主流程）
  try {
    await Promise.all([
      addExp(c.env.DB, user.userId, 5),
      markTaskDone(c.env.DB, user.userId, 'post'),
      (async () => {
        // 软删内容不计入发帖成就统计（first_post / posts_100 仅统计未删除帖子）
        const cnt = await c.env.DB.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND deleted_at IS NULL').bind(user.userId).first<{ c: number }>();
        const n = cnt?.c || 0;
        if (n >= 1) await unlockAchievement(c.env.DB, user.userId, 'first_post');
        if (n >= 100) await unlockAchievement(c.env.DB, user.userId, 'posts_100');
      })(),
    ]);
  } catch (e) { console.error('post achievement hook failed', e); }

  // AI 异步审核投递：只投 postId（内容消费侧重读，避免大消息）；
  // 投递失败仅记日志（fail-open：发帖已成功，绝不阻塞响应）；开关判定在消费侧（省一次 settings 读）
  if (c.env.QUEUE) {
    try {
      await c.env.QUEUE.send({ postId: post.id });
    } catch (e) {
      console.error('ai_review.enqueue_failed', e);
    }
  }

  return c.json({ success: true, data: post, message: '发布成功' }, 201);
});

// 抢红包排行榜（公开）：按抢到顺序返回，含手气最佳
posts.get('/:id/red-packet-claims', async (c) => {
  const postId = parseId(c.req.param('id'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);

  const rp = await c.env.DB
    .prepare('SELECT id, total_coins, total_packets FROM red_packets WHERE post_id = ? ORDER BY id DESC LIMIT 1')
    .bind(postId)
    .first<{ id: number; total_coins: number; total_packets: number }>();
  if (!rp) return c.json({ success: true, data: { claims: [], total_coins: 0, total_packets: 0, best: null } });

  const claims = await c.env.DB
    .prepare(`
      SELECT c.user_id, u.username, c.amount, c.created_at
      FROM red_packet_claims c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.red_packet_id = ? AND c.amount > 0
      ORDER BY c.id ASC
    `)
    .bind(rp.id)
    .all<{ user_id: number; username: string | null; amount: number; created_at: string }>();

  const rows = claims.results || [];
  let best: { user_id: number; username: string | null; amount: number } | null = null;
  for (const r of rows) {
    if (!best || r.amount > best.amount) best = { user_id: r.user_id, username: r.username, amount: r.amount };
  }

  return c.json({
    success: true,
    data: { claims: rows, total_coins: rp.total_coins, total_packets: rp.total_packets, best },
  });
});

// 帖子详情
posts.get('/:id', optionalAuth, async (c) => {
  const id = parseId(c.req.param('id'));
  const user: JWTPayload | undefined = c.get('user');
  if (id === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const post = await getPostById(c.env.DB, id);
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);

  // 打回待编辑（rejected）帖：前台仅作者本人可见；管理员除外（始终可见全部）
  if (post.review_status === 'rejected') {
    let viewerRole: string | undefined;
    if (user) {
      const viewer = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(user.userId).first<{ role: string }>();
      viewerRole = viewer?.role;
    }
    if (post.owner_user_id !== user?.userId && viewerRole !== 'admin') {
      return c.json({ success: false, error: '帖子不存在' }, 404);
    }
  }

  // 点赞+收藏并行查（合并 bookmark 请求，省一次 HTTP 往返）

  const [likeResult, bmResult] = await Promise.all([
    user ? getLike(c.env.DB, user.userId, id, 'post') : Promise.resolve(null),
    user ? c.env.DB.prepare('SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?').bind(user.userId, id).first() : Promise.resolve(null),
  ]);
  const liked = !!likeResult;
  const bookmarked = !!bmResult;

  // 浏览记录后台执行，不阻塞响应；举报数需回填 reported 字段，改为同步查询
  c.executionCtx.waitUntil(recordPageView(c.env.DB, id, user?.userId?.toString() || null).catch(() => {}));
  const pendingReport = await c.env.DB
    .prepare("SELECT COUNT(*) as cnt FROM reports WHERE target_id = ? AND target_type = 'post' AND status = 'pending'")
    .bind(id)
    .first<{ cnt: number }>()
    .catch(() => null);
  const reported = (pendingReport?.cnt || 0) > 0;

  // 付费检查：非本人、非管理员时需要已付费
  // 注意：巡查员（moderator）不豁免——和普通用户一样要付费解锁，
  // 否则拥有巡查权限就能免费读全站付费帖，付费经济无法循环（管理员仅用于管理/排障）
  let requires: { type: string; price?: number } | null = null;
  let hiddenContent = post?.content;
  // 用 owner_user_id（未脱敏）判断归属，匿名帖对作者本人仍需可见
  // payload 已不含 role：登录用户实时查一次 DB 角色（optionalAuth 不缓存 dbUser）
  let viewerRole: string | undefined;
  if (user) {
    const viewer = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(user.userId).first<{ role: string }>();
    viewerRole = viewer?.role;
  }
  if (post && post.owner_user_id !== user?.userId && (!user || viewerRole !== 'admin')) {
    if (post.price) {
      const hasPaid = await c.env.DB
        .prepare("SELECT id FROM post_access WHERE post_id = ? AND user_id = ? AND type = 'paid'")
        .bind(id, user?.userId || 0).first();
      if (!hasPaid) {
        requires = { type: 'paid', price: post.price };
        hiddenContent = '__PAID__' + post.price;
      }
    }
  }

  // 对无权限用户隐藏 price 字段
  const safePost = requires ? { ...post, content: hiddenContent, price: undefined } : post;
  // 剥离内部字段 owner_user_id（未脱敏的真实作者ID），防止匿名帖泄露作者身份；
  // 匿名红包帖的 red_packet_owner_id 同样脱敏（红包归属用 is_owner 判断即可）
  const { owner_user_id: _ownerId, red_packet_owner_id: _rpOwnerId, ...safeDetail } = safePost;

  // ponytail: 3次访问 — 每次查看扣1次 views_left，归零后删除
  if (!requires && user && post && post.owner_user_id !== user.userId && post.price) {
    c.executionCtx.waitUntil((async () => {
      // 先减1，如果减后 <=0 则删除（防止并发残留）
      await c.env.DB
        .prepare("UPDATE post_access SET views_left = views_left - 1 WHERE post_id = ? AND user_id = ? AND views_left > 0")
        .bind(id, user.userId).run().catch(() => {});
      await c.env.DB
        .prepare("DELETE FROM post_access WHERE post_id = ? AND user_id = ? AND views_left <= 0")
        .bind(id, user.userId).run().catch(() => {});
    })());
  }

  return c.json({
    success: true,
    data: {
      ...safeDetail,
      is_owner: user ? user.userId === post.owner_user_id : false,
      requires,
      liked,
      bookmarked,
      reported,
      author: post.author_id
        ? {
            id: post.author_id,
            username: post.username,
            avatar_url: post.author_avatar,
            bio: post.author_bio,
            role: post.author_role,
            banned_until: post.author_banned_until,
            vip_tier: post.author_vip_tier,
            nick_theme: post.author_nick_theme,
            title_badge: post.author_title_badge,
            avatar_frame: post.author_avatar_frame,
            avatar_frame_expires_at: post.author_avatar_frame_expires_at,
          }
        : null,
      category: post.category_name
        ? { name: post.category_name, slug: post.category_slug }
        : null,
    },
  });
});

// 编辑帖子
posts.put('/:id', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const { title, content, category_id, price } = await c.req.json();

  const post = await getPostOwner(c.env.DB, id);
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  // 仅作者本人或管理员可编辑；巡查员不可编辑他人帖子（role 从 dbUser 读）
  const dbUser = c.get('dbUser') as User;
  if (post.user_id !== user.userId && dbUser.role !== 'admin') {
    return c.json({ success: false, error: '只能编辑自己的帖子' }, 403);
  }

  if (title) {
    const titleCheck = validatePostTitle(title);
    if (!titleCheck.valid) return c.json({ success: false, error: titleCheck.error }, 400);
  }
  if (content) {
    const contentCheck = validateContent(content);
    if (!contentCheck.valid) return c.json({ success: false, error: contentCheck.error }, 400);
  }

  // 处理价格更新（null/undefined = 不变，0/null = 清除）
  const updatePrice = price !== undefined ? (price ? Math.max(1, Math.min(99999, parseInt(price) || 0)) : null) : undefined;

  // 分类/付费板块校验（仅校验本次提供/生效的字段，保持编辑灵活性）：
  // 分类存在性 + announcements 仅限 admin/moderator + 设价时板块须 allow_paid=1
  // （防止任意用户把帖子改成站务公告、在禁付费板块设价、指向不存在的分类）
  const settingPrice = updatePrice !== undefined && updatePrice !== null;
  let targetCategoryId = category_id ?? undefined;
  if (settingPrice && !targetCategoryId) {
    // 未改分类但设价：按帖子当前所在板块校验付费开关
    const curCat = await c.env.DB.prepare('SELECT category_id FROM posts WHERE id = ?').bind(id).first<{ category_id: number | null }>();
    targetCategoryId = curCat?.category_id ?? undefined;
  }
  const catErr = await validatePostCategory(c.env.DB, dbUser, targetCategoryId, settingPrice);
  if (catErr) return c.json({ success: false, error: catErr.error }, catErr.status);

  await dbUpdatePost(c.env.DB, id, {
    title, content,
    category_id,
    ...(updatePrice !== undefined ? { price: updatePrice } : {}),
  });

  // 打回待编辑（rejected）帖编辑成功 → 重新提交：轮次+1、回 pending、清空标记（票数清零重来）
  const curPost = await c.env.DB
    .prepare("SELECT review_status FROM posts WHERE id = ?")
    .bind(id)
    .first<{ review_status: string }>();
  if (curPost?.review_status === 'rejected') {
    await c.env.DB
      .prepare("UPDATE posts SET review_status = 'pending', review_round = review_round + 1, rejected_at = NULL, flagged_by = NULL, flagged_reason = NULL, violation_count = 0 WHERE id = ?")
      .bind(id)
      .run();
    // 重新提交也走 AI 预筛（与首次发帖同链路）：该帖曾被人工确认违规，重提内容仍需复审；
    // 投递失败仅记日志（fail-open），开关判定在消费侧
    if (c.env.QUEUE) {
      try {
        await c.env.QUEUE.send({ postId: id });
      } catch (e) {
        console.error('ai_review.reenqueue_failed', e);
      }
    }
    return c.json({ success: true, message: '已重新提交，帖子进入待巡查队列' });
  }
  return c.json({ success: true, message: '编辑成功' });
});

// 删除帖子
posts.delete('/:id', requireAuth, checkNotBanned, async (c) => {
  const user: JWTPayload = c.get('user');
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);

  const post = await getPostOwner(c.env.DB, id);
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  // 仅作者本人或管理员可删除；巡查员不能删他人帖子（走举报审核）；role 从 dbUser 读
  const dbUser = c.get('dbUser') as User;
  if (post.user_id !== user.userId && dbUser.role !== 'admin') {
    return c.json({ success: false, error: '只能删除自己的帖子；违规内容请使用举报' }, 403);
  }

  await hardDeletePost(c.env.DB, id);
  return c.json({ success: true, message: '已删除' });
});

// 置顶/取消置顶（仅管理员/巡查员）
posts.put('/:id/pin', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const dbUser = c.get('dbUser') as User;
  if (dbUser.role !== 'admin' && dbUser.role !== 'moderator') {
    return c.json({ success: false, error: '权限不足' }, 403);
  }
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const { is_pinned } = await c.req.json();

  const exists = await postExists(c.env.DB, id);
  if (!exists) return c.json({ success: false, error: '帖子不存在' }, 404);

  await togglePinPost(c.env.DB, id, !!is_pinned);

  // 置顶时通知所有活跃用户（批量插入，不阻塞响应）
  if (is_pinned) {
    const post = await getPostById(c.env.DB, id);
    if (post) {
      const truncatedTitle = post.title?.slice(0, 50) || '公告';
      // D1 线上每请求查询数有硬上限（免费档 50 / 付费档 1000），原实现先 SELECT 最多 500 个用户，
      // 再按 100 条分块 db.batch 逐条 INSERT（约 500 条语句 / 5 次往返），免费档直接超限、付费档占一半配额。
      // 改为单条 INSERT...SELECT 一次往返完成：无匹配行（目标用户均被删/禁）时自然不插入，
      // 等价于原「results.length > 0 才插入」；全参数绑定（?），无注入面。
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const content = `📢 ${truncatedTitle}`;
      await c.env.DB
        .prepare(`
          INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, content, read, created_at)
          SELECT id, ?, 'system', ?, NULL, ?, 0, ?
          FROM users
          WHERE deleted_at IS NULL AND role != 'banned' AND id != ?
          ORDER BY id
          LIMIT 500
        `)
        .bind(user.userId, id, content, now, user.userId)
        .run();
    }
  }

  return c.json({ success: true, message: is_pinned ? '已置顶' : '已取消置顶' });
});


// ─── 付费解锁 ───
posts.post('/:id/unlock', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const { type } = await c.req.json();

  const post = await c.env.DB
    .prepare('SELECT id, user_id, price FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<{ id: number; user_id: number; price: number | null }>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);

  if (type === 'paid') {
    if (!post.price) return c.json({ success: false, error: '此帖子无需付费' }, 400);
    // 抢占解锁资格：INSERT ... ON CONFLICT DO NOTHING 原子幂等，changes=1 才继续扣款。
    // 并发双请求只有第一个能抢到（UNIQUE(post_id,user_id,type)），后到者直接返回「已解锁」，
    // 杜绝「扣款 UPDATE 各自成功、后一个 INSERT 撞唯一约束报 500 且不退款」的双扣问题
    const claim = await c.env.DB
      .prepare("INSERT INTO post_access (post_id, user_id, type, views_left) VALUES (?, ?, 'paid', 3) ON CONFLICT(post_id, user_id, type) DO NOTHING")
      .bind(id, user.userId)
      .run();
    if (!claim.meta.changes) {
      return c.json({ success: false, error: '已解锁，无需重复付费' }, 400);
    }
    // 扣积分（原子守卫：余额不足时 UPDATE 影响 0 行不扣款）
    const result = await c.env.DB
      .prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ? AND coins >= ?')
      .bind(post.price, post.price, user.userId, post.price).run();
    if (!result.meta.changes) {
      // 积分不足：补偿删除刚抢占的 post_access 行，避免白拿解锁资格（下次可正常重试）
      await c.env.DB
        .prepare("DELETE FROM post_access WHERE post_id = ? AND user_id = ? AND type = 'paid'")
        .bind(id, user.userId).run();
      return c.json({ success: false, error: `积分不足，需要 ${post.price} 积分` }, 400);
    }
    // 积分给帖子作者（确保 balance 行存在）
    if (post.user_id !== user.userId) {
      await c.env.DB
        .prepare('INSERT INTO user_balances (user_id, coins, total_earned) VALUES (?, 0, 0) ON CONFLICT(user_id) DO NOTHING')
        .bind(post.user_id).run();
      await c.env.DB
        .prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
        .bind(post.price, post.price, post.user_id).run();
    }
    // 记录交易日志
    const txStmts: any[] = [
      c.env.DB.prepare('INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, ?, ?, coins, ? FROM user_balances WHERE user_id = ?')
        .bind(user.userId, '付费查看', -post.price, `付费查看帖子 #${id}`, user.userId),
    ];
    // 给作者也记录交易流水
    if (post.user_id !== user.userId) {
      txStmts.push(
        c.env.DB.prepare('INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, ?, ?, coins, ? FROM user_balances WHERE user_id = ?')
          .bind(post.user_id, '帖子收入', post.price, `帖子付费收入 #${id}`, post.user_id),
      );
    }
    await c.env.DB.batch(txStmts);
    return c.json({ success: true, message: `已支付 ${post.price} 积分，解锁成功` });
  }

  return c.json({ success: false, error: '无效的解锁类型' }, 400);
});

export default posts;
