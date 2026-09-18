import { useState, useEffect, useRef } from 'react';
import { parseMediaTokens, reorderMediaTokens, removeMediaToken, moveToken, type MediaToken } from '../utils/mediaTokens';

/**
 * 媒体管理条：把正文里的图片/视频按出现顺序列成缩略图，用 ← → 按钮调整顺序、✕ 删除。
 *
 * - 折叠态只显示一行摘要「媒体（3 图 · 1 视频）」，点击展开
 * - 操作直接改写正文里的标记顺序/删除该标记，正文仍是唯一数据源
 * - 上传新文件后由父组件递增 expandSignal 自动展开，让用户看到刚传进来的东西
 * - 不提供拖拽排序（2026-09-18 用户要求彻底禁用）：原生拖拽（长按触发）会卡死页面，
 *   一律改用按钮，页面上不再有任何 draggable 元素
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
                style={{ WebkitTouchCallout: 'none', userSelect: 'none', touchAction: 'manipulation' }}
                className="relative shrink-0 w-[92px] rounded-lg border border-gray-200 bg-white"
              >
                <span className="absolute top-1 left-1 z-10 bg-black/55 text-white text-[10px] rounded px-1.5 py-0.5">{i + 1}</span>
                <div
                  className="w-full h-16 rounded-t-lg overflow-hidden bg-gray-900 flex items-center justify-center cursor-pointer"
                  title={onInsertToken ? '点击插入到光标处' : undefined}
                  onClick={() => onInsertToken?.(t)}
                >
                  {t.kind === 'image' ? (
                    // draggable=false + 不可选中：避免长按触发系统「保存/预览图片」菜单（移动端会卡住页面）
                    <img src={t.url} alt={t.alt} className="w-full h-full object-cover pointer-events-none"
                      loading="lazy" draggable={false} />
                  ) : (
                    // 视频缩略图用静态占位，不渲染真实 <video>：
                    // 每个 video 元素都会占一个解码器，移动端长按还会触发原生媒体手势/尝试播放，是页面卡死的诱因
                    <div className="w-full h-full flex flex-col items-center justify-center text-white/85 select-none">
                      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      <span className="text-[10px] mt-0.5">视频</span>
                    </div>
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
            用 ← → 按钮调整顺序；✕ 只删除正文里的这一处标记（同一张图被引用多次时互不影响）；点缩略图可把该媒体插到光标处
          </p>
        </div>
      )}
    </div>
  );
}
