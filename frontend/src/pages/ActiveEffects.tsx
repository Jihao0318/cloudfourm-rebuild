import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { items as itemsApi } from '../services/api';
import type { DecorationData } from '../types';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import EmptyState from '../components/EmptyState';
import { faStar } from '@fortawesome/free-solid-svg-icons';
import BackButton from '../components/BackButton';

interface Effect {
  id: string;
  type: string;
  label: string;
  postId: number | null;
  postTitle: string | null;
  expiresAt: string | null;
  cancellable: boolean;
}

function Countdown({ expiresAt }: { expiresAt: string | null }) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    const update = () => {
      if (!expiresAt) { setDisplay('永久'); return; }
      const diff = new Date(expiresAt.replace(' ', 'T') + 'Z').getTime() - Date.now();
      if (diff <= 0) { setDisplay('已过期'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setDisplay(`${h}时 ${m}分 ${s}秒`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // 移动端缩短为「X天 X时」，sm+ 保留完整「X时 X分 X秒」
  const short = (() => {
    if (!expiresAt) return display; // 永久/已过期直接复用
    const diff = new Date(expiresAt.replace(' ', 'T') + 'Z').getTime() - Date.now();
    if (diff <= 0) return display;
    const days = Math.floor(diff / 86400000);
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return days > 0 ? `${days}天 ${h % 24}时` : `${h}时 ${m}分`;
  })();

  return (
    <span className={`font-mono text-sm whitespace-nowrap ${!expiresAt ? 'text-gray-400' : display === '已过期' ? 'text-red-400' : 'text-gray-700'}`}>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{display}</span>
    </span>
  );
}

const EFFECT_ICONS: Record<string, string> = {
  bump: '🚀', highlight: '✨', fortune: '🔮', rainbow_title: '🌈',
  title_badge: '🏅', custom_title: '🏅', vip: '⭐',
};

const EFFECT_LABELS: Record<string, string> = {
  bump: '推荐卡', highlight: '高亮卡', fortune: '今日运势', rainbow_title: '炫彩标题',
  title_badge: '称号', custom_title: '自定义称号', vip: 'VIP',
};

// ===== 装饰区工具（称号）=====

// 时间字符串转毫秒（兼容 "2026-09-12 10:00:00" 格式）
function toMs(dateStr: string): number {
  return new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
}

// 是否已过期
function isExpired(expiresAt: string | null): boolean {
  return !!expiresAt && toMs(expiresAt) <= Date.now();
}

// 有效期文案：永久 / 已过期 / 还剩 X 天（向上取整：24 小时内算 1 天）
function validityText(expiresAt: string | null, permanent = false): string {
  if (permanent || !expiresAt) return '永久';
  if (isExpired(expiresAt)) return '已过期';
  const diff = toMs(expiresAt) - Date.now();
  const days = Math.ceil(diff / 86400000);
  return `还剩 ${days} 天`;
}

// 有效期徽章（灰色系与页面整体风格一致）
function ValidityBadge({ expiresAt, permanent = false }: { expiresAt: string | null; permanent?: boolean }) {
  const text = validityText(expiresAt, permanent);
  const cls = text === '已过期' ? 'bg-gray-100 text-gray-400'
    : text === '永久' ? 'bg-gray-100 text-gray-500'
    : 'bg-green-50 text-green-600';
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{text}</span>;
}

export default function ActiveEffects() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [effects, setEffects] = useState<Effect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  // 按类型分组折叠（所有 Hook 都必须在条件返回之前声明）
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());

  // 装饰与效果数据（称号 / 头像框）
  const [decoration, setDecoration] = useState<DecorationData | null>(null);
  const [loadingDecoration, setLoadingDecoration] = useState(true);
  const [decorationError, setDecorationError] = useState('');
  // 操作防连点：进行中的操作标识（title:xxx / frame:xxx / cancel:xxx / item:xxx）
  const [acting, setActing] = useState('');

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 加载完成，避免刷新时 user 为 null 被误踢
    if (!user) { navigate('/login', { state: { from: '/active-effects' } }); return; }
    loadEffects();
    loadDecoration();
    timerRef.current = setInterval(loadEffects, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [authLoading, user]);

  const loadEffects = async () => {
    try {
      const res = await itemsApi.activeEffects();
      if (res.success && res.data) setEffects(res.data);
      else setError(res.error || '加载失败');
    } catch (e: any) { setError(e.message || '加载失败'); }
    setLoading(false);
  };

  const loadDecoration = async () => {
    try {
      const res = await itemsApi.decoration();
      if (res.success && res.data) { setDecoration(res.data); setDecorationError(''); }
      else setDecorationError(res.error || '加载失败');
    } catch (e: any) { setDecorationError(e.message || '加载失败'); }
    setLoadingDecoration(false);
  };

  const cancelEffect = async (effect: Effect) => {
    const json = await itemsApi.cancelEffect(effect.id);
    if (json.success) {
      toast(json.message || '已取消', 'success');
      loadEffects();
    } else {
      toast(json.error || '取消失败', 'error');
    }
  };

  // ===== 称号操作 =====
  const equipTitle = async (title: string) => {
    if (acting) return;
    setActing(`title:${title}`);
    try {
      const json = await itemsApi.equipTitleBadge(title);
      if (json.success) {
        toast(json.message || '佩戴成功', 'success');
        loadDecoration(); loadEffects(); refreshUser?.();
      } else toast(json.error || '佩戴失败', 'error');
    } catch (e: any) { toast(e.message || '佩戴失败', 'error'); }
    setActing('');
  };

  const cancelTitleBadge = async () => {
    if (acting) return;
    setActing('cancel:title_badge');
    try {
      const json = await itemsApi.cancelEffect('title_badge');
      if (json.success) {
        toast(json.message || '已摘除', 'success');
        loadDecoration(); loadEffects(); refreshUser?.();
      } else toast(json.error || '摘除失败', 'error');
    } catch (e: any) { toast(e.message || '摘除失败', 'error'); }
    setActing('');
  };

  // ===== 称号操作 =====
  if (authLoading || !user) return null;

  const toggleCollapse = (type: string) => {
    setCollapsedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const postEffects = effects.filter(e => e.postId);
  // 个人效果过滤：已佩戴称号在「我的称号」区展示，头像框前端已下线（后端接口保留），两者都不在「个人效果」重复出现
  const userEffects = effects.filter(e => !e.postId && e.type !== 'title_badge' && e.type !== 'avatar_frame');

  // 帖子效果按类型分组
  const postGroups: Record<string, Effect[]> = {};
  for (const ef of postEffects) {
    if (!postGroups[ef.type]) postGroups[ef.type] = [];
    postGroups[ef.type].push(ef);
  }

  // ===== 我的称号区渲染 =====
  const renderTitles = () => {
    if (loadingDecoration) {
      return (
        <div className="bg-white border rounded-2xl p-4 space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton width={90} height={16} />
              <Skeleton width={64} height={14} />
              <Skeleton width={56} height={26} className="ml-auto" />
            </div>
          ))}
        </div>
      );
    }
    if (decorationError && !decoration) {
      return (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>称号数据加载失败：{decorationError}</span>
          <button onClick={() => { setLoadingDecoration(true); loadDecoration(); }}
            className="shrink-0 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">重试</button>
        </div>
      );
    }
    const titles = decoration?.ownedTitles || [];
    if (titles.length === 0) {
      return (
        <div className="bg-white border rounded-2xl px-4 py-6 text-center">
          <p className="text-sm text-gray-400">暂无称号，完成成就即可获得</p>
        </div>
      );
    }
    return (
      <div className="bg-white border rounded-2xl divide-y">
        {titles.map(t => {
          const equipped = decoration?.equipped.titleBadge?.title === t.title
            && !isExpired(decoration.equipped.titleBadge?.expiresAt ?? null);
          const expired = isExpired(t.expiresAt);
          const busy = acting === `title:${t.title}` || acting === 'cancel:title_badge';
          return (
            <div key={t.title} className="flex items-center gap-3 px-4 py-3">
              <span className="text-sm font-medium text-gray-800">🏅 {t.title}</span>
              <ValidityBadge expiresAt={t.expiresAt} permanent={t.permanent} />
              <div className="ml-auto shrink-0">
                {expired ? (
                  <span className="text-xs text-gray-300">已过期</span>
                ) : equipped ? (
                  <button disabled={busy} onClick={cancelTitleBadge}
                    className="px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition disabled:opacity-50">
                    {busy ? '摘除中…' : '摘除'}
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => equipTitle(t.title)}
                    className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50">
                    {busy ? '佩戴中…' : '佩戴'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ===== 头像框区渲染 =====
  // 头像框功能前端已下线（2026-08-13），后端接口（/items/use/avatar-frame、/items/equip-avatar-frame、/items/decoration）保留；
  // 后续如需恢复：找回 renderFrames 实现 + 头像框 section（见 git 历史 9e42513 之前的版本），并按 Avatar.tsx 注释接入图片资源
  const renderFrames = () => null;

  return (
    <div className="max-w-3xl mx-auto">
      <Helmet><title>装饰与效果 - CloudForum</title></Helmet>
      <div className="flex items-center gap-3 mb-4">
        <BackButton />
        <h1 className="text-xl md:text-2xl font-bold">🏷️ 装饰与效果</h1>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{effects.length}</span>
      </div>

      {/* 我的称号 */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-1 px-1">我的称号</h2>
        <p className="text-xs text-gray-400 mb-2 px-1">成就解锁的称号，可随时佩戴/摘除</p>
        {renderTitles()}
      </section>

      {loading ? (
        <div className="space-y-4">
          <Skeleton width={120} height={28} className="mb-4" />
          <div className="bg-white border rounded-2xl p-4">
            <Skeleton width="40%" height={18} className="mb-3" />
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton circle width={32} height={32} />
                  <div className="flex-1">
                    <Skeleton width="60%" height={14} className="mb-1" />
                    <Skeleton width="40%" height={12} />
                  </div>
                  <Skeleton width={80} height={14} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : error && effects.length === 0 ? (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>效果列表加载失败：{error}</span>
          <button onClick={() => { setLoading(true); loadEffects(); }}
            className="shrink-0 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">重试</button>
        </div>
      ) : effects.length === 0 ? (
        <EmptyState
          icon={faStar}
          title="暂无活跃效果"
          description="使用道具后，效果会显示在这里"
          theme="info"
        />
      ) : (
        <div className="space-y-4">
          {/* 帖子类效果 - 按类型分组折叠 */}
          {Object.keys(postGroups).length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-2 px-1">帖子效果</h2>
              <div className="space-y-2">
                {Object.entries(postGroups).map(([type, items]) => {
                  const collapsed = collapsedTypes.has(type);
                  return (
                    <div key={type} className="bg-white border rounded-2xl overflow-hidden">
                      {/* 分组头 */}
                      <button onClick={() => toggleCollapse(type)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition">
                        <span className="text-xl">{EFFECT_ICONS[type] || '📦'}</span>
                        <span className="text-sm font-medium text-gray-800">{EFFECT_LABELS[type] || type}</span>
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{items.length}</span>
                        <span className="ml-auto text-xs text-gray-400">{collapsed ? '展开' : '收起'}</span>
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                      {/* 列表 */}
                      {!collapsed && (
                        <div className="divide-y border-t">
                          {items.map(ef => (
                            <div key={ef.id} className="flex items-center gap-3 px-4 py-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-400 truncate" title={ef.postTitle || ''}>
                                  📄 {ef.postTitle || `帖子 #${ef.postId}`}
                                </p>
                              </div>
                              <Countdown expiresAt={ef.expiresAt} />
                              {ef.cancellable && (
                                <button onClick={() => cancelEffect(ef)}
                                  className="shrink-0 px-2.5 py-1 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition">
                                  取消
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 用户类效果 */}
          {userEffects.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-2 px-1">个人效果</h2>
              <div className="space-y-2">
                {userEffects.map(ef => (
                  <div key={ef.id} className="bg-white border rounded-2xl p-4 flex items-center gap-4 flex-wrap">
                    <div className="text-2xl shrink-0">{EFFECT_ICONS[ef.type] || '📦'}</div>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-gray-800">{EFFECT_LABELS[ef.type] || ef.type}</span>
                      <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">{ef.label}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-gray-500 mb-1">剩余</div>
                      <Countdown expiresAt={ef.expiresAt} />
                    </div>
                    {ef.cancellable && (
                      <button onClick={() => cancelEffect(ef)}
                        className="shrink-0 px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition">
                        取消
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
