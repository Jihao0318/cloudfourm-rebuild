import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { site, coins as coinsApi, posts as postsApi, leaderboardApi } from '../services/api';
import Avatar from './Avatar';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faCoins, faBolt, faTrophy, faSignInAlt, faUserPlus, faMagic, faGift, faNewspaper } from '@fortawesome/free-solid-svg-icons';

interface RankUser {
  id: number;
  username: string;
  coins: number;
  rank: number;
  avatar_url: string | null;
}

interface FeaturedPost {
  id: number;
  title: string;
  username: string;
  endsAt: string;
}

// 全站荣誉框内条目（可扩展：以后新增全站性质入口只需往此数组加对象）
const SITE_FEATURES = [
  { emoji: '🏛️', title: '成就殿堂', desc: '全部成就 · 达成人数公开', path: '/achievements' },
];

// 右侧边栏：我的（头像/昵称 → 个人主页 + 快捷入口）/ 推荐位 / 热门帖子 / 积分排行前三
// 克制风格：白卡 + 细边框 + 灰色小标题（大厂论坛通用模式），lg+ 显示
// 公告不在此处（顶栏下方已有全站公告横幅，避免重复）
export default function HomeSidebar() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<{ text: string; ver: string } | null>(null);
  const [featured, setFeatured] = useState<FeaturedPost[]>([]);
  const [hotPosts, setHotPosts] = useState<{ id: number; title: string; username: string; comment_count: number }[]>([]);
  const [topUsers, setTopUsers] = useState<RankUser[]>([]);

  const refreshBalance = async () => {
    try {
      const r = await coinsApi.balance();
      if (r.success) setBalance(r.data?.coins ?? null);
    } catch { /* 静默：余额刷新失败不影响页面 */ }
  };

  // 公告「知道了，不再显示」：localStorage 记录已读版本（announcement_updated_at），
  // 每次公告更新（版本变化）重新显示，直到用户再次点击不再显示
  const loadAnnouncement = async () => {
    try {
      const r = await site.announcement();
      if (!r.success || !r.data?.announcement) { setAnnouncement(null); return; }
      const ver = r.data.announcement_updated_at || r.data.announcement;
      const seenKey = `cf_announcement_seen_${user?.id ?? 'guest'}`;
      if (localStorage.getItem(seenKey) === ver) { setAnnouncement(null); return; }
      setAnnouncement({ text: r.data.announcement, ver });
    } catch { /* 静默 */ }
  };

  const dismissAnnouncement = () => {
    if (!announcement) return;
    localStorage.setItem(`cf_announcement_seen_${user?.id ?? 'guest'}`, announcement.ver);
    setAnnouncement(null);
  };

  useEffect(() => {
    if (user) refreshBalance();
    loadAnnouncement();
    // 推荐位：使用推荐卡的帖子（侧边栏曝光，不插队主页列表）
    postsApi.featured().then(r => { if (r.success) setFeatured(r.data || []); }).catch(() => {});
    postsApi.list({ sort: 'hot', pageSize: 5 })
      .then(r => { if (r.success) setHotPosts((r.data || []).map((p: any) => ({ id: p.id, title: p.title, username: p.username || '匿名同学', comment_count: p.comment_count }))); })
      .catch(() => {});
    // 排行榜前三（其余排名统一入口查看）
    leaderboardApi.coins().then(r => { if (r.success) setTopUsers((r.data || []).slice(0, 3)); }).catch(() => {});
    // 积分变动（购买/签到/红包等）时同步余额
    window.addEventListener('coins:changed', refreshBalance);
    return () => window.removeEventListener('coins:changed', refreshBalance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const cardCls = 'bg-white dark:bg-[#111] rounded-xl border border-gray-100 dark:border-gray-800 p-4';
  const titleCls = 'text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2.5 flex items-center gap-1.5';

  return (
    <aside className="space-y-4">
      {/* ① 我的（头像/昵称 → 个人主页 + 快捷入口） */}
      <div className={cardCls}>
        <h3 className={titleCls}><FontAwesomeIcon icon={faUser} className="text-primary-500" />我的</h3>
        {user ? (
          <>
            {/* 个人主页入口：点头像/昵称进入（符合用户第一操作意图） */}
            <Link to="/profile"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition mb-2">
              <Avatar url={user.avatar_url} username={user.username} size="md" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                  {user.username}
                </span>
                <span className="block text-[11px] text-gray-400">查看个人主页 →</span>
              </span>
            </Link>
            <Link to="/coins" className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition mb-2">
              <span className="text-xs text-gray-500">积分余额</span>
              <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{balance ?? '—'}</span>
            </Link>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { to: '/tasks', icon: faBolt, label: '任务' },
                { to: '/warehouse', icon: faCoins, label: '仓库' },
                { to: '/red-packets', icon: faGift, label: '红包' },
                { to: '/active-effects', icon: faMagic, label: '活跃效果' },
              ].map(l => (
                <Link key={l.to} to={l.to}
                  className="px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 hover:text-primary-600 transition flex items-center gap-1.5">
                  <FontAwesomeIcon icon={l.icon} className="text-gray-400 text-[11px]" />{l.label}
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 leading-relaxed">登录后即可发帖、签到、参与社区互动</p>
            <div className="grid grid-cols-2 gap-1.5">
              <Link to="/login" className="px-3 py-2 rounded-lg bg-primary-600 text-white text-xs font-medium text-center hover:bg-primary-700 transition flex items-center justify-center gap-1">
                <FontAwesomeIcon icon={faSignInAlt} />登录
              </Link>
              <Link to="/register" className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 text-center hover:bg-gray-50 dark:hover:bg-gray-900 transition flex items-center justify-center gap-1">
                <FontAwesomeIcon icon={faUserPlus} />注册
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ② 全站公告（每次更新后重新显示，点「不再显示」后直到下次更新才出现） */}
      {announcement && (
        <div className={`${cardCls} border-primary-200 dark:border-primary-800 bg-gradient-to-b from-primary-50/60 to-white dark:from-primary-950/30 dark:to-[#111]`}>
          <h3 className={titleCls}><FontAwesomeIcon icon={faNewspaper} className="text-primary-500" />全站公告</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{announcement.text}</p>
          <button onClick={dismissAnnouncement}
            className="mt-3 w-full py-1.5 rounded-lg border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400 text-xs font-medium hover:bg-primary-50 dark:hover:bg-primary-950/40 transition">
            知道了，不再显示
          </button>
        </div>
      )}

      {/* ③ 全站荣誉：范围较大、全站性质的东西（独立框，目前为成就殿堂；条目由 SITE_FEATURES 数组扩展） */}
      <div className={cardCls}>
        <h3 className={titleCls}>🏛️ 全站荣誉</h3>
        <div className="space-y-1.5">
          {SITE_FEATURES.map(f => (
            <Link key={f.path} to={f.path}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition group">
              <span className="w-9 h-9 shrink-0 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-900 flex items-center justify-center text-lg">{f.emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-primary-600 transition">{f.title}</span>
                <span className="block text-[11px] text-gray-400 truncate">{f.desc}</span>
              </span>
              <span className="text-gray-300 group-hover:text-primary-500 transition shrink-0">›</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ④ 推荐位：使用推荐卡的帖子（付费曝光位，不插队主页列表） */}
      {featured.length > 0 && (
        <div className={`${cardCls} border-amber-200 dark:border-amber-900`}>
          <h3 className={`${titleCls} text-amber-600 dark:text-amber-400`}>🔥 推荐</h3>
          <div className="space-y-1">
            {featured.map((p, i) => (
              <Link key={p.id} to={`/post/${p.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-amber-50/60 dark:hover:bg-amber-900/20 transition">
                <span className={`w-4 text-center text-[11px] font-semibold shrink-0 ${i < 3 ? 'text-amber-500' : 'text-gray-300'}`}>{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-gray-700 dark:text-gray-200 truncate hover:text-amber-600">{p.title}</span>
                  <span className="block text-[11px] text-gray-400 truncate">by {p.username}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ⑤ 热门帖子 */}
      {hotPosts.length > 0 && (
        <div className={cardCls}>
          <h3 className={titleCls}><FontAwesomeIcon icon={faBolt} className="text-amber-500" />热门帖子</h3>
          <div className="space-y-1">
            {hotPosts.map((p, i) => (
              <Link key={p.id} to={`/post/${p.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition">
                <span className={`w-4 text-center text-[11px] font-semibold shrink-0 ${i < 3 ? 'text-amber-500' : 'text-gray-300'}`}>{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-gray-600 dark:text-gray-300 truncate hover:text-primary-600">{p.title}</span>
                  <span className="block text-[11px] text-gray-400 truncate">by {p.username}</span>
                </span>
                <span className="text-[11px] text-gray-400 shrink-0">💬 {p.comment_count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ⑥ 积分排行前三（其余排名统一入口查看） */}
      <div className={cardCls}>
        <h3 className={titleCls}><FontAwesomeIcon icon={faTrophy} className="text-amber-500" />积分排行</h3>
        <div className="space-y-1">
          {topUsers.length > 0 ? topUsers.map((u, i) => (
            <Link key={u.id} to={`/user/${u.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition">
              <span className="w-6 text-center text-sm shrink-0">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
              </span>
              <Avatar url={u.avatar_url} username={u.username} size="sm" />
              <span className="flex-1 min-w-0 text-[13px] text-gray-700 dark:text-gray-200 truncate">{u.username}</span>
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium shrink-0">{u.coins?.toLocaleString()} 🪙</span>
            </Link>
          )) : (
            <p className="text-xs text-gray-400 px-2 py-1">加载中...</p>
          )}
        </div>
        <Link to="/leaderboard" className="mt-2 flex items-center justify-center px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-primary-600 hover:bg-gray-50 dark:hover:bg-gray-900 transition">
          查看完整排行 →
        </Link>
      </div>
    </aside>
  );
}
