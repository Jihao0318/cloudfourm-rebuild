import { useState, useEffect, useRef } from 'react';
import { parseMediaTokens, reorderMediaTokens, removeMediaToken, moveToken, type MediaToken } from '../utils/mediaTokens';

/**
 * 媒体管理条：把正文里的图片/视频按出现顺序列成缩略图，支持排序（拖拽 或 ← → 按钮）与删除。
 *
 * - 折叠态只显示一行摘要「媒体（3 图 · 1 视频）」，点击展开（用户选定的形态）
 * - 操作直接改写正文里的标记顺序/删除该标记，正文仍是唯一数据源
 * - 上传新文件后由父组件递增 expandSignal 自动展开，让用户看到刚传进来的东西
 */
interface MediaManagerProps {
  value: string;
  onChange: (next: string) => void;
  /** 递增该值即自动展开（上传完成后用） */
  expandSignal?: number;
  /** 点击缩略图：把该媒体标记插到光标处 */
  onInsertToken?: (token: MediaToken) => void;
}

export default function MediaManager({ value, onChange, expandSignal = 0, onInsertToken }: MediaManagerProps) {
  const [expanded, setExpanded] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const lastSignal = useRef(expandSignal);

  // 上传后自动展开（首次挂载不展开）
  useEffect(() => {
    if (expandSignal !== lastSignal.current) {
      lastSignal.current = expandSignal;
      if (expandSignal > 0) setExpanded(true);
    }
  }, [expandSignal]);

  const tokens = parseMediaTokens(value);
  const imageCount = tokens.filter(t => t.kind === 'image').length;
  const videoCount = tokens.length - imageCount;

  if (tokens.length === 0) return null;

  const applyOrder = (order: MediaToken[]) => onChange(reorderMediaTokens(value, order));

  const handleDrop = (to: number) => {
    if (dragIndex === null || dragIndex === to) { setDragIndex(null); setOverIndex(null); return; }
    const order = [...tokens];
    const [moved] = order.splice(dragIndex, 1);
    order.splice(to, 0, moved);
    setDragIndex(null);
    setOverIndex(null);
    applyOrder(order);
  };

  const summary = `媒体（${imageCount} 图${videoCount ? ` · ${videoCount} 视频` : ''}）`;

  return (
    <div className="border-t border-gray-200 bg-gray-50/60">
      {/* 折叠头（点击展开/收起） */}
      <button type="button" onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-5 py-2 text-xs text-gray-600 hover:text-gray-900 transition">
        <span className="font-medium">{summary}</span>
        <span className="text-gray-400">{expanded ? '点击收起' : '点击展开（可排序 / 删除）'}</span>
        <span className="ml-auto text-gray-400">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-3">
          <div className="flex gap-2.5 overflow-x-auto pb-2">
            {tokens.map((t, i) => (
              <div key={`${t.kind}-${t.url}-${i}`}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                onDragOver={e => { e.preventDefault(); setOverIndex(i); }}
                onDragLeave={() => setOverIndex(prev => (prev === i ? null : prev))}
                onDrop={e => { e.preventDefault(); handleDrop(i); }}
                className={`relative shrink-0 w-[92px] rounded-lg border bg-white cursor-grab transition ${
                  dragIndex === i ? 'opacity-40' : ''
                } ${overIndex === i && dragIndex !== null && dragIndex !== i ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200'}`}
              >
                <span className="absolute top-1 left-1 z-10 bg-black/55 text-white text-[10px] rounded px-1.5 py-0.5">{i + 1}</span>
                <div
                  className="w-full h-16 rounded-t-lg overflow-hidden bg-gray-900 flex items-center justify-center cursor-pointer"
                  title={onInsertToken ? '点击插入到光标处' : undefined}
                  onClick={() => onInsertToken?.(t)}
                >
                  {t.kind === 'image' ? (
                    <img src={t.url} alt={t.alt} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    // 视频：用 preload=metadata + #t=0.1 取首帧当缩略图（不下载整个视频）
                    <video src={`${t.url}#t=0.1`} preload="metadata" muted playsInline
                      className="w-full h-full object-cover pointer-events-none" />
                  )}
                </div>
                <div className="flex border-t border-gray-200">
                  <button type="button" title="前移" disabled={i === 0}
                    onClick={() => applyOrder(moveToken(tokens, i, -1))}
                    className="flex-1 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent">←</button>
                  <button type="button" title="后移" disabled={i === tokens.length - 1}
                    onClick={() => applyOrder(moveToken(tokens, i, 1))}
                    className="flex-1 py-1 text-xs text-gray-600 border-l border-gray-200 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent">→</button>
                  <button type="button" title="从正文删除"
                    onClick={() => onChange(removeMediaToken(value, t))}
                    className="flex-1 py-1 text-xs text-gray-600 border-l border-gray-200 hover:bg-red-50 hover:text-red-600">✕</button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">
            拖动缩略图可排序，或用 ← → 按钮；✕ 只删除正文里的这一处标记（同一张图被引用多次时互不影响）
          </p>
        </div>
      )}
    </div>
  );
}
