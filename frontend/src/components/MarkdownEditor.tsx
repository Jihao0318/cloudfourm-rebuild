import { useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { markdownSchema } from '../utils/markdownSanitize';
import { upload } from '../services/api';
import { compressImageIfNeeded, formatBytes, UPLOAD_LIMIT_BYTES } from '../utils/imageCompress';
import { compressVideoIfNeeded, VIDEO_QUALITY_META, type VideoQuality } from '../utils/videoCompress';
import { imageTag, videoTag } from '../utils/mediaTokens';
import MediaManager from './MediaManager';
import { useToast } from '../contexts/ToastContext';

/** 单次最多可选择的文件数（图片 + 视频合计） */
const MAX_FILES_PER_PICK = 9;

// ===== 视频平台嵌入检测 =====
function detectVideoPlatform(url: string): { html: string; platform: string } | null {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return {
      html: `<iframe src="https://www.youtube.com/embed/${ytMatch[1]}" allowfullscreen class="w-full aspect-video rounded-lg"></iframe>`,
      platform: 'YouTube',
    };
  }

  // Bilibili
  const bvMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
  if (bvMatch) {
    return {
      html: `<iframe src="https://player.bilibili.com/player.html?bvid=${bvMatch[1]}" allowfullscreen class="w-full aspect-video rounded-lg"></iframe>`,
      platform: 'Bilibili',
    };
  }

  // 直链视频
  if (url.match(/\.(mp4|webm|mov)(\?|$)/i)) {
    return {
      html: `<video src="${url}" controls class="w-full rounded-lg"></video>`,
      platform: '直链视频',
    };
  }

  return null;
}



interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}

const IconBold = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
  </svg>
);
const IconItalic = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" />
  </svg>
);
const IconHeading = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4v16" /><path d="M18 4v16" /><path d="M6 12h12" />
  </svg>
);
const IconQuote = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
  </svg>
);
const IconCode = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
  </svg>
);
const IconLink = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const IconImage = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
  </svg>
);
const IconList = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const IconVideo = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

interface ToolbarAction {
  key: string;
  icon: React.ReactNode;
  title: string;
  action: (text: string, start: number, end: number) => { newText: string; cursorPos: number };
}

export default function MarkdownEditor({ value, onChange, placeholder, minHeight = '300px' }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageBtnRef = useRef<HTMLButtonElement>(null); // 图片菜单锚点（fixed 定位计算坐标用）

  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('正在处理文件...');
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('720p');
  // 上传完成后递增，让媒体管理条自动展开给用户看新内容
  const [mediaExpandSignal, setMediaExpandSignal] = useState(0);
  const { toast } = useToast();

  const [showImageMenu, setShowImageMenu] = useState(false);
  const [showEmbedDialog, setShowEmbedDialog] = useState(false);
  const [embedUrl, setEmbedUrl] = useState('');

  // 多文件上传是异步串行的，回调里读 value 会拿到旧值（闭包快照）→ 用 ref 拿最新正文
  const valueRef = useRef(value);
  valueRef.current = value;

  const insertAt = useCallback((pos: number, text: string) => {
    const cur = valueRef.current;
    const p = Math.min(Math.max(0, pos), cur.length);
    const next = cur.slice(0, p) + text + cur.slice(p);
    valueRef.current = next;
    onChange(next);
    return p + text.length;
  }, [onChange]);

  const insertSyntax = useCallback((action: ToolbarAction) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const { newText, cursorPos } = action.action(value.slice(start, end), start, end);
    onChange(value.slice(0, start) + newText + value.slice(end));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(cursorPos, cursorPos); });
  }, [value, onChange]);

  /**
   * 多文件处理（图片 + 视频，串行）：
   * 每个文件先压缩再上传，全部完成后**一次性插入**到「开始处理时的光标处」，
   * 顺序与选择顺序一致——避免多张并发插入互相覆盖（闭包快照）以及顺序错乱。
   * 单个文件失败不影响其余文件，最后汇总提示。
   */
  const handleFiles = useCallback(async (picked: File[]) => {
    const files = picked.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (files.length === 0) return;
    const batch = files.slice(0, MAX_FILES_PER_PICK);
    if (files.length > MAX_FILES_PER_PICK) {
      toast(`单次最多 ${MAX_FILES_PER_PICK} 个文件，已只处理前 ${MAX_FILES_PER_PICK} 个`, 'error');
    }

    // 记录「开始处理时」的光标位置：之后用户点别处也不影响插入位置
    const ta = textareaRef.current;
    const anchor = ta ? ta.selectionStart : valueRef.current.length;

    setUploading(true);
    const results: string[] = [];
    const failures: string[] = [];
    const notes: string[] = [];
    let done = 0;

    for (const [i, file] of batch.entries()) {
      const isImage = file.type.startsWith('image/');
      const label = `${i + 1}/${batch.length}`;
      try {
        let toUpload: File = file;
        if (isImage) {
          setUploadStatus(`${label} 压缩图片中…（${file.name}）`);
          const r = await compressImageIfNeeded(file);
          toUpload = r.file;
          if (r.compressed) notes.push(`图片 ${file.name} 已压缩：${formatBytes(r.originalSize)} → ${formatBytes(r.finalSize)}`);
          if (toUpload.size > UPLOAD_LIMIT_BYTES) {
            failures.push(`${file.name}：压缩后仍 ${formatBytes(toUpload.size)}，超过 ${formatBytes(UPLOAD_LIMIT_BYTES)} 上限`);
            continue;
          }
        } else {
          setUploadStatus(`${label} 处理视频中…（${file.name}）`);
          const r = await compressVideoIfNeeded(file, videoQuality, {
            onProgress: p => setUploadStatus(`${label} ${p.phase} ${Math.round(p.ratio * 100)}%（${file.name}）`),
          });
          if (r.mode === 'blocked') {
            failures.push(`${file.name}：${r.reason || '无法处理'}`);
            continue;
          }
          toUpload = r.file;
          if (r.mode === 'pass') {
            if (r.warning) notes.push(r.warning);
          } else {
            const how = r.mode === 'webcodecs' ? '快速转码' : '录制式压缩';
            notes.push(`视频 ${file.name} 已${how}：${formatBytes(r.originalSize)} → ${formatBytes(r.finalSize)}${r.elapsedMs ? `（用时 ${(r.elapsedMs / 1000).toFixed(1)} 秒）` : ''}（${VIDEO_QUALITY_META[videoQuality].label}）`);
          }
          if (toUpload.size > UPLOAD_LIMIT_BYTES) {
            failures.push(`${file.name}：压缩后仍 ${formatBytes(toUpload.size)}，超过上限，请剪短或改选更省流的档位`);
            continue;
          }
        }

        setUploadStatus(`${label} 上传中…（${file.name}）`);
        const res = await upload.image(toUpload);
        if (res.success && res.data?.url) {
          results.push(isImage ? imageTag(res.data.url) : videoTag(res.data.url));
        } else {
          failures.push(`${file.name}：${res.error || '上传失败'}`);
        }
      } catch (err: any) {
        failures.push(`${file.name}：${err?.message || '处理失败'}`);
      }
      done++;
      setUploadStatus(`已处理 ${done}/${batch.length}`);
    }

    // 收尾统一兜底：插入/提示出错也绝不让异常逃出去（未捕获异常会让调用链上的 UI 状态卡死）
    try {
      if (results.length > 0) {
        const cur = valueRef.current;
        const needLeadingNl = cur.length > 0 && !cur.slice(0, anchor).endsWith('\n');
        const block = (needLeadingNl ? '\n' : '') + results.join('\n');
        const caret = insertAt(anchor, block);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) { el.focus(); el.setSelectionRange(caret, caret); }
        });
        setMediaExpandSignal(n => n + 1);
      }
      if (notes.length) toast(notes.slice(0, 3).join('；') + (notes.length > 3 ? `（共 ${notes.length} 条）` : ''), 'success');
      if (failures.length) {
        const msg = failures.slice(0, 3).join('；') + (failures.length > 3 ? `（共 ${failures.length} 个失败）` : '');
        toast(`有 ${failures.length} 个文件未成功：${msg}`, 'error');
      }
    } catch (err) {
      console.error('[upload] 上传收尾失败:', err);
    } finally {
      setUploading(false);
    }
  }, [insertAt, toast, videoQuality]);

  // 嵌入链接处理
  const handleEmbedLink = useCallback(() => {
    const url = embedUrl.trim();
    if (!url) return;
    const result = detectVideoPlatform(url);
    if (!result) {
      alert('无法识别该链接，请使用 YouTube、Bilibili 链接或直链视频地址');
      return;
    }
    const html = `\n${result.html}\n`;
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart;
      onChange(value.slice(0, start) + html + value.slice(start));
      requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + html.length, start + html.length); });
    } else {
      onChange(value + html);
    }
    setEmbedUrl('');
    setShowEmbedDialog(false);
  }, [embedUrl, value, onChange]);

  // 粘贴：一次粘贴多张图片时全部处理（原来只取第一张就 return）
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    handleFiles(files);
  }, [handleFiles]);

  // 说明：本编辑器不再支持「拖拽文件上传」（2026-09-18 按用户要求废弃）。
  // 上传入口只有两个：工具栏「上传图片/视频（可多选）」与粘贴。相关拖拽监听/高亮状态已删除，
  // 依赖的 document 级 drag/drop 监听、rootRef、dragActive 等一并移除，避免留下无用分支。


  // 插入位置：以「开始处理时的光标」为准（由 handleFiles 内部记录），避免处理期间点击别处导致错位

  const actions: ToolbarAction[] = [
    {
      key: 'bold', icon: <IconBold />, title: '加粗',
      action: (sel, start) => sel ? { newText: `**${sel}**`, cursorPos: start + sel.length + 4 } : { newText: '****', cursorPos: start + 2 },
    },
    {
      key: 'italic', icon: <IconItalic />, title: '斜体',
      action: (sel, start) => sel ? { newText: `*${sel}*`, cursorPos: start + sel.length + 2 } : { newText: '**', cursorPos: start + 1 },
    },
    {
      key: 'heading', icon: <IconHeading />, title: '标题',
      action: (sel, start, end) => {
        const prefix = '### ';
        if (sel) {
          const stripped = sel.replace(/^#{1,6}\s*/, '');
          return { newText: `${prefix}${stripped}`, cursorPos: start + prefix.length + stripped.length };
        }
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', start);
        const line = lineEnd >= 0 ? value.slice(lineStart, lineEnd) : value.slice(lineStart);
        const stripped = line.replace(/^#{1,6}\s*/, '');
        return {
          newText: value.slice(0, lineStart) + prefix + stripped + (lineEnd >= 0 ? value.slice(lineEnd) : ''),
          cursorPos: lineStart + prefix.length + stripped.length,
        };
      },
    },
    {
      key: 'quote', icon: <IconQuote />, title: '引用',
      action: (sel, start) => {
        if (sel) {
          const quoted = sel.split('\n').map(l => l.startsWith('> ') ? l : `> ${l}`).join('\n');
          return { newText: `${quoted}\n\n`, cursorPos: start + quoted.length + 2 };
        }
        return { newText: '> ', cursorPos: start + 2 };
      },
    },
    {
      key: 'code', icon: <IconCode />, title: '代码块',
      action: (sel, start) => {
        if (sel) {
          if (sel.includes('\n')) return { newText: `\`\`\`\n${sel}\n\`\`\``, cursorPos: start + sel.length + 8 };
          return { newText: `\`${sel}\``, cursorPos: start + sel.length + 2 };
        }
        return { newText: '```\n\n```', cursorPos: start + 5 };
      },
    },
    {
      key: 'link', icon: <IconLink />, title: '链接',
      action: (sel, start) => sel
        ? { newText: `[${sel}](url)`, cursorPos: start + sel.length + 7 }
        : { newText: '[标题](url)', cursorPos: start + 1 },
    },
    {
      key: 'list', icon: <IconList />, title: '列表',
      action: (sel, start) => {
        if (sel) {
          const listed = sel.split('\n').map(l => l.startsWith('- ') ? l : `- ${l}`).join('\n');
          return { newText: `${listed}\n`, cursorPos: start + listed.length + 1 };
        }
        return { newText: '- ', cursorPos: start + 2 };
      },
    },
  ];

  return (
    <div className="border border-gray-200 rounded-xl bg-white shadow-sm">
      {/* 工具栏：overflow-x-auto 允许 375px 下左组横向滚动；图标按钮 p-1 shrink-0 收紧宽度 */}
      <div className="relative flex items-center justify-between px-2 py-1.5 bg-gray-50/80 border-b border-gray-200 rounded-t-xl overflow-x-auto">
        <div className="flex items-center gap-0.5">
          {actions.map(act => (
            <button key={act.key} type="button" onClick={() => insertSyntax(act)} title={act.title}
              className="p-1 shrink-0 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-200/70 transition-colors"
            >{act.icon}</button>
          ))}
          {/* 图片按钮 + 弹出菜单
              菜单用 fixed + portal 渲染：① 工具栏 overflow-x-auto 会裁剪 absolute 弹层（overflow-y 被计算为 auto）；
              ② main z-10 会困住页面内弹层。两者都必须脱离，故用按钮坐标计算 fixed 位置 */}
          <div className="relative">
            <button ref={imageBtnRef} type="button" onClick={() => setShowImageMenu(true)} title="图片"
              className="p-1 shrink-0 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-200/70 transition-colors"
            ><IconImage /></button>
            {showImageMenu && imageBtnRef.current && (() => {
              const rect = imageBtnRef.current!.getBoundingClientRect();
              return createPortal(
                <>
                  <div className="fixed inset-0 z-[55]" onClick={() => setShowImageMenu(false)} />
                  {/* 图片菜单：右对齐按钮右侧、向下展开，防在工具栏滚动/窄屏时向右出屏 */}
                  <div className="fixed z-[60] bg-white border border-gray-200 rounded-lg shadow-lg py-1.5 min-w-[140px] whitespace-nowrap"
                    style={{ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) }}>
                    <button type="button" onClick={() => { fileInputRef.current?.click(); setShowImageMenu(false); }}
                      className="w-full text-left px-4 py-2.5 min-h-[40px] text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2.5">
                      <svg className="w-4 h-4 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      上传图片/视频（可多选）
                    </button>
                    <button type="button" onClick={() => {
                      const ta = textareaRef.current;
                      if (ta) {
                        const start = ta.selectionStart;
                        const end = ta.selectionEnd;
                        const sel = value.slice(start, end);
                        const tmpl = sel ? `![${sel}](url)` : '![](url)';
                        onChange(value.slice(0, start) + tmpl + value.slice(end));
                        requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + tmpl.length - 1, start + tmpl.length - 1); });
                      }
                      setShowImageMenu(false);
                    }}
                      className="w-full text-left px-4 py-2.5 min-h-[40px] text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2.5">
                      <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      外链图片
                    </button>
                  </div>
                </>,
                document.body
              );
            })()}
          </div>
          {/* 视频嵌入按钮 — 直接打开嵌入链接弹窗 */}
          <button type="button" onClick={() => setShowEmbedDialog(true)} title="嵌入视频 (YouTube/B站)"
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-200/70 transition-colors"
          ><IconVideo /></button>
          {/* 视频压缩档位：只影响上传的视频（图片按自家规则压到 ≤8MB） */}
          <select value={videoQuality} onChange={e => setVideoQuality(e.target.value as VideoQuality)}
            title="上传视频的压缩档位（越清晰体积越大）"
            className="ml-0.5 shrink-0 text-xs border border-gray-300 rounded-md px-1 py-0.5 text-gray-600 bg-white outline-none focus:border-primary-400">
            {(Object.keys(VIDEO_QUALITY_META) as VideoQuality[]).map(k => (
              <option key={k} value={k}>{VIDEO_QUALITY_META[k].label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center bg-gray-200/60 rounded-lg p-0.5 shrink-0">
          <button type="button" onClick={() => setMode('write')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${mode === 'write' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >编辑</button>
          <button type="button" onClick={() => setMode('preview')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${mode === 'preview' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >预览</button>
        </div>
      </div>
      {/* 隐藏的文件选择器：支持多选（图片 + 视频），一次最多 9 个 */}
      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) handleFiles(files);
        }} />


      {/* 上传进度提示 */}
      {uploading && (
        <div className="flex items-center gap-2 px-5 py-2 text-sm text-primary-600 bg-primary-50 border-b border-primary-100">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {uploadStatus}
        </div>
      )}

      {mode === 'write' ? (
        <>
          <textarea ref={textareaRef} value={value} onChange={e => onChange(e.target.value)}
            onPaste={handlePaste}
            placeholder={placeholder || '支持 Markdown；图片/视频可多选上传（最多 9 个），也可以直接粘贴图片'}
            required
            className="w-full px-5 py-4 outline-none resize-y font-mono text-base leading-relaxed text-gray-800 placeholder-gray-400"
            style={{ minHeight }}
          />
          {/* 媒体管理条：折叠态一行摘要，展开后可拖拽排序 / 删除（改的是正文里的标记顺序） */}
          <div className="rounded-b-xl overflow-hidden">
            <MediaManager value={value} onChange={onChange} expandSignal={mediaExpandSignal}
              onInsertToken={t => {
                const ta = textareaRef.current;
                const at = ta ? ta.selectionStart : valueRef.current.length;
                const caret = insertAt(at, t.raw);
                requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(caret, caret); } });
              }} />
          </div>
        </>
      ) : (
        <div className="w-full px-5 py-4 overflow-y-auto prose prose-sm max-w-none prose-headings:text-gray-900 prose-a:text-primary-600 prose-code:bg-gray-100 prose-code:text-pink-600 prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-img:rounded-lg rounded-b-xl"
          style={{ minHeight }}
        >
          {value ? <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]}>{value}</ReactMarkdown> : <p className="text-gray-400 italic mt-2">暂无内容</p>}
        </div>
      )}

      {/* 嵌入链接弹窗 — portal 到 body，避免被困在 main z-10 堆叠上下文（否则遮罩盖不住根级底部导航 z-50） */}
      {showEmbedDialog && createPortal(
        <>
          <div className="fixed inset-0 z-[55] bg-black/40" onClick={() => { setShowEmbedDialog(false); setEmbedUrl(''); }} />
          <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-5 w-[90vw] max-w-md">
            <h3 className="text-base font-semibold text-gray-800 mb-3">嵌入视频链接</h3>
            <p className="text-xs text-gray-500 mb-3">支持 YouTube、Bilibili 链接或直接 .mp4/.webm 视频地址</p>
            <input type="url" value={embedUrl} onChange={e => setEmbedUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=... 或 https://..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400 mb-4"
              onKeyDown={e => { if (e.key === 'Enter') handleEmbedLink(); }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setShowEmbedDialog(false); setEmbedUrl(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
              <button type="button" onClick={handleEmbedLink} disabled={!embedUrl.trim()}
                className="px-4 py-2 text-sm text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 rounded-lg transition-colors">插入</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
