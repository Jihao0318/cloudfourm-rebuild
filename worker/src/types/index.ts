// ============================================================
// 类型定义
// ============================================================

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  avatar_url: string;
  bio: string;
  role: 'user' | 'moderator' | 'admin';
  twofa_secret: string | null;
  twofa_enabled: number;
  email_verified: number;
  notify_on_reply: number;
  notify_on_like: number;
  banned_until: string | null;
  deleted_at: string | null;
  scheduled_deleted_at: string | null;
  token_version: number;
  custom_title?: string | null;
  custom_title_expires_at?: string | null;
  nick_theme?: string | null;
  title_badge?: string | null;
  title_badge_expires_at?: string | null;
  avatar_frame?: string | null;
  avatar_frame_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: number;
  username: string;
  avatar_url: string;
  banner_url?: string;
  bio: string;
  role: string;
  created_at: string;
  banned_until?: string | null;
  vip_tier?: string | null;
  nick_theme?: string | null;
  custom_title?: string | null;
  custom_title_expires_at?: string | null;
  title_badge?: string | null;
  title_badge_expires_at?: string | null;
  avatar_frame?: string | null;
  avatar_frame_expires_at?: string | null;
}

export interface Post {
  id: number;
  user_id: number | null;
  title: string;
  content: string;
  category_id: number | null;
  is_pinned: number;
  is_locked: number;
  is_anonymous: number;
  decoration_id: number | null;
  price?: number | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PostDetail extends Post {
  author?: PublicUser;
  category?: Category;
  liked?: boolean;
  decoration?: ShopItem;
}

export interface Comment {
  id: number;
  post_id: number;
  user_id: number;
  parent_id: number | null;
  content: string;
  like_count: number;
  created_at: string;
  deleted_at: string | null;
  author?: PublicUser;
  children?: Comment[];
  liked?: boolean;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  allow_anonymous: number;
  is_active: number;
  created_at: string;
}

export interface Like {
  id: number;
  user_id: number;
  target_id: number;
  target_type: 'post' | 'comment';
  created_at: string;
}

export interface Verification {
  id: number;
  user_id: number;
  type: 'email_verify' | 'password_reset' | 'password_change' | 'twofa';
  code: string;
  data: string;
  expires_at: string;
  used: number;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface PageView {
  id: number;
  post_id: number;
  visitor_id: string | null;
  viewed_at: string;
}

// API 请求类型

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreatePostRequest {
  title: string;
  content: string;
  category_id?: number;
  price?: number;
}

export interface UpdatePostRequest {
  title?: string;
  content?: string;
  category_id?: number;
}

export interface CreateCommentRequest {
  content: string;
  parent_id?: number;
}

export interface LikeRequest {
  target_id: number;
  target_type: 'post' | 'comment';
}

export interface UpdateProfileRequest {
  username?: string;
  bio?: string;
}

export interface NotifySettingsRequest {
  notify_on_reply?: boolean;
  notify_on_like?: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================
// 积分扩展类型
// ============================================================

export interface ShopItem {
  id: number;
  name: string;
  type: 'rename_card' | 'post_decoration';
  price: number;
  data: string;
  sort_order: number;
  created_at: string;
}

export interface UserItem {
  id: number;
  user_id: number;
  item_id: number;
  used: number;
  applied_to: number | null;
  created_at: string;
  item?: ShopItem;
}

export interface Tip {
  id: number;
  from_user_id: number;
  to_user_id: number;
  target_type: 'post' | 'comment';
  target_id: number;
  amount: number;
  created_at: string;
}

export interface UnbanRequest {
  id: number;
  user_id: number;
  coins_paid: number;
  status: 'pending' | 'approved' | 'rejected';
  reviewer_id: number | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

// JWT Payload — 只保留身份标识 + token 版本号；role/vip 一律从 c.get('dbUser') 读（防快照过时）
export interface JWTPayload {
  userId: number;
  username: string;
  ver?: number;
}

// Worker Env Bindings
export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  TELEGRAPH_IMAGE_URL: string;
  // CORS 白名单（逗号分隔多域名）；未配置时 CORS 回退为回显 Origin（本地开发兼容）
  FRONTEND_URL?: string;
  ENVIRONMENT: string;
  // 初始管理员邮箱（注册时邮箱匹配则提权 admin）；未配置时回退为首个注册用户自动 admin —— 上线前必须设置
  INITIAL_ADMIN_EMAIL?: string;
  // AI 内容审核：密钥 JUDGE_API_KEY + 审核服务地址 JUDGE_API_URL（完整 /api/judge 端点）；未配置时 fail-open 放行
  JUDGE_API_KEY?: string;
  JUDGE_API_URL?: string;
  // 邮件服务：URL 与 Bearer token，未配置时 forgot 不发送
  MAILER_URL?: string;
  MAILER_TOKEN?: string;
  /** AI 审核队列 producer（wrangler.jsonc queues.producers）；未绑定（本地无队列时）→ 投递跳过 */
  QUEUE?: Queue<{ postId: number }>;
  /** 审核后端 service binding（可选，未配置走公网 JUDGE_API_URL） */
  JUDGE?: Fetcher;
  /** 邮件网关 service binding（可选，未配置走公网 MAILER_URL） */
  MAILER?: Fetcher;
}
