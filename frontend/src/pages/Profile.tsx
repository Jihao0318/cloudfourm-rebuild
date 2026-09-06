import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { formatDate, formatRelativeTime } from '../utils/date';
import { users as usersApi, auth as authApi, upload as uploadApi, posts as postsApi, bookmarks as bookmarksApi, follows as followsApi, achievementsApi, invites as invitesApi } from '../services/api';
import type { PublicUser, Post, AchievementInfo } from '../types';
import { levelFromExp } from '../utils/level';
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
  const profileId = id ? parseInt(id) : currentUser?.id;

  const [profileUser, setProfileUser] = useState<PublicUser | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [postList, setPostList] = useState<Post[]>([]);
  const [postTotal, setPostTotal] = useState(0);
  const [postPage, setPostPage] = useState(1);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [tab, setTab] = useState<'posts' | 'bookmarks' | 'growth' | 'invite' | 'settings'>('posts');
  const [bmList, setBmList] = useState<any[]>([]);
  const [bmTotal, setBmTotal] = useState(0);
  const [bmPage, setBmPage] = useState(1);
  const [bmLoading, setBmLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const [bio, setBio] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  // 修改密码两步表单（独立状态）
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  // 重发验证码倒计时（60s 防连点/防轰炸）
  // 注册邮箱验证徽章（未验证时显示）
  const [emailVerifyOpen, setEmailVerifyOpen] = useState(false);
  const [emailVerifyCode, setEmailVerifyCode] = useState('');
  const [emailVerifyLoading, setEmailVerifyLoading] = useState(false);
  const [emailVerifyError, setEmailVerifyError] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  // 邀请好友
  const [inviteData, setInviteData] = useState<{ codes: { code: string; created_at: string }[]; invited_count: number; total_reward: number } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [nickTheme, setNickTheme] = useState('theme1');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerVer, setBannerVer] = useState(0); // 背景图版本号（更新后 +时间戳，防缓存旧图）
  const [cropModal, setCropModal] = useState<{ file: File; aspect: number; type: 'avatar' | 'banner' } | null>(null);
  const cropTypeRef = useRef<'avatar' | 'banner'>('avatar');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showBanDetail, setShowBanDetail] = useState(false);
  const [achData, setAchData] = useState<{ achievements: AchievementInfo[]; unlocked_count: number; total: number } | null>(null);
  const [achLoading, setAchLoading] = useState(false);
  const [achError, setAchError] = useState(false);
  const [achCollapsed, setAchCollapsed] = useState(false); // 成就栏折叠（默认展开）
  const [deleteModal, setDeleteModal] = useState<{ step: 1 | 2 | 3; password: string; countdown: number; error?: string; verifying?: boolean } | null>(null);
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
      // 切换用户时重置分页/tab/收藏列表，避免展示上一个用户的数据
      setPostPage(1);
      setTab('posts');
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
        setProfileUser(res.data); setBio(res.data.bio || '');
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
    if (isOwnProfile && currentUser) {
      setNewUsername(currentUser.username);
      setCustomTitle(currentUser.custom_title || '');
      const savedTheme = (currentUser.nick_theme && currentUser.nick_theme !== 'default') ? currentUser.nick_theme : 'theme1';
      setNickTheme(savedTheme);
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

  const loadUserPosts = async (userId: number, page: number) => {
    setLoadingPosts(true);
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

    if (modalType === 'avatar') {
      setAvatarUploading(true); setError('');
      try {
        const r = await uploadApi.image(file);
        if (r.success && r.data) { await usersApi.updateAvatar(r.data.url); await refreshUser(); setMessage('头像已更新'); }
        else setError(r.error || '上传失败');
      } catch (err: any) { setError(err.message); }
      setAvatarUploading(false);
    } else {
      setBannerUploading(true); setError('');
      try {
        const r = await uploadApi.image(file);
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

  const flashRef = useRef<ReturnType<typeof setTimeout>>();
  const flash = (msg: string, isErr = false) => {
    if (flashRef.current) clearTimeout(flashRef.current);
    setMessage(isErr ? '' : msg); setError(isErr ? msg : '');
    flashRef.current = setTimeout(() => { setMessage(''); setError(''); }, 3000);
  };

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

  // ===== 修改密码（一步直改：验证当前密码后直接设置新密码，后端踢全部会话需重新登录） =====
  const handleChangePassword = async () => {
    setPwError('');
    if (!oldPw) { setPwError('请输入当前密码'); return; }
    if (!newPw) { setPwError('请输入新密码'); return; }
    if (confirmPw !== newPw) { setPwError('两次输入的新密码不一致'); return; }
    setPwLoading(true);
    try {
      const r = await authApi.changePassword(oldPw, newPw);
      if (r.success) {
        toast('密码已修改，请重新登录', 'success');
        // 后端已踢掉全部会话，下次请求会 401 自动跳转登录页
        navigate('/login', { replace: true });
      } else {
        setPwError(r.error || '修改失败');
      }
    } catch (err: any) {
      setPwError(err.message);
    }
    setPwLoading(false);
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
                <h1 className={`text-xl font-bold ${getVipNickClass(isOwnProfile ? currentUser?.vip_tier : profileUser.vip_tier, isOwnProfile ? nickTheme : profileUser.nick_theme) || 'text-gray-900'}`}>{profileUser.username}</h1>
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
                            <span key={i} className="text-[9px] bg-amber-50 text-amber-700 border border-amber-100 rounded px-1 py-0.5">{rewardLabel(r)}</span>
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
      {tab === 'settings' && isOwnProfile && (
        <div className="bg-white rounded-2xl border p-6 space-y-5 transition-all duration-300">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900">编辑资料</h2>
          </div>
          {/* 邮箱未验证提示（策略 A 宽松：仅提示，不限制功能） */}
          {currentUser?.email_verified === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
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
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">用户名</label>
            <div className="flex gap-2">
              <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-xl outline-none focus:border-primary-500 text-sm" />
              <button onClick={async () => {
                try { const r = await authApi.changeUsername(newUsername); if (r.success) { flash('用户名已更新'); await refreshUser(); } else flash(r.error || '失败', true); }
                catch (err: any) { flash(err.message, true); }
              }} className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">保存</button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">个人简介</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={500}
              className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary-500 text-sm resize-none" placeholder="介绍一下自己..." />
            <div className="flex justify-end mt-2">
              <button onClick={async () => { try { await usersApi.updateProfile({ bio }); await refreshUser(); flash('简介已更新'); } catch (err: any) { flash(err.message, true); } }}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">保存简介</button>
            </div>
          </div>
          {currentUser?.is_vip && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">自定义头衔 <span className="text-primary-500">VIP</span></label>
            <div className="flex gap-2">
              <input type="text" value={customTitle} onChange={e => setCustomTitle(e.target.value.slice(0, 30))}
                className="flex-1 px-3 py-2 border rounded-xl outline-none focus:border-primary-500 text-sm" placeholder="设置你的VIP头衔" maxLength={30} />
              <button onClick={async () => {
                try { const r = await usersApi.updateTitle(customTitle); if (r.success) { flash('头衔已更新'); await refreshUser(); } else flash(r.error || '失败', true); }
                catch (err: any) { flash(err.message, true); }
              }} className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">保存</button>
            </div>
          </div>
          )}
          {currentUser?.vip_tier === 'svip+' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">昵称主题 <span className="text-red-500">S VIP+</span></label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { id: 'theme1', label: '红金', colors: 'from-red-500 via-amber-400 to-red-500' },
                { id: 'theme2', label: '紫粉', colors: 'from-purple-500 via-pink-500 to-purple-500' },
                { id: 'theme3', label: '蓝紫', colors: 'from-cyan-500 via-blue-500 to-purple-500' },
                { id: 'theme4', label: '绿金', colors: 'from-emerald-500 via-green-400 to-amber-400' },
              ].map(theme => {
                const active = nickTheme === theme.id;
                return (
                  <button key={theme.id} onClick={() => setNickTheme(theme.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border-2 transition ${active ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200 hover:border-gray-300'}`}>
                    <span className={`text-transparent bg-clip-text bg-gradient-to-r ${theme.colors} font-bold`}>{theme.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={async () => {
                try { const r = await usersApi.updateNickTheme(nickTheme); if (r.success) { await refreshUser(); flash('主题已保存'); } else flash(r.error || '失败', true); }
                catch (err: any) { flash(err.message, true); }
              }} className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">保存主题</button>
              {nickTheme !== ((currentUser?.nick_theme && currentUser.nick_theme !== 'default') ? currentUser.nick_theme : 'theme1') && (
                <span className="text-xs text-orange-500">有未保存的更改</span>
              )}
            </div>
            <div className="mt-3 p-3 bg-gray-50 rounded-xl text-center">
              <span className="text-xs text-gray-400">预览效果：</span>
              <div className={`text-lg font-bold mt-1 ${getVipNickClass(currentUser?.vip_tier, nickTheme) || 'text-gray-900'}`}>{currentUser?.username || '用户名'}</div>
            </div>
          </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">邮箱</label>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-gray-700">{currentUser?.email}</p>
              <button
                onClick={() => navigate('/change-email')}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">
                更换邮箱
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 安全设置面板（settings Tab 内第二块） */}
      {tab === 'settings' && isOwnProfile && (
        <div className="bg-white rounded-2xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900">安全设置</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6 items-start">
            {/* 左列：修改密码 */}
            <div className="pb-5 md:pb-0 md:border-r md:pr-6 border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">修改密码</h3>
              <div className="space-y-2">
              <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} placeholder="当前密码" className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary-500 text-sm" />
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="新密码" className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary-500 text-sm" />
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="确认新密码" className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary-500 text-sm" />
              <p className="text-xs text-gray-400">至少 6 位，需包含大写字母和数字。修改成功后需重新登录。</p>
              <button onClick={handleChangePassword} disabled={pwLoading}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50">
                {pwLoading ? '提交中...' : '确认修改'}
              </button>
            </div>
            </div>
            {/* 右列 */}
            <div className="space-y-5">
              {/* 管理后台入口（仅管理员/巡查员可见） */}
              {(currentUser?.role === 'admin' || currentUser?.role === 'moderator') && (
                <div className="pb-5 border-b">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">管理</h3>
                  <Link to="/admin"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-50 text-gray-700 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-100 transition">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    进入管理后台
                  </Link>
                </div>
              )}

              {/* 退出登录 */}
              <div className="pb-5 border-b">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">退出登录</h3>
                <button onClick={() => setLogoutModal(true)}
                  className="w-full md:w-auto px-4 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-medium hover:bg-red-100 transition">
                  退出当前账号
                </button>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-red-600 mb-3">注销账户</h3>

                {currentUser?.scheduled_deleted_at ? (() => {
                  const d = new Date(currentUser.scheduled_deleted_at!.replace(' ', 'T') + 'Z');
                  const remainingMs = d.getTime() - Date.now();
                  const totalHours = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60)));
                  const days = Math.floor(totalHours / 24);
                  const hours = totalHours % 24;
                  const remainingText = days > 0 ? `${days}天${hours}小时` : `${hours}小时`;
                  return (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                    <p className="text-sm text-yellow-800 font-medium mb-1">⏳ 账户注销待处理</p>
                    <p className="text-xs text-yellow-700 mb-3">
                      将在 <strong>{remainingText}</strong> 后自动注销。在此期间可随时取消。
                    </p>
                    <button onClick={async () => {
                      try {
                        const r = await authApi.cancelDeletion();
                        if (r.success) {
                          await refreshUser();
                          flash('已取消账户注销');
                        } else {
                          flash(r.error || '取消失败', true);
                        }
                      } catch (err: any) {
                        flash(err.message, true);
                      }
                    }}
                      className="px-4 py-2 bg-white border border-yellow-300 text-yellow-700 rounded-xl text-sm font-medium hover:bg-yellow-50 transition">
                      取消注销
                    </button>
                  </div>);
                })() : (
                  <>
                    <p className="text-xs text-gray-500 mb-3">注销后账户和所有内容将被清除，有 3 天冷静期可反悔。</p>
                    <button onClick={() => setDeleteModal({ step: 1, password: '', countdown: 5 })}
                      className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition">注销账户</button>
                  </>
                )}
              </div>
            </div>
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
          image={URL.createObjectURL(cropModal.file)}
          aspect={cropModal.aspect}
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

      {/* 注销确认弹窗 — 两级确认 + 5 秒冷静 */}
      {deleteModal && (() => {
        const modal = deleteModal;
        // portal 到 body：避免被困在 main z-10 堆叠上下文（否则遮罩盖不住根级底部导航 z-50）
        return createPortal(
          <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setDeleteModal(null)}>
            <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
              {modal.step === 1 && (
                <>
                  <h3 className="text-lg font-bold text-red-600 mb-3">⚠️ 确认注销</h3>
                  <p className="text-sm text-gray-600 mb-2">你确定要注销账户吗？</p>
                  <p className="text-xs text-gray-400 mb-5">注销后有 <strong>3 天冷静期</strong>，期间可以随时取消。</p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setDeleteModal(null)} className="px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
                    <button onClick={() => setDeleteModal({ ...modal, step: 2 })} className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition">下一步</button>
                  </div>
                </>
              )}
              {modal.step === 2 && (
                <>
                  <h3 className="text-lg font-bold text-red-600 mb-3">🔐 验证密码</h3>
                  <p className="text-xs text-gray-500 mb-4">请输入密码验证身份，验证通过后将进入 5 秒冷静倒计时。</p>
                  <input type="password" value={modal.password} onChange={e => setDeleteModal({ ...modal, password: e.target.value, error: '' })}
                    className="w-full px-3 py-2 border border-red-300 rounded-xl outline-none focus:border-red-500 text-sm mb-2" placeholder="输入密码" />
                  {modal.error && <p className="text-xs text-red-500 mb-3">{modal.error}</p>}
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setDeleteModal(null)} className="px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
                    <button disabled={!modal.password || modal.verifying}
                      onClick={async () => {
                        setDeleteModal(prev => prev ? { ...prev, verifying: true, error: '' } : prev);
                        try {
                          const r = await authApi.verifyPassword(modal.password);
                          if (r.success) {
                            // 密码正确，进入 5 秒倒计时
                            setDeleteModal(prev => prev ? { ...prev, step: 3, verifying: false, countdown: 5 } : prev);
                            const timer = setInterval(() => {
                              setDeleteModal(prev => {
                                if (!prev || prev.countdown <= 1) {
                                  clearInterval(timer);
                                  return prev ? { ...prev, countdown: 0 } : null;
                                }
                                return { ...prev, countdown: prev.countdown - 1 };
                              });
                            }, 1000);
                          } else {
                            setDeleteModal(prev => prev ? { ...prev, verifying: false, error: r.error || '密码错误' } : prev);
                          }
                        } catch (err: any) {
                          setDeleteModal(prev => prev ? { ...prev, verifying: false, error: err.message || '验证失败' } : prev);
                        }
                      }}
                      className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                      {modal.verifying ? '验证中...' : '验证密码'}
                    </button>
                  </div>
                </>
              )}
              {modal.step === 3 && (
                <>
                  <h3 className="text-lg font-bold text-red-600 mb-3">⏳ 冷静倒计时</h3>
                  <p className="text-sm text-gray-600 mb-1">请等待 <strong>{modal.countdown}</strong> 秒后点击确认提交注销。</p>
                  <p className="text-xs text-gray-400 mb-5">冷静期内可随时取消操作。</p>
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                      <span className="text-2xl font-bold text-red-600">{modal.countdown}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setDeleteModal(null)} className="px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
                    <button disabled={modal.countdown > 0}
                      onClick={async () => {
                        setDeleteModal(prev => prev ? { ...prev, verifying: true } : prev);
                        try {
                          const r = await authApi.deleteAccount(modal.password);
                          if (r.success) {
                            setDeleteModal(null);
                            flash('账户将在3天后自动注销');
                            setTimeout(() => { logout(); navigate('/'); }, 2000);
                          } else {
                            setDeleteModal(prev => prev ? { ...prev, verifying: false, error: r.error || '提交失败' } : prev);
                          }
                        } catch (err: any) {
                          setDeleteModal(prev => prev ? { ...prev, verifying: false, error: err.message || '提交失败' } : prev);
                        }
                      }}
                      className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                      {modal.verifying ? '提交中...' : '确认提交'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        );
      })()}
    </>
  );
}
