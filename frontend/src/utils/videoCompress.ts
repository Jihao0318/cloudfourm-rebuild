/**
 * 上传前视频处理（纯浏览器端）
 *
 * 三条路径（用户选定的组合拳）：
 *   1. 体检：读时长/分辨率 → 体积已达标（≤19MB）直接原样上传，零等待；
 *   2. 快路：浏览器支持 WebCodecs 且源是 MP4/MOV → 用硬件编码真转码（秒级到十几秒级）；
 *   3. 兜底：不支持 WebCodecs 或源是 WebM/MKV 等不便解封装的格式 → canvas + MediaRecorder
 *      录制式压缩（1× 实时，需保持页面前台，可取消）；
 *   都走不通（浏览器解不开的编码 / iOS 长视频）→ 返回明确原因，让用户剪短或改用外链。
 *
 * 依赖（mp4box / mp4-muxer）只在真正走快路时动态 import，普通浏览者不加载。
 */

export type VideoQuality = '480p' | '720p' | '1080p';

/** 与图片共用同一条 19MB 硬上限（图床限制），压缩目标留出余量 */
export const VIDEO_UPLOAD_LIMIT_BYTES = 19 * 1024 * 1024;
const VIDEO_TARGET_BYTES = 12 * 1024 * 1024;

/** 清晰度档位：目标高度 + 视频码率（音频另算 96kbps） */
export const VIDEO_QUALITY_META: Record<VideoQuality, { label: string; height: number; mbps: number }> = {
  '480p': { label: '省流 480p', height: 480, mbps: 0.9 },
  '720p': { label: '标准 720p', height: 720, mbps: 1.8 },
  '1080p': { label: '高清 1080p', height: 1080, mbps: 3.0 },
};

const AUDIO_BPS = 96 * 1024;

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  /** 需要压缩（超过 19MB） */
  needCompress: boolean;
  /** 按当前档位压缩后的预估体积 */
  estimateBytes: number;
  /** 当前档位下、压缩后不超上传上限的最长秒数 */
  maxSeconds: number;
}

export type VideoMode = 'pass' | 'webcodecs' | 'recorder' | 'blocked';

export interface VideoCompressResult {
  file: File;
  mode: VideoMode;
  originalSize: number;
  finalSize: number;
  /** 无法处理时的原因（mode='blocked' 时前端直接展示） */
  reason?: string;
  /** 直接上传时的提醒（如 MOV 在部分浏览器无法播放） */
  warning?: string;
  elapsedMs?: number;
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1);
}

/** 快路支持判断：WebCodecs 可用 + 源是 MP4/MOV（mp4box 可解封装） */
export function canFastTranscode(file: File): boolean {
  if (typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder !== 'function') return false;
  return /\.(mp4|m4v|mov)$/i.test(file.name) || ['video/mp4', 'video/quicktime'].includes(file.type);
}

function loadVideoMeta(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    const done = () => resolve(v);
    v.onloadedmetadata = () => {
      // 某些格式 loadedmetadata 时 duration 仍是 Infinity（边下边播），等一小会儿再取
      if (!Number.isFinite(v.duration)) {
        v.currentTime = 1e101;
        const onSeek = () => { v.currentTime = 0; done(); };
        v.onseeked = () => { v.onseeked = null; onSeek(); };
        setTimeout(() => { if (v.onseeked) onSeek(); }, 1500);
      } else {
        done();
      }
    };
    v.onerror = () => reject(new Error('浏览器无法解码这个视频（编码/容器不支持）'));
    v.src = url;
  });
}

/** 读元数据 + 按档位给出预估体积与可录时长 */
export async function probeVideo(file: File, quality: VideoQuality): Promise<VideoProbe> {
  const url = URL.createObjectURL(file);
  try {
    const v = await loadVideoMeta(url);
    const meta = VIDEO_QUALITY_META[quality];
    const videoBps = meta.mbps * 1e6;
    const estimateBytes = (videoBps + AUDIO_BPS) / 8 * (v.duration || 0);
    const maxSeconds = Math.floor(VIDEO_TARGET_BYTES / ((videoBps + AUDIO_BPS) / 8));
    const out = { duration: v.duration, width: v.videoWidth, height: v.videoHeight, needCompress: file.size > VIDEO_UPLOAD_LIMIT_BYTES, estimateBytes, maxSeconds };
    v.removeAttribute('src');
    v.load();
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pickRecorderMime(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export interface CompressCallbacks {
  onProgress?: (p: { phase: string; ratio: number }) => void;
  signal?: AbortSignal;
}

/**
 * 兜底路径：canvas 重绘 + MediaRecorder 录制式压缩（1× 实时）。
 * 音频经 WebAudio 接到 MediaStreamDestination（不会外放声音），与画面一起录进结果。
 */
async function compressWithRecorder(file: File, quality: VideoQuality, cb: CompressCallbacks): Promise<VideoCompressResult> {
  const meta = VIDEO_QUALITY_META[quality];
  const url = URL.createObjectURL(file);
  const started = Date.now();
  let video: HTMLVideoElement | null = null;
  let audioCtx: AudioContext | null = null;
  let recorder: MediaRecorder | null = null;
  const cleanup = () => {
    try { recorder?.state !== 'inactive' && recorder?.stop(); } catch { /* 已停止 */ }
    try { video?.pause(); } catch { /* 未播放 */ }
    if (video) { video.removeAttribute('src'); video.load(); }
    audioCtx?.close().catch(() => {});
    URL.revokeObjectURL(url);
  };
  try {
    video = await loadVideoMeta(url);
    const srcH = video.videoHeight || meta.height;
    const srcW = video.videoWidth || Math.round(meta.height * 16 / 9);
    // 不放大：源比档位矮就保持源尺寸
    const targetH = Math.min(meta.height, srcH);
    const targetW = Math.max(2, Math.round(srcW * (targetH / srcH) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 不可用');

    const mime = pickRecorderMime();
    if (!mime) throw new Error('当前浏览器不支持录制式压缩，请改用 MP4 或贴外链');

    // 音轨：元素不能静音（否则录到静音），但接到 MediaStreamDestination 不放给扬声器
    const stream = canvas.captureStream(30);
    try {
      audioCtx = new AudioContext();
      const src = audioCtx.createMediaElementSource(video);
      const dest = audioCtx.createMediaStreamDestination();
      src.connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      video.muted = false;
      video.volume = 1;
    } catch {
      // 音频处理不可用（部分浏览器/静音源）：静音输出，画面照常
      video.muted = true;
    }

    const chunks: BlobPart[] = [];
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: meta.mbps * 1e6,
      audioBitsPerSecond: AUDIO_BPS,
    });
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

    const finished = new Promise<void>((resolve) => { recorder!.onstop = () => resolve(); });
    recorder.start(1000);

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    let cancelled = false;
    const onAbort = () => { cancelled = true; try { recorder?.stop(); } catch { /* 已停止 */ } };
    cb.signal?.addEventListener('abort', onAbort, { once: true });

    await new Promise<void>((resolve, reject) => {
      const step = () => {
        if (!video) return;
        if (cancelled) return resolve();
        ctx.drawImage(video, 0, 0, targetW, targetH);
        cb.onProgress?.({ phase: '压缩中（请保持本页在前台）', ratio: duration ? Math.min(0.99, video.currentTime / duration) : 0 });
        if (video.ended || (duration && video.currentTime >= duration - 0.05)) return resolve();
        const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback;
        if (rvfc) rvfc.call(video, step);
        else requestAnimationFrame(step);
      };
      video!.onerror = () => reject(new Error('播放失败，无法压缩'));
      video!.play().then(() => step()).catch(reject);
    });

    cb.signal?.removeEventListener('abort', onAbort);
    try { recorder.stop(); } catch { /* 已停止 */ }
    await finished;
    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    const ext = type === 'video/mp4' ? 'mp4' : 'webm';
    const outName = file.name.replace(/\.[^.]+$/, '') + `-${quality}.${ext}`;
    const out = new File([blob], outName, { type });
    cleanup();
    if (cancelled) return { file, mode: 'blocked', originalSize: file.size, finalSize: file.size, reason: '已取消压缩' };
    return { file: out, mode: 'recorder', originalSize: file.size, finalSize: out.size, elapsedMs: Date.now() - started };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * 统一入口：按「体检 → 直传 / 快路 / 兜底 / 拦截」决定怎么处理。
 */
export async function compressVideoIfNeeded(
  file: File,
  quality: VideoQuality,
  cb: CompressCallbacks = {}
): Promise<VideoCompressResult> {
  // 1) 体检：体积已达标就直传，零等待
  if (file.size <= VIDEO_UPLOAD_LIMIT_BYTES) {
    const warning = /\.(mov|avi|mkv)$/i.test(file.name)
      ? '已直接上传；MOV/AVI 在部分浏览器（如 Linux 上的 Chrome）可能无法播放，建议先用工具转成 MP4'
      : undefined;
    return { file, mode: 'pass', originalSize: file.size, finalSize: file.size, warning };
  }

  // 2) iOS：长视频压缩容易被系统中断，直接引导用户剪短（用户选定的策略）
  if (isIos()) {
    return {
      file, mode: 'blocked', originalSize: file.size, finalSize: file.size,
      reason: `iPhone/iPad 上无法稳定压缩 ${(file.size / 1024 / 1024).toFixed(0)}MB 的视频，请先在相册里剪短（或选更低分辨率导出）后再上传，也可以贴视频外链`,
    };
  }

  let probe: VideoProbe | null = null;
  try {
    probe = await probeVideo(file, quality);
  } catch (err) {
    return {
      file, mode: 'blocked', originalSize: file.size, finalSize: file.size,
      reason: (err as Error).message + '，请改用 MP4 格式或贴视频外链',
    };
  }

  // 3) 时长/体积预检：压缩后预计仍超上限时，先让用户截短或降档，避免等半天才失败
  const meta = VIDEO_QUALITY_META[quality];
  if (probe.duration > probe.maxSeconds) {
    return {
      file, mode: 'blocked', originalSize: file.size, finalSize: file.size,
      reason: `视频 ${Math.round(probe.duration)} 秒，${meta.label} 档压缩后约 ${(probe.estimateBytes / 1024 / 1024).toFixed(1)}MB，超过 19MB 上限。请剪短到约 ${probe.maxSeconds} 秒以内，或改选更省流的档位`,
    };
  }

  // 4) 快路：WebCodecs 真转码（依赖动态加载）
  if (canFastTranscode(file)) {
    try {
      cb.onProgress?.({ phase: '快速转码中…', ratio: 0 });
      const { transcodeFast } = await import('./videoFastTranscode');
      const out = await transcodeFast(file, quality, cb);
      return { ...out, mode: 'webcodecs', elapsedMs: out.elapsedMs };
    } catch (err) {
      // 快路失败（编解码器不支持、文件损坏等）→ 落到兜底路径再试一次
      console.warn('[video] 快路转码失败，改用录制式压缩:', err);
    }
  }

  // 5) 兜底：canvas + MediaRecorder 录制式压缩
  try {
    return await compressWithRecorder(file, quality, cb);
  } catch (err) {
    return {
      file, mode: 'blocked', originalSize: file.size, finalSize: file.size,
      reason: (err as Error).message || '压缩失败，请改用 MP4 或贴视频外链',
    };
  }
}
