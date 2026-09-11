import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { formatRelativeTime, formatDateTime, parseDate } from '../utils/date';
import { levelFromExp } from '../utils/level';
import { posts as postsApi, comments as commentsApi, likes as likesApi, reports as reportsApi, bookmarks as bookmarksApi, tips as tipsApi, decorations as decorationsApi, shop as shopApi, thanksApi, items as itemsApi } from '../services/api';
import type { Post, Comment } from '../types';
import { postBgClass } from '../utils/postBg';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { markdownSchema, isSafeMediaSrc } from '../utils/markdownSanitize';
import Avatar from '../components/Avatar';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import { Helmet } from 'react-helmet-async';
import { useToast } from '../contexts/ToastContext';
import VIPBadge, { getVipNickClass, getVipCommentClass } from '../components/VIPBadge';
import { PostDetailSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import ConfirmModal from '../components/ConfirmModal';
import PostEffectModal from '../components/PostEffectModal';
import BackButton from '../components/BackButton';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeart, faBan, faThumbtack, faEye, faFlag, faComments, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
// 注意：@fortawesome 包自带类型，此处子路径导入（含 chevron 系列）与裸模块导入解析到同一份真实类型，运行时不受影响
import { faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons/index.js';
import { faStar } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { faHeart as faHeartRegular, faStar as faStarRegular } from '@fortawesome/free-regular-svg-icons';

// 检查用户是否处于封禁期
function isBanned(author: { banned_until?: string | null } | undefined | null): boolean {
  // ponytail: SQLite 格式 "2025-01-01 12:00:00" 需要替换空格，否则 JS Date 解析失败
  return !!author?.banned_until && new Date(author.banned_until.replace(' ', 'T') + 'Z').getTime() > Date.now();
}

// 作者等级：复用 src/utils/level.ts（与后端 game.ts LEVEL_TIERS 单一数据源一致），不再页面内自维护

export default function PostDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const postId = id ? parseInt(id) : NaN;
  const isValidId = !isNaN(postId) && postId > 0;

  const [post, setPost] = useState<Post | null>(null);
  const [commentList, setCommentList] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: number; username: string } | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 评论加载失败独立于帖子本体错误：只在评论区位置提示，不替换整个页面
  const [commentError, setCommentError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 图片预览：一组幻灯片 + 当前下标（同一图片组内的图片可左右逐张切换）
  const [preview, setPreview] = useState<{ slides: { src: string }[]; index: number } | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Record<number, boolean>>({});
  const { toast } = useToast();
  const [commentFilter, setCommentFilter] = useState('all');
  const [reportModal, setReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment'; id: number } | null>(null);
  const [tipModal, setShowTipModal] = useState(false);
  const [tipTarget, setTipTarget] = useState<{ type: 'post' | 'comment'; id: number } | null>(null);
  const [commentPage, setCommentPage] = useState(1);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentLoadingMore, setCommentLoadingMore] = useState(false);
  const [likeAnimCommentId, setLikeAnimCommentId] = useState<number | null>(null);
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<number | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [postThanked, setPostThanked] = useState(false);
  const [thankedComments, setThankedComments] = useState<Set<number>>(new Set());

  useEffect(() => { if (isValidId) loadPost(); }, [id]);

  // ponytail: 点击回复后自动聚焦输入框并滚动到可视区域
  useEffect(() => {
    if (replyTo && commentInputRef.current) {
      commentInputRef.current.focus();
      commentInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [replyTo]);

  const loadComments = async (page: number, append: boolean = false) => {
    if (append) setCommentLoadingMore(true);
    try {
      const res = await commentsApi.list(postId, page);
      if (res.success && res.data) {
        const data = res.data;
        setCommentList(prev => append ? [...prev, ...data] : data);
        setCommentTotal(res.total || 0);
        setCommentPage(page);
        setCommentError('');
      } else {
        setCommentError(res.error || '加载评论失败');
      }
    } catch (err: any) { setCommentError(err.message || '加载评论失败'); }
    if (append) setCommentLoadingMore(false);
  };

  const sentinelRef = useRef<HTMLDivElement>(null);

  // 无限滚动：评论列表底部可见时自动加载下一页
  // 仅「全部」筛选下生效：其他筛选为本地排序/过滤，继续追加会破坏顺序稳定性
  useEffect(() => {
    if (commentFilter !== 'all') return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !commentLoadingMore && !commentError && commentList.length < commentTotal) {
        loadComments(commentPage + 1, true);
      }
    }, { rootMargin: '100px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [commentLoadingMore, commentList.length, commentTotal, commentPage, commentFilter, commentError]);

  const loadPost = async () => {
    setLoading(true);
    try {
      // 帖子详情已含 bookmarked 字段（后端合并），评论也同时加载
      const [postRes] = await Promise.all([
        postsApi.get(postId),
        loadComments(1),
      ]);
      if (postRes.success && postRes.data) {
        setPost(postRes.data);
        setBookmarked((postRes.data as any).bookmarked || false);
      }
    } catch (err: any) { setError(err.message || '加载失败'); }
    setLoading(false);
  };

  const [likeAnim, setLikeAnim] = useState(false);
  // 取消红包确认弹窗（仅发帖人）
  const [cancelRpOpen, setCancelRpOpen] = useState(false);
  // 效果管理弹窗（仅发帖人，每帖一次机会）
  const [effectModalOpen, setEffectModalOpen] = useState(false);
  // 抢红包排行榜（展开查看）
  const [rpOpen, setRpOpen] = useState(false);
  const [rpLoading, setRpLoading] = useState(false);
  const [rpError, setRpError] = useState('');
  const [rpClaims, setRpClaims] = useState<{ claims: { user_id: number; username: string | null; amount: number; created_at: string }[]; total_coins: number; total_packets: number; best: { user_id: number; username: string | null; amount: number } | null } | null>(null);
  // 抢红包记录：失败时进入错误态（显示重试），不伪装成「没有人抢到」
  const loadRpClaims = async () => {
    if (!post) return;
    setRpLoading(true);
    setRpError('');
    try {
      const res = await postsApi.redPacketClaims(post.id);
      if (res.success && res.data) setRpClaims(res.data);
      else setRpError(res.error || '加载失败');
    } catch (e: any) { setRpError(e?.message || '加载失败'); }
    setRpLoading(false);
  };
  const handleLike = async () => {
    if (!user) { navigate('/login', { state: { from: `/post/${id}` } }); return; }
    if (!post) return;
    // ponytail: 乐观更新 — 先变红+动画，后端失败再回滚
    const wasLiked = !!post.liked;
    setPost({ ...post, liked: !wasLiked, like_count: Math.max(0, post.like_count + (wasLiked ? -1 : 1)) });
    setLikeAnim(true); setTimeout(() => setLikeAnim(false), 300);
    try {
      await likesApi.toggle(post.id, 'post', wasLiked);
    } catch (e) {
      // 回滚 + 提示（如今日点赞次数已达上限等）
      setPost(p => p ? { ...p, liked: wasLiked, like_count: Math.max(0, p.like_count + (wasLiked ? 1 : -1)) } : null);
      toast((e as any)?.message || '操作失败', 'error');
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const handleDelete = async () => {
    try { await postsApi.delete(postId); navigate('/'); } catch (e: any) { toast(e?.message || '删除失败', 'error'); }
  };

  // 解锁付费帖：unlocking 防重入，成功后局部刷新（loadPost）保留滚动位置，不整页 reload
  const handleUnlock = async () => {
    if (unlocking) return;
    setUnlocking(true);
    try {
      const r = await postsApi.unlock(postId);
      if (r.success) {
        toast('已解锁', 'success');
        window.dispatchEvent(new Event('coins:changed')); // 付费消费后刷新导航栏余额
        await loadPost();
      } else {
        toast(r.error || '解锁失败', 'error');
      }
    } catch (e: any) { toast(e?.message || '解锁失败', 'error'); }
    setUnlocking(false);
  };

  const handleReport = async () => {
    if (!reportReason.trim() || !reportTarget) { toast('请填写举报原因', 'error'); return; }
    try {
      await reportsApi.create(reportTarget.type, reportTarget.id, reportReason.trim());
      toast('举报已提交', 'success');
      setReportModal(false); setReportReason(''); setReportTarget(null);
    } catch (err: any) { toast(err.message, 'error'); }
  };

  // 取消红包：仅发帖人，退款后刷新详情与导航栏余额
  const handleCancelRedPacket = async () => {
    if (!post?.red_packet_id) return;
    const json = await itemsApi.cancelEffect(`rp_${post.red_packet_id}`);
    setCancelRpOpen(false);
    if (json.success) {
      toast(json.message || '已取消红包', 'success');
      window.dispatchEvent(new Event('coins:changed'));
      loadPost(); // 刷新详情，红包面板随之消失
    } else {
      toast(json.error || '取消失败', 'error');
    }
  };

  const handlePinToggle = async () => {
    if (!post || !user || (user.role !== 'admin' && user.role !== 'moderator')) return;
    try {
      await postsApi.togglePin(post.id, !post.is_pinned);
      setPost({ ...post, is_pinned: post.is_pinned ? 0 : 1 });
    } catch (err: any) { toast(err.message || '操作失败', 'error'); }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newComment.trim()) return;
    setSubmitting(true);
    try {
      const res = await commentsApi.create(postId, newComment.trim(), replyTo?.id);
      if (res.success) {
        await loadComments(1);
        if (post) setPost({ ...post, comment_count: post.comment_count + 1 });
        const rp = res.data?.red_packet;
        if (rp?.won) {
          toast(`抢到红包 +${rp.amount} 积分`, 'success');
          window.dispatchEvent(new Event('coins:changed')); // 抢到红包后刷新导航栏余额
          loadPost(); // 刷新帖子详情，更新红包剩余
        } else {
          toast('评论成功', 'success');
        }
        setNewComment(''); setReplyTo(null);
      } else {
        toast(res.error || '评论失败', 'error');
      }
    } catch (err: any) { toast(err.message || '评论失败', 'error'); }
    setSubmitting(false);
  };

  const handleDeleteComment = async (commentId: number) => {
    try {
      await commentsApi.delete(commentId);
      await loadComments(1);
      if (post) setPost({ ...post, comment_count: Math.max(0, post.comment_count - 1) });
      toast('评论已删除', 'success');
    }
    catch (err: any) { toast(err.message || '删除失败', 'error'); }
  };

  const handleCommentLike = async (comment: Comment) => {
    if (!user) { navigate('/login'); return; }
    // ponytail: 乐观更新（map 生成新对象，避免直接改 state 对象）
    const wasLiked = !!comment.liked;
    setCommentList(list => list.map(c => c.id === comment.id
      ? { ...c, liked: !wasLiked, like_count: (c.like_count || 0) + (wasLiked ? -1 : 1) }
      : c));
    setLikeAnimCommentId(comment.id);
    setTimeout(() => setLikeAnimCommentId(null), 300);
    try {
      await likesApi.toggle(comment.id, 'comment', wasLiked);
    } catch (e) {
      // 回滚 + 提示（如今日点赞次数已达上限等）
      setCommentList(list => list.map(c => c.id === comment.id
        ? { ...c, liked: wasLiked, like_count: (c.like_count || 0) + (wasLiked ? 1 : -1) }
        : c));
      toast((e as any)?.message || '操作失败', 'error');
    }
  };

  const handlePostThanks = async () => {
    if (!user) { navigate('/login', { state: { from: `/post/${id}` } }); return; }
    if (!post) return;
    try {
      await thanksApi.send('post', post.id);
      setPostThanked(true);
      setPost({ ...post, thanks_count: (post.thanks_count || 0) + 1 });
      toast('感谢已送出', 'success');
    } catch (err: any) { toast(err.message || '感谢失败', 'error'); }
  };

  const handleCommentThanks = async (comment: Comment) => {
    if (!user) { navigate('/login'); return; }
    try {
      await thanksApi.send('comment', comment.id);
      setThankedComments(prev => new Set(prev).add(comment.id));
      comment.thanks_count = (comment.thanks_count || 0) + 1;
      setCommentList([...commentList]);
      toast('感谢已送出', 'success');
    } catch (err: any) { toast(err.message || '感谢失败', 'error'); }
  };

  // 点击图片：收集「同一图片组」（帖子正文容器 / 某条评论的正文容器，均带 data-img-group）
  // 内的全部图片，按 DOM 顺序作为幻灯片，被点击那张作为初始下标 → 预览里可左右逐张切换。
  // 用元素身份定位下标（同一 URL 出现多次也能定位到正确那张）；容器内没有头像等干扰图。
  const handleImageClick = useCallback((el: HTMLImageElement) => {
    const group = el.closest('[data-img-group]');
    const imgs = (group ? [...group.querySelectorAll('img')] : [el]).filter(i => i.getAttribute('src'));
    if (!imgs.length) return;
    const index = Math.max(0, imgs.indexOf(el));
    setPreview({ slides: imgs.map(i => ({ src: i.getAttribute('src') as string })), index });
  }, []);

  const markdownComponents = {
    img: ({ src, alt }: { src?: string; alt?: string }) =>
      isSafeMediaSrc(src, 'img') ? (
        <img src={src} alt={alt || ''} onClick={(e) => src && handleImageClick(e.currentTarget)}
          className="max-w-full max-h-80 md:max-h-96 w-auto rounded-lg my-3 cursor-pointer transition-opacity hover:opacity-90 object-contain" />
      ) : null,
    video: ({ src, controls }: { src?: string; controls?: boolean }) =>
      isSafeMediaSrc(src, 'video') ? (
        <video src={src} controls className="w-full max-h-[70vh] rounded-lg my-3 shadow-md bg-black" />
      ) : null,
    iframe: ({ src, title }: { src?: string; title?: string }) =>
      isSafeMediaSrc(src, 'iframe') ? (
        <div className="relative w-full aspect-video my-3 rounded-lg overflow-hidden shadow-md bg-black">
          <iframe src={src} title={title || '嵌入式视频'} loading="lazy"
            className="absolute inset-0 w-full h-full" allowFullScreen />
        </div>
      ) : null,
  };

  const toggleExpand = (commentId: number) => setExpandedReplies(prev => ({ ...prev, [commentId]: !prev[commentId] }));

  const toggleReplyTo = (cid: number, username: string) => {
    if (!user) { navigate('/login'); return; }
    setReplyTo(prev => (prev?.id === cid ? null : { id: cid, username }));
  };

  // 全量评论 ID → Comment 映射
  const buildCommentMap = (comments: Comment[]): Record<number, Comment> => {
    const map: Record<number, Comment> = {};
    const walk = (items: Comment[]) => { for (const item of items) { map[item.id] = item; if (item.children) walk(item.children); } };
    walk(comments);
    return map;
  };
  const commentMap = buildCommentMap(commentList);
  const getReplyTargetName = (reply: Comment): string | null => {
    if (!reply.parent_id) return null;
    return commentMap[reply.parent_id]?.author?.username || null;
  };

  // 展平所有后代回复（已弃用，改用递归 renderCommentTree）
  
  // 递归渲染评论树（depth=0 顶层，depth=1+ 子回复带层级缩进）
  // 递归渲染评论树（depth=0 顶层，depth=1+ 缩进，depth≥2 为上限）
  const renderCommentTree = (comment: Comment, depth: number = 0): JSX.Element => {
    const isHighlighted = !!user && replyTo?.id === comment.id;
    const replyTargetName = depth > 0 ? getReplyTargetName(comment) : null;
    const children = comment.children || [];

    // 顶层评论的展开/折叠控制
    const isExpanded = depth === 0 ? (expandedReplies[comment.id] || false) : true;
    const visibleChildren = depth === 0 && !isExpanded ? children.slice(0, 2) : children;
    const totalReplies = children.length;
    const hasMore = depth === 0 && totalReplies > 2;

    // depth=0 无缩进，depth=1 缩进 20px，depth>=2 缩进 40px（上限防溢出）
    const indentClass = depth === 0 ? '' : depth === 1 ? 'pl-5' : 'pl-10';
    const vipClass = getVipCommentClass(comment.author?.vip_tier);

    return (
      <div key={comment.id} className={`py-3 first:pt-0 last:pb-0 transition ${
        isHighlighted ? 'bg-blue-50/50 -mx-4 px-4 rounded-lg' : ''
      } ${indentClass} ${vipClass}`}>
        <div className="flex items-start gap-2.5">
          <Link to={`/user/${comment.user_id}`} className="flex-shrink-0 mt-0.5">
            <Avatar url={comment.author?.avatar_url} username={comment.author?.username}
              size={depth === 0 ? 'md' : 'sm'}
              className={depth === 0 ? '' : 'w-6 h-6 text-xs'} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link to={`/user/${comment.user_id}`}
                className={`${depth === 0 ? 'font-semibold text-sm' : 'text-sm font-medium'} transition ${
                  getVipNickClass(comment.author?.vip_tier, comment.author?.nick_theme) || 'text-gray-900 hover:text-primary-600'
                }`}>
                {comment.author?.username || '匿名'}
              </Link>
              <VIPBadge vip_tier={comment.author?.vip_tier} />
              {comment.author?.role === 'admin' && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-medium">管理员</span>}
              {comment.author?.role === 'moderator' && <span className="bg-yellow-100 text-yellow-600 text-[10px] px-1.5 py-0.5 rounded font-medium">巡查员</span>}
              <span className="text-gray-400 text-xs">{formatRelativeTime(comment.created_at)}</span>
              {isHighlighted && <span className="text-[10px] bg-primary-100 text-primary-600 px-1.5 py-0.5 rounded font-medium">正在回复</span>}
            </div>
            {replyTargetName && (
              <div className="text-xs text-gray-400 mt-0.5">
                回复 <span className="text-primary-500 font-medium">@{replyTargetName}</span>
              </div>
            )}
            {/* data-img-group：本评论的图片预览范围（只收集这里的图，不跨评论/正文） */}
            <div data-img-group className={`mt-1 ${depth === 0 ? 'text-gray-800' : 'text-gray-700'} prose prose-sm max-w-none`}>
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]} components={markdownComponents}>
                {comment.content}
              </ReactMarkdown>
            </div>
            {/* 触控：px-2 py-1.5 -mx-1 扩大命中区（视觉不变）；「删除」为危险操作用红色区分 */}
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              <button onClick={() => handleCommentLike(comment)}
                className={`flex items-center gap-1 px-2 py-1.5 -mx-1 hover:text-primary-600 transition ${
                  comment.liked ? 'text-red-500' : ''
                } ${likeAnimCommentId === comment.id ? 'scale-125' : ''}`}>
                <FontAwesomeIcon icon={(comment.liked ? faHeart : faHeartRegular) as IconDefinition} /> {comment.like_count || 0}
              </button>
              {user && post?.category_allow_thanks === 1 && comment.user_id !== user.id && (
                <button onClick={() => handleCommentThanks(comment)} disabled={thankedComments.has(comment.id)}
                  className={`flex items-center gap-1 px-2 py-1.5 -mx-1 transition ${
                    thankedComments.has(comment.id) ? 'text-gray-300 cursor-default' : 'hover:text-primary-600'
                  }`}>
                  👏 {comment.thanks_count ?? 0}
                </button>
              )}
              <button onClick={() => toggleReplyTo(comment.id, comment.author?.username || '')}
                className={`flex items-center px-2 py-1.5 -mx-1 hover:text-primary-600 transition ${isHighlighted ? 'text-primary-600 font-medium' : ''}`}>
                {isHighlighted ? '取消回复' : '回复'}
              </button>
              {user && (
                <button onClick={() => { setReportTarget({ type: 'comment', id: comment.id }); setReportModal(true); }}
                  className="flex items-center px-2 py-1.5 -mx-1 hover:text-orange-500 transition text-gray-400">举报</button>
              )}
              {(user?.id === comment.user_id || user?.role === 'admin') && (
                <button onClick={() => setDeleteCommentTarget(comment.id)}
                  className="flex items-center px-2 py-1.5 -mx-1 text-red-500 hover:text-red-600 transition">删除</button>
              )}
            </div>
          </div>
        </div>

        {/* 递归渲染子回复 — 放在展开/收起按钮上方 */}
        {visibleChildren.length > 0 && (
          <div className="mt-1 space-y-1">
            {visibleChildren.map(child => renderCommentTree(child, depth + 1))}
          </div>
        )}

        {/* 展开/收起按钮 — 放在所有回复的底部 */}
        {hasMore && !isExpanded && (
          <div className={depth === 0 ? 'pl-5' : ''}>
            <button onClick={() => toggleExpand(comment.id)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium py-1.5 transition inline-flex items-center gap-1">
              <FontAwesomeIcon icon={faChevronDown as unknown as IconDefinition} style={{fontSize: '10px'}} /> 查看全部 {totalReplies} 条回复
            </button>
          </div>
        )}
        {hasMore && isExpanded && (
          <div className={depth === 0 ? 'pl-5' : ''}>
            <button onClick={() => toggleExpand(comment.id)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium py-1.5 transition inline-flex items-center gap-1">
              <FontAwesomeIcon icon={faChevronUp as unknown as IconDefinition} style={{fontSize: '10px'}} /> 收起回复
            </button>
          </div>
        )}
      </div>
    );
  };

  // 评论筛选
  const filterOptions = [
    { key: 'all', label: '全部' },
    { key: 'latest', label: '最新' },
    { key: 'oldest', label: '最早' },
    { key: 'hottest', label: '最热' },
    { key: 'author', label: '仅看楼主' },
  ];
  const filteredComments = (() => {
    if (commentFilter === 'author') {
      // 非匿名帖：按 user_id 匹配楼主
      if (post?.user_id != null) return commentList.filter(c => c.user_id === post.user_id);
      // 匿名帖：后端评论若带 is_owner 字段则按它筛选，否则返回空（由「匿名帖暂不支持」提示兜底）
      if (commentList.some(c => (c as any).is_owner !== undefined)) return commentList.filter(c => (c as any).is_owner);
      return [];
    }
    if (commentFilter === 'latest') return [...commentList].sort((a, b) => (parseDate(b.created_at)?.getTime() ?? 0) - (parseDate(a.created_at)?.getTime() ?? 0));
    if (commentFilter === 'oldest') return [...commentList].sort((a, b) => (parseDate(a.created_at)?.getTime() ?? 0) - (parseDate(b.created_at)?.getTime() ?? 0));
    if (commentFilter === 'hottest') return [...commentList].sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
    return commentList;
  })();

  // 切换筛选：重置分页并重新加载，避免筛选只作用于已加载的部分；
  // 非「全部」筛选下无限滚动被禁用（见 sentinel effect），保证排序/过滤结果顺序稳定
  const changeCommentFilter = (key: string) => {
    if (key === commentFilter) return;
    setCommentFilter(key);
    setCommentPage(1);
    setCommentTotal(0);
    setCommentList([]);
    setCommentError('');
    loadComments(1);
  };

  if (!isValidId) return <div className="text-center py-12 text-gray-500">帖子不存在</div>;
  if (loading) return <PostDetailSkeleton />;
  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-500 mb-4">{error}</p>
      <button onClick={() => { setError(''); loadPost(); }}
        className="px-4 py-2 border rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition">重试</button>
    </div>
  );
  if (!post) return <div className="text-center py-12 text-gray-500">帖子不存在</div>;

  // 解析装饰 CSS 类名 — 卡片装饰
  let cardDecoClass = '';
  try {
    if ((post as any).decoration_data) {
      const d = JSON.parse((post as any).decoration_data);
      if (d.css_class) cardDecoClass = d.css_class;
    }
  } catch (e) { console.error(e); }
  // 标题装饰 (鎏金标题) — 可叠加
  let titleDecoClass = '';
  try {
    if ((post as any).title_decoration_data) {
      const d = JSON.parse((post as any).title_decoration_data);
      if (d.css_class) titleDecoClass = d.css_class;
    }
  } catch (e) { console.error(e); }
  // article 上的装饰类 (排除纯标题装饰)
  const articleDecoClass = cardDecoClass;

  // 炫彩标题仅在有效期内显示（SQLite UTC 时间转 Date）
  const rainbowActive = post.title_effect === 'rainbow' && !!post.title_effect_expires_at &&
    new Date(post.title_effect_expires_at.replace(' ', 'T') + 'Z').getTime() > Date.now();
  // 高亮卡有效期内：卡片加金色边框+光晕（与帖子背景卡互不冲突）
  const highlightActive = !!post.highlighted_until &&
    (parseDate(post.highlighted_until)?.getTime() ?? 0) > Date.now();
  const authorLv = post.author_exp != null ? levelFromExp(post.author_exp) : null;

  const pageTitle = post?.title ? `${post.title} - CloudForum` : 'CloudForum';
  const pageDesc = post?.content?.replace(/[#*>`\[\]]/g, '').slice(0, 120) || 'CloudForum - 社区论坛';

  // 作者信息块 — 匿名帖（user_id 为 null）用纯 div，避免死链 /user/null
  // 匿名帖不显示任何作者身份信息（头像/框/等级/徽章/封禁标记），仅"匿名同学"；帖子状态徽章（置顶/提升/高亮/炫彩）保留
  const authorInfo = post.is_anonymous === 1 ? (
    <>
      <div className="w-14 h-14 rounded-full bg-gray-100 shrink-0" />
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-bold text-gray-400">匿名同学</h2>
          {post.is_pinned ? <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium"><FontAwesomeIcon icon={faThumbtack} className="mr-1" />置顶</span> : null}
          {(post as any).bumped_until && (parseDate((post as any).bumped_until)?.getTime() ?? 0) > Date.now() ? <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">🚀 提升中</span> : null}
          {highlightActive ? <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">✨ 高亮</span> : null}
          {rainbowActive ? <span className="text-xs bg-gradient-to-r from-yellow-100 to-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">🌈 炫彩</span> : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
          <span>{formatDateTime(post.created_at)}</span>
          {post.category && <><span>·</span><span>{post.category.name}</span></>}
          <span>·</span><span><FontAwesomeIcon icon={faEye} className="mr-1" />{post.view_count} 浏览</span>
        </div>
      </div>
    </>
  ) : (
    <>
      <Avatar url={post.author?.avatar_url} username={post.author?.username} size="lg" frame={post.author?.avatar_frame} frameExpiresAt={post.author?.avatar_frame_expires_at} />
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className={`font-bold transition ${getVipNickClass(post.author?.vip_tier, post.author?.nick_theme) || 'text-gray-900 group-hover:text-primary-600'}`}>{post.is_anonymous === 1 ? '匿名同学' : (post.author?.username || '匿名')}</h2>
          {post.is_anonymous === 1 && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">匿名</span>}
          <VIPBadge vip_tier={post.author?.vip_tier} />
          {authorLv && <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">Lv.{authorLv.level} {authorLv.tierName}</span>}
          {post.author?.title_badge && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">{post.author?.title_badge}</span>}
          {post.author_custom_title && post.author_custom_title_expires_at && (parseDate(post.author_custom_title_expires_at)?.getTime() ?? 0) > Date.now() && <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-medium">{post.author_custom_title}</span>}
          {isBanned(post.author) && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium" title="该用户已被封禁"><FontAwesomeIcon icon={faBan} /></span>}
          {post.is_pinned ? <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium"><FontAwesomeIcon icon={faThumbtack} className="mr-1" />置顶</span> : null}
          {(post as any).bumped_until && (parseDate((post as any).bumped_until)?.getTime() ?? 0) > Date.now() ? <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">🚀 提升中</span> : null}
          {highlightActive ? <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">✨ 高亮</span> : null}
          {rainbowActive ? <span className="text-xs bg-gradient-to-r from-yellow-100 to-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">🌈 炫彩</span> : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
          <span>{formatDateTime(post.created_at)}</span>
          {post.category && <><span>·</span><span>{post.category.name}</span></>}
          {(post.fortune && (!post.fortune_expires_at || (parseDate(post.fortune_expires_at)?.getTime() ?? 0) > Date.now())) && <><span>·</span><span className="px-1.5 py-0.5 rounded bg-gray-100">{post.fortune}</span></>}
          {/* message button removed */}
          <span>·</span><span><FontAwesomeIcon icon={faEye} className="mr-1" />{post.view_count} 浏览</span>
        </div>
      </div>
    </>
  );

  return (
    <>
    <Helmet><title>{pageTitle}</title><meta name="description" content={pageDesc} /></Helmet>
    <div className="max-w-4xl mx-auto">
      <BackButton />
      <article className={`bg-white rounded-2xl border mb-6 ${postBgClass(post.post_bg_id)} ${articleDecoClass} ${highlightActive ? 'post-highlighted' : ''} ${!articleDecoClass ? 'overflow-hidden' : ''}`}>
        {/* 移动端：作者行与操作按钮分两行（flex-col），sm 以上恢复同行；按钮区 flex-wrap 防 375px 挤压 */}
        <div className="p-5 pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {post.user_id ? (
            <Link to={`/user/${post.user_id}`} className="flex items-center gap-3 group flex-1 min-w-0">{authorInfo}</Link>
          ) : (
            <div className="flex items-center gap-3 flex-1 min-w-0">{authorInfo}</div>
          )}
          <div className="flex flex-wrap items-center justify-start sm:justify-end gap-1.5 shrink-0">
            {(user?.role === 'admin' || user?.role === 'moderator') && (
              <button onClick={handlePinToggle} className={`text-xs border px-2.5 py-1 rounded-lg transition ${post.is_pinned ? 'bg-yellow-50 text-yellow-700 border-yellow-300 hover:bg-yellow-100' : 'text-gray-500 hover:text-yellow-600 border-gray-300 hover:border-yellow-400'}`}>
                {post.is_pinned ? <><FontAwesomeIcon icon={faThumbtack} /> 取消置顶</> : <><FontAwesomeIcon icon={faThumbtack} /> 置顶</>}
              </button>
            )}
            {(post.is_owner || user?.role === 'admin') && (
              <>
                <Link to={`/post/${post.id}/edit`} className="text-xs text-gray-500 hover:text-primary-600 border px-2.5 py-1 rounded-lg transition">编辑</Link>
                <button onClick={() => setDeleteConfirm(true)} className="text-xs text-gray-500 hover:text-red-500 border px-2.5 py-1 rounded-lg transition">删除</button>
              </>
            )}
            {/* 效果管理：发帖后一次性管理帖子背景/装饰（每帖仅一次机会） */}
            {post.is_owner && (
              <button onClick={() => setEffectModalOpen(true)}
                className="text-xs text-gray-500 hover:text-primary-600 border px-2.5 py-1 rounded-lg transition">
                效果管理
              </button>
            )}
          </div>
        </div>
        {post.reported && (
          <div className="mx-5 mt-2 bg-orange-50/70 border border-orange-200/50 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
            <span className="text-orange-400 text-xs"><FontAwesomeIcon icon={faFlag} /></span>
            <span className="text-xs text-orange-600">已被举报，处理中</span>
          </div>
        )}
        {/* 打回待编辑横幅：仅作者本人/管理员可见（非作者在详情接口已 404） */}
        {(post as any).review_status === 'rejected' && (
          <div className="mx-5 mt-2 bg-red-50/80 border border-red-200/60 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-red-400 text-xs"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
              <span className="text-xs font-medium text-red-600">帖子被打回修改</span>
            </div>
            <p className="text-xs text-red-500 leading-relaxed">
              原因：{(post as any).flagged_reason || '未填写'} · 请修改后重新提交，1 天内未修改将被删除
            </p>
            <Link to={`/post/${post.id}/edit`} className="mt-2 inline-block text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-red-700 transition">✏️ 去重新编辑</Link>
          </div>
        )}
        {/* 应用装饰: cardDecoClass→article容器; titleDecoClass→h1; 二者可叠加 */}
        <div className={`px-5 pt-4 ${cardDecoClass ? 'relative' : ''}`}>
          <h1 className={`text-xl font-bold text-gray-900 ${titleDecoClass} ${rainbowActive ? 'title-effect-rainbow' : ''}`}>{post.title}</h1>
        </div>
        {/* 付费墙 */}
        {post.requires ? (
          <div className="max-w-md mx-auto my-12 p-8 bg-white rounded-xl border text-center">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-lg font-bold mb-2">此帖子需要付费查看</h2>
            <p className="text-2xl font-bold text-amber-600 mb-4">{post.requires.price} 🪙</p>
            <button onClick={handleUnlock} disabled={unlocking}
              className="bg-primary-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50">
              {unlocking ? '解锁中...' : `支付 ${post.requires.price} 积分查看`}
            </button>
          </div>
        ) : (
          <div data-img-group className="px-5 py-4 prose max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]} components={markdownComponents}>{post.content}</ReactMarkdown>
          </div>
        )}
        {/* 红包卡片 — 有红包时显示（含已被抢完状态 + 抢红包排行榜） */}
        {post.red_packet_id != null && (
          <div className="mx-5 my-4 bg-red-50/60 border border-red-200 rounded-lg px-4 py-3">
            {/* 触控：flex-wrap 允许 375px 下换行；「抢红包记录」ml-auto 靠右 */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl shrink-0">🧧</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-red-700">帖子红包</div>
                <div className="text-xs text-gray-500">
                  共 {post.red_packet_total_coins} 积分 · {post.red_packet_total_packets} 份
                  {!!post.red_packet_remaining_packets && ` · 剩余 ${post.red_packet_remaining_coins} 积分 / ${post.red_packet_remaining_packets} 份`}
                </div>
              </div>
              {post.red_packet_remaining_packets ? (
                <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded font-medium whitespace-nowrap shrink-0">评论即可抢</span>
              ) : (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded font-medium whitespace-nowrap shrink-0">已被抢完</span>
              )}
              {post.is_owner && !!post.red_packet_remaining_packets && (
                <button onClick={() => setCancelRpOpen(true)}
                  className="text-xs text-red-500 whitespace-nowrap shrink-0 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50 transition">
                  取消并退款
                </button>
              )}
              <button
                onClick={async () => {
                  if (!rpClaims && !rpLoading) await loadRpClaims();
                  setRpOpen(!rpOpen);
                }}
                className="text-xs text-red-500 hover:underline whitespace-nowrap shrink-0 ml-auto"
              >
                {rpOpen ? '收起' : '抢红包记录'}
              </button>
            </div>
            {rpOpen && (
              <div className="mt-3 border-t border-red-200/70 pt-2">
                {rpLoading ? (
                  <p className="text-xs text-gray-400 py-1">加载中...</p>
                ) : rpError ? (
                  <div className="flex items-center gap-2 text-xs py-1">
                    <span className="text-red-400">{rpError}</span>
                    <button onClick={loadRpClaims} className="text-primary-600 hover:underline">点击重试</button>
                  </div>
                ) : rpClaims && rpClaims.claims.length > 0 ? (
                  <>
                    {rpClaims.best && (
                      <div className="flex items-center gap-2 text-sm mb-2">
                        <span className="text-lg">👑</span>
                        <span className="font-medium text-red-700">{rpClaims.best.username || '用户'}</span>
                        <span className="text-gray-500 text-xs">手气最佳</span>
                        <span className="ml-auto font-bold text-red-600">{rpClaims.best.amount} 积分</span>
                      </div>
                    )}
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {rpClaims.claims.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-gray-600 py-1">
                          <span className="w-5 text-gray-400">{i + 1}.</span>
                          <span className="flex-1 truncate">{c.username || '用户'}</span>
                          <span className="text-gray-400">{formatRelativeTime(c.created_at)}</span>
                          <span className={`font-medium ${c.user_id === rpClaims.best?.user_id ? 'text-red-600' : 'text-gray-700'}`}>{c.amount} 积分</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-gray-400 py-1">还没有人抢到红包，快来评论抢吧</p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="px-5 py-3 border-t bg-black/[0.03] dark:bg-white/[0.03] flex flex-wrap items-center gap-3 md:gap-6">
          <button onClick={handleLike} className={`flex items-center gap-1.5 py-1.5 px-2.5 text-sm font-medium transition ${post.liked ? 'text-red-500' : 'text-gray-500 hover:text-red-500'}`}>
            <span className={likeAnim ? 'heart-pop inline-block' : ''}><FontAwesomeIcon icon={(post.liked ? faHeart : faHeartRegular) as IconDefinition} /></span> {post.like_count}
          </button>
          <span className="text-sm text-gray-500"><FontAwesomeIcon icon={faComments} className="mr-1" />{post.comment_count} 评论</span>
          {user && (
            <>
            <button onClick={async () => {
              const res = await bookmarksApi.toggle(post.id);
              if (res.success) setBookmarked(res.data?.bookmarked || false);
            }} className={`flex items-center gap-1 py-1.5 px-2.5 text-sm font-medium transition ${bookmarked ? 'text-yellow-500' : 'text-gray-500 hover:text-yellow-500'}`}>
              <FontAwesomeIcon icon={(bookmarked ? faStar : faStarRegular) as IconDefinition} /> 收藏
            </button>
            <button onClick={() => { setReportTarget({ type: 'post', id: postId }); setReportModal(true); }}
              className="text-sm text-gray-400 hover:text-orange-500 transition flex items-center gap-1 ml-2 py-1.5 px-2.5">
              <FontAwesomeIcon icon={faFlag} /> 举报
            </button>
            {/* 打赏按钮 */}
            <button onClick={() => { setTipTarget({ type: 'post', id: postId }); setShowTipModal(true); }}
              className="text-sm text-amber-500 hover:text-amber-600 transition flex items-center gap-1 ml-2 py-1.5 px-2.5">
              🪙 打赏
            </button>
            {/* 感谢按钮 — 自己的帖子不显示；板块未启用感谢（category_allow_thanks=0）也不显示 */}
            {!post.is_owner && post.category_allow_thanks === 1 && (
              <button onClick={handlePostThanks} disabled={postThanked}
                className={`text-sm transition flex items-center gap-1 ml-2 py-1.5 px-2.5 ${
                  postThanked ? 'text-gray-300 cursor-default' : 'text-gray-500 hover:text-primary-600'
                }`}>
                👏 感谢{post.thanks_count ? ` ${post.thanks_count}` : ''}
              </button>
            )}
            </>
          )}
          <button onClick={() => document.getElementById('comments-section')?.scrollIntoView({ behavior: 'smooth' })}
            className="ml-auto py-1.5 px-2.5 text-sm text-gray-500 hover:text-primary-600 transition flex items-center gap-1">
            ↓ 跳转评论
          </button>
        </div>
      </article>

      <div id="comments-section" className="bg-white rounded-2xl border p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
          <h2 className="text-base font-bold text-gray-900">全部评论 <span className="text-gray-400 font-normal">({post.comment_count})</span></h2>
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="text-xs text-gray-400 hover:text-primary-600 transition flex items-center gap-1">
            ↑ 回到顶部
          </button>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {filterOptions.map(f => (
              <button key={f.key} onClick={() => changeCommentFilter(f.key)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition ${
                  commentFilter === f.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >{f.label}</button>
            ))}
          </div>
        </div>

        {user ? (
          <form onSubmit={handleComment} className="mb-6 pb-6 md:pb-6 border-b">
            {replyTo && (
              <div className="flex items-center gap-2 mb-3 text-sm text-gray-500">
                <span>回复 <strong className="text-primary-600">{replyTo.username}</strong></span>
                <button type="button" onClick={() => setReplyTo(null)} className="text-primary-600 hover:underline">取消</button>
              </div>
            )}
            <div className="flex items-start gap-3">
              <Link to="/profile"><Avatar url={user.avatar_url} username={user.username} size="sm" /></Link>
              <div className="flex-1">
                <textarea ref={commentInputRef} value={newComment} onChange={e => setNewComment(e.target.value)} rows={2}
                  className="w-full px-4 py-2.5 border rounded-xl outline-none focus:border-primary-500 text-base resize-none bg-gray-50"
                  placeholder={replyTo ? `回复 ${replyTo.username}...` : '写下你的评论...'} required />
                <div className="flex justify-end mt-2">
                  <button type="submit" disabled={submitting || !newComment.trim()}
                    className="bg-primary-600 text-white px-5 py-1.5 min-h-[40px] rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">
                    {submitting ? '发送中...' : '发表评论'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        ) : (
          <div className="text-center py-6 bg-gray-50 rounded-xl mb-6 border">
            <Link to="/login" state={{ from: `/post/${id}` }} className="text-primary-600 hover:underline font-medium">登录</Link> 后即可参与评论
          </div>
        )}

        {commentList.length === 0 && commentError ? (
          <div className="text-center py-8">
            <p className="text-sm text-red-500 mb-3">{commentError}</p>
            <button onClick={() => { setCommentError(''); loadComments(1); }}
              className="text-xs px-3 py-1.5 border rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition">重试加载评论</button>
          </div>
        ) : filteredComments.length === 0 ? (
          commentFilter === 'author' && post?.user_id == null ? (
            <EmptyState
              icon={faComments}
              title="匿名帖暂不支持"
              description="该帖为匿名发布，「仅看楼主」筛选暂不可用"
            />
          ) : (
            <EmptyState
              icon={faComments}
              title={commentFilter === 'author' ? '楼主暂无评论' : '暂无评论'}
              description={commentFilter === 'author' ? '该楼主还没有发表过评论' : '来发表第一条评论吧'}
            />
          )
        ) : (
          <>
            <div className="divide-y divide-gray-100">{filteredComments.map(comment => renderCommentTree(comment, 0))}</div>
            {/* 无限滚动哨兵 — 仅「全部」筛选下滚动到此自动加载下一页（其他筛选禁用，保证顺序稳定） */}
            {commentFilter === 'all' ? (
              commentList.length < commentTotal && (
                <div ref={sentinelRef} className="text-center pt-4 pb-2">
                  {commentLoadingMore ? (
                    <span className="text-sm text-gray-400">加载中...</span>
                  ) : (
                    <span className="text-sm text-gray-300">下拉加载更多</span>
                  )}
                </div>
              )
            ) : (
              <div className="text-center pt-4 pb-2">
                <span className="text-sm text-gray-400">当前显示已加载的 {filteredComments.length} 条，切换回「全部」可加载更多</span>
              </div>
            )}
            {/* 追加加载失败 — 保留已加载列表，单独提示重试，不伪装成空 */}
            {commentError && commentList.length > 0 && (
              <div className="text-center pt-1 pb-1">
                <span className="text-xs text-red-400">加载更多失败</span>
                <button onClick={() => { setCommentError(''); loadComments(commentPage + 1, true); }}
                  className="text-xs text-primary-600 hover:underline ml-2">重试</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 打赏弹窗 */}
      {tipModal && tipTarget && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => { setShowTipModal(false); setTipTarget(null); }}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">打赏</h3>
            <p className="text-gray-500 text-sm mb-4">选择打赏金额</p>
            <div className="flex gap-3 justify-center mb-4">
              {[5, 10, 50].map(amt => (
                <button key={amt} onClick={async () => {
                  try {
                    const res = await tipsApi.send(tipTarget.type, tipTarget.id, amt);
                    if (res.success) { toast(`打赏成功！送出 ${amt} 积分`, 'success'); window.dispatchEvent(new Event('coins:changed')); setShowTipModal(false); setTipTarget(null); }
                  } catch (err: any) { toast(err.message, 'error'); }
                }} className="w-20 h-20 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900 dark:to-orange-950 border border-amber-200 dark:border-amber-800 rounded-2xl flex flex-col items-center justify-center gap-1 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-md transition">
                  <span className="text-2xl">{amt}</span>
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">🪙</span>
                </button>
              ))}
            </div>
            <button onClick={() => { setShowTipModal(false); setTipTarget(null); }}
              className="w-full py-2 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition">取消</button>
          </div>
        </div>,
        document.body
      )}

      {/* 举报弹窗 */}
      {reportModal && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => { setReportModal(false); setReportReason(''); setReportTarget(null); }}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">举报{reportTarget?.type === 'comment' ? '评论' : '帖子'}</h3>
            <textarea value={reportReason} onChange={e => setReportReason(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl text-sm outline-none focus:border-primary-500 resize-none"
              rows={3} placeholder="请描述违规原因..." />
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setReportModal(false); setReportReason(''); setReportTarget(null); }}
                className="flex-1 px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
              <button onClick={handleReport} disabled={!reportReason.trim()}
                className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-medium hover:bg-orange-700 disabled:opacity-50 transition">提交举报</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <Lightbox
        open={!!preview}
        close={() => setPreview(null)}
        slides={preview?.slides || []}
        index={preview?.index ?? 0}
        // 同步当前下标：翻到第 N 张后关闭再点第一张，仍能正确从第一张开始
        on={{ view: ({ index }) => setPreview(p => (p && p.index !== index ? { ...p, index } : p)) }}
        plugins={[Zoom]}
        zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
      />
      <ConfirmModal
        open={deleteConfirm}
        title="删除帖子"
        message="确定删除此帖子？此操作不可撤销，帖子和所有评论将被永久删除。"
        confirmText="确认删除"
        danger
        onConfirm={() => { setDeleteConfirm(false); handleDelete(); }}
        onCancel={() => setDeleteConfirm(false)}
      />
      <ConfirmModal
        open={deleteCommentTarget !== null}
        title="删除评论"
        message="确定删除此评论？"
        confirmText="确认删除"
        danger
        onConfirm={() => { if (deleteCommentTarget != null) handleDeleteComment(deleteCommentTarget); setDeleteCommentTarget(null); }}
        onCancel={() => setDeleteCommentTarget(null)}
      />
      <ConfirmModal
        open={cancelRpOpen}
        title="取消红包"
        message={`取消后剩余 ${post?.red_packet_remaining_coins ?? 0} 积分将退还到你的账户，已领取的部分无法收回。确定取消吗？`}
        confirmText="确认取消并退款"
        danger
        onConfirm={handleCancelRedPacket}
        onCancel={() => setCancelRpOpen(false)}
      />
      {/* 效果管理（每帖一次机会） */}
      <PostEffectModal
        open={effectModalOpen}
        post={post}
        onClose={() => setEffectModalOpen(false)}
        onChanged={() => loadPost()}
      />
    </div>
    </>
  );
}
