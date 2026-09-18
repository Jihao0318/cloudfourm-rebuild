/**
 * 正文里的媒体标记解析与重排（图片 + 视频）
 *
 * 设计原则：正文 markdown 始终是唯一数据源——管理条只做「读取顺序 → 改写顺序/删除」，
 * 不引入新的存储格式。已发布的帖子、渲染逻辑（PostDetail 的 img/video 组件）、
 * 安卓客户端读到的都是同一份 markdown，因此重排/删除不会产生兼容问题。
 *
 * 支持的两种标记：
 *   - 图片：![alt](url)                    —— 上传图片插入的形式
 *   - 视频：<video src="url" ...></video>  —— 上传视频插入的形式（与「嵌入链接」直链视频一致）
 */

export type MediaKind = 'image' | 'video';

export interface MediaToken {
  kind: MediaKind;
  url: string;
  /** 图片 alt 文本（视频为空串） */
  alt: string;
  /** 在正文中的字符区间 [start, end) */
  start: number;
  end: number;
  /** 命中的原始文本（重排时原样搬运，不改写用户已有的写法） */
  raw: string;
}

const IMAGE_RE = /!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g;
const VIDEO_RE = /<video\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>\s*<\/video\s*>/gi;

/** 视频标记的生成（统一格式：src + controls，不带 class/style，交给渲染端统一美化） */
export function videoTag(url: string): string {
  return `<video src="${url}" controls></video>`;
}

/** 图片标记的生成 */
export function imageTag(url: string, alt = ''): string {
  return `![${alt}](${url})`;
}

/** 按出现顺序解析正文里的全部媒体标记 */
export function parseMediaTokens(text: string): MediaToken[] {
  const tokens: MediaToken[] = [];
  for (const m of text.matchAll(IMAGE_RE)) {
    tokens.push({ kind: 'image', url: m[2], alt: m[1] || '', start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  for (const m of text.matchAll(VIDEO_RE)) {
    tokens.push({ kind: 'video', url: m[1], alt: '', start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return tokens.sort((a, b) => a.start - b.start);
}

/**
 * 按新顺序重写正文里的媒体标记：第 i 个标记位置填入 newOrder[i] 的原文。
 * 其余文字（标题、段落、空白）完全不动；数量不一致时以「位置数」为准（多余的保留原样）。
 */
export function reorderMediaTokens(text: string, newOrder: MediaToken[]): string {
  let i = 0;
  return text.replace(/!\[[^\]]*\]\(\S+?(?:\s+"[^"]*")?\)|<video\b[^>]*\bsrc\s*=\s*"[^"]+"[^>]*>\s*<\/video\s*>/gi,
    (matched) => (i < newOrder.length ? newOrder[i++].raw : matched));
}

/**
 * 删除某个媒体标记（按 start/end 定位，只删这一处——同一 URL 被多次引用时互不影响）。
 * 顺带收敛删除后残留的连续空行，避免正文出现一排空行。
 */
export function removeMediaToken(text: string, token: MediaToken): string {
  const next = text.slice(0, token.start) + text.slice(token.end);
  return next
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, (m) => (m.length > 1 ? '\n' : m));
}

/** 把某个标记按当前顺序前移/后移一位，返回新的顺序数组（越界时返回原数组） */
export function moveToken(order: MediaToken[], index: number, dir: -1 | 1): MediaToken[] {
  const to = index + dir;
  if (to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
