import type { CSSProperties } from 'react';

interface VIPBadgeProps {
  vip_tier?: string | null;
  size?: 'sm' | 'md';
}

// 徽章配色：三档统一浅蓝单色（S VIP 同款）——浅底深字、低调；金色留给称号徽章，避免撞车
const TIER_CONFIG: Record<string, { label: string; cls: string }> = {
  vip: { label: 'VIP', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' },
  's-vip': { label: 'S VIP', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' },
  'svip+': { label: 'S VIP+', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' },
};

// S VIP+ 昵称主题
const NICK_THEMES: Record<string, string> = {
  theme1: 'vip-nick-svip+-theme1',
  theme2: 'vip-nick-svip+-theme2',
  theme3: 'vip-nick-svip+-theme3',
  theme4: 'vip-nick-svip+-theme4',
};

export function getVipNickClass(vip_tier?: string | null, nick_theme?: string | null): string {
  if (!vip_tier) return '';
  // 自定义渐变不走 CSS class，由 getVipNickStyle 返回 inline style
  if (vip_tier === 'svip+' && nick_theme?.startsWith('custom:')) return '';
  if (vip_tier === 's-vip') return 'vip-nick-s-vip';
  if (vip_tier === 'svip+') {
    const theme = (nick_theme && NICK_THEMES[nick_theme]) ? NICK_THEMES[nick_theme] : 'vip-nick-svip+-theme1';
    return `vip-nick-svip+ ${theme}`;
  }
  return '';
}

// 自定义渐变（nick_theme = custom:RRGGBB,RRGGBB[,RRGGBB]，仅 SVIP+）→ 昵称 inline style；
// 预设主题走 CSS class，此函数返回空对象。渐变文字 = background-clip: text + 透明填充。
export function getVipNickStyle(vip_tier?: string | null, nick_theme?: string | null): CSSProperties {
  if (!vip_tier || vip_tier !== 'svip+' || !nick_theme?.startsWith('custom:')) return {};
  const stops = nick_theme.slice(7).split(',').filter(h => /^[0-9a-fA-F]{6}$/.test(h));
  if (stops.length < 2) return {};
  return {
    backgroundImage: `linear-gradient(90deg, #${stops.map(s => s.toUpperCase()).join(', #')})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
  } as CSSProperties;
}

export function getVipCommentClass(vip_tier?: string | null): string {
  if (!vip_tier) return '';
  if (vip_tier === 's-vip') return 'vip-comment-s-vip';
  if (vip_tier === 'svip+') return 'vip-comment-svip+';
  return '';
}

export const NICK_THEME_OPTIONS = [
  { id: 'theme1', label: '红金', colors: 'from-red-500 via-amber-400 to-red-500' },
  { id: 'theme2', label: '紫粉', colors: 'from-purple-500 via-pink-500 to-purple-500' },
  { id: 'theme3', label: '蓝紫', colors: 'from-cyan-500 via-blue-500 to-purple-500' },
  { id: 'theme4', label: '绿金', colors: 'from-emerald-500 via-green-400 to-amber-400' },
];

export default function VIPBadge({ vip_tier, size = 'sm' }: VIPBadgeProps) {
  if (!vip_tier || vip_tier === 'none') return null;
  const cfg = TIER_CONFIG[vip_tier];
  if (!cfg) return null;
  // 尺寸与等级 Lv 徽章 / 称号徽章统一：text-[10px] px-1.5 py-0.5 rounded font-medium（高度 ~18px）
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-sm px-1.5 py-0.5';
  return (
    <span className={`${sizeClass} ${cfg.cls} rounded font-medium inline-flex items-center ml-1 gap-0.5`}
      title={`${cfg.label} 会员`}>
      <span>{cfg.label}</span>
    </span>
  );
}
