export interface PostBgOption {
  id: number;
  name: string;
  className: string; // Tailwind 渐变类（完整类名，JIT 可扫到）
  preview: string; // 内联 CSS 背景预览
}

export const POST_BG_OPTIONS: PostBgOption[] = [
  // 每个背景带 dark: 深色变体（保留色相、底部渐隐至暗色卡片底色），
  // 否则暗色模式下文本被 .dark 强制为浅色、背景却是浅色渐变 → 白底白字看不清
  { id: 1, name: '天蓝', className: 'bg-gradient-to-b from-sky-100 via-sky-50 to-white dark:from-sky-900 dark:via-sky-950 dark:to-[#0b0b0f]', preview: 'linear-gradient(180deg, #e0f2fe, #f0f9ff, #ffffff)' },
  { id: 2, name: '薄荷绿', className: 'bg-gradient-to-b from-emerald-100 via-teal-50 to-white dark:from-emerald-900 dark:via-emerald-950 dark:to-[#0b0b0f]', preview: 'linear-gradient(180deg, #d1fae5, #f0fdfa, #ffffff)' },
  { id: 3, name: '暖橙', className: 'bg-gradient-to-b from-orange-100 via-amber-50 to-white dark:from-orange-900 dark:via-orange-950 dark:to-[#0b0b0f]', preview: 'linear-gradient(180deg, #ffedd5, #fffbeb, #ffffff)' },
  { id: 4, name: '樱花粉', className: 'bg-gradient-to-b from-pink-100 via-rose-50 to-white dark:from-pink-900 dark:via-pink-950 dark:to-[#0b0b0f]', preview: 'linear-gradient(180deg, #fce7f3, #fff1f2, #ffffff)' },
  { id: 5, name: '星空紫', className: 'bg-gradient-to-b from-indigo-200 via-purple-100 to-white dark:from-indigo-900 dark:via-indigo-950 dark:to-[#0b0b0f]', preview: 'linear-gradient(180deg, #c7d2fe, #ede9fe, #ffffff)' },
  // 6 号原为深色"墨黑金"，与黑色文本冲突导致看不清——改为浅色"晨雾灰"，已使用的帖子自动生效
  { id: 6, name: '晨雾灰', className: 'bg-gradient-to-b from-slate-100 via-gray-50 to-white dark:from-slate-800 dark:via-slate-900 dark:to-[#0b0b0f]', preview: 'linear-gradient(180deg, #f1f5f9, #f9fafb, #ffffff)' },
];

export function postBgClass(id: number | null | undefined): string {
  return POST_BG_OPTIONS.find(o => o.id === id)?.className ?? '';
}
