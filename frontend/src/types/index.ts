export interface User {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
  bio: string;
  role: 'user' | 'moderator' | 'admin';
  notify_on_reply: number;
  notify_on_like: number;
  created_at: string;
  email_verified?: number;
  banned_until?: string | null;
  scheduled_deleted_at?: string | null;
  is_vip?: boolean;
  vip_tier?: string | null;
  custom_title?: string | null;
  custom_title_expires_at?: string | null;
  nick_theme?: string | null;
  title_badge?: string | null;
  title_badge_expires_at?: string | null;
  avatar_frame?: string | null;
  avatar_frame_expires_at?: string | null;
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
  custom_title?: string | null;
  custom_title_expires_at?: string | null;
  nick_theme?: string | null;
  title_badge?: string | null;
  title_badge_expires_at?: string | null;
  avatar_frame?: string | null;
  avatar_frame_expires_at?: string | null;
  exp?: number;
  level?: number;
  tierName?: string;
}

export interface Post {
  id: number;
  user_id: number | null;
  title: string;
  content: string;
  category_id: number | null;
  is_pinned: number;
  is_anonymous: number;
  is_owner?: boolean;
  view_count: number;
  like_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
  username?: string;
  author_avatar?: string;
  author_banned_until?: string | null;
  author_vip_tier?: string | null;
  author_nick_theme?: string | null;
  author_avatar_frame?: string;
  author_avatar_frame_expires_at?: string | null;
  author_title_badge?: string;
  author_custom_title?: string | null;
  author_custom_title_expires_at?: string | null;
  author?: PublicUser;
  reported?: boolean;
  category_name?: string;
  category_allow_thanks?: number; // 板块感谢开关（0=关闭；关闭时隐藏感谢按钮）
  category_slug?: string;
  category?: { name: string; slug: string };
  liked?: boolean;
  bumped_until?: string | null;
  highlighted_until?: string | null;
  fortune?: string | null;
  fortune_expires_at?: string | null;
  title_effect?: string | null;
  title_effect_expires_at?: string | null;
  price?: number | null;
  requires?: { type: string; price?: number };
  // 帖子背景 / 感谢 / 红包（列表字段）
  post_bg_id?: number | null;
  effects_managed_at?: string | null; // 效果管理一次性机会（非空=已使用）
  thanks_count?: number;
  author_exp?: number | null;
  red_packet_coins?: number | null;
  red_packet_remaining?: number | null;
  // 红包（详情字段，无红包则 null）
  red_packet_id?: number | null;
  red_packet_total_coins?: number | null;
  red_packet_remaining_coins?: number | null;
  red_packet_total_packets?: number | null;
  red_packet_remaining_packets?: number | null;
}

export interface Comment {
  id: number;
  post_id: number;
  user_id: number;
  parent_id: number | null;
  content: string;
  like_count: number;
  created_at: string;
  author: PublicUser;
  children?: Comment[];
  liked?: boolean;
  thanks_count?: number;
  // 评论发布成功后的红包结果
  red_packet?: { won: boolean; amount?: number };
}

export interface TaskItem {
  task_type: 'checkin' | 'post' | 'comment' | 'liked';
  label: string;
  done: boolean;
  claimed: boolean;
  coins: number;
  exp: number;
  goal: number;
  progress: number;
}

// 成就奖励项（type 取值：coins 积分 / exp 经验 / title_badge 称号 / avatar_frame 头像框 / vip VIP 券；title_badge 永久无 days）
export interface AchievementReward {
  type: 'coins' | 'exp' | 'title_badge' | 'avatar_frame' | 'vip';
  amount?: number;
  days?: number;
  tier?: string;
}

export interface AchievementInfo {
  key: string;
  name: string;
  desc: string;
  coins: number;
  rarity: string;
  rewards: AchievementReward[];
  unlocked?: boolean; // 成就墙接口总是返回；成就殿堂未登录时无此字段
}

// 成就殿堂（GET /api/achievements/hall，公开 + optionalAuth）：多出全站达成人数与分类
export interface HallAchievement extends AchievementInfo {
  category: 'campus' | 'patrol';
  count: number;
}

export interface AchievementHall {
  total_count: number;
  total_unlocks: number;
  my_unlocked: number | null; // 未登录为 null
  achievements: HallAchievement[];
}

// 巡查员成就与等级（GET /api/moderation/stats；level 封顶时 expNeededForLevel 为 null 或与 expInLevel 相等）
export interface PatrolStats {
  level: number;
  tierName: string;
  exp: number;
  expInLevel: number;
  expNeededForLevel: number | null;
  totalReviews: number;
  totalPasses: number;
  totalQuestions: number;
  totalViolations: number;
  totalConfirms: number;
  totalClears: number;
  totalTakedowns: number;
  todayCount: number;
  unlocked: string[];
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  allow_anonymous: number;
  is_active: number;
  allow_paid: number;
  allow_thanks?: number; // 板块级感谢开关（0=关闭，1=启用）
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  total?: number;
  page?: number;
  pageSize?: number;
  limit?: number; // 多人复核阈值（举报/帖子巡查：确认违规所需票数）
  passLimit?: number; // 「没问题」通过所需票数
}

export interface LoginResponse {
  token: string;
  refresh_token?: string;
  user: User;
}

// ===== 装饰与效果（GET /api/items/decoration）=====
// 当前佩戴中的装饰（titleBadge/customTitle 用 title 字段，avatarFrame 用 frame 字段）
export interface DecorationEquip {
  title?: string;
  frame?: string;
  expiresAt: string | null;
}

// 已解锁的称号（permanent 永久称号无过期时间）
export interface OwnedTitle {
  title: string;
  expiresAt: string | null;
  permanent: boolean;
}

// 已拥有的头像框（source: achievement 成就解锁 / item 道具获得；道具未使用时携带 itemId）
export interface OwnedFrame {
  frame: string;
  expiresAt: string | null;
  source: 'achievement' | 'item';
  itemId?: number;
  itemType?: string;
  durationDays?: number;
}

export interface DecorationData {
  equipped: {
    titleBadge: DecorationEquip | null;
    avatarFrame: DecorationEquip | null;
    customTitle: DecorationEquip | null;
  };
  ownedTitles: OwnedTitle[];
  ownedFrames: OwnedFrame[];
}
