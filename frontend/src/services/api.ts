import type { ApiResponse, LoginResponse, Post, Comment, Category, User, PublicUser, PatrolStats } from '../types';

// 开发环境通过 Vite 代理到后端
// 生产环境直接请求 Worker（VITE_API_BASE=https://api.forum.jgp.dpdns.org）
const API_BASE = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_BASE || '') + '/api';

let authToken: string | null = localStorage.getItem('token');
let refreshToken: string | null = localStorage.getItem('refresh_token');

export function setToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

export function getToken(): string | null {
  return authToken;
}

export function setRefreshToken(token: string | null) {
  refreshToken = token;
  if (token) localStorage.setItem('refresh_token', token);
  else localStorage.removeItem('refresh_token');
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

// 并发 401 只触发一次 refresh：模块级 promise，其他请求 await 同一个
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    const data = await res.json();
    if (res.ok && data.success && data.data?.accessToken) {
      setToken(data.data.accessToken);
      if (data.data.refreshToken) setRefreshToken(data.data.refreshToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  isRetry: boolean = false
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Don't set Content-Type for FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // 401 优先于 content-type 检查：会话过期语义不变——刷新/清 token/触发全局登出
  if (res.status === 401) {
    const data = await res.json().catch(() => null);
    if (path.startsWith('/auth/login')) {
      throw new Error(data?.error?.message || data?.error?.code || '账号或密码错误');
    }
    const isAuthPath = path.startsWith('/auth/refresh');
    const canRetry = !isRetry && !isAuthPath && !!getRefreshToken();
    if (canRetry) {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
      }
      if (await refreshPromise) {
        return request<T>(path, options, true);
      }
    }
    setToken(null);
    setRefreshToken(null);
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error(data?.error?.message || data?.error?.code || '登录已过期，请重新登录');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    console.error('Non-JSON response:', res.status, text.slice(0, 200));
    throw new Error(`服务器返回了非 JSON 响应 (${res.status})`);
  }

  const data = await res.json();

  if (!res.ok) {
    // 新后端错误信封：{ success:false, error:{ code, message } }
    throw new Error(data?.error?.message || data?.error?.code || `HTTP ${res.status}`);
  }

  return data;
}

// ===== reshape helpers：把新后端契约字段映射回老页面期望的驼峰/蛇形字段 =====

// PublicUser / User：新 {avatar,banner,title,nickTheme,bio,role,status,experience,level,createdAt}
function reshapeUser(u: any): any {
  if (!u) return u;
  return {
    id: u.id,
    username: u.username,
    avatar_url: u.avatar,
    banner_url: u.banner,
    title: u.title,
    custom_title: u.custom_title ?? u.title,
    custom_title_expires_at: u.custom_title_expires_at,
    nick_theme: u.nickTheme,
    bio: u.bio,
    role: u.role,
    created_at: u.createdAt,
    exp: u.experience,
    level: u.level,
    // 老字段兼容（新契约不返回，默认缺省）
    is_vip: u.is_vip ?? (u.tier && u.tier !== 'none' && !u.is_expired),
    vip_tier: u.is_vip === false ? undefined : (u.tier && u.tier !== 'none' ? u.tier : undefined),
    email: u.email,
    email_verified: u.email_verified,
    banned_until: u.banned_until,
    scheduled_deleted_at: u.scheduled_deleted_at,
    notify_on_reply: u.notify_on_reply,
    notify_on_like: u.notify_on_like,
    title_badge: u.title_badge,
    avatar_frame: u.avatar_frame,
    avatar_frame_expires_at: u.avatar_frame_expires_at,
    ban_reason: u.ban_reason,
    avatar_frame_active: u.avatar_frame_active,
    custom_title_active: u.custom_title_active,
    rainbow_until: u.rainbow_until,
    rainbow_active: u.rainbow_active,
    tierName: u.tierName,
  };
}

// PostListItem / PostDetail → 老 Post 形状
function reshapePost(p: any): any {
  if (!p) return p;
  return {
    id: p.id,
    title: p.title,
    user_id: p.authorId ?? null,
    username: p.authorUsername || '匿名',
    author_avatar: p.authorAvatar,
    category_id: p.categoryId ?? null,
    category: p.category ? { name: p.category.name, slug: p.category.slug } : undefined,
    category_name: p.categoryName,
    is_pinned: p.isPinned ? 1 : 0,
    is_anonymous: p.isAnonymous ? 1 : 0,
    is_owner: p.isOwner,
    view_count: p.viewCount ?? 0,
    like_count: p.likeCount ?? 0,
    comment_count: p.commentCount ?? 0,
    created_at: p.createdAt,
    updated_at: p.updatedAt ?? p.createdAt,
    content: p.content,
    price: p.price,
    requires: (p.isPaid && !p.unlocked) ? { type: 'paid', price: p.price } : undefined,
    unlocked: p.unlocked,
    liked: p.liked ?? false,
    bookmarked: p.bookmarked ?? false,
    isLocked: p.isLocked,
    isBumped: p.isBumped,
    isHighlighted: p.isHighlighted,
    highlighted_until: p.isHighlighted ? p.createdAt : null,
    fortune: p.fortune,
    fortune_expires_at: p.fortune_expires_at,
    post_bg_id: p.post_bg_id ?? null,
    title_effect: p.titleEffect,
    title_effect_expires_at: p.titleEffectExpiresAt,
    bumped_until: p.isBumped ? p.bumpedUntil || p.createdAt : null,
    review_status: p.reviewStatus,
    flagged_reason: p.flaggedReason,
    // 作者元信息（新契约仅 authorUsername/authorAvatar；其余缺失，页面容错）
    author: {
      id: p.authorId,
      username: p.authorUsername,
      avatar_url: p.authorAvatar,
      banned_until: undefined,
      vip_tier: undefined,
      nick_theme: undefined,
      role: undefined,
      avatar_frame: undefined,
      avatar_frame_expires_at: undefined,
      title_badge: undefined,
    },
    author_exp: p.authorExp,
  };
}

function itemOfList(res: any, map: (i: any) => any): ApiResponse<any[]> {
  const d = res?.data;
  return {
    ...res,
    data: Array.isArray(d) ? d.map(map) : ((d?.items || []) as any[]).map(map),
    total: d?.total ?? res?.total,
    page: d?.page ?? res?.page,
    page_size: d?.page_size ?? res?.page_size,
  };
}

// AuthResult → LoginResponse：{user, accessToken, refreshToken}
function reshapeAuthResult(d: any): LoginResponse {
  return {
    token: d.accessToken,
    refresh_token: d.refreshToken,
    user: reshapeUser(d.user),
  };
}

// =========================================================
// Auth
// =========================================================
export const auth = {
  register: (username: string, email: string, password: string, invite_code?: string) =>
    request<LoginResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, inviteCode: invite_code }),
    }).then(res => ({ ...res, data: res.data ? reshapeAuthResult(res.data) : res.data })),

  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account: email, password }),
    }).then(res => ({ ...res, data: res.data ? reshapeAuthResult(res.data) : res.data })),

  // 忘记密码：重置请求（防枚举）
  forgot: (email: string) =>
    request<null>('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ account: email }),
    }),

  // 重置密码：验证码 + 新密码
  reset: (email: string, code: string, new_password: string) =>
    request<null>('/auth/password-reset/verify', {
      method: 'POST',
      body: JSON.stringify({ account: email, code, newPassword: new_password }),
    }),

  me: () => request<User>('/auth/me').then(res => ({ ...res, data: res.data ? reshapeUser(res.data) : res.data })),

  verifyPassword: (password: string) =>
    request<null>('/auth/verify-password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // 修改邮箱第一步：提交新邮箱（新契约不校验旧密码）
  emailRequest: (new_email: string, _password: string) =>
    request<null>('/auth/email/request', {
      method: 'POST',
      body: JSON.stringify({ newEmail: new_email }),
    }),

  // 修改邮箱第二步：验证码 + 新邮箱
  emailVerify: (code: string, newEmail?: string) =>
    request<null>('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ newEmail: newEmail || '', code }),
    }),

  // 修改密码（新流程：旧密码+新密码，直接 PUT）
  passwordRequest: (old_password: string) =>
    request<null>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ oldPassword: old_password, newPassword: '' }),
    }),
  passwordVerify: (_code: string, new_password: string) =>
    request<null>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ oldPassword: '', newPassword: new_password }),
    }),

  verifyEmailRegister: (code: string) =>
    request<null>('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ newEmail: '', code }),
    }),

  resendEmailCode: () =>
    request<null>('/auth/email/resend', { method: 'POST' }),

  resendPasswordCode: () =>
    request<null>('/auth/password/resend', { method: 'POST' }),

  // 改名：新契约走商城改名卡
  changeUsername: (username: string) =>
    request<null>('/coins/shop/use-rename', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  deleteAccount: (_password: string) =>
    request<null>('/auth/account', { method: 'DELETE' }),

  cancelDeletion: () =>
    request<null>('/auth/cancel-deletion', { method: 'POST' }),

  logout: () =>
    request<null>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: getRefreshToken() }),
    }),
};

// 用户邀请码
export const invites = {
  create: () =>
    request<{ code: string }>('/auth/invites', { method: 'POST', body: JSON.stringify({ count: 1 }) }),

  my: () =>
    request<{ codes: { code: string; created_at: string }[]; invited_count: number; total_reward: number }>('/auth/invites'),
};

// =========================================================
// Posts
// =========================================================
export const posts = {
  unlock: (id: number) =>
    request<null>(`/posts/${id}/unlock`, { method: 'POST' }),

  list: (params?: { page?: number; pageSize?: number; categoryId?: number; userId?: number; sort?: string; search?: string; feed?: boolean; excludeAnonymous?: boolean }, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('page_size', String(params.pageSize));
    if (params?.categoryId) query.set('categoryId', String(params.categoryId));
    if (params?.userId) query.set('userId', String(params.userId));
    if (params?.sort) query.set('sort', params.sort);
    if (params?.search) query.set('q', params.search);
    // feed（关注流）已下线：无对应端点，返回空列表
    if (params?.feed) return Promise.resolve<ApiResponse<Post[]>>({ success: true, data: [] });
    return request<Post[]>(`/posts?${query}`, { signal }).then(res => itemOfList(res, reshapePost));
  },

  featured: () =>
    Promise.resolve<ApiResponse<{ id: number; title: string; username: string; endsAt: string }[]>>({ success: true, data: [] }),

  get: (id: number) => request<Post>(`/posts/${id}`).then(res => ({ ...res, data: res.data ? reshapePost(res.data) : res.data })),

  // 抢红包排行榜
  redPacketClaims: (postId: number) =>
    request<any>(`/posts/${postId}/red-packet/claims`)
      .then(res => {
        const d: any = res.data;
        const claims = (d?.claims || []).map((c: any) => ({ user_id: c.userId, username: c.username, amount: c.amount, created_at: c.createdAt }));
        return { ...res, data: {
          claims,
          total_coins: d?.total_coins ?? 0,
          total_packets: d?.total_packets ?? 0,
          best: d?.best ? { user_id: d.best.userId, username: claims.find((c: any) => c.user_id === d.best.userId)?.username ?? null, amount: d.best.amount } : null,
        }};
      }),

  create: (title: string, content: string, categoryId?: number, price?: number, isAnonymous?: boolean | number, _options?: any) =>
    request<Post>('/posts', {
      method: 'POST',
      body: JSON.stringify({ title, content, categoryId, isAnonymous: !!isAnonymous, price }),
    }).then(res => ({ ...res, data: res.data ? reshapePost(res.data) : res.data })),

  update: (id: number, data: { title?: string; content?: string; category_id?: number; price?: number | null }) =>
    request<Post>(`/posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: data.title, content: data.content, categoryId: data.category_id }),
    }).then(res => ({ ...res, data: res.data ? reshapePost(res.data) : res.data })),

  delete: (id: number) =>
    request<null>(`/posts/${id}`, { method: 'DELETE' }),

  togglePin: (id: number, is_pinned: boolean) =>
    request<null>(`/posts/${id}/pin`, {
      method: 'PUT',
      body: JSON.stringify({ pinOrder: is_pinned ? 1 : 0 }),
    }),
};

// =========================================================
// Comments
// =========================================================
function reshapeComment(c: any): Comment {
  return {
    id: c.id,
    post_id: c.postId,
    user_id: c.authorId,
    parent_id: c.parentId,
    content: c.content,
    like_count: c.likeCount ?? 0,
    created_at: c.createdAt,
    liked: c.liked ?? false,
    author: {
      id: c.authorId,
      username: c.authorUsername || '匿名',
      avatar_url: c.authorAvatar,
      role: '',
      vip_tier: undefined,
      nick_theme: undefined,
    } as any,
    children: (c.children || []).map(reshapeComment),
  };
}

export const comments = {
  list: (postId: number, page: number = 1, pageSize: number = 20) =>
    request<any>(`/posts/${postId}/comments?page=${page}&page_size=${pageSize}`).then(res => {
      const d: any = res.data;
      return { ...res, data: (d?.items || []).map(reshapeComment), total: d?.total ?? res.total };
    }),

  create: (postId: number, content: string, parent_id?: number) =>
    request<Comment>(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, parentId: parent_id }),
    }).then(res => ({ ...res, data: res.data ? reshapeComment(res.data) : res.data })),

  update: (id: number, content: string) =>
    request<null>(`/comments/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  delete: (id: number) =>
    request<null>(`/comments/${id}`, { method: 'DELETE' }),
};

// =========================================================
// Categories
// =========================================================
function reshapeCategory(c: any): Category {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug ?? '',
    description: c.description ?? '',
    sort_order: c.sortOrder ?? 0,
    allow_anonymous: c.allowAnonymous ? 1 : 0,
    is_active: c.isActive !== undefined ? (c.isActive ? 1 : 0) : 1,
    allow_paid: c.allowPaid ? 1 : 0,
    allow_thanks: c.allowThanks ? 1 : 0,
  };
}

export const categories = {
  list: (_includeInactive?: boolean) =>
    request<Category[]>('/categories').then(res => ({ ...res, data: (res.data || []).map(reshapeCategory) })),

  create: (name: string, slug: string, description?: string, _sort_order?: number, _allowAnonymous?: number, _isActive?: number, _allowPaid?: number, _allowThanks?: number) =>
    request<Category>('/categories', {
      method: 'POST',
      body: JSON.stringify({ name, slug, description: description || '', sortOrder: 0, allowPaid: !!_allowPaid, allowThanks: !!_allowThanks }),
    }),

  update: (id: number, data: any) =>
    request<null>(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: data.name, slug: data.slug, description: data.description, sortOrder: data.sort_order, allowPaid: !!data.allow_paid, allowThanks: !!data.allow_thanks, isActive: data.is_active !== 0 }),
    }),

  delete: (id: number) =>
    request<null>(`/categories/${id}`, { method: 'DELETE' }),
};

// =========================================================
// Likes
// =========================================================
export const likes = {
  toggle: async (target_id: number, target_type: 'post' | 'comment', liked: boolean) => {
    if (liked) {
      return request<null>('/likes', {
        method: 'DELETE',
        body: JSON.stringify({ target_id, target_type }),
      });
    }
    return request<null>('/likes', {
      method: 'POST',
      body: JSON.stringify({ target_id, target_type }),
    });
  },
};

// =========================================================
// Upload
// =========================================================
export const upload = {
  image: async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return request<{ url: string; filename: string }>('/upload/image', {
      method: 'POST',
      body: formData,
    });
  },
};

// =========================================================
// Users
// =========================================================
export const users = {
  getProfile: (id: number) => request<PublicUser>(`/users/${id}/profile`).then(res => ({ ...res, data: res.data ? reshapeUser(res.data) : res.data })),

  updateProfile: (data: { username?: string; bio?: string }) =>
    request<null>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify({ bio: data.bio }),
    }),

  updateAvatar: (avatar_url: string) =>
    request<null>('/users/avatar', {
      method: 'PUT',
      body: JSON.stringify({ avatar: avatar_url }),
    }),

  updateBanner: (banner_url: string) =>
    request<null>('/users/banner', {
      method: 'PUT',
      body: JSON.stringify({ banner: banner_url }),
    }),

  updateTitle: (title: string) =>
    request<{ custom_title: string }>('/users/title', {
      method: 'PUT',
      body: JSON.stringify({ title }),
    }),

  updateNickTheme: (theme: string) =>
    request<{ nick_theme: string }>('/users/nick-theme', {
      method: 'PUT',
      body: JSON.stringify({ theme }),
    }),

  updateNotifySettings: (data: { notify_on_reply?: boolean; notify_on_like?: boolean }) =>
    request<null>('/users/notify-settings', {
      method: 'PUT',
      body: JSON.stringify({ reply: data.notify_on_reply, like: data.notify_on_like, system: data.notify_on_like ?? false }),
    }),

  search: (q: string) =>
    request<{ id: number; username: string; avatar_url: string }[]>(`/users/search?q=${encodeURIComponent(q)}`)
      .then(res => itemOfList(res, (u: any) => ({ id: u.id, username: u.username, avatar_url: u.avatar }))),
};

// =========================================================
// Admin
// =========================================================
export const admin = {
  verifyAdmin: () => request<{ is_admin: boolean; role: string }>('/auth/me').then(res => {
    const u = res.data;
    return { ...res, data: { is_admin: u?.role === 'admin', role: u?.role || 'user' } };
  }),

  listUsers: (page?: number, search?: string) =>
    request<any[]>(`/admin/users?page=${page || 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`)
      .then(res => itemOfList(res, (u: any) => ({
        id: u.id, username: u.username, email: u.email, role: u.role, status: u.status,
        avatar: u.avatar, created_at: u.created_at, deleted_at: u.deleted_at,
        banned_until: u.banned_until, ban_reason: u.ban_reason, token_version: u.token_version,
      }))),

  updateUserRole: (userId: number, role: string) =>
    request<null>(`/admin/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),

  getSettings: () => request<Record<string, string>>('/admin/settings'),

  updateSettings: (settings: Record<string, string>) =>
    request<null>('/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  getStats: () =>
    request<{ totalUsers: number; totalPosts: number; totalComments: number; totalViews: number }>('/admin/stats'),

  listPinned: () => request<any[]>('/admin/pinned'),

  unpinPost: (id: number) =>
    request<null>(`/admin/pinned/${id}`, { method: 'PUT', body: JSON.stringify({ pinned: false }) }),

  reorderPinned: (id: number, direction: 'up' | 'down') =>
    request<null>(`/admin/pinned/${id}/reorder`, { method: 'PUT', body: JSON.stringify({ order: direction === 'up' ? 1 : -1 }) }),

  banUser: (userId: number, duration: number, unit: 'hours' | 'days', reason?: string) =>
    request<null>(`/admin/users/${userId}/ban`, { method: 'PUT', body: JSON.stringify({ duration, unit, reason }) }),

  unbanUser: (userId: number) =>
    request<null>(`/admin/users/${userId}/ban`, { method: 'DELETE' }),

  setUsername: (userId: number, username: string) =>
    request<null>(`/admin/users/${userId}/username`, { method: 'PUT', body: JSON.stringify({ username }) }),

  deleteUser: (userId: number, confirm: number) =>
    request<null>(`/admin/users/${userId}`, { method: 'DELETE', body: JSON.stringify({ confirm }) }),

  // 积分管理（新后端无 admin 端接口，见报告）
  listCoins: (_page?: number) =>
    Promise.resolve({ success: true, data: [] as any[], total: 0 }),
  adjustCoins: (_user_id: number, _amount: number, _reason?: string) =>
    Promise.resolve<ApiResponse<null>>({ success: true, data: null, message: '' }),

  // VIP 管理（新后端无 admin 端接口，见报告）
  listVips: (_page?: number, _search?: string) =>
    Promise.resolve({ success: true, data: [] as any[], total: 0 }),
  setVip: (_userId: number, _tier: string, _days: number) =>
    Promise.resolve<ApiResponse<null>>({ success: true, data: null, message: '' }),
  deleteVip: (_userId: number) =>
    Promise.resolve<ApiResponse<null>>({ success: true, data: null, message: '' }),

  listPosts: (page?: number, search?: string) =>
    request<any[]>(`/admin/posts?page=${page || 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(res => itemOfList(res, (x: any) => x)),
  deletePost: (id: number) =>
    request<null>(`/admin/posts/${id}`, { method: 'DELETE' }),
  restorePost: (id: number) =>
    request<null>(`/admin/posts/${id}/restore`, { method: 'PUT' }),
  lockPost: (id: number, is_locked: boolean) =>
    request<null>(`/admin/posts/${id}/lock`, { method: 'PUT', body: JSON.stringify({ locked: is_locked }) }),

  listComments: (page?: number, search?: string) =>
    request<any[]>(`/admin/comments?page=${page || 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(res => itemOfList(res, (x: any) => x)),
  deleteComment: (id: number) =>
    request<null>(`/admin/comments/${id}`, { method: 'DELETE' }),

  searchUsers: (q: string) =>
    request<any[]>(`/admin/users/search?q=${encodeURIComponent(q)}`).then(res => ({ ...res, data: res.data || [] })),

  getStatsDetail: () =>
    request<any>('/admin/stats/detail').then(res => {
      const d: any = res.data;
      return { ...res, data: {
        today: { users: d?.today_users ?? 0, posts: d?.today_posts ?? 0, comments: d?.today_comments ?? 0 },
        categories: d?.categories || [],
        topUsers: (d?.coins_top || []).map((c: any) => ({ id: c.userId, user_id: c.userId, username: c.username, coins: c.coins })),
      }};
    }),

  // 举报管理（新后端无 admin 端接口，见报告）
  listReports: (_page?: number) =>
    Promise.resolve({ success: true, data: [] as any[], total: 0, limit: 3, passLimit: 3 }),
  reviewReport: (_id: number, _action: 'confirm' | 'pass') =>
    Promise.resolve<ApiResponse<null>>({ success: true, data: null, message: '已处理' }),
  resolveReport: (_id: number) => Promise.resolve<ApiResponse<null>>({ success: true, data: null, message: '' }),
  dismissReport: (_id: number) => Promise.resolve<ApiResponse<null>>({ success: true, data: null, message: '' }),

  listInvites: () => request<any[]>('/admin/invites').then(res => itemOfList(res, (x: any) => x)),
  createInvite: () => request<{ code: string }>('/admin/invites', { method: 'POST', body: JSON.stringify({ count: 1 }) }),
  deleteInvite: (code: string) =>
    request<null>(`/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  resetPassword: (userId: number) =>
    request<{ temporary_password: string }>(`/admin/users/${userId}/reset-password`, { method: 'PUT' }),

  securityLogs: (page?: number) =>
    request<any[]>(`/admin/security-logs?page=${page || 1}`).then(res => itemOfList(res, (x: any) => x)),

  // 解封申请审核（新：/admin/unban-requests + /unban/{id}/decide）
  unbanRequests: (page?: number) =>
    request<any[]>(`/admin/unban-requests?status=pending&page=${page || 1}`).then(res => itemOfList(res, (x: any) => x)),
  approveUnban: (id: number) =>
    request<null>(`/unban/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve: true }) }),
  rejectUnban: (id: number, reason?: string) =>
    request<null>(`/unban/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve: false, note: reason }) }),

  // 抽奖配置
  lottery: () => request<any>('/admin/lottery'),
  updateLotteryConfig: (config: Record<string, number>) =>
    request<null>('/admin/lottery', { method: 'PUT', body: JSON.stringify(config) }),
  createLotteryPrize: (data: { name: string; emoji?: string; type: string; value?: string; weight: number; rarity: string }) =>
    request<null>('/admin/lottery/prizes', { method: 'POST', body: JSON.stringify(data) }),
  updateLotteryPrize: (id: number, data: Record<string, any>) =>
    request<null>(`/admin/lottery/prizes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLotteryPrize: (id: number) =>
    request<null>(`/admin/lottery/prizes/${id}`, { method: 'DELETE' }),
};

// =========================================================
// 签到（新：/coins/check-in）
// =========================================================
export const checkIn = {
  // 新契约无独立「今日」端点，从 stats 派生
  today: async (date?: string): Promise<ApiResponse<{ checked_in: boolean; streak: number; coins_earned: number }>> => {
    const res = await request<{ total_days: number; month_days: number; current_streak: number; month_dates: string[] }>('/coins/check-in/stats');
    if (!res.success) return { success: false, error: res.error };
    const d = res.data;
    return { success: true, data: { checked_in: date ? (d?.month_dates || []).includes(date) : false, streak: d?.current_streak ?? 0, coins_earned: 0 } };
  },
  do: (date?: string) =>
    request<any>('/coins/check-in', {
      method: 'POST',
      body: JSON.stringify({}),
    }).then(res => ({ ...res, data: res.data ? { streak: res.data.streak, coins_earned: res.data.reward ?? res.data.coins_earned ?? 0, message: '签到成功', base_reward: res.data.base_reward, vip_bonus: res.data.vip_bonus } : res.data })),
  stats: (date?: string) =>
    request<{ total_days: number; month_days: number; current_streak: number; month_dates: string[] }>(`/coins/check-in/stats${date ? `?month=${date.slice(0, 7)}` : ''}`),
};

// =========================================================
// Coins
// =========================================================
export const coins = {
  balance: () =>
    request<{ coins: number; total_earned: number; total_spent: number }>('/coins/balance')
      .then(res => ({ ...res, data: res.data ? { coins: res.data.coins ?? 0, total_earned: 0, total_spent: 0 } : res.data })),
  todayEarnings: () =>
    request<{ today_total: number; daily_max: number; details: { type: string; amount: number; count: number }[] }>('/coins/today-earnings')
      .then(res => ({ ...res, data: res.data ? { today_total: res.data.today_total ?? 0, daily_max: res.data.daily_max ?? 0, details: (res.data.details || []).map((x: any) => ({ type: x.type, amount: x.sum, count: x.count })) } : res.data })),
  transactions: (page?: number) =>
    request<any[]>(`/coins/transactions?page=${page || 1}`)
      .then(res => ({ ...res, data: ((res.data as any)?.items || []).map((t: any) => ({ id: t.id, type: t.type, amount: t.amount, created_at: t.createdAt, other_username: t.otherUsername, balance_after: t.balanceAfter, description: t.description })) })),
  transfer: (to_user_id: number, amount: number) =>
    request<null>('/coins/transfer', { method: 'POST', body: JSON.stringify({ to_user_id, amount }) }),
};

// =========================================================
// VIP（新：/coins/vip/*）
// =========================================================
export interface VipPlan {
  tier: string;
  label: string;
  price: number;
  upload_limit: number;
  check_in_bonus: number;
  transfer_fee: number;
}

const VIP_LABEL: Record<string, string> = { vip: 'VIP', 's-vip': 'S VIP', 'svip+': 'S VIP+', none: '' };

const vipPlansLocal: VipPlan[] = [
  { tier: 'vip', label: 'VIP', price: 300, upload_limit: 0, check_in_bonus: 2, transfer_fee: 10 },
  { tier: 's-vip', label: 'S VIP', price: 800, upload_limit: 0, check_in_bonus: 3, transfer_fee: 5 },
  { tier: 'svip+', label: 'S VIP+', price: 2800, upload_limit: 0, check_in_bonus: 5, transfer_fee: 2 },
];

export const vip = {
  // /vip/plans 已下线：返回本地常量（页面消费）
  plans: () => Promise.resolve({ success: true, data: vipPlansLocal }),
  status: () =>
    request<any>('/coins/vip/status')
      .then(res => {
        const d = res.data;
        return { ...res, data: d ? { is_vip: d.tier !== 'none' && !d.is_expired, tier: d.tier, expires_at: d.expires_at, expired: d.is_expired, label: VIP_LABEL[d.tier] || '' } : d };
      }),
  purchase: (tier: string) =>
    request<any>('/coins/vip/purchase', { method: 'POST', body: JSON.stringify({ tier }) })
      .then(res => ({ ...res, data: res.data, message: res.data?.tier ? '购买成功' : undefined })),
};

// =========================================================
// Reports / Stats
// =========================================================
export const reports = {
  create: (target_type: 'post' | 'comment', target_id: number, reason: string) =>
    request<null>('/reports', {
      method: 'POST',
      body: JSON.stringify({ target_type, target_id, reason }),
    }),
};

export const stats = {
  recordView: (postId: number) =>
    request<null>(`/stats/view/${postId}`, { method: 'POST' }),
};

// 公开站点设置
export const site = {
  announcement: () => request<{ announcement: string; announcement_updated_at: string }>('/settings/public'),
};

// =========================================================
// Notifications
// =========================================================
export interface NotificationItem {
  id: number;
  user_id: number;
  actor_id: number | null;
  type: 'reply' | 'like_post' | 'like_comment' | 'post_takedown' | 'post_rejected' | 'system' | 'comment' | 'follow';
  post_id: number | null;
  comment_id: number | null;
  content: string | null;
  read: number;
  created_at: string;
  actor_name?: string;
  actor_avatar?: string;
}

function reshapeNotification(n: any): NotificationItem {
  return {
    id: n.id,
    user_id: n.userId,
    actor_id: n.actorId ?? null,
    type: n.type,
    post_id: n.postId ?? null,
    comment_id: n.commentId ?? null,
    content: n.content ?? null,
    read: n.read ? 1 : 0,
    created_at: n.createdAt,
    actor_name: n.actorUsername,
    actor_avatar: n.actorAvatar,
  };
}

export const notifications = {
  list: (page: number = 1) =>
    request<NotificationItem[]>(`/notifications?page=${page}`)
      .then(res => ({ ...res, data: (((res.data as any)?.items || []) as any[]).map(reshapeNotification), total: (res.data as any)?.total, unread: (res.data as any)?.unread })),

  markRead: (id: number) =>
    request<null>(`/notifications/${id}/read`, { method: 'PUT' }),

  markAllRead: () =>
    request<null>('/notifications/read-all', { method: 'PUT' }),

  unreadCount: () =>
    request<{ unread: number }>('/notifications/unread-count'),

  clearDelivered: (maxId?: number) =>
    request<null>(`/notifications/delivered${maxId !== undefined ? `?maxId=${maxId}` : ''}`, { method: 'DELETE' }),
};

// =========================================================
// Follows / Bookmarks
// =========================================================
export const follows = {
  toggle: (userId: number) =>
    request<{ following: boolean }>(`/follows/${userId}`, { method: 'POST' }),

  check: (userId: number) =>
    request<{ following: boolean }>(`/follows/check/${userId}`),

  getFollowing: (userId: number, page?: number) =>
    request<any[]>(`/follows/${userId}/following?page=${page || 1}`).then(res => res),
  getFollowers: (userId: number, page?: number) =>
    request<any[]>(`/follows/${userId}/followers?page=${page || 1}`).then(res => res),

  getCounts: (userId: number) =>
    request<any>(`/follows/counts/${userId}`)
      .then(res => ({ ...res, data: res.data ? { following: res.data.followingCount, followers: res.data.followerCount } : res.data })),
};

export const bookmarks = {
  toggle: (postId: number) =>
    request<{ bookmarked: boolean }>('/bookmarks/toggle', {
      method: 'POST',
      body: JSON.stringify({ post_id: postId }),
    }),

  check: (postId: number) =>
    request<{ bookmarked: boolean }>(`/bookmarks/check/${postId}`),

  list: (page: number = 1) =>
    request<any[]>(`/bookmarks?page=${page}`).then(res => itemOfList(res, reshapePost)),
};

// =========================================================
// 商城 / 道具 / 抽奖
// =========================================================
export const shop = {
  items: () =>
    request<any[]>('/coins/shop').then(res => ({ ...res, data: (res.data || []).map((i: any) => ({ id: i.id, name: i.name, type: i.type, price: i.price, data: i.data, rarity: i.rarity })) })),
  buy: (itemId: number) =>
    request<any>('/coins/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: itemId }) }),
  useRename: (new_username: string) =>
    request<any>('/coins/shop/use-rename', { method: 'POST', body: JSON.stringify({ username: new_username }) }),
  myItems: () =>
    request<any[]>('/coins/shop/my-items').then(res => ({ ...res, data: (res.data || []).map((i: any) => ({ id: i.item_id, item_id: i.item_id, kind: i.type === 'vip_ticket' ? 'vip_ticket' : '', rarity: i.rarity, used: 0, applied_to: null, created_at: i.expires_at || '', name: i.name, type: i.type, data: i.data })) })),
};

export const tips = {
  send: (target_type: 'post' | 'comment', target_id: number, amount: number) =>
    request<null>('/tips', {
      method: 'POST',
      body: JSON.stringify({ target_type, target_id, amount }),
    }),
};

// 抽奖（新：/coins/lottery/draw body {times:1|10}）
export interface LotteryStatus {
  draw_cost: number;
  draw10_cost: number;
  balance: number;
  prizes: {
    id: number;
    name: string;
    emoji: string;
    type: string;
    value: string;
    rarity: string;
    weight: number;
  }[];
  pity: {
    pulls_since_ssr: number;
    total_pulls: number;
    ssr_chance: number;
    to_soft_pity: number;
    to_hard_pity: number;
  };
}

export interface LotteryDrawResult {
  items: { id: number; name: string; emoji: string; rarity: string; coins: number }[];
  summary: { total_coins_gain: number; item_count: number; vip_granted: boolean; has_ssr: boolean; has_announce: boolean };
  cost: number;
}

function reshapeDraw(data: any): LotteryDrawResult {
  const items = (data?.results || []).map((r: any) => ({
    id: r.prizeId ?? 0,
    name: r.prizeName,
    emoji: r.prizeEmoji || '🎁',
    rarity: r.rarity,
    coins: r.amount,
    value: String(r.amount),
    type: r.prizeType,
  }));
  return {
    items,
    summary: {
      total_coins_gain: items.reduce((s: number, i: any) => s + (i.coins || 0), 0),
      item_count: items.filter((i: any) => i.type && i.type !== 'coins').length,
      vip_granted: items.some((i: any) => i.type === 'vip_ticket'),
      has_ssr: items.some((i: any) => i.rarity === 'SSR'),
      has_announce: items.some((i: any) => i.type === 'announce'),
    },
    cost: data?.costs ?? 0,
  };
}

export const lotteryCoins = {
  // /lottery-coins/status 已下线：价格用本地常量，余额从 /coins/balance 取
  status: async (): Promise<ApiResponse<LotteryStatus>> => {
    const data: LotteryStatus = {
      draw_cost: 40, draw10_cost: 360, balance: 0,
      prizes: [], pity: { pulls_since_ssr: 0, total_pulls: 0, ssr_chance: 5, to_soft_pity: 50, to_hard_pity: 80 },
    };
    try {
      const bal = await coins.balance();
      data.balance = bal.data?.coins ?? 0;
    } catch { /* 忽略余额失败 */ }
    return { success: true, data };
  },
  draw: () =>
    request<LotteryDrawResult>('/coins/lottery/draw', { method: 'POST', body: JSON.stringify({ times: 1 }) })
      .then(res => ({ ...res, data: reshapeDraw(res.data) })),
  draw10: () =>
    request<LotteryDrawResult>('/coins/lottery/draw', { method: 'POST', body: JSON.stringify({ times: 10 }) })
      .then(res => ({ ...res, data: reshapeDraw(res.data) })),
};

export const leaderboardApi = {
  coins: (_page?: number) =>
    request<any>('/coins/leaderboard?limit=20').then(res => {
      const d = res.data;
      return { ...res, data: (d?.items || []).map((u: any) => ({ id: u.userId, user_id: u.userId, username: u.username, coins: u.coins, rank: u.rank, avatar_url: null })) };
    }),
};

export const unban = {
  request: () => request<null>('/unban/request', { method: 'POST' }),
  myRequest: () => request<any>('/unban/my-request'),
};

// =========================================================
// 感谢
// =========================================================
export const thanksApi = {
  send: (target_type: 'post' | 'comment', target_id: number) =>
    request<null>('/thanks', {
      method: 'POST',
      body: JSON.stringify({ target_type, target_id }),
    }),
};

// =========================================================
// 巡查 / 申诉
// =========================================================
export const moderation = {
  reviewPosts: (queue: 'pending' | 'flagged') =>
    request<any[]>(`/moderation/review-posts?queue=${queue}&page_size=50`).then(res => itemOfList(res, (x: any) => x)),
  reviewPost: (post_id: number, action: string, reason?: string) =>
    request<null>('/moderation/review-posts/' + post_id + '/vote', {
      method: 'POST',
      body: JSON.stringify({ vote: action }),
    }),
  patrolStats: () =>
    request<any>('/moderation/stats').then(res => {
      const d = res.data;
      return { ...res, data: d ? {
        level: d.level, tierName: d.tier_name, exp: d.exp, expInLevel: d.exp_in_level,
        expNeededForLevel: d.exp_needed_for_level, totalReviews: d.total_reviews ?? d.reviews_done ?? 0,
        totalPasses: d.correct ?? 0, totalQuestions: 0, totalViolations: 0, totalConfirms: 0,
        totalClears: 0, totalTakedowns: 0, todayCount: 0, unlocked: [],
      } : d };
    }),
};

// =========================================================
// 道具系统
// =========================================================
export const items = {
  myItems: () => shop.myItems(),
  use: (type: string, itemId?: number, payload?: any) => {
    // VIP 体验券走单独兑换端点
    if (type === 'vip-ticket') {
      return request<any>('/coins/items/redeem-vip', { method: 'POST', body: JSON.stringify({ ticket_id: itemId }) })
        .then(res => ({ ...res, data: res.data, message: res.data?.tier ? 'VIP 已激活' : undefined }));
    }
    const body: Record<string, any> = { item_type: type };
    if (itemId) body.post_id = itemId;
    if (payload) {
      if (payload.value !== undefined) body.value = payload.value;
      if (payload.content !== undefined) body.content = payload.content;
      if (payload.frame !== undefined) body.value = payload.frame;
      if (payload.bg_id !== undefined) body.value = payload.bg_id;
      if (payload.badge !== undefined) body.value = payload.badge;
      if (payload.title !== undefined) body.value = payload.title;
    }
    return request<any>('/coins/items/use', { method: 'POST', body: JSON.stringify(body) });
  },
  recycleBatch: (ids: number[]) =>
    request<any>('/coins/items/recycle', { method: 'POST', body: JSON.stringify({ items: ids.map(id => ({ item_id: id, quantity: 1 })) }) }),
  activeEffects: () =>
    request<any>('/coins/items/effects').then(res => {
      const d = res.data;
      const list: any[] = [];
      if (d?.rainbow_active && d.rainbow_until) {
        list.push({ id: 'rainbow', type: 'rainbow_title', label: '炫彩标题', postId: null, postTitle: null, expiresAt: d.rainbow_until, cancellable: false });
      }
      if (d?.custom_title_active && d.custom_title) {
        list.push({ id: 'custom_title', type: 'custom_title', label: d.custom_title, postId: null, postTitle: null, expiresAt: d.custom_title_expires_at, cancellable: false });
      }
      return { ...res, data: list };
    }),
  redPackets: () =>
    request<any[]>('/coins/shop/my-items').then(res => ({ ...res, data: (res.data || []) })),

  // 取消效果：红包取消防 /posts/{id}/red-packet/cancel；其余无摘除端点（前端本地管理）
  cancelEffect: (effectId: string) => {
    if (typeof effectId === 'string' && effectId.startsWith('rp_')) {
      const pid = parseInt(effectId.slice(3));
      if (!isNaN(pid)) {
        return request<any>(`/posts/${pid}/red-packet/cancel`, { method: 'POST' }).then(res => ({ ...res, message: res.data?.refunded ? `已退款 ${res.data.refunded} 积分` : undefined }));
      }
    }
    return Promise.resolve<ApiResponse<any>>({ success: true, data: null, message: '已取消' });
  },
  // 装饰佩戴（已下线）
  decoration: () => Promise.resolve<ApiResponse<any>>({ success: true, data: { equipped: { titleBadge: null, avatarFrame: null, customTitle: null }, ownedTitles: [], ownedFrames: [] }, message: '' }),
  equipTitleBadge: (_title: string) => Promise.resolve<ApiResponse<any>>({ success: true, data: null, message: '功能已下线' }),
  equipAvatarFrame: (_frame: string) => Promise.resolve<ApiResponse<any>>({ success: true, data: null, message: '功能已下线' }),
};

// =========================================================
// 申诉
// =========================================================
export const appeals = {
  access: () =>
    request<{ allowed: boolean; level: number; requiredLevel: number; isAdmin: boolean }>('/appeals/access'),
  submit: (post_id: number, reason: string) =>
    request<null>('/appeals', { method: 'POST', body: JSON.stringify({ post_id, reason }) }),
  pendingList: (page?: number) =>
    request<any[]>(`/appeals/pending?page=${page || 1}&page_size=20`).then(res => itemOfList(res, (x: any) => x)),
  decide: (id: number, action: 'approve' | 'reject') =>
    request<any>(`/appeals/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve: action === 'approve', note: action === 'reject' ? '维持下架' : '' }) })
      .then(res => ({ ...res, message: res.data?.message })),
  info: (post_id: number) =>
    request<{ post_id: number; title: string; deleted: boolean; appeal: any }>(`/appeals/post/${post_id}`),
};
