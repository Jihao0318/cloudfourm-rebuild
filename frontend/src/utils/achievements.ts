import type { AchievementReward } from '../types';

// 稀有度 → 展示元数据（对照表：bronze=emerald 入门 / silver=blue 进阶 / gold=purple 资深 / legend=amber 传说）
export interface RarityMeta {
  medal: string;
  label: string;
  card: string;
  pill: string;
}

export const RARITY_META: Record<string, RarityMeta> = {
  bronze: { medal: '🥉', label: '入门', card: 'bg-emerald-50 border-emerald-200', pill: 'bg-emerald-100 text-emerald-700' },
  silver: { medal: '🥈', label: '进阶', card: 'bg-blue-50 border-blue-200', pill: 'bg-blue-100 text-blue-700' },
  gold: { medal: '🥇', label: '资深', card: 'bg-purple-50 border-purple-200', pill: 'bg-purple-100 text-purple-700' },
  legend: { medal: '👑', label: '传说', card: 'bg-amber-50 border-amber-200', pill: 'bg-amber-100 text-amber-700' },
};

// 未知稀有度兜底（接口新增值时不报错）
export function rarityMeta(rarity: string): RarityMeta {
  return RARITY_META[rarity] || { medal: '🏅', label: rarity || '成就', card: 'bg-gray-50 border-gray-200', pill: 'bg-gray-100 text-gray-600' };
}

// 奖励 → 展示文案（🪙 积分 / ⚡ 经验 / 👑 称号 / 🖼️ 头像框 / 💎 VIP 券；称号永久无 days）
export function rewardLabel(r: AchievementReward): string {
  switch (r.type) {
    case 'coins':
      return `🪙 +${r.amount ?? 0} 积分`;
    case 'exp':
      return `⚡ +${r.amount ?? 0} 经验`;
    case 'title_badge':
      return r.days ? `👑 称号·${r.days}天` : '👑 称号·永久';
    case 'avatar_frame':
      return r.days ? `🖼️ 头像框·${r.days}天` : '🖼️ 头像框·永久';
    case 'vip': {
      const tierName = r.tier === 'vip' ? 'VIP' : r.tier === 's-vip' ? 'S VIP' : r.tier ? 'S VIP+' : '';
      const base = tierName ? `💎 ${tierName}券` : '💎 VIP券';
      return r.days ? `${base}·${r.days}天` : base;
    }
  }
}
