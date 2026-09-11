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

// 注意：react-easy-crop 自带类型（index.d.ts / index.d.mts，导出 Area、Point、CropperProps 等），
// 此前手写的 ambient 声明会遮蔽真实类型（如缺少 mediaProps，导致图片加载失败无法监听），故移除。
// 与下方 @fortawesome 的处理一致：包自带类型时不再手写声明。

// 注意：@fortawesome/* 三包自带完整类型（free-solid-svg-icons / free-regular-svg-icons 的 index.d.ts
// 与 react-fontawesome 的 dist/index.d.ts），此前手写的 ambient 声明会遮蔽真实类型并造成
// 图标列表不全（未列出图标导入报错）与重复导出（faCoins/faDice 各声明两次）的问题，故移除。
// 包内子路径导入（如 @fortawesome/free-solid-svg-icons/index.js）解析不受影响。
