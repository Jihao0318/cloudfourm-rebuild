// D1 返回的日期格式是 "2026-06-13 14:16:57"（UTC），解析为 Date
export function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  // D1 存储的是 UTC 时间，加 Z 标记为 UTC
  const iso = dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// Bilibili/YouTube 风格相对时间
export function formatRelativeTime(dateStr: string | null | undefined): string {
  const d = parseDate(dateStr);
  if (!d) return '-';

  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return '刚刚';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  // 超过7天显示月-日（Asia/Shanghai 时区）
  const shanghaiStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
  return shanghaiStr;
}

export function formatDate(dateStr: string | null | undefined): string {
  const d = parseDate(dateStr);
  if (!d) return '-';
  return d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  const d = parseDate(dateStr);
  if (!d) return '-';
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
