import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { formatDate, formatRelativeTime } from '../utils/date';
import { users as usersApi, auth as authApi, upload as uploadApi, posts as postsApi, bookmarks as bookmarksApi, follows as followsApi, achievementsApi, invites as invitesApi } from '../services/api';
import type { PublicUser, Post, AchievementInfo } from '../types';
import { levelFromExp } from '../utils/level';
import { compressImageIfNeeded } from '../utils/imageCompress';
import { rewardLabel } from '../utils/achievements';
import Avatar from '../components/Avatar';
import BackButton from '../components/BackButton';
import ConfirmModal from '../components/ConfirmModal';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import CropModal from '../components/CropModal';
import VIPBadge, { getVipNickClass } from '../components/VIPBadge';
import { ProfileSkeleton, PostListSkeleton } from '../components/Skeleton';
import { faNewspaper, faBookmark } from '@fortawesome/free-solid-svg-icons';
import EmptyState from '../components/EmptyState';

export default function Profile() {
  const { id } = useParams();
  const { user: currentUser, refreshUser, logout, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isOwnProfile = !id || (currentUser && currentUser.id === parseInt(id));
  // 自己已保存的昵称主题（S VIP+ 专用；编辑入口在「编辑资料」页）
  const myNickTheme = currentUser?.nick_theme && currentUser.nick_theme !== 'default' ? currentUser.nick_theme : 'theme1';
  const profileId = id ? parseInt(id) : currentUser?.id;

  const [profileUser, setProfileUser] = useState<PublicUser | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [postList, setPostList] = useState<Post[]>([]);
  const [postTotal, setPostTotal] = useState(0);
  const [postPage, setPostPage] = useState(1);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [tab, setTab] = useState<'posts' | 'bookmarks' | 'growth' | 'invite' | 'settings'>(() => {
    // 支持 /profile?tab=settings 直达（从「编辑资料」「注销账户」等子页返回时落回原 tab）
    const t = new URLSearchParams(window.location.search).get('tab');
    return (['posts', 'bookmarks', 'growth', 'invite', 'settings'] as const).includes(t as any)
      ? (t as 'posts' | 'bookmarks' | 'growth' | 'invite' | 'settings')
      : 'posts';
  });
  const [bmList, setBmList] = useState<any[]>([]);
  const [bmTotal, setBmTotal] = useState(0);
  const [bmPage, setBmPage] = useState(1);
  const [bmLoading, setBmLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // 重发验证码倒计时（60s 防连点/防轰炸）
  // 注册邮箱验证徽章（未验证时显示）
  const [emailVerifyOpen, setEmailVerifyOpen] = useState(false);
  const [emailVerifyCode, setEmailVerifyCode] = useState('');
  const [emailVerifyLoading, setEmailVerifyLoading] = useState(false);
  const [emailVerifyError, setEmailVerifyError] = useState('');
  // 邀请好友
  const [inviteData, setInviteData] = useState<{ codes: { code: string; created_at: string }[]; invited_count: number; total_reward: number } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerVer, setBannerVer] = useState(0); // 背景图版本号（更新后 +时间戳，防缓存旧图）
  const [cropModal, setCropModal] = useState<{ file: File; aspect: number; type: 'avatar' | 'banner' } | null>(null);
  const cropTypeRef = useRef<'avatar' | 'banner'>('avatar');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showBanDetail, setShowBanDetail] = useState(false);
  // 上一次渲染的 profileId：用于区分「首次挂载」与「真正切换用户」（后者才重置 tab）
  const prevProfileIdRef = useRef<number | undefined>(undefined);
  const [achData, setAchData] = useState<{ achievements: AchievementInfo[]; unlocked_count: number; total: number } | null>(null);
  const [achLoading, setAchLoading] = useState(false);
  const [achError, setAchError] = useState(false);
  const [achCollapsed, setAchCollapsed] = useState(false); // 成就栏折叠（默认展开）
  const [unbanModal, setUnbanModal] = useState(false);
  const [logoutModal, setLogoutModal] = useState(false);

  // 未登录访问 /profile（自己主页）→ 跳登录页并带 from 回跳
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser && !id) {
      navigate('/login', { state: { from: '/profile' } });
    }
  }, [authLoading, currentUser, id, navigate]);

  useEffect(() => {
    if (profileId) {
      // 切换用户时重置分页/tab/收藏列表，避免展示上一个用户的数据。
      // 注意：首次挂载不要重置 tab —— 否则会覆盖 /profile?tab=xxx 指定的初始 tab
      const switchedUser = prevProfileIdRef.current !== undefined && prevProfileIdRef.current !== profileId;
      prevProfileIdRef.current = profileId;
      setPostPage(1);
      if (switchedUser) setTab('posts');
      setBmList([]);
      loadProfile(profileId);
      loadUserPosts(profileId, 1);
    }
  }, [profileId]);

  // 成就墙 — 仅自己的主页（成就接口只支持当前登录用户）
  // 抽成可复用函数：挂载时拉一次 + 切到「成长」tab 时重新拉取（用户可能在其他页面解锁了新成就）
  const fetchAchievements = useCallback(async () => {
    if (!isOwnProfile) return;
    setAchLoading(true);
    setAchError(false);
    try {
      const res = await achievementsApi.list();
      if (res.success && res.data) setAchData(res.data);
      else setAchError(true); // 接口业务失败（如 500）→ 展示错误态而非永久「加载中」
    } catch {
      setAchError(true); // 网络错误 → 展示错误态 + 重试按钮
    }
    setAchLoading(false);
  }, [isOwnProfile]);
  useEffect(() => {
    if (isOwnProfile) fetchAchievements();
  }, [isOwnProfile, fetchAchievements]);
  // tab 切到「成长」时重新拉取，保证成就数据新鲜（挂载时默认 tab 为 posts，不会重复请求）
  useEffect(() => {
    if (tab === 'growth' && isOwnProfile) fetchAchievements();
  }, [tab, isOwnProfile, fetchAchievements]);

  // 邀请数据（仅自己主页）
  const loadInvites = useCallback(() => {
    invitesApi.my().then(res => {
      if (res.success && res.data) { setInviteData(res.data); setInviteError(''); }
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (isOwnProfile) loadInvites();
  }, [isOwnProfile, loadInvites]);

  const loadProfile = async (userId: number) => {
    try {
      const res = await usersApi.getProfile(userId);
      if (res.success && res.data) {
        setProfileUser(res.data);
      } else {
        setLoadFailed(true);
        return;
      }
    } catch {
      // 404 / 网络错误 → 渲染错误态，避免无限骨架屏
      setLoadFailed(true);
      return;
    }
    // 检查关注状态
    if (currentUser && userId !== currentUser.id) {
      try {
        const fRes = await followsApi.check(userId);
        if (fRes.success) setFollowing(fRes.data?.following || false);
      } catch { /* 关注状态失败不阻塞主页渲染 */ }
    }
  };

  const loadBookmarks = async (page: number = 1) => {
    setBmLoading(true);
    try {
      const res = await bookmarksApi.list(page);
      if (res.success && res.data) { setBmList(res.data); setBmTotal(res.total || 0); }
    } catch { /* 失败静默，展示空态 */ }
    setBmLoading(false);
  };

  // URL 直达「收藏」tab（/profile?tab=bookmarks）时也要拉数据（原先只有点 tab 按钮才拉）
  useEffect(() => {
    if (tab === 'bookmarks' && isOwnProfile && bmList.length === 0) loadBookmarks();
  }, [tab, isOwnProfile]);

  const loadUserPosts = async (userId: number, page: number) => {    setLoadingPosts(true);
    try {
      const res = await postsApi.list({ userId, page, pageSize: 10 });
      if (res.success && res.data) { setPostList(res.data); setPostTotal(res.total || 0); }
    } catch { /* 失败静默，展示空态 */ }
    setLoadingPosts(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    cropTypeRef.current = 'avatar';
    setCropModal({ file, aspect: 1, type: 'avatar' });
    e.target.value = '';
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    cropTypeRef.current = 'banner';
    setCropModal({ file, aspect: 5 / 2, type: 'banner' });
    e.target.value = '';
  };

  // 裁剪完成后上传
  const handleCropDone = useCallback(async (blob: Blob) => {
    const modalType = cropTypeRef.current;
    setCropModal(null);
    const file = new File([blob], 'cropped.jpg', { type: 'image/jpeg' });
    // 裁剪导出已按最长边上限缩放，这里再走一次统一压缩兜底（小图自动跳过，不改画质）
    const { file: toUpload } = await compressImageIfNeeded(file);

    if (modalType === 'avatar') {
      setAvatarUploading(true); setError('');
      try {
        const r = await uploadApi.image(toUpload);
        if (r.success && r.data) {
          const avatarUrl = r.data.url;
          await usersApi.updateAvatar(avatarUrl);
          // 本地同步主页头像，否则要刷新页面才能看到新头像（与背景图更新保持一致）
          setProfileUser(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev);
          await refreshUser();
          setMessage('头像已更新');
        }
        else setError(r.error || '上传失败');
      } catch (err: any) { setError(err.message); }
      setAvatarUploading(false);
    } else {
      setBannerUploading(true); setError('');
      try {
        const r = await uploadApi.image(toUpload);
        if (r.success && r.data) {
          const bannerUrl = r.data.url;
          const save = await usersApi.updateBanner(bannerUrl);
          if (save.success) {
            await refreshUser();
            setProfileUser(prev => prev ? { ...prev, banner_url: bannerUrl } : prev);
            setBannerVer(Date.now()); // 版本号防浏览器/图床缓存旧图，保证各设备看到同一张新图
            setMessage('背景图已更新');
          } else { setError(save.error || '保存失败'); }
        } else { setError(r.error || '上传失败'); }
      } catch (err: any) { setError(err.message); }
      setBannerUploading(false);
    }
  }, []);

  // 复制文本：优先 async clipboard API，失败回退 textarea + execCommand，再失败提示手动复制
  const copyText = async (text: string, successMsg: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast(successMsg, 'success');
        return;
      }
      throw new Error('clipboard unavailable');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) { toast(successMsg, 'success'); return; }
        throw new Error('execCommand copy failed');
      } catch {
        toast('复制失败，请手动复制', 'error');
      }
    }
  };

  // ===== 注册邮箱验证徽章 =====
  const handleResendCode = async () => {
    setEmailVerifyError('');
    setEmailVerifyLoading(true);
    try {
      const r = await authApi.resendEmailCode();
      if (r.success) toast('验证码已发送至你的邮箱', 'success');
      else setEmailVerifyError(r.error || '发送失败');
    } catch (err: any) {
      setEmailVerifyError(err.message);
    }
    setEmailVerifyLoading(false);
  };

  const handleEmailVerifyRegister = async () => {
    setEmailVerifyError('');
    if (!emailVerifyCode) { setEmailVerifyError('请输入验证码'); return; }
    setEmailVerifyLoading(true);
    try {
      const r = await authApi.verifyEmailRegister(emailVerifyCode);
      if (r.success) {
        toast('邮箱验证成功');
        setEmailVerifyOpen(false);
        setEmailVerifyCode('');
        await refreshUser();
      } else {
        setEmailVerifyError(r.error || '验证失败');
      }
    } catch (err: any) {
      setEmailVerifyError(err.message);
    }
    setEmailVerifyLoading(false);
  };

  // 加载失败（用户不存在 / 网络错误）→ 错误态，避免无限骨架屏
  if (loadFailed) {
    return (
      <>
        <Helmet><title>用户不存在 - CloudForum</title></Helmet>
        <div className="max-w-3xl mx-auto">
          <BackButton />
          <div className="bg-white dark:bg-gray-900 rounded-2xl border dark:border-gray-700 p-10 text-center">
            <div className="text-4xl mb-3">😕</div>
            <p className="text-gray-600 dark:text-gray-400 font-medium mb-5">用户不存在或加载失败</p>
            <Link to="/" className="inline-block px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">返回首页</Link>
          </div>
        </div>
      </>
    );
  }

  if (!profileUser) return <ProfileSkeleton />;

  // 封禁状态判断
  const isBanned = !!profileUser.banned_until && new Date(profileUser.banned_until.replace(' ', 'T') + 'Z').getTime() > Date.now();

  // 提交解封申请
  const handleUnbanRequest = async () => {
    setUnbanModal(false);
    try {
      const { unban } = await import('../services/api');
      const res = await unban.request();
      if (res.success) {
        toast(res.message || '解封申请已提交，请等待管理员审核');
      } else {
        toast(res.error || '提交失败', 'error');
      }
    } catch (e: any) {
      toast('提交失败: ' + (e.message || e), 'error');
    }
  };

  const totalPages = Math.ceil(postTotal / 10);
  // 后端收藏接口默认 pageSize=20
  const bmTotalPages = Math.ceil(bmTotal / 20);

  return (
    <>
    <Helmet><title>{profileUser?.username ? `${profileUser.username} - CloudForum` : '个人主页 - CloudForum'}</title></Helmet>
    <div className="max-w-3xl mx-auto space-y-5">
      <BackButton />
      {message && <div className="bg-green-50 text-green-700 px-4 py-3 rounded-xl text-sm border border-green-200">{message}</div>}
      {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm border border-red-200">{error}</div>}

      {/* 用户头部 + 背景图 */}
      <div className="bg-white rounded-2xl border overflow-hidden">
        {/* 5:2 背景容器：padding-bottom 40% 撑高（全浏览器兼容，替代 aspect-ratio），
            保证手机/电脑上容器比例严格一致 5:2，配合 object-cover 画面内容完全相同 */}
        <div className="relative bg-gradient-to-r from-primary-400 to-primary-600 overflow-hidden" style={{ paddingBottom: '40%' }}>
          {profileUser.banner_url ? (
            <img
              src={`${profileUser.banner_url}${profileUser.banner_url.includes('?') ? '&' : '?'}v=${bannerVer}`}
              alt="背景图"
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover cursor-pointer hover:opacity-95 transition"
              onClick={() => setPreviewImage(profileUser.banner_url!)}
            />
          ) : null}

          {/* 上传中遮罩 */}
          {bannerUploading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
              <div className="flex items-center gap-2 text-white text-sm">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                上传中...
              </div>
            </div>
          )}

          {isOwnProfile && !bannerUploading && (
            <label className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-4 py-2 rounded-full cursor-pointer hover:bg-black/70 transition backdrop-blur-sm z-10 select-none">
              🖼 更换背景
              <input type="file" accept="image/*" className="hidden" disabled={bannerUploading}
                onChange={handleBannerUpload} />
            </label>
          )}
        </div>
        <div className="px-6 pb-6 relative">
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4">
            <div className="relative ring-4 ring-white rounded-full -mt-10">
              <div onClick={() => profileUser.avatar_url && setPreviewImage(profileUser.avatar_url)} className="cursor-pointer">
                <Avatar url={profileUser.avatar_url} username={profileUser.username} size="lg" className="w-20 h-20 md:w-24 md:h-24 text-2xl"
                  frame={profileUser.avatar_frame} frameExpiresAt={profileUser.avatar_frame_expires_at} />
              </div>
              {isOwnProfile && (
                <label className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center cursor-pointer text-sm hover:bg-primary-700 transition shadow-sm">
                  <span>+</span>
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" disabled={avatarUploading} />
                </label>
              )}
            </div>
            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <h1 className={`text-xl font-bold ${getVipNickClass(isOwnProfile ? currentUser?.vip_tier : profileUser.vip_tier, isOwnProfile ? myNickTheme : profileUser.nick_theme) || 'text-gray-900'}`}>{profileUser.username}</h1>
                <VIPBadge vip_tier={profileUser.vip_tier} />
                {profileUser.exp != null && <span className="text-[10px] bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded font-medium">Lv.{levelFromExp(profileUser.exp).level} {levelFromExp(profileUser.exp).tierName}</span>}
                {profileUser.title_badge && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">{profileUser.title_badge}</span>}
                {profileUser.role === 'admin' && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-medium">管理员</span>}
                {profileUser.role === 'moderator' && <span className="bg-yellow-100 text-yellow-600 text-[11px] px-1.5 py-0.5 rounded font-medium">巡查员</span>}
                {/* 私聊按钮已删除 */}
                {/* 关注按钮 — 非自己主页时显示 */}
                {!isOwnProfile && currentUser && (
                  <button onClick={async () => {
                    setFollowLoading(true);
                    const res = await followsApi.toggle(profileId!);
                    if (res.success) setFollowing(res.data?.following || false);
                    setFollowLoading(false);
                  }} disabled={followLoading}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition ${following ? 'bg-gray-200 text-gray-600' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
                    {followLoading ? '...' : following ? '已关注' : '+ 关注'}
                  </button>
                )}
                {isBanned && (
                  <button onClick={() => setShowBanDetail(!showBanDetail)}
                    className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded font-medium hover:bg-red-200 transition cursor-pointer">
                    🚫 已封禁 {showBanDetail ? '▲' : '▼'}
                  </button>
                )}
              </div>
              {isBanned && showBanDetail && profileUser.banned_until && (
                <div className="mt-2 px-3 py-2 bg-red-50 rounded-lg border border-red-200 text-xs text-red-700">
                  封禁至：{new Date(profileUser.banned_until.replace(' ', 'T') + 'Z').toLocaleString('zh-CN')}
                  {(profileUser as any).ban_reason && (
                    <div className="mt-1.5">封禁原因：{(profileUser as any).ban_reason}</div>
                  )}
                  {isOwnProfile && (
                    <button onClick={() => setUnbanModal(true)}
                      className="mt-2 w-full px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition">
                      提交解封申请（需 500 积分）
                    </button>
                  )}
                </div>
              )}
              {profileUser.custom_title && (!profileUser.custom_title_expires_at || new Date(profileUser.custom_title_expires_at) > new Date()) && (
                <p className="text-xs text-primary-500 mt-0.5 font-medium">{profileUser.custom_title}</p>
              )}
              {profileUser.bio && <p className="text-gray-600 mt-1 text-sm">{profileUser.bio}</p>}
              <div className="flex items-center justify-center sm:justify-start gap-3 text-xs text-gray-400 mt-2">
                <span>注册于 {formatDate(profileUser.created_at)}</span>
                <span>·</span>
                <span>{postTotal} 篇帖子</span>
              </div>
              {avatarUploading && <p className="text-xs text-primary-600 mt-1">上传中...</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap bg-white rounded-xl border p-1.5">
            <button onClick={() => setTab('posts')} className={`px-3 py-2 min-h-[40px] whitespace-nowrap rounded-lg text-sm font-medium transition ${tab === 'posts' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>帖子</button>
            {isOwnProfile && (
              <>
                <button onClick={() => { setTab('bookmarks'); if (bmList.length === 0) loadBookmarks(); }} className={`px-3 py-2 min-h-[40px] whitespace-nowrap rounded-lg text-sm font-medium transition ${tab === 'bookmarks' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>⭐ 收藏</button>
                <button onClick={() => setTab('growth')} className={`px-3 py-2 min-h-[40px] whitespace-nowrap rounded-lg text-sm font-medium transition ${tab === 'growth' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>📈 成长</button>
                <button onClick={() => setTab('invite')} className={`px-3 py-2 min-h-[40px] whitespace-nowrap rounded-lg text-sm font-medium transition ${tab === 'invite' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>🤝 邀请</button>
                <button onClick={() => setTab('settings')} className={`px-3 py-2 min-h-[40px] whitespace-nowrap rounded-lg text-sm font-medium transition ${tab === 'settings' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>⚙️ 设置</button>
              </>
            )}
          </div>

          <div className="space-y-5">
          {tab === 'growth' && isOwnProfile && (
          <div className="bg-white rounded-2xl border p-6">
        {(() => {
          const lv = levelFromExp(profileUser.exp ?? 0);
          const pct = Math.round(lv.progress * 100);
          return (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-gray-900">📈 成长</h2>
                <span className="text-xs bg-primary-50 text-primary-600 px-2 py-0.5 rounded font-medium">Lv.{lv.level} {lv.tierName}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {lv.expForNextLevel > 0 ? `经验 ${lv.expInLevel}/${lv.expForNextLevel}，升级还需 ${lv.expForNextLevel - lv.expInLevel} 经验` : '已满级 🎉'}
              </p>
            </>
          );
        })()}
        {isOwnProfile && (
          <div className="mt-5 pt-5 border-t">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setAchCollapsed(!achCollapsed)} className="flex items-center gap-2 text-sm font-semibold text-gray-900 hover:text-primary-600 transition">
                🏆 成就
                <span className={`text-[10px] text-gray-400 transition-transform ${achCollapsed ? '' : 'rotate-180'}`}>▼</span>
              </button>
              <div className="flex items-center gap-3">
                {achData && <span className="text-xs text-gray-400">已解锁 {achData.unlocked_count}/{achData.total}</span>}
                <Link to="/achievements" className="text-xs text-primary-600 hover:text-primary-700 font-medium">查看成就殿堂 →</Link>
              </div>
            </div>
            {achCollapsed ? (
              <p className="text-xs text-gray-400 text-center py-3">成就已折叠，点击标题展开</p>
            ) : achData ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {/* 已达成优先显示 */}
                {[...achData.achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked)).map(a => (
                  <div key={a.key} className={`p-3 rounded-xl border text-center ${a.unlocked ? 'bg-primary-50 border-primary-200' : 'bg-gray-50 border-gray-200'}`}>
                    <div className={`text-lg mb-1 ${a.unlocked ? '' : 'opacity-40 grayscale'}`}>{a.unlocked ? '🏅' : '🔒'}</div>
                    <div className={`text-xs font-medium ${a.unlocked ? 'text-primary-700' : 'text-gray-500'}`}>{a.name}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{a.desc}</div>
                    {!a.unlocked && (
                      a.rewards && a.rewards.length > 0 ? (
                        <div className="mt-1 flex flex-wrap justify-center gap-1">
                          {a.rewards.map((r, i) => (
                            <span key={i} className="text-[9px] bg-amber-50 text-amber-700 border border-amber-100 rounded px-1 py-0.5">{rewardLabel(r, { titleName: a.name })}</span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] text-amber-600 mt-0.5">+{a.coins} 积分</div>
                      )
                    )}
                  </div>
                ))}
              </div>
            ) : achError ? (
              <div className="text-center py-4">
                <p className="text-red-500 text-xs mb-3">成就加载失败</p>
                <button onClick={fetchAchievements} disabled={achLoading}
                  className="px-4 py-1.5 border border-primary-200 text-primary-600 rounded-lg text-xs font-medium hover:bg-primary-50 transition disabled:opacity-50">
                  {achLoading ? '加载中...' : '重试'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">加载中...</p>
            )}
          </div>
        )}
      </div>
          )}

          {/* VIP 入口 */}
          {isOwnProfile && (
            <Link to="/vip" className="block bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900 dark:to-yellow-950 rounded-2xl border border-yellow-200 dark:border-yellow-900 p-4 hover:shadow-md transition group">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-900 group-hover:text-primary-600 transition">
                    {currentUser?.is_vip ? `👑 ${currentUser.vip_tier === 'vip' ? 'VIP' : currentUser.vip_tier === 's-vip' ? 'S VIP' : 'S VIP+'} 会员` : '👑 升级 VIP'}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{currentUser?.is_vip ? '查看会员权益' : '解锁更多特权'}</p>
                </div>
                <span className="text-xl">{currentUser?.is_vip ? '⭐' : '💎'}</span>
              </div>
            </Link>
          )}
      {/* 编辑资料面板（settings Tab） */}
      {/* 设置 tab：账号与安全入口（资料编辑/改密码/换邮箱/注销均为独立页面，这里只留入口） */}
      {tab === 'settings' && isOwnProfile && (
        <div className="bg-white rounded-2xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900">设置</h2>
          </div>

          {/* 邮箱未验证提示（策略 A 宽松：仅提示，不限制功能） */}
          {currentUser?.email_verified === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-medium text-amber-800">📧 邮箱未验证</p>
                <div className="flex gap-2">
                  <button onClick={handleResendCode} disabled={emailVerifyLoading}
                    className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-200 transition disabled:opacity-50">
                    {emailVerifyLoading ? '发送中...' : '发送验证码'}
                  </button>
                  <button onClick={() => { setEmailVerifyOpen(!emailVerifyOpen); setEmailVerifyError(''); }}
                    className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-50 transition">
                    我已收到验证码
                  </button>
                </div>
              </div>
              {emailVerifyOpen && (
                <div className="mt-3 flex gap-2 items-end">
                  <input type="text" value={emailVerifyCode} onChange={e => setEmailVerifyCode(e.target.value)}
                    placeholder="6 位验证码" maxLength={6}
                    className="flex-1 px-3 py-2 border border-amber-300 rounded-xl outline-none focus:border-amber-500 text-sm" />
                  <button onClick={handleEmailVerifyRegister} disabled={emailVerifyLoading}
                    className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 transition disabled:opacity-50">
                    {emailVerifyLoading ? '验证中...' : '验证'}
                  </button>
                </div>
              )}
              {emailVerifyError && <p className="text-xs text-red-500 mt-2">{emailVerifyError}</p>}
            </div>
          )}

          {/* 入口列表：每行一个去处，表单都在独立页面里 */}
          <div className="divide-y divide-gray-100">
            <Link to="/edit-profile" className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-gray-50 transition">
              <span className="text-lg leading-none">👤</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">编辑资料</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  用户名 · 个人简介{currentUser?.is_vip ? ' · 自定义头衔' : ''}{currentUser?.vip_tier === 'svip+' ? ' · 昵称主题' : ''}
                </p>
              </div>
              <span className="text-gray-300">›</span>
            </Link>

            <Link to="/change-email" className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-gray-50 transition">
              <span className="text-lg leading-none">📧</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">邮箱</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {currentUser?.email} · {currentUser?.email_verified === 0 ? '未验证' : '已验证'}
                </p>
              </div>
              <span className="text-gray-300">›</span>
            </Link>

            <Link to="/change-password" className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-gray-50 transition">
              <span className="text-lg leading-none">🔒</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">修改密码</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">验证当前密码后设置新密码，修改成功后需重新登录</p>
              </div>
              <span className="text-gray-300">›</span>
            </Link>

            {(currentUser?.role === 'admin' || currentUser?.role === 'moderator') && (
              <Link to="/admin" className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-gray-50 transition">
                <span className="text-lg leading-none">🛠</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">管理后台</p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">进入{currentUser?.role === 'admin' ? '管理后台' : '巡查台'}</p>
                </div>
                <span className="text-gray-300">›</span>
              </Link>
            )}

            <button onClick={() => setLogoutModal(true)}
              className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-gray-50 transition text-left">
              <span className="text-lg leading-none">🚪</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">退出登录</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">退出当前登录的账号</p>
              </div>
              <span className="text-gray-300">›</span>
            </button>

            <Link to="/delete-account" className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-red-50/60 transition">
              <span className="text-lg leading-none">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-600">注销账户</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {currentUser?.scheduled_deleted_at ? '已提交注销，可在页面内取消' : '提交后 3 天冷静期，期间可随时取消'}
                </p>
              </div>
              <span className="text-gray-300">›</span>
            </Link>
          </div>
        </div>
      )}

      {/* 邀请好友卡片（仅自己主页，invite Tab） */}
      {tab === 'invite' && isOwnProfile && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900 dark:to-teal-950 rounded-2xl border border-emerald-200 dark:border-emerald-900 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-gray-900">🤝 邀请好友</p>
              <p className="text-xs text-gray-500 mt-0.5">
                每邀请一位好友注册成功，你获得 <span className="text-emerald-600 dark:text-emerald-400 font-medium">+120 积分</span>（同时只能有 1 个邀请码，使用后可再生成）
              </p>
            </div>
            {!inviteData || inviteData.codes.length === 0 ? (
              <button
                onClick={async () => {
                  setInviteLoading(true);
                  try {
                    const res = await invitesApi.create();
                    if (res.success && res.data) {
                      toast('邀请码已生成', 'success');
                      // 本地直接插入新码立即显示（不依赖 GET 刷新——GET 与 POST 共享限流桶，被 429 静默吞掉会导致 UI 不更新）
                      setInviteData(prev => ({
                        codes: [{ code: res.data!.code, created_at: new Date().toISOString() }, ...(prev?.codes || [])],
                        invited_count: prev?.invited_count || 0,
                        total_reward: prev?.total_reward || 0,
                      }));
                      setInviteError('');
                      loadInvites(); // 后台静默校准（失败不影响 UI）
                    } else {
                      setInviteError(res.error || '生成失败');
                    }
                  } catch (err: any) {
                    setInviteError(err.message);
                  }
                  setInviteLoading(false);
                }}
                disabled={inviteLoading}
                className="shrink-0 text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {inviteLoading ? '生成中...' : '+ 生成邀请码'}
              </button>
            ) : (
              <span className="shrink-0 text-xs text-gray-400 mt-0.5">邀请码使用后可再生成</span>
            )}
          </div>
          {inviteError && <p className="text-xs text-red-500 mt-2">{inviteError}</p>}
          <div className="mt-3 space-y-2">
            {inviteData && inviteData.codes.length > 0 ? (
              inviteData.codes.map(c => (
                <div key={c.code} className="flex items-center gap-2 bg-white/70 dark:bg-black/60 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
                  <code className="text-sm font-mono font-semibold text-emerald-700 tracking-wider">{c.code}</code>
                  <div className="ml-auto flex items-center gap-3">
                    <button
                      onClick={() => copyText(c.code, '邀请码已复制')}
                      className="text-xs text-gray-400 hover:text-emerald-600 transition"
                    >
                      复制
                    </button>
                    <button
                      onClick={() => copyText(`${window.location.origin}/invite/${c.code}`, '邀请链接已复制')}
                      className="text-xs text-emerald-600 hover:underline transition"
                    >
                      复制邀请链接
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-gray-400">还没有邀请码，点击右上角生成一个分享给好友吧</p>
            )}
          </div>
          {inviteData && (
            <p className="text-xs text-gray-500 mt-3">
              已邀请 <span className="text-emerald-600 font-medium">{inviteData.invited_count}</span> 人 · 累计获得
              <span className="text-emerald-600 font-medium"> {inviteData.total_reward}</span> 积分
            </p>
          )}
        </div>
      )}

      {/* 帖子 Tab（默认） */}
      {tab === 'posts' && (
        <div className="bg-white rounded-2xl border p-6">
        <h2 className="font-bold text-gray-900 mb-4">帖子 <span className="text-gray-400 font-normal text-sm">({postTotal})</span></h2>
        {loadingPosts ? (
          <PostListSkeleton count={3} />
        ) : postList.length === 0 ? (
          <EmptyState icon={faNewspaper} title="暂无帖子" description={isOwnProfile ? '你还没有发过帖子' : '该用户还没有发过帖子'} />
        ) : (
          <div className="space-y-2">
            {postList.map(post => (
              <Link key={post.id} to={`/post/${post.id}`} className="block px-4 py-3 border rounded-xl hover:bg-gray-50 transition group">
                <h3 className="font-medium text-gray-900 group-hover:text-primary-600 transition line-clamp-1">{post.title}</h3>
                <div className="flex items-center gap-3 text-xs text-gray-400 mt-1.5 flex-wrap">
                  {post.category_name && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded whitespace-nowrap">{post.category_name}</span>}
                  <span className="whitespace-nowrap">{formatRelativeTime(post.created_at)}</span>
                  {(post.fortune && (!post.fortune_expires_at || new Date(post.fortune_expires_at) > new Date())) && <span className="px-1.5 py-0.5 rounded bg-gray-100 whitespace-nowrap">{post.fortune}</span>}
                  <span className="whitespace-nowrap">浏览 {post.view_count}</span>
                  <span className="whitespace-nowrap">评论 {post.comment_count}</span>
                  <span className="whitespace-nowrap">赞 {post.like_count}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-5">
            <button onClick={() => { const next = Math.max(1, postPage - 1); setPostPage(next); loadUserPosts(profileId!, next); }}
              disabled={postPage === 1} className="px-3 py-1.5 border rounded-xl text-sm disabled:opacity-50 hover:bg-gray-50 transition">← 上一页</button>
            <span className="text-sm text-gray-400">{postPage}/{totalPages}</span>
            <button onClick={() => { const next = postPage + 1; setPostPage(next); loadUserPosts(profileId!, next); }}
              disabled={postPage >= totalPages} className="px-3 py-1.5 border rounded-xl text-sm disabled:opacity-50 hover:bg-gray-50 transition">下一页 →</button>
          </div>
        )}
        </div>
      )}

      {/* 收藏 Tab（仅自己） */}
      {tab === 'bookmarks' && isOwnProfile && (
        <div className="bg-white rounded-2xl border p-6">
        <h2 className="font-bold text-gray-900 mb-4">⭐ 收藏 <span className="text-gray-400 font-normal text-sm">({bmTotal})</span></h2>
        {bmLoading ? <PostListSkeleton count={3} /> : bmList.length === 0 ? (
          <EmptyState icon={faBookmark} title="暂无收藏" description="去首页看看有没有感兴趣的帖子" />
        ) : (
          <div className="space-y-2">
            {bmList.map((bm: any) => (
              <Link key={bm.id} to={`/post/${bm.id}`} className="block px-4 py-3 border rounded-xl hover:bg-gray-50 transition group">
                <h3 className="font-medium text-gray-900 group-hover:text-primary-600 transition line-clamp-1">{bm.title || '无标题'}</h3>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                  <span>{bm.username || '匿名'}</span>
                  <span>💬 {bm.comment_count}</span>
                  <span>❤️ {bm.like_count}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {bmTotalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-5">
            <button onClick={() => { setBmPage(prev => { const next = Math.max(1, prev - 1); loadBookmarks(next); return next; }); }}
              disabled={bmPage === 1} className="px-3 py-1.5 border rounded-xl text-sm disabled:opacity-50 hover:bg-gray-50 transition">← 上一页</button>
            <span className="text-sm text-gray-400">{bmPage}/{bmTotalPages}</span>
            <button onClick={() => { setBmPage(prev => { const next = prev + 1; loadBookmarks(next); return next; }); }}
              disabled={bmPage >= bmTotalPages} className="px-3 py-1.5 border rounded-xl text-sm disabled:opacity-50 hover:bg-gray-50 transition">下一页 →</button>
          </div>
        )}
        </div>
      )}
        </div>
      </div>
      {cropModal && (
        <CropModal
          file={cropModal.file}
          aspect={cropModal.aspect}
          maxOutputSize={cropModal.type === 'avatar' ? 1024 : 2048}
          onCrop={handleCropDone}
          onCancel={() => setCropModal(null)}
        />
      )}
      <Lightbox open={!!previewImage} close={() => setPreviewImage(null)} slides={previewImage ? [{ src: previewImage }] : []} plugins={[Zoom]} zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }} />

      {/* 解封申请确认 */}
      <ConfirmModal
        open={unbanModal}
        title="提交解封申请"
        message="解封申请将扣除 500 积分作为保证金。审核通过后不退，审核失败全额退款。确定继续？"
        confirmText="确定申请"
        danger
        onConfirm={handleUnbanRequest}
        onCancel={() => setUnbanModal(false)}
      />

      {/* 退出登录确认 */}
      <ConfirmModal
        open={logoutModal}
        title="退出登录"
        message="确定要退出登录吗？"
        confirmText="退出"
        danger
        onConfirm={() => { setLogoutModal(false); logout(); navigate('/'); }}
        onCancel={() => setLogoutModal(false)}
      />

    </>
  );
}
