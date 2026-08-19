import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { checkIn as checkInApi } from '../services/api';
import BackButton from '../components/BackButton';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle, faCalendarAlt } from '@fortawesome/free-solid-svg-icons';

function getLocalDate(): string {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export default function CheckIn() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [todayStatus, setTodayStatus] = useState<{ checked_in: boolean; streak: number; coins_earned: number } | null>(null);
  const [stats, setStats] = useState<{ total_days: number; month_days: number; current_streak: number; month_dates: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 恢复登录态，避免刷新时 user 短暂为 null 误踢
    if (!user) { navigate('/login'); return; }
    loadData();
  }, [authLoading, user]);

  const loadData = async () => {
    setLoading(true);
    setLoadError('');
    const date = getLocalDate();
    try {
      const [todayRes, statsRes] = await Promise.all([checkInApi.today(date), checkInApi.stats(date)]);
      if (todayRes.success && todayRes.data) setTodayStatus(todayRes.data);
      else setLoadError(todayRes.error || '签到状态加载失败');
      if (statsRes.success && statsRes.data) setStats(statsRes.data);
      else setLoadError(statsRes.error || '签到统计加载失败');
    } catch (e: any) { setLoadError(e?.message || '签到状态加载失败'); console.error(e); }
    setLoading(false);
  };

  const handleCheckIn = async () => {
    setChecking(true);
    try {
      const res = await checkInApi.do(getLocalDate());
      if (res.success && res.data) {
        setMessage(res.data.message);
        toast(`签到成功！获得 ${res.data.coins_earned} 积分`, 'success');
        // 积分已到账：通知 Layout 刷新导航栏余额
        window.dispatchEvent(new Event('coins:changed'));
        setAnimating(true);
        setTimeout(() => setAnimating(false), 600);
        loadData();
      } else {
        setMessage(res.error || '签到失败');
        toast(res.error || '签到失败', 'error');
      }
    } catch (err: any) {
      setMessage(err.message || '签到失败');
      toast(err.message || '签到失败', 'error');
    }
    setChecking(false);
  };

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  if (!user) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <BackButton />

      {message && (
        <div className={`px-4 py-3 rounded-xl text-sm border ${message.includes('成功') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
          {message}
        </div>
      )}

      <div className={`bg-white rounded-2xl border p-6 text-center transition-all duration-300 ${animating ? 'scale-105 ring-2 ring-green-300' : ''}`}>
        {loadError ? (
          /* 加载失败：显示错误 + 重试，绝不展示「今日未签到」诱导重复签到 */
          <>
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-red-500 text-sm mb-4">{loadError}</p>
            <button onClick={loadData} disabled={loading}
              className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-primary-700 disabled:opacity-50 transition text-lg">
              {loading ? '加载中...' : '重试'}
            </button>
          </>
        ) : loading && !todayStatus ? (
          <div className="text-sm text-gray-400 py-6 animate-pulse">加载中...</div>
        ) : (
          <>
            <div className={`text-5xl mb-3 transition-all duration-300 ${animating ? 'animate-bounce' : ''}`}><FontAwesomeIcon icon={todayStatus?.checked_in ? faCheckCircle : faCalendarAlt} /></div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              {todayStatus?.checked_in ? '今日已签到' : '今日未签到'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              连续签到 <strong className="text-primary-600">{todayStatus?.streak || stats?.current_streak || 0}</strong> 天
            </p>
            {!todayStatus?.checked_in ? (
              <button onClick={handleCheckIn} disabled={checking}
                className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-primary-700 disabled:opacity-50 transition text-lg">
                {checking ? '签到中...' : '签到'}
              </button>
            ) : (
              <p className="text-sm text-gray-400">今日签到获得 <strong className="text-green-600">{todayStatus?.coins_earned}</strong> 积分</p>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{stats?.total_days || 0}</div>
          <div className="text-xs text-gray-500 mt-1">累计签到</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{stats?.month_days || 0}</div>
          <div className="text-xs text-gray-500 mt-1">本月签到</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">{todayStatus?.streak || stats?.current_streak || 0}</div>
          <div className="text-xs text-gray-500 mt-1">连续天数</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border p-6">
        <h3 className="font-bold text-gray-900 mb-3">{year}年{month + 1}月</h3>
        <div className="grid grid-cols-7 gap-1 text-center">
          {['日', '一', '二', '三', '四', '五', '六'].map(d => (
            <div key={d} className="text-xs text-gray-400 py-1">{d}</div>
          ))}
          {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const checked = stats?.month_dates.includes(dateStr);
            const isToday = dateStr === getLocalDate();
            return (
              <div key={day} className={`py-2 text-sm rounded-lg ${checked ? 'bg-primary-100 text-primary-700 font-medium' : isToday ? 'bg-gray-100 text-gray-700' : 'text-gray-500'}`}>
                {day}{checked && <div className="text-[8px]">✓</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border p-6">
        <h3 className="font-bold text-gray-900 mb-3">签到奖励规则</h3>
        <div className="space-y-1 text-sm text-gray-600">
          <p>• 每日签到可获得积分奖励</p>
          <p>• 连续签到奖励更丰厚</p>
        </div>
      </div>
    </div>
  );
}
