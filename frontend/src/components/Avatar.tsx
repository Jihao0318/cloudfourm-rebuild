// 通用头像组件 — 支持头像框（过期自动隐藏）
// 头像框 = 管理后台添加的透明 PNG（图片直链），DB 表 avatar_frames（scale/offset 滑杆调参）。
// 渲染模型：头像填满容器，框图叠在上层 —— left/top = 容器中心 + offset，
// width = scale × 容器宽，translate(-50%,-50%) 居中；装饰超出/遮挡头像属于设计效果。
import { useState, useEffect } from 'react';
import { avatarFramesApi } from '../services/api';

interface AvatarProps {
  url?: string | null;
  username?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  frame?: string | null;
  frameExpiresAt?: string | null;
}

const sizeMap = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-14 h-14 text-xl',
};

export interface AvatarFrameDef {
  id: number;
  name: string;
  image_url: string;
  scale: number;
  offset_x: number;
  offset_y: number;
}

// 模块级缓存：全站头像共用一次拉取；后台改框后刷新页面生效
let frameCache: AvatarFrameDef[] | null = null;
let framePromise: Promise<AvatarFrameDef[]> | null = null;
const frameListeners = new Set<() => void>();

function loadFrames(): Promise<AvatarFrameDef[]> {
  if (framePromise) return framePromise;
  framePromise = avatarFramesApi.list()
    .then(r => { frameCache = r.success && r.data ? r.data : []; frameListeners.forEach(l => l()); return frameCache; })
    .catch(() => { frameCache = []; frameListeners.forEach(l => l()); return frameCache; });
  return framePromise;
}

// 后台增删改头像框后调用：清缓存并重新拉取，全站 Avatar 立即拿到新清单
export function reloadAvatarFrames() {
  framePromise = null;
  frameCache = null;
  return loadFrames();
}

// 订阅模块缓存的 hook：首个 Avatar 触发拉取，完成后全站重渲染
function useAvatarFrames(): AvatarFrameDef[] | null {
  const [frames, setFrames] = useState<AvatarFrameDef[] | null>(frameCache);
  useEffect(() => {
    if (frameCache) { setFrames(frameCache); return; }
    const l = () => setFrames(frameCache);
    frameListeners.add(l);
    loadFrames();
    return () => { frameListeners.delete(l); };
  }, []);
  return frames;
}

export default function Avatar({ url, username, size = 'md', className = '', frame, frameExpiresAt }: AvatarProps) {
  const sizeClass = sizeMap[size];
  const frames = useAvatarFrames();

  // 头像框过期检查
  const frameValid = frame && (!frameExpiresAt || new Date(frameExpiresAt) > new Date());
  const frameDef = frameValid && frames ? frames.find(f => String(f.id) === String(frame)) : undefined;
  // CSS 兜底：无匹配图片框时的 ring（含历史 default 值）
  const frameClass = frameValid && !frameDef ? 'ring-2 ring-amber-400' : '';

  const img = url ? (
    <img
      src={url}
      alt={username || '头像'}
      loading="lazy"
      className={`${sizeClass} rounded-full object-cover flex-shrink-0 ${frameClass} ${className}`}
    />
  ) : (
    <div className={`${sizeClass} bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-bold flex-shrink-0 ${frameClass} ${className}`}>
      {username?.[0]?.toUpperCase() || '?'}
    </div>
  );

  // 图片型头像框：容器承载全部尺寸类（sizeClass + className——调用方传响应式尺寸类时
  // 必须由容器承载，否则头像撑大而框仍按容器定位 → Profile 等页比例错位），头像层 w-full h-full
  // 填满容器；框图按 scale/offset 叠加在头像上层（超容部分可见，装饰遮挡头像属设计效果）。
  if (frameValid && frameDef) {
    return (
      <div className={`relative ${sizeClass} ${className} flex-shrink-0`}>
        {url ? (
          <img src={url} alt={username || '头像'} loading="lazy"
            className={`w-full h-full rounded-full object-cover ${frameClass}`} />
        ) : (
          <div className={`w-full h-full bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-bold ${frameClass}`}>
            {username?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <img src={frameDef.image_url} alt="" aria-hidden
          className="absolute pointer-events-none max-w-none"
          style={{
            left: `calc(50% + ${frameDef.offset_x}%)`,
            top: `calc(50% + ${frameDef.offset_y}%)`,
            width: `${frameDef.scale * 100}%`,
            transform: 'translate(-50%, -50%)',
          }} />
      </div>
    );
  }

  return img;
}
