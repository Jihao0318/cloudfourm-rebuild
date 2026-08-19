import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { leaderboardApi } from '../services/api';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import EmptyState from '../components/EmptyState';
import Avatar from '../components/Avatar';
import BackButton from '../components/BackButton';
import { faTrophy } from '@fortawesome/free-solid-svg-icons';



export default function Leaderboard() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    leaderboardApi.coins().then(res => {
      if (res.success) setUsers(res.data || []);
      else setError(res.error || '加载失败');
    }).catch((err: any) => setError(err.message || '加载失败')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const getRankBadge = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  if (loading) return (
    <div className="max-w-4xl mx-auto py-4 sm:py-6">
      <Skeleton width="40%" height={28} className="mb-1" />
      <Skeleton width="30%" height={16} className="mb-6" />
      <div className="space-y-2">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-xl">
            <Skeleton width={32} height={24} />
            <Skeleton circle width={40} height={40} />
            <div className="flex-1">
              <Skeleton width={`${40 + i * 8}%`} height={16} className="mb-1" />
              <Skeleton width="30%" height={12} />
            </div>
            <Skeleton width={70} height={18} />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto py-4 sm:py-6">
      <div className="flex items-center gap-3 mb-1">
        <BackButton />
        <h1 className="text-2xl font-bold">积分排行榜</h1>
      </div>
      <p className="text-gray-500 text-sm mb-6 pl-10">积分总榜 TOP 50</p>

      {error ? (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>排行榜加载失败：{error}</span>
          <button onClick={load}
            className="shrink-0 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">重试</button>
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={faTrophy}
          title="排行榜暂无数据"
          description="积分交易后即可上榜"
          theme="warning"
        />
      ) : (
        <div className="space-y-2">
          {users.map((u, idx) => (
            <Link
              key={u.id}
              to={`/user/${u.id}`}
              className={`flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition ${
                idx < 3 ? 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/40 dark:to-transparent border border-amber-100' : ''
              }`}
            >
              <div className="w-10 text-center font-bold text-lg">
                {getRankBadge(u.rank)}
              </div>
              <Avatar url={u.avatar_url} username={u.username} size="md" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {u.username}
                  {u.vip_tier && <span className="ml-1 text-xs text-yellow-500">●</span>}
                </div>
                <div className="text-xs text-gray-400">{u.custom_title && (!u.custom_title_expires_at || new Date(u.custom_title_expires_at) > new Date()) ? u.custom_title : ''}</div>
              </div>
              <div className="text-amber-600 font-bold">{u.coins.toLocaleString()} 🪙</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
