// 第三方包类型声明 — 这些包没有自带的 @types 声明
declare module 'react-loading-skeleton' {
  import type { FC, CSSProperties } from 'react';
  interface SkeletonProps {
    count?: number;
    height?: number | string;
    width?: number | string;
    circle?: boolean;
    className?: string;
    style?: CSSProperties;
    containerClassName?: string;
    containerTestId?: string;
  }
  const Skeleton: FC<SkeletonProps>;
  export default Skeleton;
}

declare module 'react-easy-crop' {
  import type { FC } from 'react';
  interface CropData {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  interface CropperProps {
    image: string;
    crop: { x: number; y: number };
    zoom: number;
    aspect?: number;
    onCropChange: (crop: { x: number; y: number }) => void;
    onZoomChange: (zoom: number) => void;
    onCropComplete?: (croppedArea: CropData, croppedAreaPixels: CropData) => void;
    maxZoom?: number;
    minZoom?: number;
    style?: { containerStyle?: CSSProperties; mediaStyle?: CSSProperties };
  }
  const Cropper: FC<CropperProps>;
  export default Cropper;
  export type { CropData };
  export type Area = CropData;
  export type Point = { x: number; y: number };
}

// 注意：@fortawesome/* 三包自带完整类型（free-solid-svg-icons / free-regular-svg-icons 的 index.d.ts
// 与 react-fontawesome 的 dist/index.d.ts），此前手写的 ambient 声明会遮蔽真实类型并造成
// 图标列表不全（未列出图标导入报错）与重复导出（faCoins/faDice 各声明两次）的问题，故移除。
// 包内子路径导入（如 @fortawesome/free-solid-svg-icons/index.js）解析不受影响。
