import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHome, faPlusCircle, faCalendarCheck, faCoins, faUser, faSignInAlt, faUserPlus } from '@fortawesome/free-solid-svg-icons';
import NotificationBell from './NotificationBell';

import ConfirmModal from './ConfirmModal';
import MoreMenu from './MoreMenu';

export default function Layout() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showScrollTop, setShowScrollTop] = useState(false);

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  // 暗色模式 — 恢复 afb4137 的 CSS 变量方案
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleDark = () => setIsDark(prev => !prev);

// ponytail: prefetch route map — 提出组件外避免每次渲染重建
const PREFETCH_MAP: Record<string, () => Promise<any>> = {
  '/': () => import('../pages/Home'),
  '/boards': () => import('../pages/Boards'),
  '/create': () => import('../pages/CreatePost'),
  '/check-in': () => import('../pages/CheckIn'),
  '/tasks': () => import('../pages/Tasks'),
  '/shop': () => import('../pages/Shop'),
  '/warehouse': () => import('../pages/Warehouse'),
  '/lottery': () => import('../pages/LotteryCoins'),
  '/coins': () => import('../pages/Coins'),
  '/vip': () => import('../pages/VIP'),
  '/leaderboard': () => import('../pages/Leaderboard'),
  '/achievements': () => import('../pages/Achievements'),
  '/login': () => import('../pages/Login'),
  '/register': () => import('../pages/Register'),
  '/profile': () => import('../pages/Profile'),
  '/admin': () => import('../pages/Admin'),
};

const prefetchPage = (path: string) => PREFETCH_MAP[path]?.().catch(() => {});

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);



  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const handleLogout = () => {
    logout(); navigate('/');
  };

  // 桌面端顶栏 — 仅保留高频链接，低频放入「更多」下拉
  // 积分入口由右侧 🪙 余额承担（侧边栏/底部导航也有），避免重复；VIP 移入「更多」
  const mainLinks = user ? [
    { path: '/', label: '首页' },
    { path: '/boards', label: '板块' },
    { path: '/create', label: '发布' },
    { path: '/check-in', label: '签到' },
  ] : [
    { path: '/', label: '首页' },
    { path: '/boards', label: '板块' },
  ];

  // 更多下拉：只留侧边栏没有的入口（任务/仓库/排行已在首页侧边栏）
  const moreLinks = [
    { path: '/vip', label: 'VIP' },
    { path: '/shop', label: '商城' },
    { path: '/lottery', label: '抽奖' },
  ];

  // 移动端底部导航（管理入口已移入「我的」页面；签到/任务挪入「我的」页常用入口）
  const bottomNav = user ? [
    { path: '/', label: '首页', icon: faHome },
    { path: '/check-in', label: '签到', icon: faCalendarCheck },
    { path: '/create', label: '发布', icon: faPlusCircle },
    { path: '/coins', label: '积分', icon: faCoins },
    { path: '/profile', label: '我的', icon: faUser },
  ] : [
    { path: '/', label: '首页', icon: faHome },
    { path: '/login', label: '登录', icon: faSignInAlt },
    { path: '/register', label: '注册', icon: faUserPlus },
  ];

  return (
    <div className="min-h-screen flex flex-col pb-[calc(4rem_+_env(safe-area-inset-bottom))] md:pb-0">
      {/* 跳过导航链接 — 键盘辅助 */}
      <a href="#main-content"
        className="skip-to-content">
        跳到主要内容
      </a>

      {/* 回到顶部按钮 */}
      
      {showScrollTop && (
        <button onClick={scrollToTop}
          className="fixed bottom-32 md:bottom-28 right-6 z-40 w-11 h-11 bg-white/70 dark:bg-black/60 backdrop-blur-md border border-white/40 dark:border-white/10 text-gray-600 dark:text-gray-300 rounded-full shadow-lg hover:bg-white/90 dark:hover:bg-black/70 hover:shadow-xl transition-all flex items-center justify-center"
          aria-label="回到顶部"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
        </button>
      )}

      {/* 顶栏 — 桌面端和手机端都保留 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4">
          {/* 顶栏布局：Logo 靠左、工具区靠右（手机端通知/深色在右上角）、桌面导航绝对居中 */}
          <div className="relative flex items-center justify-between h-14">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="font-bold text-lg text-gray-900">CloudForum</span>
            </Link>

            {/* 桌面导航 — md 以上显示；绝对居中，不受两侧内容影响
                z-20：nav 的 -translate-x-1/2 会创建堆叠上下文，若不提 z 会低于 main(z-10)，
                「更多」下拉（nav 内 z-50）展开到内容区时会被页面内容盖住（历史遮挡 bug 根因） */}
            <nav className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-1 z-20" aria-label="主导航">
              {mainLinks.map(link => (
                <Link key={link.path} to={link.path} onMouseEnter={() => prefetchPage(link.path)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition whitespace-nowrap"
                  aria-label={link.label}>
                  {link.label}
                </Link>
              ))}
              {/* 更多下拉菜单 — 仅点击切换，无悬停干扰 */}
              {user && (
                <MoreMenu links={moreLinks} />
              )}
            </nav>

            {/* 右侧：桌面端显示完整，手机端只显示 Logo 和汉堡；靠右 */}
            <div className="flex items-center gap-2 shrink-0">
              {user && <NotificationBell userId={user.id} />}
              {/* 深色模式切换 */}
              <button onClick={toggleDark} className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition" aria-label={isDark ? '切换为浅色模式' : '切换为深色模式'}>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isDark ? (
                    <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>
                  ) : (
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  )}
                </svg>
              </button>
              {user ? (
                <>
                  {/* 个人主页入口已移入首页侧边栏「我的」卡（点头像/昵称进入），顶栏不再重复 */}
                  {(user.role === 'admin' || user.role === 'moderator') && (
                    <Link to={user.role === 'admin' ? '/admin' : '/moderator'} className="hidden md:inline-block px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition">{user.role === 'admin' ? '管理' : '巡查台'}</Link>
                  )}
                  <button onClick={() => setShowLogoutConfirm(true)} className="hidden md:inline-block px-3 py-1.5 text-sm text-gray-400 hover:text-red-600 transition">退出登录</button>
                </>
              ) : (
                /* 未登录：登录/注册入口在首页侧边栏「我的」卡内，顶栏不再重复 */
                null
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main id="main-content" className="flex-1 w-full px-4 py-6">
        <Outlet />
      </main>

      {/* 移动端底部导航 — sm 以下显示；外层加安全区 padding，背景色延伸到 Home Indicator 区域 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-[#111] border-t shadow-lg pb-[env(safe-area-inset-bottom)]" aria-label="底部导航">
        <div className="flex items-center justify-around h-16">
          {bottomNav.map(item => {
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-lg transition h-full min-h-[44px] ${active ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}>
                <FontAwesomeIcon icon={item.icon as any} className="text-xl" />
                <span className={`text-[11px] font-medium ${active ? 'font-semibold' : ''}`}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* 退出确认弹窗 */}
      <ConfirmModal
        open={showLogoutConfirm}
        title="退出登录"
        message="确定要退出当前账号吗？"
        confirmText="退出"
        danger
        onConfirm={() => { setShowLogoutConfirm(false); handleLogout(); }}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      {/* 页脚 */}
      <footer className="bg-white border-t py-6 mt-8 hidden md:block">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-gray-500">
          <div className="flex items-center justify-center gap-3 text-xs">
            <Link to="/terms" className="text-gray-400 hover:text-primary-600 transition">用户协议</Link>
            <span className="text-gray-300">·</span>
            <span>Powered by Cloudflare Workers + Pages + D1</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
