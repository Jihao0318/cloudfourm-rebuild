import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { achievementsApi } from '../services/api';
import { rarityMeta, rewardLabel } from '../utils/achievements';
import { levelFromExp } from '../utils/level';
import { formatRelativeTime } from '../utils/date';
import type { AchievementUnlocker, HallAchievement } from '../types';
import Avatar from './Avatar';

interface Props {
  achievement: HallAchievement | null;
  onClose: () => void;
}

/**
 * 成就达成者名单弹窗：成就殿堂里点击某个成就后，查看「哪些人达成了」。
 * 名单按达成时间先后排序（先达成者在前），分页加载（每页 20 人）。
 */
export default function AchievementUnlockersModal({ achievement, onClose }: Props) {
  const [users, setUsers] = useState<AchievementUnlocker[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const key = achievement?.key || '';

  // 打开/切换成就时拉第一页
  useEffect(() => {
    if (!key) return;
    let alive = true;
    setUsers([]); setTotal(0); setPage(1); setError(''); setLoading(true);
    achievementsApi.unlockers(key, 1)
      .then(res => {
        if (!alive) return;
        if (res.success && res.data) {
          setUsers(res.data.users || []);
          setTotal(res.data.total || 0);
        } else {
          setError(res.error || '加载失败');
        }
      })
      .catch((e: any) => { if (alive) setError(e?.message || '加载失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key]);

  // 打开时锁定背景滚动 + Esc 关闭
  useEffect(() => {
    if (!achievement) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', onKey); };
  }, [achievement, onClose]);

  if (!achievement) return null;

  const meta = rarityMeta(achievement.rarity);

  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const next = page + 1;
      const res = await achievementsApi.unlockers(key, next);
      if (res.success && res.data) {
        setUsers(prev => [...prev, ...(res.data!.users || [])]);
        setTotal(res.data.total || 0);
        setPage(next);
      } else {
        setError(res.error || '加载失败');
      }
    } catch (e: any) {
      setError(e?.message || '加载失败');
    }
    setLoading(false);
  };

  // portal 到 body：避免被困在 main 的 z-10 堆叠上下文（与其它弹窗一致）；z-[90] 低于全局 Toast
  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#111] rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}>
        {/* 头部：成就信息 */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl leading-none">{meta.medal}</span>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{achievement.name}</h3>
              <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.pill}`}>{meta.label}</span>
            </div>
            <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{achievement.desc}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="text-[11px] text-gray-500">
                <strong className="text-gray-800 dark:text-gray-200">{total}</strong> 人达成
              </span>
              {(achievement.rewards || []).map((r, i) => (
                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${meta.pill}`}>{rewardLabel(r, { titleName: achievement.name })}</span>
              ))}
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm">✕</button>
        </div>

        {/* 达成者名单 */}
        <div className="px-5 py-4 overflow-y-auto">
          {loading && users.length === 0 && <p className="text-xs text-gray-400 text-center py-6">加载中...</p>}
          {!loading && error && <p className="text-xs text-red-500 text-center py-6">{error}</p>}
          {!loading && !error && users.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">还没有人达成这个成就</p>
          )}
          <div className="space-y-1.5">
            {users.map(u => (
              <Link key={u.id} to={`/user/${u.id}`} onClick={onClose}
                className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 transition">
                <Avatar url={u.avatar_url} username={u.username} size="sm"
                  frame={u.avatar_frame} frameExpiresAt={u.avatar_frame_expires_at} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{u.username}</span>
                    <span className="shrink-0 text-[10px] bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded font-medium">
                      Lv.{levelFromExp(u.exp ?? 0).level}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400">{formatRelativeTime(u.unlocked_at)}达成</div>
                </div>
                <span className="shrink-0 text-xs text-gray-300">›</span>
              </Link>
            ))}
          </div>

          {users.length > 0 && users.length < total && (
            <button onClick={loadMore} disabled={loading}
              className="w-full mt-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 disabled:opacity-50 transition">
              {loading ? '加载中...' : `加载更多（已显示 ${users.length}/${total}）`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
