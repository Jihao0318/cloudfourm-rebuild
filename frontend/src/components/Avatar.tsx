// 通用头像组件 — 支持头像框样式（过期自动隐藏）
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

// 头像框定义：className = CSS 边框样式（拼到头像元素上）；img = 透明底图片边框（叠加渲染，见 assets/frames/README.md）
// 【后续接入图片型头像框的步骤】
// 1. 图片放 src/assets/frames/frame-{英文名}.png：512×512 透明 PNG，内孔直径 = 画布 80% 最佳（规范见 README）；
// 2. 顶部用 import 引入图片（必须 import，不能写字符串相对路径——Vite 不处理运行时字符串路径会 404）；
// 3. FRAME_STYLES 新增条目 { img: frameXxx, scale }，scale = 100 / 内孔占画布比例（内孔 80% → 1.25），
//    使头像恰好填满内孔、环带套在头像外圈；图片资源删除/换图后此条目同步处理。
interface FrameDef {
  className?: string;
  img?: string;
  scale?: number; // 图片框渲染缩放倍数（= 100 / 内孔占画布比例），默认 1.25
}

const FRAME_STYLES: Record<string, FrameDef> = {
  default: { className: 'ring-2 ring-purple-400 shadow-lg shadow-purple-200' },
};

export default function Avatar({ url, username, size = 'md', className = '', frame, frameExpiresAt }: AvatarProps) {
  const sizeClass = sizeMap[size];

  // 头像框过期检查
  const frameValid = frame && (!frameExpiresAt || new Date(frameExpiresAt) > new Date());
  const frameDef = frameValid ? FRAME_STYLES[frame!] : undefined;
  // 未知 frame 值兜底 amber ring（CSS 类）；图片型只叠加图片，不额外加 ring
  const frameClass = frameValid && !frameDef?.img ? (frameDef?.className || 'ring-2 ring-amber-400') : '';

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

  // 图片型头像框渲染（当前 FRAME_STYLES 无图片型条目，此分支为预留）：
  // - 容器必须承载全部尺寸类（sizeClass + className）——调用方若传响应式尺寸类（如 Profile 的
  //   w-20 h-20 md:w-24 md:h-24），需同时拼到容器上，否则头像会溢出容器（历史 bug 根因）；
  // - 头像层/字母层 w-full h-full 填满容器；边框图 absolute inset-0 + transform: scale(scale)
  //   等比外扩（不改变布局盒），环带自然套在头像外圈；
  // - 已知坑：① 不要用 CSS border-image（与 border-radius 不兼容，圆形场景必错位）；
  //   ② 边框 img 不加 rounded-full / object-cover（透明 PNG 自带形状）。
  if (frameValid && frameDef?.img) {
    return (
      <div className={`relative ${sizeClass} flex-shrink-0`}>
        {img}
        <img src={frameDef.img} alt="" aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" />
      </div>
    );
  }

  return img;
}
