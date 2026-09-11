/**
 * 上传前图片压缩（纯浏览器端，无第三方依赖）
 *
 * 体积链路上的两道硬限制（取更严的为准）：
 *   - forum-worker 后端 /upload/image：20MB
 *   - 图床（Telegraph-Image）：19MB（图片先走 Telegram sendPhoto，超限自动回退 sendDocument）
 * 因此上传上限记为 19MB，压缩目标设为 8MB，留足余量。
 *
 * 策略（类似微信发图，够用就好）：
 *   1. 小图（≤ 2MB）与不可压缩类型（GIF 动图、SVG）原样上传，不重新编码；
 *   2. 超限时按「像素预算 16MP + 单边 4096」缩放，再逐级降质量，直到 ≤ 8MB；
 *   3. 若压缩结果反而更大（已高度压缩过的图），保留原文件不上采样。
 */

/** 图床 19MB 硬上限（后端 20MB，取更严的） */
export const UPLOAD_LIMIT_BYTES = 19 * 1024 * 1024;
/** 低于该体积不压缩：小图重编码只会掉质量、白等时间 */
const SKIP_BELOW_BYTES = 2 * 1024 * 1024;
/** 压缩目标：远低于 19MB 上限，兼顾上传速度 */
const TARGET_BYTES = 8 * 1024 * 1024;
/** 像素预算与单边上限：手机原图动辄 48MP，先降到画布/带宽都舒适的量级 */
const MAX_PIXELS = 16e6;
const MAX_DIMENSION = 4096;
/** 逐级降质档位（先画质后尺寸，避免一上来就糊） */
const QUALITY_LADDER = [0.92, 0.84, 0.76, 0.68];

export interface CompressResult {
  /** 实际应上传的文件（未压缩时即原文件） */
  file: File;
  originalSize: number;
  finalSize: number;
  compressed: boolean;
  /** 未压缩时的原因，便于排查/统计 */
  reason?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** GIF（可能是动图）、SVG（矢量）不做位图重编码 */
export function isCompressibleImage(file: File): boolean {
  if (!file.type.startsWith('image/')) return false;
  return !['image/gif', 'image/svg+xml'].includes(file.type);
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// 保留 alpha 用 WebP；不支持 WebP 编码的环境（老 Safari）回退 JPEG
async function pickOutputType(sourceType: string): Promise<string> {
  if (sourceType === 'image/jpeg' || sourceType === 'image/jpg') return 'image/jpeg';
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const blob = await canvasToBlob(probe, 'image/webp', 0.8);
  return blob && blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
}

function withNewExtension(name: string, type: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${type === 'image/webp' ? 'webp' : 'jpg'}`;
}

function drawToCanvas(img: HTMLImageElement, width: number, height: number, flattenToWhite: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // JPEG 无透明通道，先铺白底，否则透明区域会变黑
  if (flattenToWhite) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/**
 * 按需压缩：返回可直接上传的文件。任何失败都退回原文件，绝不阻塞上传。
 */
export async function compressImageIfNeeded(file: File): Promise<CompressResult> {
  const untouched = (reason: string): CompressResult =>
    ({ file, originalSize: file.size, finalSize: file.size, compressed: false, reason });

  if (!isCompressibleImage(file)) return untouched('skip-type');
  if (file.size <= SKIP_BELOW_BYTES) return untouched('skip-small');

  const url = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImageFromUrl(url);
    } catch {
      return untouched('decode-failed'); // 浏览器不认识的格式（如 HEIC）→ 原样上传，由后端给明确错误
    }

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    if (!srcW || !srcH) return untouched('decode-failed');

    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (srcW * srcH)), MAX_DIMENSION / Math.max(srcW, srcH));
    if (scale >= 1 && file.size <= TARGET_BYTES) return untouched('skip-target');

    const type = await pickOutputType(file.type);
    const flatten = type === 'image/jpeg';
    let width = Math.max(1, Math.round(srcW * scale));
    let height = Math.max(1, Math.round(srcH * scale));
    let best: Blob | null = null;

    // 最多三轮：首轮按目标尺寸逐级降质，仍超目标则整体缩到 70% 再试
    for (let round = 0; round < 3; round++) {
      const canvas = drawToCanvas(img, width, height, flatten);
      for (const quality of QUALITY_LADDER) {
        const blob = await canvasToBlob(canvas, type, quality);
        if (!blob) continue;
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= TARGET_BYTES) break;
      }
      if (best && best.size <= TARGET_BYTES) break;
      width = Math.max(1, Math.round(width * 0.7));
      height = Math.max(1, Math.round(height * 0.7));
    }

    if (!best) return untouched('encode-failed');
    if (best.size >= file.size) return untouched('no-gain');

    return {
      file: new File([best], withNewExtension(file.name, best.type), { type: best.type, lastModified: Date.now() }),
      originalSize: file.size,
      finalSize: best.size,
      compressed: true,
    };
  } catch {
    return untouched('error');
  } finally {
    URL.revokeObjectURL(url);
  }
}
