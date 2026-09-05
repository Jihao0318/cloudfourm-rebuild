import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams, useNavigationType } from 'react-router-dom';
import { posts as postsApi, categories as categoriesApi } from '../services/api';
import type { Post, Category } from '../types';
import { Helmet } from 'react-helmet-async';
import { faNewspaper } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../contexts/AuthContext';
import { formatRelativeTime, parseDate } from '../utils/date';
import { levelFromExp } from '../utils/level';
import { postBgClass } from '../utils/postBg';
import Avatar from '../components/Avatar';
import VIPBadge, { getVipNickClass } from '../components/VIPBadge';
import { PostListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import HomeSidebar from '../components/HomeSidebar';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSatelliteDish, faThumbtack, faSearch } from '@fortawesome/free-solid-svg-icons';

function extractFirstImage(content?: string): string | null {
  if (!content) return null;
  const match = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  return match ? match[1] : null;
}

// ===== 返回首页的滚动恢复缓存 =====
// 离开首页时保存列表数据/页码/滚动位置；POP 返回时先用缓存立即渲染完整列表
// （高度瞬间恢复，骨架屏塌陷导致的浏览器滚动恢复失败不再发生），再精确滚回原位置。
// 数据超过 60s 视为过期（返回场景通常在几秒~几十秒内），过期则正常重新加载。
interface HomeCache {
  postList: Post[];
  total: number;
  page: number;
  savedY: number;
  ts: number;
  key: string;
}
let homeCache: HomeCache | null = null;

export default function Home() {
  const navigate = useNavigate();
  
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  // 板块筛选与 URL 同步：板块页 /boards 点击卡片 → /?categoryId=X 进入本页并自动筛选
  // URL 是唯一事实源：读 searchParams 派生筛选状态，浏览器前进/后退天然生效
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = (() => {
    const v = searchParams.get('categoryId');
    return v ? (Number(v) || undefined) : undefined;
  })();
  const [sort, setSort] = useState<string>('latest');
  const [feed, setFeed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const isPageChangeOnly = useRef(false);
  const { user } = useAuth();
  const pageSize = 20;

  // POP 返回时命中未过期缓存 → 用缓存数据初始化（跳过骨架屏、高度立即恢复），
  // 挂载后精确滚回离开时的位置；否则正常加载。数据超过 60s 视为过期。
  const navigationType = useNavigationType();
  const cacheKey = `${categoryId || ''}|${sort}|${searchQuery}|${feed ? 1 : 0}`;
  const cacheUsable = navigationType === 'POP' && homeCache !== null && homeCache.key === cacheKey && Date.now() - homeCache.ts < 60_000;
  const restoredRef = useRef(cacheUsable);
  const [postList, setPostList] = useState<Post[]>(() => (cacheUsable && homeCache ? homeCache.postList : []));
  const [total, setTotal] = useState<number>(() => (cacheUsable && homeCache ? homeCache.total : 0));
  const [loading, setLoading] = useState<boolean>(() => !(cacheUsable && homeCache));
  // ponytail: 纯翻页时用此函数，通知 loadPosts 不闪骨架屏
  const goToPage = (n: number) => { isPageChangeOnly.current = true; setPage(n); };

  // 板块筛选：仅写 URL（读由上面的 searchParams 派生），浏览器后退/前进同步生效
  const selectCategory = (id?: number) => {
    setPage(1);
    if (id !== undefined) setSearchParams({ categoryId: String(id) });
    else setSearchParams({});
  };

  // 防抖：输入变化后 300ms 触发搜索，避免频繁请求，同时重置到第一页
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setSearchQuery(searchInput);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  // 抽屉侧边栏打开时锁定 body 滚动（关闭后恢复原值）
  useEffect(() => {
    if (drawerOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prevOverflow; };
    }
  }, [drawerOpen]);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    // POP 返回且已用缓存渲染：跳过首次加载（列表数据已是缓存内容）
    if (restoredRef.current) { restoredRef.current = false; return; }
    loadPosts();
  }, [page, categoryId, sort, searchQuery, feed]);

  // 离开首页时保存列表数据与滚动位置（cleanup 在新页面 effect 之前跑，此时 scrollY 仍是首页位置）
  useEffect(() => {
    return () => {
      homeCache = {
        postList, total, page,
        savedY: window.scrollY,
        ts: Date.now(),
        key: `${categoryId || ''}|${sort}|${searchQuery}|${feed ? 1 : 0}`,
      };
    };
  }, [postList, total, page, categoryId, sort, searchQuery, feed]);

  // POP 返回且有缓存：列表已同步渲染（高度足够），精确滚回离开时的位置；
  // POP 但无缓存（过期/条件变化）：浏览器恢复会因骨架屏塌陷失败，显式回顶部
  useEffect(() => {
    if (restoredRef.current && homeCache) {
      // 重试钉住：恢复瞬间图片/字体可能尚未加载完成（内容高度会变化），
      // 在约 2 秒内持续校正到目标位置；用户一旦触摸/滚轮即停止（把控制权交还用户）
      const savedY = homeCache.savedY;
      let cancelled = false;
      let tries = 0;
      const stop = () => {
        cancelled = true;
        window.removeEventListener('touchstart', stop);
        window.removeEventListener('wheel', stop);
      };
      window.addEventListener('touchstart', stop, { passive: true });
      window.addEventListener('wheel', stop, { passive: true });
      const tick = () => {
        if (cancelled) return;
        window.scrollTo(0, savedY);
        if (++tries < 12) setTimeout(() => requestAnimationFrame(tick), 120);
        else stop();
      };
      requestAnimationFrame(tick);
    } else if (navigationType === 'POP') {
      window.scrollTo(0, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCategories = async () => {
    try {
      const res = await categoriesApi.list();
      if (res.success && res.data) setCategoryList(res.data);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  };

  const loadPosts = async () => {
    // 取消前一次请求，避免竞态
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // ponytail: 纯翻页不闪骨架屏（isPageChangeOnly），筛选/搜索切换时正常闪烁
    if (!isPageChangeOnly.current) setLoading(true);
    isPageChangeOnly.current = false;
    setError('');
    try {
      const res = await postsApi.list({ page, pageSize, categoryId, sort, search: searchQuery || undefined, feed: feed || undefined }, controller.signal);
      if (res.success && res.data) {
        setPostList(res.data);
        setTotal(res.total || 0);
      } else {
        setError(res.error || '加载失败');
      }
    } catch (err: any) {
      // 新请求开始时旧请求会被 abort——忽略该错误，交由新请求处理
      if (err?.name === 'AbortError') return;
      setError(err.message || '加载失败');
    }
    setLoading(false);
  };

  const totalPages = Math.ceil(total / pageSize);
  const adminOrMod = user?.role === 'admin' || user?.role === 'moderator';

  return (
    <>
    <Helmet><title>CloudForum - 社区论坛</title><meta name="description" content="CloudForum 是一个现代化社区论坛，支持发帖、评论、点赞和分类浏览" /></Helmet>
    <div className="max-w-6xl mx-auto">
      {/* 工具栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2 w-full md:w-auto">
          {/* 移动端抽屉开关（<lg 显示，lg+ 隐藏） */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开侧边栏"
            className="lg:hidden shrink-0 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 transition"
          >
            <span aria-hidden="true" className="text-lg leading-none">☰</span>
          </button>

          {/* 移动端：下拉切换板块（底栏「签到」已恢复，板块入口统一走这里） */}
          <select
            value={feed ? 'feed' : categoryId ? String(categoryId) : ''}
            onChange={(e) => {
              const v = e.target.value;
              setPage(1);
              if (v === 'feed') { setFeed(true); selectCategory(undefined); setSort('latest'); }
              else { setFeed(false); selectCategory(v ? Number(v) : undefined); }
            }}
            className="md:hidden flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-gray-200 text-sm bg-white dark:bg-[#111] dark:border-gray-700 dark:text-gray-200 outline-none focus:border-primary-500"
            title="选择板块"
          >
            <option value="">全部帖子</option>
            <option value="feed">关注动态</option>
            {categoryList.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>

          {/* 桌面端：完整板块选择（hidden md:flex） */}
          <div className="hidden md:flex items-center gap-2 flex-wrap">
          <button
            onClick={() => selectCategory(undefined)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              !categoryId ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            全部
          </button>
          {user && (
            <button
              onClick={() => { setFeed(prev => !prev); setPage(1); selectCategory(undefined); setSort('latest'); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                feed ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {feed ? <><FontAwesomeIcon icon={faSatelliteDish} /> 关注</> : '关注'}
            </button>
          )}
          {categoryList.map((cat) => (
            <button
              key={cat.id}
              onClick={() => selectCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                categoryId === cat.id ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {cat.name}
            </button>
          ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            title="排序方式"
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1); }}
            className="px-3 py-1.5 border rounded-lg text-sm bg-white"
          >
            <option value="latest">最新</option>
            <option value="hot">最热</option>
            <option value="most_viewed">最多浏览</option>
          </select>
          {user && (
            <Link to="/create" className="shrink-0 whitespace-nowrap bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700">
              + 发布
            </Link>
          )}
        </div>
      </div>

      {/* 搜索栏 — 实时搜索，输入即搜 */}
      <div className="mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input id="search-input" name="search" type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              autoComplete="off" autoCapitalize="none" autoCorrect="off" enterKeyHint="search"
              placeholder="搜索帖子标题和内容..."
              className="w-full px-4 py-2 pl-10 pr-8 border rounded-xl text-base outline-none focus:border-primary-500 bg-white" />
            <FontAwesomeIcon icon={faSearch} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            {/* 搜索中指示器 */}
            {(loading || searchInput !== searchQuery) && searchInput && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin" />
              </div>
            )}
          </div>
          {searchQuery && (
            <button type="button" onClick={() => { setSearchInput(''); setPage(1); }}
              className="px-3 py-2 min-h-[40px] text-gray-500 hover:text-gray-700 text-sm whitespace-nowrap">✕ 清除</button>
          )}
        </div>
      </div>

      {/* 搜索结果提示 */}
      {!loading && searchQuery && postList.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <FontAwesomeIcon icon={faSearch} className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">没有找到包含「<strong>{searchQuery}</strong>」的帖子</p>
          <p className="text-xs mt-1 text-gray-300">试试其他关键词</p>
        </div>
      )}

      {/* 双栏：左侧边栏 + 右列帖子流（lg+ 显示，利用桌面留白） */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] items-start">
        {/* 桌面端固定左栏（lg+ 显示，移动端隐藏为抽屉） */}
        <div className="hidden lg:block">
          <HomeSidebar />
        </div>
        <div className="min-w-0">
      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>
      )}
      {/* 帖子列表 */}
      {loading ? (
        <PostListSkeleton count={5} />
      ) : postList.length === 0 ? (
        <EmptyState
          icon={faNewspaper}
          title="暂无帖子"
          description="还没有人发帖，来发表第一条吧"
          action={user ? { label: '发布帖子', to: '/create' } : undefined}
        />
      ) : (
        <div className="space-y-2.5">
          {postList.map((post) => {
            // 解析装饰数据
            let cardDecoClass = '';
            try { const d = JSON.parse((post as any).decoration_data || '{}'); if (d.css_class) cardDecoClass = d.css_class; } catch {}
            // 炫彩标题过期判断（D1 UTC 字符串）
            const titleEffectActive = post.title_effect === 'rainbow' && (!post.title_effect_expires_at || (parseDate(post.title_effect_expires_at)?.getTime() ?? 0) > Date.now());
            return (
            <Link
              key={post.id}
              to={`/post/${post.id}`}
              className={`block rounded-xl border transition ${cardDecoClass} ${postBgClass(post.post_bg_id)} ${
                post.highlighted_until && new Date(post.highlighted_until) > new Date()
                  ? 'post-highlighted hover:shadow-amber-200'
                  : 'bg-white border-gray-100 hover:shadow-lg'
              }`}
            >
              {/* 状态标记：置顶保留唯一彩色（黄），其余统一灰底降噪；推荐帖不在此标记（在侧边栏推荐位展示） */}
              <div className="px-4 pt-2.5 flex gap-1">
                {post.is_pinned ? (
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-medium"><FontAwesomeIcon icon={faThumbtack} className="mr-1" />置顶</span>
                ) : null}
                {post.highlighted_until && new Date(post.highlighted_until) > new Date() ? (
                  <span className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 px-2 py-0.5 rounded font-medium">✨ 高亮</span>
                ) : null}
                {titleEffectActive ? (
                  <span className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 px-2 py-0.5 rounded font-medium">🌈 炫彩</span>
                ) : null}
                {typeof post.content === 'string' && post.content.startsWith('__PAID__') ? (
                  <span className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 px-2 py-0.5 rounded font-medium border border-gray-200 dark:border-gray-700">🔒 付费 {post.content.replace('__PAID__', '')} 积分</span>
                ) : null}
              </div>

              {/* 头像 + 信息行 */}
              <div className="px-4 pt-2.5 pb-1.5 flex items-start gap-3">
                {post.is_anonymous ? (
                  // 匿名帖：不显示任何身份信息（头像/框/等级/徽章），仅"匿名同学"占位
                  <>
                    <div className="w-9 h-9 rounded-full bg-gray-100 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-400">匿名同学</span>
                        {post.category_name && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{post.category_name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                        <span>{formatRelativeTime(post.created_at)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                {post.user_id ? (
                  // span + navigate 替代嵌套 Link（避免 <a> 嵌套 <a> 的 DOM 非法结构）
                  <span className="cursor-pointer" onClick={(e) => { e.stopPropagation(); navigate(`/user/${post.user_id}`); }}>
                    <Avatar url={post.author_avatar} username={post.username} size="md" frame={post.author_avatar_frame} frameExpiresAt={post.author_avatar_frame_expires_at} />
                  </span>
                ) : (
                  <Avatar url={post.author_avatar} username={post.username} size="md" frame={post.author_avatar_frame} frameExpiresAt={post.author_avatar_frame_expires_at} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {post.user_id ? (
                      <span
                        onClick={(e) => { e.stopPropagation(); navigate(`/user/${post.user_id}`); }}
                        className={`cursor-pointer font-semibold transition ${getVipNickClass(post.author_vip_tier, post.author_nick_theme) || 'text-gray-900 hover:text-primary-600'}`}
                      >
                        {post.username || '匿名'}
                      </span>
                    ) : (
                      <span className="font-semibold text-gray-400">{post.username || '已注销'}</span>
                    )}
                    <VIPBadge vip_tier={post.author_vip_tier} />
                    {post.author_exp != null && <span className="text-[10px] bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded font-medium">Lv.{levelFromExp(post.author_exp).level}</span>}
                    {post.author_title_badge && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">{post.author_title_badge}</span>}
                    {post.author_custom_title && post.author_custom_title_expires_at && new Date(post.author_custom_title_expires_at) > new Date() && <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-medium">{post.author_custom_title}</span>}
                    {post.category_name && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{post.category_name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                    <span>{formatRelativeTime(post.created_at)}</span>
                    {(post.fortune && (!post.fortune_expires_at || new Date(post.fortune_expires_at) > new Date())) && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100">{post.fortune}</span>}
                  </div>
                </div>
                  </>
                )}
              </div>

              {/* 帖子标题 + 内容预览 */}
              <div className="px-4 pb-1.5 flex gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5 line-clamp-1">{post.title}</h3>
                  <p className="text-[13px] text-gray-500 line-clamp-1 leading-relaxed">
                    {typeof post.content === 'string' && post.content.startsWith('__PAID__') ? '内容已锁定，点击查看详情' : post.content?.replace(/!\[.*?\]\(.*?\)/g, '[图片]').replace(/\[([^\]]*)\]\(.*?\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[#*>`]/g, '').slice(0, 150)}
                  </p>
                </div>
                {(() => {
                  const img = extractFirstImage(post.content);
                  return img ? (
                    <div className="flex-shrink-0">
                      <img src={img} alt="" className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover border" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                  ) : null;
                })()}
              </div>

              {/* 统计信息 */}
              <div className="px-4 pb-2.5 flex items-center gap-3 text-xs text-gray-400">
                <span>浏览 {post.view_count}</span>
                <span>评论 {post.comment_count}</span>
                <span>赞 {post.like_count}</span>
              </div>
            </Link>
          );
        })}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-8">
          <button
            onClick={() => goToPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 min-w-[36px] border rounded-lg text-sm disabled:opacity-50"
          >
            上一页
          </button>
          {/* 页码组：移动端同样显示（按钮紧凑化），支持直接跳页 */}
          <span className="inline-flex flex-wrap justify-center gap-1">
            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 10) {
                pageNum = i + 1;
              } else if (page <= 5) {
                pageNum = i + 1;
              } else if (page >= totalPages - 4) {
                pageNum = totalPages - 9 + i;
              } else {
                pageNum = page - 4 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => goToPage(pageNum)}
                  className={`px-2 py-1.5 min-w-[32px] rounded-lg text-sm ${
                    page === pageNum ? 'bg-primary-600 text-white' : 'border hover:bg-gray-50'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </span>
          <button
            onClick={() => goToPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 min-w-[36px] border rounded-lg text-sm disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
        </div>
      </div>

      {/* 移动端抽屉侧边栏（<lg 显示）：半透明遮罩 + 左侧滑出面板，内容复用 HomeSidebar
          portal 到 body：避免被困在 main z-10 堆叠上下文（否则遮罩盖不住根级底部导航 z-50、面板底部被盖） */}
      {createPortal(
        <>
        <div
          className={`fixed inset-0 z-[55] bg-black/50 lg:hidden transition-opacity ${drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden={!drawerOpen}
        />
        <div
          className={`fixed left-0 top-0 bottom-0 w-72 z-[60] bg-white dark:bg-[#111] shadow-xl transition-transform duration-300 lg:hidden ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
          role="dialog"
          aria-label="侧边栏"
        >
          <div className="flex items-center justify-between pl-5 pr-2 h-14 border-b border-gray-100 dark:border-gray-800 shrink-0">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">社区信息</span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="关闭侧边栏"
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              <span aria-hidden="true" className="text-xl leading-none">✕</span>
            </button>
          </div>
          <div className="h-[calc(100%-3.5rem)] overflow-y-auto p-4">
            <HomeSidebar />
          </div>
        </div>
        </>,
        document.body
      )}
    </div>
    </>
  );
}
