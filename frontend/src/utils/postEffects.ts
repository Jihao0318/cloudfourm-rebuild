import type { Post } from '../types';
import { parseDate } from './date';

/**
 * 帖子效果额度（与后端 worker/src/handlers/items.ts 的 effectQuotaError 保持同一规则）：
 *   同一帖子同时最多叠 MAX_POST_EFFECTS 种装饰效果（帖子背景 / 推荐卡 / 高亮卡 / 今日运势）。
 *   · 同一类效果已生效时再次使用（换背景、推荐卡续费、高亮/运势叠加时长）不占新额度；
 *   · 取消效果立即释放额度；
 *   · 额度按「当前生效的效果种类数」实时计算，不是一次性用掉的次数。
 */
export const MAX_POST_EFFECTS = 2;

export type PostEffectKind = 'bg' | 'bump' | 'highlight' | 'fortune';

export const EFFECT_LABELS: Record<PostEffectKind, string> = {
  bg: '帖子背景',
  bump: '推荐卡',
  highlight: '高亮卡',
  fortune: '今日运势',
};

function isActive(value: string | null | undefined): boolean {
  const d = parseDate(value);
  return !!d && d.getTime() > Date.now();
}

/** 当前生效的效果种类（顺序固定，便于展示） */
export function activeEffectKinds(post: Post): PostEffectKind[] {
  const kinds: PostEffectKind[] = [];
  if (post.post_bg_id) kinds.push('bg');
  if (isActive(post.bumped_until)) kinds.push('bump');
  if (isActive(post.highlighted_until)) kinds.push('highlight');
  if (isActive(post.fortune_expires_at)) kinds.push('fortune');
  return kinds;
}

export interface EffectQuota {
  /** 已生效的效果种类 */
  active: PostEffectKind[];
  used: number;
  max: number;
  /** 剩余可新增的效果种类数 */
  remaining: number;
  /** 还能继续管理吗（剩余为 0 也不是完全锁死：取消一个已生效效果即可腾出额度） */
  canManage: boolean;
}

export function effectQuota(post: Post | null | undefined): EffectQuota {
  const active = post ? activeEffectKinds(post) : [];
  const remaining = Math.max(0, MAX_POST_EFFECTS - active.length);
  return { active, used: active.length, max: MAX_POST_EFFECTS, remaining, canManage: remaining > 0 || active.length > 0 };
}

/** 某一类效果当前是否允许使用（已生效的同类可直接续期/替换） */
export function canApplyEffect(quota: EffectQuota, kind: PostEffectKind): boolean {
  return quota.active.includes(kind) || quota.remaining > 0;
}
