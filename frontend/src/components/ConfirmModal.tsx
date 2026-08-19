import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open, title, message, confirmText = '确定', cancelText = '取消',
  danger = false, loading = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // 锁定背景滚动；保存前值以便嵌套弹窗（如 PostEffectModal 内嵌 ItemDetailModal）按 LIFO 正确恢复
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // 聚焦确认按钮，方便键盘操作
    setTimeout(() => confirmRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  // portal 到 body：页面内渲染时若被困在 main z-10 堆叠上下文，遮罩实际层级只有 10，
  // 会被根级底部导航 z-50 / 回到顶部 z-40 压住（遮罩不压暗、按钮浮层）——portal 后 z-[60] 真实生效
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      {/* 弹窗 */}
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end flex-wrap max-[380px]:flex-col">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 min-h-[40px] rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50 max-[380px]:w-full"
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 min-h-[40px] rounded-xl text-sm font-medium text-white transition disabled:opacity-50 max-[380px]:w-full ${
              danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {loading ? '处理中...' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
