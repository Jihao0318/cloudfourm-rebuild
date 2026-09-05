import { defaultSchema } from 'rehype-sanitize';

// 允许的 iframe 嵌入源（仅 https 语义）：YouTube / YouTube nocookie / Bilibili 官方嵌入。
// 兼容协议相对地址（//player.bilibili.com/...，B 站/YouTube 官方分享代码的默认格式）——
// 站点是 https，`//` 解析为 https，不存在降级风险
const IFRAME_SRC_RE = /^(https:)?\/\/(www\.youtube\.com\/embed|www\.youtube-nocookie\.com\/embed|player\.bilibili\.com)(\/|\?|$)/;

// 基于 GitHub 默认白名单扩展：保留用户富媒体（img/video/audio/iframe）。
// on* 事件属性等危险内容由 sanitize 默认规则直接剥离，无需额外配置。
export const markdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'iframe', 'video', 'audio'],
  attributes: {
    ...defaultSchema.attributes,
    iframe: [['src', IFRAME_SRC_RE], 'title', 'width', 'height', 'loading', 'allowFullScreen', 'allowfullscreen', 'scrolling', 'frameborder', 'border', 'framespacing'],
    video: ['src', 'controls', 'poster', 'preload', 'width', 'height'],
    audio: ['src', 'controls', 'preload'],
  },
};

/**
 * 组件层兜底校验媒体 src（sanitize 之后的第二道防线）。
 * - iframe：仅放行上方白名单域名（https）
 * - img/video：仅放行 https: / data:image（仅 img） / 无协议头的相对地址（同站资源）
 * 返回 false 时调用方不渲染该元素。
 */
export function isSafeMediaSrc(src: string | undefined, kind: 'img' | 'video' | 'iframe'): boolean {
  if (!src) return false;
  if (kind === 'iframe') {
    // 协议相对地址（//host/...）按当前页协议（https）解析，视为安全
    if (src.startsWith('//')) return IFRAME_SRC_RE.test('https:' + src);
    return IFRAME_SRC_RE.test(src);
  }
  if (src.startsWith('https:') || (kind === 'img' && src.startsWith('data:image/'))) return true;
  // 无协议头的地址（/uploads/..、./、../、//cdn）由浏览器按当前页协议解析，无 javascript: 注入面
  return !/^[a-z][a-z0-9+.-]*:/i.test(src);
}
