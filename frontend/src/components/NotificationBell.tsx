import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { notifications as notificationsApi, type NotificationItem } from '../services/api';
import { formatRelativeTime } from '../utils/date';

// 缓存 key 按账号隔离，避免 A 登出后 B 看到 A 的通知
const storageKeyOf = (userId: number) => `notifications_${userId}`;

interface CachedNotification extends NotificationItem {
  _cached: true;
}

interface NotificationBellProps {
  userId: number;
}

// 通知类型 → 图标 + 底色（视觉锚点，信息可扫读）
const TYPE_META: Record<string, { icon: string; cls: string }> = {
  reply:        { icon: '💬', cls: 'bg-blue-50 dark:bg-blue-900/30' },
  like_post:    { icon: '❤️', cls: 'bg-red-50 dark:bg-red-900/30' },
  like_comment: { icon: '❤️', cls: 'bg-red-50 dark:bg-red-900/30' },
  follow:       { icon: '🤝', cls: 'bg-green-50 dark:bg-green-900/30' },
  post_takedown: { icon: '🚫', cls: 'bg-red-50 dark:bg-red-900/30' }, // 下架类通知（可申诉）
  post_rejected: { icon: '✏️', cls: 'bg-amber-50 dark:bg-amber-900/30' }, // 打回类通知（可修改重提）
  system:       { icon: '🔔', cls: 'bg-amber-50 dark:bg-amber-900/30' },
};

export default function NotificationBell({ userId }: NotificationBellProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CachedNotification[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKeyOf(userId)) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const [badge, setBadge] = useState(0);
  // 展开的通知 id（点击后显示完整内容；帖子下架/删除时通知全文仍可读）
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // 持久化到 localStorage
  const save = useCallback((items: CachedNotification[]) => {
    localStorage.setItem(storageKeyOf(userId), JSON.stringify(items));
    setBadge(items.filter(n => !n.read).length);
  }, [userId]);

  // 30 秒轮询拉新通知（首次拉取由 userId 变化 effect 触发）
  const listRef = useRef(list);
  listRef.current = list;

  const fetchAndDeliver = useCallback(async () => {
    try {
      const res = await notificationsApi.list();
      if (res.success && res.data && res.data.length > 0) {
        const currentList = listRef.current;
        const existing = new Set(currentList.map(n => n.id));
        const newItems = res.data
          .filter((n: NotificationItem) => !existing.has(n.id))
          .map((n: NotificationItem) => ({ ...n, _cached: true as const }));
        if (newItems.length > 0) {
          const merged = [...newItems, ...currentList].slice(0, 100);
          save(merged);
          setList(merged);
          // 传本次已拉取的最大通知 id：服务端只清理已确认送达的通知，
          // 拉取与清理窗口内新到达的通知（id 更大）不会被误删
          const maxId = res.data.reduce((m: number, n: NotificationItem) => Math.max(m, n.id), 0);
          notificationsApi.clearDelivered(maxId).catch(() => {});
        }
      }
    } catch (e) { console.error(e); }
  }, [save]);

  // 账号切换（userId 变化）时重置为该账号缓存并拉取一次
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKeyOf(userId)) || '[]');
      const cached: CachedNotification[] = Array.isArray(parsed) ? parsed : [];
      setList(cached);
      setBadge(cached.filter(n => !n.read).length);
    } catch {
      setList([]);
      setBadge(0);
    }
    fetchAndDeliver();
  }, [userId, fetchAndDeliver]);

  useEffect(() => {
    const interval = setInterval(fetchAndDeliver, 30000);
    return () => clearInterval(interval);
  }, [fetchAndDeliver]);

  const handleToggle = () => setOpen(prev => !prev);
  const handleClose = () => setOpen(false);

  // 点击单条 → 展开/收起完整内容（帖子可能已下架/删除，展开保证通知全文可见）+ 标记已读
  const handleClick = (n: CachedNotification) => {
    setExpandedId(prev => prev === n.id ? null : n.id);
    notificationsApi.markRead(n.id).then(() => {
      const updated = listRef.current.map(item => item.id === n.id ? { ...item, read: 1 as const } : item);
      setList(updated);
      save(updated);
    }).catch(() => {});
  };

  // 全部已读 → 服务端确认后置本地全部已读
  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      const updated = listRef.current.map(n => ({ ...n, read: 1 as const }));
      setList(updated);
      save(updated);
    } catch { /* 失败保留未读，以服务端为准 */ }
  };

  // 一键清除 → 服务端清除已投递通知，成功后清空本地（否则 30 秒轮询会全部回来）
  const handleClearAll = async () => {
    try {
      await notificationsApi.clearDelivered();
      setList([]);
      save([]);
    } catch { /* 失败保留本地列表 */ }
  };

  // 点击/触摸外部关闭（同时支持鼠标和触屏）
  useEffect(() => {
    if (!open) return;
    const onOutside = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [open]);

  // 手机端打开时锁定 body 滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const renderText = (n: CachedNotification) => {
    const actor = n.actor_name || '系统';
    switch (n.type) {
      case 'reply': return <><strong>{actor}</strong> 评论了你的帖子</>;
      case 'like_post': return <><strong>{actor}</strong> 赞了你的帖子</>;
      case 'like_comment': return <><strong>{actor}</strong> 赞了你的评论</>;
      default: return <span>{n.content || actor}</span>;
    }
  };

  // 副文本：评论内容预览 / 类型说明，填充行内空白（下架/打回类通知无副文本——展开区只显示原文+对应入口）
  const renderSub = (n: CachedNotification) => {
    if (n.type === 'post_takedown' || n.type === 'post_rejected') return '';
    if (n.type === 'reply' && n.content) return `评论：${n.content}`;
    if (n.type === 'like_post' || n.type === 'like_comment') return n.content || '点击查看相关帖子';
    if (n.post_id) return '点击查看相关帖子';
    return '';
  };

  // 按日期分组（本地时区）：今天 / 更早
  const grouped: { label: string; items: CachedNotification[] }[] = [];
  for (const n of list) {
    const d = new Date(n.created_at.replace(' ', 'T') + 'Z');
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const label = d >= startToday ? '今天' : '更早';
    const g = grouped.find(x => x.label === label);
    if (g) g.items.push(n); else grouped.push({ label, items: [n] });
  }

  return (
    <div className="relative">
      {/* 铃铛按钮 */}
      <button ref={btnRef} onClick={handleToggle}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
        title="通知">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full leading-none px-1">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {/* 通知面板：手机端全屏沉浸（盖住顶栏，含头部返回），桌面端右侧下拉 */}
      {open && (
        <>
          {/* 手机端 backdrop：z-[55] 高于底部导航 z-50 */}
          <div className="fixed inset-0 z-[55] bg-black/50 md:hidden" onClick={handleClose} />

          <div ref={panelRef}
            className={`
              z-[60] bg-white dark:bg-[#111] flex flex-col
              /* 手机端：固定全屏（显式四边定位 + 显式背景，保证完全覆盖遮罩，头部自带返回） */
              fixed top-0 left-0 right-0 bottom-0 pb-16 md:pb-0
              /* 桌面端：右侧下拉 */
              md:inset-auto md:absolute md:right-0 md:top-full md:mt-2 md:w-96
              md:border md:dark:border-[#222] md:rounded-xl md:shadow-xl md:max-h-[70vh]
            `}
          >
            {/* 头部：返回 + 标题 + 未读计数 + 操作 */}
            <div className="flex items-center justify-between px-4 py-3 border-b dark:border-[#333] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={handleClose} className="md:hidden p-1 -ml-1 text-gray-500 hover:text-gray-700 shrink-0" aria-label="关闭通知">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="text-base font-bold text-gray-900 dark:text-[#e0e0e0]">通知</span>
                {badge > 0 && (
                  <span className="text-[11px] bg-red-500 text-white rounded-full px-2 py-0.5 font-medium shrink-0">{badge} 未读</span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {badge > 0 && (
                  <button onClick={handleMarkAllRead}
                    className="text-xs text-primary-600 hover:bg-primary-50 rounded-lg py-2 px-2 min-h-[40px] transition">全部已读</button>
                )}
                {list.length > 0 && (
                  <button onClick={handleClearAll}
                    className="text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg py-2 px-2 min-h-[40px] transition">清空</button>
                )}
              </div>
            </div>

            {/* 列表（分组）——显式不透明背景，即使 flex 继承异常也保证覆盖遮罩 */}
            <div className="flex-1 overflow-y-auto bg-white dark:bg-[#111]">
              {list.length === 0 ? (
                /* 空态：占满面板，不再塌陷 */
                <div className="h-full min-h-[320px] flex flex-col items-center justify-center px-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl mb-4">🔕</div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300">暂无通知</p>
                  <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">收到点赞、评论、回复时，<br />会在这里第一时间提醒你</p>
                </div>
              ) : (
                grouped.map(g => (
                  <div key={g.label}>
                    {/* 分组标题 */}
                    <div className="px-4 pt-3 pb-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500">{g.label}</div>
                    {g.items.map(n => {
                      const meta = TYPE_META[n.type] || TYPE_META.system;
                      const sub = renderSub(n);
                      const expanded = expandedId === n.id;
                      return (
                        <div key={n.id}
                          className={`group relative flex items-start gap-3 px-4 py-3 border-b dark:border-[#333] transition cursor-pointer ${
                            !n.read ? 'bg-primary-50/40 dark:bg-primary-950/20 hover:bg-primary-50/70' : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                          }`}
                          onClick={() => handleClick(n)}
                        >
                          {/* 未读左侧竖条 */}
                          {!n.read && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r bg-primary-500" />}

                          {/* 类型图标 */}
                          <div className={`w-10 h-10 rounded-full ${meta.cls} flex items-center justify-center text-lg shrink-0`}>
                            {meta.icon}
                          </div>

                          {/* 主文本 + 时间（同行）+ 副文本（展开时显示完整内容） */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className={`text-sm leading-snug ${expanded ? '' : 'truncate'} ${!n.read ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
                                {renderText(n)}
                              </span>
                              <span className="text-[11px] text-gray-400 shrink-0">{formatRelativeTime(n.created_at)}</span>
                            </div>
                            {sub && (
                              <div className={`text-xs text-gray-500 dark:text-gray-400 mt-1 ${expanded ? 'whitespace-pre-wrap break-words leading-relaxed' : 'line-clamp-1'}`}>{sub}</div>
                            )}
                            {expanded && (
                              <div className="mt-2 space-y-1.5">
                                {/* 下架类通知：原文下方提供申诉入口（其他类型只有完整原文，不显示申诉） */}
                                {n.type === 'post_takedown' && n.post_id && (
                                  <>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">如有异议，请点击下方申诉</p>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpen(false); navigate(`/appeal/${n.post_id}`); }}
                                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
                                      📄 申诉 →
                                    </button>
                                  </>
                                )}
                                {/* 打回类通知：原文下方提供「去修改」入口（作者编辑后重新提交，进入待巡查） */}
                                {n.type === 'post_rejected' && n.post_id && (
                                  <>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">请修改后重新提交（1 天内未修改将被删除）</p>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpen(false); navigate(`/post/${n.post_id}/edit`); }}
                                      className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline">
                                      ✏️ 去修改 →
                                    </button>
                                  </>
                                )}
                                <p className="text-[11px] text-gray-400">点击收起</p>
                              </div>
                            )}
                          </div>

                          {/* 未读红点 */}
                          {!n.read && <span className="w-2 h-2 bg-red-500 rounded-full shrink-0 mt-2" />}

                          {/* 删除：桌面 hover 显示，移动端淡显 */}
                          <button
                            onClick={(e) => { e.stopPropagation(); const updated = list.filter(item => item.id !== n.id); setList(updated); save(updated); }}
                            className="shrink-0 self-center p-1.5 rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100 max-md:opacity-50"
                            title="删除">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
