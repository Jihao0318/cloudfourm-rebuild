import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { tasksApi } from '../services/api';
import { Helmet } from 'react-helmet-async';
import type { TaskItem } from '../types';
import BackButton from '../components/BackButton';

const TASK_GOALS: Record<TaskItem['task_type'], number> = { checkin: 1, post: 1, comment: 2, liked: 1 };
const TASK_ICONS: Record<TaskItem['task_type'], string> = { checkin: '📅', post: '📝', comment: '💬', liked: '❤️' };
// 未完成任务 → 可点击跳转到对应页面完成（被动任务 liked 无入口，保持展示态）
const TASK_ROUTES: Partial<Record<TaskItem['task_type'], string>> = {
  checkin: '/check-in',
  post: '/create',
  comment: '/',
};
const TASK_ACTIONS: Partial<Record<TaskItem['task_type'], string>> = {
  checkin: '去签到 →',
  post: '去发帖 →',
  comment: '去评论 →',
};

interface TodayData {
  tasks: TaskItem[];
  all_done: boolean;
  bonus_claimed: boolean;
}

export default function Tasks() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 加载完成，避免刷新时误踢登录
    if (!user) { navigate('/login', { state: { from: '/tasks' } }); return; }
    loadToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  // 从其他页面/标签完成任务后切回时，刷新进度（不闪加载：有 data 时不显示加载态）
  useEffect(() => {
    if (!user) return;
    const refresh = () => loadToday();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user]);

  const loadToday = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await tasksApi.today();
      if (res.success && res.data) setData(res.data);
      else setLoadError(res.error || '加载失败');
    } catch (err: any) {
      setLoadError(err.message || '加载失败');
    }
    setLoading(false);
  };

  const handleClaim = async (task: TaskItem) => {
    setClaiming(task.task_type);
    try {
      const res = await tasksApi.claim(task.task_type);
      if (res.success && res.data) {
        toast(`+${res.data.coins} 积分 +${res.data.exp} 经验`);
        // 奖励已到账：通知 Layout 刷新导航栏余额
        window.dispatchEvent(new Event('coins:changed'));
        loadToday();
      } else {
        toast(res.error || '领取失败', 'error');
      }
    } catch (err: any) {
      toast(err.message || '领取失败', 'error');
    }
    setClaiming(null);
  };

  const handleClaimBonus = async () => {
    setClaiming('bonus');
    try {
      const res = await tasksApi.claimBonus();
      if (res.success && res.data) {
        toast(`+${res.data.coins} 积分`);
        // 奖励已到账：通知 Layout 刷新导航栏余额
        window.dispatchEvent(new Event('coins:changed'));
        loadToday();
      } else {
        toast(res.error || '领取失败', 'error');
      }
    } catch (err: any) {
      toast(err.message || '领取失败', 'error');
    }
    setClaiming(null);
  };

  if (!user) return null;

  return (
    <>
      <Helmet><title>每日任务 - CloudForum</title></Helmet>
      <div className="max-w-3xl mx-auto space-y-5">
        <BackButton />

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">📋 每日任务</h1>
          {data && (
            <span className="text-xs text-gray-500">
              已完成 {data.tasks.filter(t => t.done).length}/{data.tasks.length}
            </span>
          )}
        </div>

        {loading && !data ? (
          <div className="bg-white rounded-2xl border p-10 text-center text-sm text-gray-400">加载中...</div>
        ) : data ? (
          <>
            {/* 任务卡片 */}
            {data.tasks.map(task => {
              const goal = task.goal ?? TASK_GOALS[task.task_type] ?? 1; // 后端返回 goal 优先，兜底防 NaN
              const percent = Math.min(100, Math.round((task.progress / goal) * 100));
              const zeroReward = task.coins === 0 && task.exp === 0; // 展示型任务（如每日签到：奖励由签到接口发放）
              return (
                <div key={task.task_type} className="bg-white rounded-2xl border p-5 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center text-xl shrink-0">
                    {TASK_ICONS[task.task_type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm">{task.label}</span>
                      <span className="text-xs text-gray-400">{task.progress}/{goal}</span>
                    </div>
                    <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">+{task.coins} 积分 +{task.exp} 经验</p>
                  </div>
                  <div className="shrink-0">
                    {task.claimed ? (
                      <span className="text-xs text-gray-400 px-3 py-1.5 rounded-lg bg-gray-50">已领取 ✓</span>
                    ) : task.done ? (
                      zeroReward ? (
                        // 展示型任务（签到等）：奖励随行为发放，完成即视为已领取，无需"领取"按钮
                        <span className="text-xs text-gray-400 px-3 py-1.5 rounded-lg bg-gray-50">已完成 ✓</span>
                      ) : (
                        <button onClick={() => handleClaim(task)} disabled={claiming === task.task_type}
                          className="px-4 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 disabled:opacity-50 transition">
                          {claiming === task.task_type ? '领取中...' : '领取'}
                        </button>
                      )
                    ) : (
                      TASK_ROUTES[task.task_type] ? (
                        // 未完成且有对应页面：直接跳转去完成
                        <Link to={TASK_ROUTES[task.task_type]!}
                          className="px-4 py-1.5 border border-primary-200 text-primary-600 rounded-lg text-xs font-medium hover:bg-primary-50 transition whitespace-nowrap">
                          {TASK_ACTIONS[task.task_type] || '去完成 →'}
                        </Link>
                      ) : (
                        // 被动任务（获得点赞）无入口，保持展示态
                        <span className="text-xs text-gray-400 px-3 py-1.5 rounded-lg bg-gray-50">未完成</span>
                      )
                    )}
                  </div>
                </div>
              );
            })}

            {/* 宝箱卡 */}
            <div className={`bg-white rounded-2xl border p-5 flex items-center gap-4 ${data.all_done && !data.bonus_claimed ? 'border-yellow-200 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950 dark:to-yellow-950 dark:border-yellow-800' : ''}`}>
              <div className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center text-xl shrink-0">🎁</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 text-sm">每日宝箱</span>
                  <span className="text-xs text-gray-400">完成全部任务后开启</span>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">+14 积分</p>
              </div>
              <div className="shrink-0">
                {data.bonus_claimed ? (
                  <span className="text-xs text-gray-400 px-3 py-1.5 rounded-lg bg-gray-50">已领取 ✓</span>
                ) : data.all_done ? (
                  <button onClick={handleClaimBonus} disabled={claiming === 'bonus'}
                    className="px-4 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 disabled:opacity-50 transition">
                    {claiming === 'bonus' ? '领取中...' : '领取宝箱 +14 积分'}
                  </button>
                ) : (
                  <span className="text-xs text-gray-400 px-3 py-1.5 rounded-lg bg-gray-50">🔒 未解锁</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-2xl border p-10 text-center">
            <p className="text-red-500 text-sm mb-4">{loadError || '加载失败，请稍后重试'}</p>
            <button onClick={loadToday} className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">重试</button>
          </div>
        )}
      </div>
    </>
  );
}
