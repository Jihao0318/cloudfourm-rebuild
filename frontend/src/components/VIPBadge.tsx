interface VIPBadgeProps {
  vip_tier?: string | null;
  size?: 'sm' | 'md';
}

// 徽章背景渐变：三档统一淡蓝色（Tailwind from-*-to-*，JIT 可扫到）
const TIER_CONFIG: Record<string, { label: string; cls: string }> = {
  vip: { label: 'VIP', cls: 'from-sky-300 to-blue-400' },
  's-vip': { label: 'S VIP', cls: 'from-sky-300 to-blue-400' },
  'svip+': { label: 'S VIP+', cls: 'from-sky-300 to-blue-400' },
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
  if (vip_tier === 's-vip') return 'vip-nick-s-vip';
  if (vip_tier === 'svip+') {
    const theme = (nick_theme && NICK_THEMES[nick_theme]) ? NICK_THEMES[nick_theme] : 'vip-nick-svip+-theme1';
    return `vip-nick-svip+ ${theme}`;
  }
  return '';
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
    <span className={`${sizeClass} bg-gradient-to-r ${cfg.cls} text-white rounded font-medium inline-flex items-center ml-1 gap-0.5`}
      title={`${cfg.label} 会员`}>
      <span>{cfg.label}</span>
    </span>
  );
}
