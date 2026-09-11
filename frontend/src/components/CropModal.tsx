import { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';

interface CropModalProps {
  file: File;
  aspect: number;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}

// 将裁剪结果导出为 Blob
function getCroppedBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D not supported')); return; }
      // 导出固定为 JPEG（无透明通道），先铺白底，否则 PNG 的透明区域会变成黑块
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, pixelCrop.width, pixelCrop.height);
      ctx.drawImage(
        img, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
        0, 0, pixelCrop.width, pixelCrop.height
      );
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/jpeg', 0.9);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageSrc;
  });
}

export default function CropModal({ file, aspect, onCrop, onCancel }: CropModalProps) {
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  // object URL 随文件只创建一次、卸载时释放：写在渲染里会导致每次重渲染都新建地址，
  // 图片反复重载（裁剪位置/缩放被重置）且旧地址永久泄漏
  const image = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => { URL.revokeObjectURL(image); }, [image]);

  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedPixels(croppedAreaPixels);
  }, []);

  const handleMediaError = useCallback(() => setLoadFailed(true), []);

  const handleConfirm = async () => {
    if (busy) return;
    // 图片未就绪时给出提示而非静默返回（否则用户点「确认」毫无反应，无从判断）
    if (!croppedPixels) {
      setError('图片还没加载完成，请稍候；若一直如此请换一张图片');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const blob = await getCroppedBlob(image, croppedPixels);
      onCrop(blob);
    } catch (err) {
      console.error('Crop failed:', err);
      setError('图片处理失败，请重试或换一张图片');
    }
    setBusy(false);
  };

  const hint = error || (loadFailed ? '图片加载失败，请返回重新选择' : '');

  // portal 到 body：避免被困在 main z-10 堆叠上下文内（否则层级实际只有 10，
  // 移动端底部导航 z-50 会盖住底部缩放滑块，裁剪功能不可用）；
  // z-[90] 低于全局 Toast z-[100]
  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/80 flex flex-col" onClick={e => e.stopPropagation()}>
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-2 md:px-4 md:py-3 bg-black/60 text-white shrink-0">
        <button onClick={onCancel} className="text-sm opacity-70 hover:opacity-100 min-h-10 min-w-10 flex items-center justify-center">取消</button>
        <span className="text-xs md:text-sm font-medium">调整图片</span>
        <button onClick={handleConfirm} disabled={busy}
          className="text-sm text-primary-400 hover:text-primary-300 font-medium min-h-10 min-w-10 flex items-center justify-center disabled:opacity-50">
          {busy ? '处理中…' : '确认'}
        </button>
      </div>

      {/* 裁剪区域 — 固定 flex-1 确保占满剩余空间 */}
      <div className="flex-1 relative min-h-0">
        <Cropper
          image={image}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          mediaProps={{ onError: handleMediaError }}
        />
      </div>

      {/* 底部：错误提示 + 缩放滑块（pb 用 max() 保留原有 10px 底距，Home Indicator 存在时再叠加安全区） */}
      <div className="shrink-0 bg-black/60">
        {hint && <p className="px-4 pt-2 text-xs text-red-400 text-center">{hint}</p>}
        <div className="flex items-center gap-3 px-4 py-2.5 md:px-6 md:py-4 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
          <span className="text-white/60 text-xs">缩小</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1 accent-primary-500 h-1.5"
          />
          <span className="text-white/60 text-xs">放大</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
