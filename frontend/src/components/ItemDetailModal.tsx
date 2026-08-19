import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  name: string;
  description?: string;
  detail?: string;
  price?: number;
  onClose: () => void;
}

// 道具详情弹窗：列表里只显示简短描述，完整特性点「查看详情」弹出
export default function ItemDetailModal({ open, name, description, detail, price, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    // 锁定背景滚动；保存前值以便嵌套弹窗按 LIFO 正确恢复
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  if (!open) return null;
  // portal 到 body：避免被困在 main z-10 堆叠上下文（否则遮罩盖不住根级底部导航 z-50）；
  // z-[95] 高于 PostEffectModal z-[90]（嵌套详情弹窗盖在父弹窗上）、低于全局 Toast z-[100]
  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#111] rounded-2xl w-full max-w-sm shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{name}</h3>
            {typeof price === 'number' && (
              <span className="shrink-0 bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 font-bold px-2 py-0.5 rounded text-xs">{price} 🪙</span>
            )}
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center text-gray-500 text-sm shrink-0">✕</button>
        </div>
        <div className="p-5">
          {description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{description}</p>}
          {detail && (
            <div className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line bg-gray-50 dark:bg-gray-900 rounded-xl p-3.5">
              {detail}
            </div>
          )}
          {!detail && <p className="text-xs text-gray-400">暂无更多说明</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
