import type { ApiResponse, LoginResponse, Post, Comment, Category, User, PublicUser, TaskItem, AchievementInfo, AchievementHall, AchievementUnlocker, PatrolStats, DecorationData } from '../types';

// 开发环境通过 Vite 代理到 localhost:8787
// 生产环境直接请求 Worker：VITE_API_BASE 为后端地址（当前 = https://apiforum.jgp.dpdns.org，CF 优选路由）
// 多源回退架构已移至 multi-source-fallback 分支备用
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
      body: JSON.stringify({ refresh_token: rt }),
    });
    const data = await res.json();
    if (res.ok && data.success && data.data?.token) {
      setToken(data.data.token);
      if (data.data.refresh_token) setRefreshToken(data.data.refresh_token);
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

  // 401 优先于 content-type 检查：服务端 401 可能返回非 JSON body（网关/Worker 错误页），
  // 但会话过期语义不变——刷新/清 token/触发全局登出流程必须照常执行
  if (res.status === 401) {
    const data = await res.json().catch(() => null);
    // 登录接口自身的 401（账号或密码错误）不代表会话过期，直接抛错不触发全局登出
    if (path.startsWith('/auth/login')) {
      throw new Error(data?.error || '账号或密码错误');
    }
    // token 过期：先用 refresh_token 换新 token 并重试一次（刷新接口本身除外）
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
    // refresh 失败或重试仍 401：清除 token，触发全局事件
    setToken(null);
    setRefreshToken(null);
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error(data?.error || '登录已过期，请重新登录');
  }

  // 检查响应是否为 JSON，否则给出更明确的错误
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    console.error('Non-JSON response:', res.status, text.slice(0, 200));
    throw new Error(`服务器返回了非 JSON 响应 (${res.status})，请检查 Worker 是否已部署且 WORKER_URL 配置正确`);
  }

  const data = await res.json();

  // 非 2xx 统一抛错：优先取服务端 error 文案，缺失时回退 HTTP 状态码；
  // err.data 挂响应体的业务数据字段（data），与成功路径 res.data 的取值层级一致
  // （登录被责令/被拦等引导流程需要 body.data 里的凭证字段）
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`) as Error & { data?: unknown };
    err.data = data.data;
    throw err;
  }

  return data;
}

// Auth
export const auth = {
  register: (username: string, email: string, password: string, invite_code?: string) =>
    request<LoginResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, invite_code }),
    }),

  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  // 忘记密码：发送验证码邮件（后端统一响应防枚举）
  forgot: (email: string) =>
    request<null>('/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  // 重置密码：验证码 + 新密码
  reset: (email: string, code: string, new_password: string) =>
    request<null>('/auth/reset', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password }),
    }),

  me: () => request<User>('/auth/me'),

  verifyPassword: (password: string) =>
    request<null>('/auth/verify-password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // 修改邮箱两步验证：第一步提交新邮箱+当前密码，服务端向新邮箱发验证码
  emailRequest: (new_email: string, password: string) =>
    request<null>('/auth/email/request', {
      method: 'POST',
      body: JSON.stringify({ new_email, password }),
    }),

  // 修改邮箱两步验证：第二步提交验证码（成功后服务端踢掉全部会话，需重新登录）
  emailVerify: (code: string) =>
    request<null>('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  // 修改密码（登录态一步直改）：验证当前密码后直接设置新密码（成功后踢掉全部会话，需重新登录）
  changePassword: (current_password: string, new_password: string) =>
    request<null>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password, new_password }),
    }),

  // 注册邮箱验证：提交注册时收到的验证码
  verifyEmailRegister: (code: string) =>
    request<null>('/auth/email/verify-register', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  // 登录前免登录邮箱验证：账号（用户名或邮箱）+ 验证码（require_email_verify 开启时登录被拦，用此端点验证后再登录）
  verifyEmailGuest: (account: string, code: string) =>
    request<{ message?: string }>('/auth/email/verify-guest', {
      method: 'POST',
      body: JSON.stringify({ account, code }),
    }),

  // 登录前重发验证码：账号（用户名或邮箱）定位，返回脱敏绑定邮箱（帮用户回忆绑的是哪个邮箱）
  resendEmailGuest: (account: string) =>
    request<{ message?: string; masked_email?: string }>('/auth/email/resend-guest', {
      method: 'POST',
      body: JSON.stringify({ account }),
    }),

  // ===== 责令换邮箱流程（change_token 半登录态：登录时密码已验证）=====

  // 第一步：向用户输入的新邮箱发码
  changeEmailGuestRequest: (change_token: string, email: string) =>
    request<{ message?: string; masked_email?: string }>('/auth/email/change-guest/request', {
      method: 'POST',
      body: JSON.stringify({ change_token, email }),
    }),

  // 第二步：验证码确认 → 换绑 + 清除责令 + 后端直接签发登录态
  changeEmailGuestConfirm: (change_token: string, email: string, code: string) =>
    request<{ token: string; refresh_token: string; user: User }>('/auth/email/change-guest/confirm', {
      method: 'POST',
      body: JSON.stringify({ change_token, email, code }),
    }),

  // 重发邮箱验证码（注册验证发到当前邮箱；改邮箱流程发到新邮箱，由后端按 pending data 判断）
  resendEmailCode: () =>
    request<null>('/auth/email/resend', { method: 'POST' }),


  changeUsername: (username: string) =>
    request<null>('/auth/username', {
      method: 'PUT',
      body: JSON.stringify({ username }),
    }),

  deleteAccount: (password: string) =>
    request<null>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }),

  cancelDeletion: () =>
    request<null>('/auth/cancel-deletion', { method: 'POST' }),

  logout: () =>
    request<null>('/auth/logout', {
      method: 'POST',
      // 携带 refresh_token 让服务端删除对应行（否则登出后 refresh 仍可续签）
      body: JSON.stringify({ refresh_token: getRefreshToken() }),
    }),
};

// 用户邀请码（拉新奖励）
export const invites = {
  create: () =>
    request<{ code: string }>('/auth/invites', { method: 'POST' }),

  my: () =>
    request<{ codes: { code: string; created_at: string }[]; invited_count: number; total_reward: number }>('/auth/invites'),
};

// Posts
export const posts = {
  unlock: (id: number) =>
    request<null>(`/posts/${id}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ type: 'paid' }),
    }),

  list: (params?: { page?: number; pageSize?: number; categoryId?: number; userId?: number; sort?: string; search?: string; feed?: boolean; excludeAnonymous?: boolean }, signal?: AbortSignal) => {
    // feed 模式走独立路由（requireAuth 确保登录）
    if (params?.feed) {
      const q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.pageSize) q.set('pageSize', String(params.pageSize));
      if (params.sort) q.set('sort', params.sort);
      return request<Post[]>(`/posts/feed?${q}`, { signal });
    }
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.categoryId) query.set('categoryId', String(params.categoryId));
    if (params?.userId) query.set('userId', String(params.userId));
    if (params?.sort) query.set('sort', params.sort);
    if (params?.search) query.set('search', params.search);
    if (params?.excludeAnonymous) query.set('exclude_anonymous', '1');
    return request<Post[]>(`/posts?${query}`, { signal });
  },
  // 推荐位：侧边栏展示使用推荐卡的帖子（原提升卡）
  featured: () => request<{ id: number; title: string; username: string; endsAt: string }[]>('/posts/featured'),

  get: (id: number) => request<Post>(`/posts/${id}`),

  // 抢红包排行榜（公开）：claims 按抢到顺序，best 为手气最佳
  redPacketClaims: (postId: number) =>
    request<{ claims: { user_id: number; username: string | null; amount: number; created_at: string }[]; total_coins: number; total_packets: number; best: { user_id: number; username: string | null; amount: number } | null }>(`/posts/${postId}/red-packet-claims`),

  create: (title: string, content: string, category_id?: number, price?: number, isAnonymous?: number, options?: { redPacketTotal?: number; redPacketCount?: number; postBgId?: number }) =>
    request<Post>('/posts', {
      method: 'POST',
      body: JSON.stringify({
        title, content, category_id, price, is_anonymous: isAnonymous || 0,
        red_packet_total: options?.redPacketTotal,
        red_packet_count: options?.redPacketCount,
        post_bg_id: options?.postBgId,
      }),
    }),

  update: (id: number, data: { title?: string; content?: string; category_id?: number; price?: number | null }) =>
    request<Post>(`/posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    request<null>(`/posts/${id}`, { method: 'DELETE' }),

  togglePin: (id: number, is_pinned: boolean) =>
    request<null>(`/posts/${id}/pin`, {
      method: 'PUT',
      body: JSON.stringify({ is_pinned }),
    }),
};

// Comments
export const comments = {
  list: (postId: number, page: number = 1, pageSize: number = 20) =>
    request<Comment[]>(`/comments/post/${postId}?page=${page}&pageSize=${pageSize}`),

  create: (postId: number, content: string, parent_id?: number) =>
    request<Comment>(`/comments/post/${postId}`, {
      method: 'POST',
      body: JSON.stringify({ content, parent_id }),
    }),

  update: (id: number, content: string) =>
    request<null>(`/comments/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  delete: (id: number) =>
    request<null>(`/comments/${id}`, { method: 'DELETE' }),
};

// Categories
export const categories = {
  list: (includeInactive?: boolean) => request<Category[]>(includeInactive ? '/categories?includeInactive=1' : '/categories'),

  create: (name: string, slug: string, description?: string, sort_order?: number, allowAnonymous?: number, isActive?: number, allowPaid?: number, allowThanks?: number) =>
    request<Category>('/categories', {
      method: 'POST',
      body: JSON.stringify({ name, slug, description, sort_order, allow_anonymous: allowAnonymous ?? 0, is_active: isActive ?? 1, allow_paid: allowPaid ?? 0, allow_thanks: allowThanks ?? 0 }),
    }),

  update: (id: number, data: Partial<Category>) =>
    request<null>(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    request<null>(`/categories/${id}`, { method: 'DELETE' }),
};

// Likes
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

// Upload
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

// Users
export const users = {
  getProfile: (id: number) => request<PublicUser>(`/users/${id}/profile`),

  updateProfile: (data: { username?: string; bio?: string }) =>
    request<null>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  updateAvatar: (avatar_url: string) =>
    request<null>('/users/avatar', {
      method: 'PUT',
      body: JSON.stringify({ avatar_url }),
    }),

  updateBanner: (banner_url: string) =>
    request<null>('/users/banner', {
      method: 'PUT',
      body: JSON.stringify({ banner_url }),
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
      body: JSON.stringify(data),
    }),

  search: (q: string) =>
    request<{ id: number; username: string; avatar_url: string }[]>(`/users/search?q=${encodeURIComponent(q)}`),
};

// Admin
export const admin = {
  // 管理员验证（从 DB 实时读取）
  verifyAdmin: () => request<{ is_admin: boolean; role: string }>('/auth/admin-status'),

  // 用户管理
  listUsers: (page?: number) =>
    request<User[]>(`/admin/users?page=${page || 1}`),

  listUserRoles: (page?: number) =>
    request<{ id: number; username: string; email: string; role: string }[]>(`/admin/users/roles?page=${page || 1}`),

  updateUserRole: (userId: number, role: string) =>
    request<null>(`/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  // 管理员设置邮箱验证状态（verified: 1 已验证 / 0 未验证）
  setEmailVerified: (id: number, verified: 0 | 1) =>
    request<null>(`/admin/users/${id}/email-verified`, {
      method: 'PUT',
      body: JSON.stringify({ verified }),
    }),

  // 责令更换邮箱：管理员发起（原因 1-200 字，展示给用户）
  orderEmailChange: (id: number, reason: string) =>
    request<null>(`/admin/users/${id}/order-email-change`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    }),

  // 解除责令（用户线下解决后人工解除；用户完成换邮箱后自动清除）
  cancelEmailChange: (id: number) =>
    request<null>(`/admin/users/${id}/cancel-email-change`, { method: 'PUT', body: JSON.stringify({}) }),

  getSettings: () => request<Record<string, string>>('/admin/settings'),

  updateSettings: (settings: Record<string, string>) =>
    request<null>('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  getStats: () =>
    request<{
      totalUsers: number;
      totalPosts: number;
      totalComments: number;
      totalViews: number;
    }>('/admin/stats'),

  // 置顶管理
  listPinned: () => request<any[]>('/admin/pinned'),

  unpinPost: (id: number) =>
    request<null>(`/admin/pinned/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_pinned: false }),
    }),

  reorderPinned: (id: number, direction: 'up' | 'down') =>
    request<null>(`/admin/pinned/${id}/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ direction }),
    }),

  // 封禁用户（reason：封禁原因，解封审核时展示）
  banUser: (userId: number, duration: number, unit: 'hours' | 'days', reason?: string) =>
    request<null>(`/admin/users/${userId}/ban`, {
      method: 'PUT',
      body: JSON.stringify({ duration, unit, reason }),
    }),

  unbanUser: (userId: number) =>
    request<null>(`/admin/users/${userId}/ban`, { method: 'DELETE' }),

  setUsername: (userId: number, username: string) =>
    request<null>(`/admin/users/${userId}/username`, {
      method: 'PUT',
      body: JSON.stringify({ username }),
    }),

  // 删除用户（三次确认）
  deleteUser: (userId: number, confirm: number) =>
    request<null>(`/admin/users/${userId}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm }),
    }),

  // 积分管理
  listCoins: (page?: number) =>
    request<{ user_id: number; username: string; role: string; coins: number; total_earned: number; total_spent: number }[]>(`/admin/coins?page=${page || 1}`),

  adjustCoins: (user_id: number, amount: number, reason?: string) =>
    request<null>('/admin/coins/adjust', {
      method: 'POST',
      body: JSON.stringify({ user_id, amount, reason }),
    }),

  // VIP 管理
  listVips: (page?: number, search?: string) =>
    request<any[]>(`/admin/vips?page=${page || 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  setVip: (userId: number, tier: string, days: number) =>
    request<null>(`/admin/vips/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ tier, days }),
    }),
  deleteVip: (userId: number) =>
    request<null>(`/admin/vips/${userId}`, { method: 'DELETE' }),

  // 帖子管理
  listPosts: (page?: number, search?: string) =>
    request<any[]>(`/admin/posts?page=${page || 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  deletePost: (id: number) =>
    request<null>(`/admin/posts/${id}`, { method: 'DELETE' }),
  restorePost: (id: number) =>
    request<null>(`/admin/posts/${id}/restore`, { method: 'PUT' }),
  lockPost: (id: number, is_locked: boolean) =>
    request<null>(`/admin/posts/${id}/lock`, {
      method: 'PUT',
      body: JSON.stringify({ is_locked }),
    }),

  // 评论管理
  listComments: (page?: number, search?: string) =>
    request<any[]>(`/admin/comments?page=${page || 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  deleteComment: (id: number) =>
    request<null>(`/admin/comments/${id}`, { method: 'DELETE' }),

  // 搜索
  searchUsers: (q: string) =>
    request<any[]>(`/admin/users/search?q=${encodeURIComponent(q)}`),

  // 详细统计
  getStatsDetail: () =>
    request<{ today: { users: number; posts: number; comments: number }; categories: any[]; topUsers: any[] }>('/admin/stats/detail'),

  listReports: (page?: number) =>
    request<any[]>(`/admin/reports?page=${page || 1}`),
  // 多人复核投票（confirm=确认违规 / pass=没问题驳回；达阈值自动执行，管理员一票）
  reviewReport: (id: number, action: 'confirm' | 'pass') =>
    request<{ message: string; confirm_count?: number; pass_count?: number; limit?: number; pass_limit?: number }>(`/admin/reports/${id}/review`, {
      method: 'POST', body: JSON.stringify({ action }),
    }),
  resolveReport: (id: number) =>
    request<null>(`/admin/reports/${id}/resolve`, { method: 'POST' }),
  dismissReport: (id: number) =>
    request<null>(`/admin/reports/${id}/dismiss`, { method: 'POST' }),

  // 邀请码管理
  listInvites: () => request<any[]>('/admin/invites'),
  createInvite: () => request<{ code: string }>('/admin/invites', { method: 'POST' }),
  deleteInvite: (code: string) =>
    request<null>(`/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  // 重置密码（返回一次性临时密码）
  resetPassword: (userId: number) =>
    request<{ temporary_password: string }>(`/admin/users/${userId}/reset-password`, { method: 'PUT' }),

  // 安全日志
  securityLogs: (page?: number) =>
    request<any[]>(`/admin/security-logs?page=${page || 1}`),
};

// Check-In
export const checkIn = {
  today: (date?: string) => request<{ checked_in: boolean; streak: number; coins_earned: number }>(`/check-in/today${date ? `?date=${date}` : ''}`),
  do: (date?: string) => request<{ streak: number; coins_earned: number; message: string }>('/check-in', { method: 'POST', body: JSON.stringify({ date }) }),
  stats: (date?: string) => request<{ total_days: number; month_days: number; current_streak: number; month_dates: string[] }>(`/check-in/stats${date ? `?date=${date}` : ''}`),
};

// Coins
export const coins = {
  balance: () => request<{ coins: number; total_earned: number; total_spent: number }>('/coins/balance'),
  todayEarnings: () => request<{ today_total: number; details: { type: string; amount: number; count: number }[] }>('/coins/today-earnings'),
  transactions: (page?: number) => request<any[]>(`/coins/transactions?page=${page || 1}`),
  transfer: (to_user_id: number, amount: number) =>
    request<null>('/coins/transfer', { method: 'POST', body: JSON.stringify({ to_user_id, amount }) }),
};

// VIP
export interface VipPlan {
  tier: string;
  label: string;
  price: number;
  upload_limit: number;
  check_in_bonus: number;
  transfer_fee: number;
}

export const vip = {
  status: () => request<{ is_vip: boolean; tier: string; expires_at?: string; auto_renew?: boolean }>('/vip/status'),
  plans: () => request<VipPlan[]>('/vip/plans'),
  purchase: (tier: string) =>
    request<null>('/vip/purchase', { method: 'POST', body: JSON.stringify({ tier }) }),
};

// Stats
export const reports = {
  create: (target_type: 'post' | 'comment', target_id: number, reason: string) =>
    request<null>('/reports', {
      method: 'POST',
      body: JSON.stringify({ target_type, target_id, reason }),
    }),
};


// 公开站点设置
export const site = {
  announcement: () => request<{ announcement: string; announcement_updated_at: string }>('/settings/public'),
};

// Notifications
export interface NotificationItem {
  id: number;
  user_id: number;
  actor_id: number | null;
  type: 'reply' | 'like_post' | 'like_comment' | 'post_takedown' | 'post_rejected' | 'email_change_ordered' | 'system';
  post_id: number | null;
  comment_id: number | null;
  content: string | null;
  read: number;
  created_at: string;
  actor_name?: string;
  actor_avatar?: string;
}
// messages removed



export const follows = {
  toggle: (userId: number) =>
    request<{ following: boolean }>(`/follows/${userId}`, { method: 'POST' }),

  check: (userId: number) =>
    request<{ following: boolean }>(`/follows/check/${userId}`),

  getFollowing: (userId: number, page?: number) =>
    request<any[]>(`/follows/${userId}/following?page=${page || 1}`),

  getFollowers: (userId: number, page?: number) =>
    request<any[]>(`/follows/${userId}/followers?page=${page || 1}`),

  getCounts: (userId: number) =>
    request<{ following: number; followers: number }>(`/follows/counts/${userId}`),
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
    request<any[]>(`/bookmarks?page=${page}`),
};

// ===== 积分扩展功能 =====

export const shop = {
  items: () => request<any[]>('/shop/items'),
  buy: (itemId: number, quantity: number = 1) =>
    request<{ item: any; quantity: number; total_price: number }>(`/shop/buy/${itemId}`, {
      method: 'POST',
      body: JSON.stringify({ quantity }),
    }),
  useRename: (new_username: string) =>
    request<any>('/shop/use-rename', {
      method: 'POST',
      body: JSON.stringify({ new_username }),
    }),
  myItems: () => request<any[]>('/shop/my-items'),
};

export const decorations = {
  my: () => request<any[]>('/decorations/my'),
  apply: (postId: number, user_item_id: number) =>
    request<null>(`/decorations/apply/${postId}`, {
      method: 'POST',
      body: JSON.stringify({ user_item_id }),
    }),
  remove: (postId: number) =>
    request<null>(`/decorations/remove/${postId}`, { method: 'POST' }),
};

export const tips = {
  send: (target_type: 'post' | 'comment', target_id: number, amount: number) =>
    request<null>('/tips', {
      method: 'POST',
      body: JSON.stringify({ target_type, target_id, amount }),
    }),
};

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
  items: { id: number; name: string; emoji: string; type: string; value: string; rarity: string; coins: number }[];
  summary: { total_coins_gain: number; item_count: number; vip_granted: boolean; has_ssr: boolean; has_announce: boolean };
  cost: number;
}

export const lotteryCoins = {
  status: () => request<LotteryStatus>('/lottery-coins/status'),
  draw: () => request<LotteryDrawResult>('/lottery-coins/draw', { method: 'POST' }),
  draw10: () => request<LotteryDrawResult>('/lottery-coins/draw10', { method: 'POST' }),
};

export const leaderboardApi = {
  coins: (page?: number) => request<any[]>(`/leaderboard/coins?page=${page || 1}`),
};

export const unban = {
  request: () => request<null>('/unban/request', { method: 'POST' }),
  myRequest: () => request<any>('/unban/my-request'),
};

;// 给 admin 对象追加解封审核方法
// 在 admin 命名空间里追加
;(admin as any).lottery = () =>
  request<any>('/admin/lottery');
;(admin as any).updateLotteryConfig = (config: Record<string, number>) =>
  request<null>('/admin/lottery', { method: 'PUT', body: JSON.stringify(config) });
;(admin as any).createLotteryPrize = (data: { name: string; emoji?: string; type: string; value?: string; weight: number; rarity: string }) =>
  request<null>('/admin/lottery/prizes', { method: 'POST', body: JSON.stringify(data) });
;(admin as any).updateLotteryPrize = (id: number, data: Record<string, any>) =>
  request<null>(`/admin/lottery/prizes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
;(admin as any).deleteLotteryPrize = (id: number) =>
  request<null>(`/admin/lottery/prizes/${id}`, { method: 'DELETE' });

;(admin as any).unbanRequests = (page?: number) =>
  request<any[]>(`/admin/unban-requests?page=${page || 1}`);
;(admin as any).approveUnban = (id: number) =>
  request<null>(`/admin/unban-requests/${id}/approve`, { method: 'POST' });
;(admin as any).rejectUnban = (id: number, reason?: string) =>
  request<null>(`/admin/unban-requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const notifications = {
  list: (page: number = 1) =>
    request<NotificationItem[]>(`/notifications?page=${page}`),

  markRead: (id: number) =>
    request<null>(`/notifications/${id}/read`, { method: 'PUT' }),

  markAllRead: () =>
    request<null>('/notifications/read-all', { method: 'PUT' }),

  unreadCount: () =>
    request<{ unread: number }>('/notifications/unread-count'),

  // maxId：本次已拉取的最大通知 id，服务端只清理已确认送达的通知（不传则清空全部，向后兼容）
  clearDelivered: (maxId?: number) =>
    request<null>(`/notifications/delivered${maxId !== undefined ? `?maxId=${maxId}` : ''}`, { method: 'DELETE' }),
};

// ===== 任务系统 =====
export const tasksApi = {
  today: () =>
    request<{ tasks: TaskItem[]; all_done: boolean; bonus_claimed: boolean }>('/tasks/today'),
  claim: (task_type: string) =>
    request<{ coins: number; exp: number }>('/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ task_type }),
    }),
  claimBonus: () =>
    request<{ coins: number }>('/tasks/claim-bonus', { method: 'POST' }),
};

// ===== 成就系统 =====
export const achievementsApi = {
  list: () =>
    request<{ achievements: AchievementInfo[]; unlocked_count: number; total: number }>('/achievements'),
  // 成就殿堂（公开 + optionalAuth：带 token 时返回个人解锁状态，未登录 achievements 无 unlocked 字段）
  hall: () =>
    request<AchievementHall>('/achievements/hall', { method: 'GET' }),
  // 某成就的达成者名单（公开，分页）
  unlockers: (key: string, page: number = 1) =>
    request<{ users: AchievementUnlocker[]; total: number; page: number; page_size: number }>(
      `/achievements/${encodeURIComponent(key)}/unlockers?page=${page}`, { method: 'GET' }),
};

// ===== 感谢 =====
export const thanksApi = {
  send: (target_type: 'post' | 'comment', target_id: number) =>
    request<null>('/thanks', {
      method: 'POST',
      body: JSON.stringify({ target_type, target_id }),
    }),
};

// ===== 巡查体系（admin + moderator）：单帖预览队列 + 多人复核制 =====
export const moderation = {
  reviewPosts: (queue: 'pending' | 'flagged') =>
    request<any[]>(`/moderation/review-posts?queue=${queue}&pageSize=50`),
  reviewPost: (post_id: number, action: string, reason?: string) =>
    request<null>('/moderation/review-post', {
      method: 'POST',
      body: JSON.stringify({ post_id, action, reason }),
    }),
  patrolStats: () => request<PatrolStats>('/moderation/stats', { method: 'GET' }),
  // AI 审核日志（巡查台栏目，消费端只保留最近 20 条）
  aiLogs: () => request<any[]>('/moderation/ai-logs'),
};

// ===== 道具系统 =====
export const items = {
  myItems: () => request<any[]>('/items/my-items'),
  use: (type: string, itemId?: number, payload?: any) => {
    const ep = itemId ? `/items/use/${type}/${itemId}` : `/items/use/${type}`;
    return request<any>(ep, { method: 'POST', body: payload ? JSON.stringify(payload) : undefined });
  },
  recycleBatch: (ids: number[]) =>
    request<any>('/items/recycle-batch', { method: 'POST', body: JSON.stringify({ ids }) }),
  activeEffects: () => request<any[]>('/items/active-effects'),
  redPackets: () => request<any[]>('/items/red-packets'),
  cancelEffect: (effectId: string) =>
    request<any>('/items/cancel-effect', { method: 'POST', body: JSON.stringify({ effectId }) }),
  // 装饰与效果：称号/头像框佩戴数据与操作
  decoration: () => request<DecorationData>('/items/decoration'),
  equipTitleBadge: (title: string) =>
    request<any>('/items/equip-title-badge', { method: 'POST', body: JSON.stringify({ title }) }),
  equipAvatarFrame: (frame: string) =>
    request<any>('/items/equip-avatar-frame', { method: 'POST', body: JSON.stringify({ frame }) }),
};

// ===== AI 内容审核（经 Worker 代理转发，密钥在服务端，不落前端） =====

/**
 * 发帖前调用 AI 审核。通过返回 true，拒绝返回 false 并弹出原因。
 * 代理后端返回 { success, data: { allowed, reason } }；请求失败/网络异常时 fail-open 放行。
 */
export async function reviewPostContent(content: string): Promise<boolean> {
  try {
    const res = await request<{ allowed: boolean; reason?: string }>('/review-content', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (!res.success) throw new Error(res.error || '审核服务不可用，请稍后重试');
    if (!res.data?.allowed) throw new Error(`审核未通过：${res.data?.reason || '内容违规'}`);
    return true;
  } catch (err: any) {
    if (err.message?.startsWith('审核未通过')) throw err;
    console.warn('[judge] 审核服务异常，已默认放行:', err.message);
    return true;
  }
}

// 已下架复审（申诉）
export const appeals = {
  // 复审权限查询（Tab 显隐控制）
  access: () =>
    request<{ allowed: boolean; level: number; requiredLevel: number; isAdmin: boolean }>('/appeals/access'),
  // 提交申诉（作者本人，帖子须软删状态）
  submit: (post_id: number, reason: string) =>
    request<null>('/appeals', { method: 'POST', body: JSON.stringify({ post_id, reason }) }),
  // 待复审列表（达标巡查员/管理员）
  pendingList: (page?: number) =>
    request<any[]>(`/appeals/pending?page=${page || 1}&pageSize=20`),
  // 单人判定：approve=恢复重新巡查 / reject=维持下架
  decide: (id: number, action: 'approve' | 'reject') =>
    request<null>(`/appeals/${id}/decide`, { method: 'POST', body: JSON.stringify({ action }) }),
  // 申诉页信息（帖子是否可申诉 + 已有申诉状态）
  info: (post_id: number) =>
    request<{ post_id: number; title: string; deleted: boolean; appeal: any }>(`/appeals/post/${post_id}`),
};
