import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';

interface CropModalProps {
  image: string;
  aspect: number;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}

// 将裁剪结果导出为 Blob
function getCroppedBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (imageSrc.startsWith('http')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D not supported')); return; }
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

export default function CropModal({ image, aspect, onCrop, onCancel }: CropModalProps) {
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedPixels(croppedAreaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedPixels) return;
    try {
      const blob = await getCroppedBlob(image, croppedPixels);
      onCrop(blob);
    } catch (err) {
      console.error('Crop failed:', err);
    }
  };

  // portal 到 body：避免被困在 main z-10 堆叠上下文内（否则层级实际只有 10，
  // 移动端底部导航 z-50 会盖住底部缩放滑块，裁剪功能不可用）；
  // z-[90] 低于全局 Toast z-[100]
  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/80 flex flex-col" onClick={e => e.stopPropagation()}>
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-2 md:px-4 md:py-3 bg-black/60 text-white shrink-0">
        <button onClick={onCancel} className="text-sm opacity-70 hover:opacity-100 min-h-10 min-w-10 flex items-center justify-center">取消</button>
        <span className="text-xs md:text-sm font-medium">调整图片</span>
        <button onClick={handleConfirm} className="text-sm text-primary-400 hover:text-primary-300 font-medium min-h-10 min-w-10 flex items-center justify-center">确认</button>
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
        />
      </div>

      {/* 缩放滑块 — pb 用 max() 保留原有 10px 底距，Home Indicator 存在时再叠加安全区 */}
      <div className="flex items-center gap-3 px-4 py-2.5 md:px-6 md:py-4 bg-black/60 shrink-0 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
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
    </div>,
    document.body
  );
}
