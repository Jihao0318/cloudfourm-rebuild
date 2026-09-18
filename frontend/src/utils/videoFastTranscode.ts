/**
 * 视频快路：WebCodecs 真转码（MP4/MOV → H.264/AAC）
 *
 * 为什么需要它：MediaRecorder 录制式压缩是 1× 实时的（3 分钟视频等 3 分钟），
 * 而 WebCodecs 走硬件编解码，同一条视频通常几秒到几十秒就能完成。
 *
 * 流程：mp4box 解封装 → VideoDecoder 解 → canvas 缩放到目标分辨率 → VideoEncoder 重编码
 *       → mp4-muxer 封装；音轨不重编码，按 AAC 原样透传（避免音质二次损失，也省一半工作量）。
 *
 * 只在真正需要压缩、且浏览器支持 WebCodecs、且源文件是 MP4/MOV 时才会被动态 import。
 * 任何一步不支持/失败都抛错，由调用方回落到录制式压缩那条路。
 */
import { createFile, DataStream, type ISOFile, type MP4BoxBuffer, type Sample } from 'mp4box';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { VIDEO_QUALITY_META, type CompressCallbacks, type VideoQuality } from './videoCompress';

/** 超过这个体积就不走快路：整段读进内存 + 解码帧队列容易把标签页撑爆，交给录制式路径（内存占用低得多） */
const FAST_PATH_MAX_BYTES = 300 * 1024 * 1024;

/** AAC 采样率索引表（AudioSpecificConfig 用） */
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** AAC-LC 的 2 字节 AudioSpecificConfig（mp4-muxer 需要它作为解码器描述） */
function aacSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const idx = AAC_RATES.indexOf(sampleRate);
  if (idx < 0) throw new Error('音轨采样率不受支持');
  const objectType = 2; // AAC-LC
  const bits = (objectType << 11) | (idx << 7) | (channels << 3);
  return new Uint8Array([(bits >> 8) & 0xff, bits & 0xff]);
}

/** 取视频轨的 avcC（H.264 解码器配置描述），VideoDecoder 需要它按 AVCC 格式解码 */
function avcCDescription(iso: ISOFile, trackId: number): Uint8Array {
  const trak = iso.getTrackById(trackId) as unknown as {
    mdia: { minf: { stbl: { stsd: { entries: Array<{ avcC?: { write: (s: DataStream) => void } }> } } } };
  };
  const avcC = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC;
  if (!avcC) throw new Error('取不到 H.264 解码配置');
  // 默认即大端序（DataStream 构造第三个参数缺省为 BIG_ENDIAN）
  const stream = new DataStream(undefined, 0);
  avcC.write(stream);
  // 去掉 box 头（4 字节 size + 4 字节 type），WebCodecs 只要 box 内容
  return new Uint8Array(stream.buffer as ArrayBuffer).slice(8);
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** 按分辨率挑一个浏览器支持的 H.264 编码器配置（从高到低试） */
async function pickEncoderConfig(width: number, height: number, bitrate: number): Promise<VideoEncoderConfig> {
  const candidates = height > 720
    ? ['avc1.640028', 'avc1.4d0028', 'avc1.42E01E']   // High/ Main 4.0 / Baseline
    : height > 480
      ? ['avc1.4d001f', 'avc1.42E01E', 'avc1.42001f'] // Main 3.1 / Baseline
      : ['avc1.42E01E', 'avc1.42001e', 'avc1.4d001e'];
  for (const codec of candidates) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: 30, avc: { format: 'avc' } };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return config;
    } catch { /* 试下一个 */ }
  }
  throw new Error('浏览器不支持 H.264 编码（WebCodecs）');
}

export interface FastTranscodeResult {
  file: File;
  originalSize: number;
  finalSize: number;
  elapsedMs: number;
}

export async function transcodeFast(file: File, quality: VideoQuality, cb: CompressCallbacks): Promise<FastTranscodeResult> {
  if (file.size > FAST_PATH_MAX_BYTES) throw new Error('文件过大，改用录制式压缩');
  const started = Date.now();
  const meta = VIDEO_QUALITY_META[quality];
  const buffer = await file.arrayBuffer();

  // ── 1. 解封装 ──
  const iso = createFile();
  const info = await new Promise<{ videoTracks: any[]; audioTracks: any[] }>((resolve, reject) => {
    iso.onReady = (i: any) => resolve(i);
    iso.onError = (e: unknown) => reject(new Error('解析 MP4 失败: ' + String(e)));
    // mp4box 要求 ArrayBuffer 上带 fileStart（其内部约定），这里补上
    (buffer as MP4BoxBuffer).fileStart = 0;
    iso.appendBuffer(buffer as MP4BoxBuffer);
    iso.flush();
  });

  const vTrack = info.videoTracks?.[0];
  if (!vTrack) throw new Error('文件里没有视频轨');
  const aTrack = info.audioTracks?.[0];

  const srcW = vTrack.video?.width || vTrack.track_width || 0;
  const srcH = vTrack.video?.height || vTrack.track_height || 0;
  if (!srcW || !srcH) throw new Error('读不到视频尺寸');
  const targetH = Math.min(meta.height, srcH);
  const targetW = even(srcW * (targetH / srcH));

  // ── 2. 音轨：仅 AAC 透传（其他编码交给录制式路径处理，避免把声音弄丢） ──
  let audioDesc: { description: Uint8Array; sampleRate: number; numberOfChannels: number } | null = null;
  if (aTrack) {
    const codec = String(aTrack.codec || '');
    if (!/^mp4a\.40\.(2|1)$/.test(codec)) throw new Error('音轨不是 AAC，改用录制式压缩');
    const sampleRate = aTrack.audio?.sample_rate || 48000;
    const numberOfChannels = aTrack.audio?.channel_count || 2;
    audioDesc = { description: aacSpecificConfig(sampleRate, numberOfChannels), sampleRate, numberOfChannels };
  }

  // ── 3. 输出封装 ──
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: targetW, height: targetH },
    ...(audioDesc ? { audio: { codec: 'aac', numberOfChannels: audioDesc.numberOfChannels, sampleRate: audioDesc.sampleRate } } : {}),
    fastStart: 'in-memory',
  });

  const encoderConfig = await pickEncoderConfig(targetW, targetH, Math.round(meta.mbps * 1e6));
  let encoderError: Error | null = null;
  let firstVideoChunk = true;
  const encoder = new VideoEncoder({
    output: (chunk, chunkMeta) => {
      muxer.addVideoChunk(chunk, chunkMeta);
      firstVideoChunk = false;
    },
    error: (e) => { encoderError = e as Error; },
  });
  encoder.configure(encoderConfig);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let firstAudioChunk = true;
  let decoded = 0;
  let totalVideoSamples = 0;

  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        ctx.drawImage(frame, 0, 0, targetW, targetH);
        const ts = frame.timestamp;
        const dur = frame.duration || Math.round(1e6 / 30);
        frame.close();
        const out = new VideoFrame(canvas, { timestamp: ts, duration: dur });
        encoder.encode(out, { keyFrame: decoded % 60 === 0 });
        out.close();
        decoded++;
        cb.onProgress?.({ phase: '快速转码中', ratio: totalVideoSamples ? Math.min(0.98, decoded / totalVideoSamples) : 0 });
      } catch (e) {
        encoderError = e as Error;
      }
    },
    error: (e) => { encoderError = e as Error; },
  });

  const vTimescale = vTrack.timescale || 1000;
  decoder.configure({
    codec: String(vTrack.codec),
    description: avcCDescription(iso, vTrack.id),
    codedWidth: srcW,
    codedHeight: srcH,
  });

  // ── 4. 逐样本推进（视频解→编，音频直通） ──
  const sampleQueue: Array<{ kind: 'v' | 'a'; sample: Sample }> = [];
  iso.onSamples = (id: number, _user: unknown, samples: Sample[]) => {
    const kind: 'v' | 'a' = id === vTrack.id ? 'v' : 'a';
    if (kind === 'v') totalVideoSamples += samples.length;
    for (const s of samples) sampleQueue.push({ kind, sample: s });
  };
  iso.setExtractionOptions(vTrack.id, null, { nbSamples: 30 });
  if (aTrack) iso.setExtractionOptions(aTrack.id, null, { nbSamples: 60 });
  iso.start();

  // 解封装回调是同步刷出来的，这里按队列消费并做背压控制
  const aTimescale = aTrack?.timescale || vTimescale;
  let cursor = 0;
  while (true) {
    if (cb.signal?.aborted) throw new Error('已取消');
    if (encoderError) throw encoderError;
    if (cursor >= sampleQueue.length) {
      // 队列暂时空：等解封装回调继续产出
      if (cursor > 0 && decoded >= totalVideoSamples && totalVideoSamples > 0) break;
      await new Promise(r => setTimeout(r, 15));
      if (cursor >= sampleQueue.length && totalVideoSamples > 0 && decoded >= totalVideoSamples) break;
      continue;
    }
    const { kind, sample } = sampleQueue[cursor++];
    // 末尾样本可能不带 data（mp4box 类型里 data 可选）——跳过即可
    const sampleData = sample.data;
    if (!sampleData) continue;
    if (kind === 'v') {
      decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: (sample.cts * 1e6) / vTimescale,
        duration: (sample.duration * 1e6) / vTimescale,
        data: sampleData,
      }));
      // 背压：解码/编码队列积压时让出线程
      while (encoder.encodeQueueSize > 12 || decoder.decodeQueueSize > 24) {
        await new Promise(r => setTimeout(r, 20));
        if (encoderError) throw encoderError;
      }
    } else if (audioDesc) {
      muxer.addAudioChunk(new EncodedAudioChunk({
        type: 'key',
        timestamp: (sample.cts * 1e6) / aTimescale,
        duration: (sample.duration * 1e6) / aTimescale,
        data: sampleData,
      }), firstAudioChunk
        ? { decoderConfig: { codec: 'mp4a.40.2', description: audioDesc.description, sampleRate: audioDesc.sampleRate, numberOfChannels: audioDesc.numberOfChannels } }
        : undefined);
      firstAudioChunk = false;
    }
    // 释放样本占用的内存
    (sample as unknown as { data: ArrayBuffer | null }).data = null;
  }

  await decoder.flush();
  await encoder.flush();
  decoder.close();
  encoder.close();
  muxer.finalize();
  if (!firstVideoChunk) { /* 有输出 */ }

  const outBuf = target.buffer;
  if (!outBuf || outBuf.byteLength === 0) throw new Error('转码结果为空');
  const outName = file.name.replace(/\.[^.]+$/, '') + `-${quality}.mp4`;
  const out = new File([outBuf], outName, { type: 'video/mp4' });
  return { file: out, originalSize: file.size, finalSize: out.size, elapsedMs: Date.now() - started };
}
