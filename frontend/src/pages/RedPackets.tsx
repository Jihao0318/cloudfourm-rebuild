import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { items as itemsApi } from '../services/api';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import EmptyState from '../components/EmptyState';
import ConfirmModal from '../components/ConfirmModal';
import BackButton from '../components/BackButton';
import { faStar } from '@fortawesome/free-solid-svg-icons';

interface RedPacket {
  id: number;
  postId: number;
  postTitle: string;
  totalCoins: number;
  remainingCoins: number;
  totalPackets: number;
  remainingPackets: number;
  claimedCount: number;
  createdAt: string;
}

export default function RedPackets() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [list, setList] = useState<RedPacket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<RedPacket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 加载完成
    if (!user) { navigate('/login', { state: { from: '/red-packets' } }); return; }
    loadList();
    timerRef.current = setInterval(loadList, 5000); // 5 秒轮询实时刷新剩余金额/领取人数
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [authLoading, user]);

  const loadList = async () => {
    try {
      const res = await itemsApi.redPackets();
      if (res.success && res.data) setList(res.data);
      else if (!res.success) setError(res.error || '加载失败');
    } catch (e: any) { setError(e.message || '加载失败'); }
    setLoading(false);
  };

  const confirmCancel = async () => {
    if (!confirmTarget) return;
    const json = await itemsApi.cancelEffect(`rp_${confirmTarget.id}`);
    setConfirmTarget(null);
    if (json.success) {
      toast(json.message || '已取消红包', 'success');
      window.dispatchEvent(new Event('coins:changed')); // 退款到账，刷新导航栏余额
      setError('');
      loadList();
    } else {
      toast(json.error || '取消失败', 'error');
    }
  };

  if (authLoading || !user) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <BackButton />
        <h1 className="text-xl md:text-2xl font-bold">我的红包</h1>
        <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">{list.length} 个进行中</span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="bg-white dark:bg-[#111] border rounded-2xl p-4">
              <Skeleton width="50%" height={14} className="mb-2" />
              <Skeleton width="30%" height={18} className="mb-2" />
              <Skeleton width="100%" height={8} />
            </div>
          ))}
        </div>
      ) : error && list.length === 0 ? (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>红包列表加载失败：{error}</span>
          <button onClick={() => { setLoading(true); loadList(); }}
            className="shrink-0 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">重试</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={faStar}
          title="暂无进行中的红包"
          description="发帖时挂上积分红包，就会在这里显示实时状态"
          theme="info"
        />
      ) : (
        <div className="space-y-3">
          {list.map(rp => {
            const pct = rp.totalCoins ? Math.max(0, Math.min(100, (rp.remainingCoins / rp.totalCoins) * 100)) : 0;
            return (
              <div key={rp.id} className="bg-white dark:bg-[#111] border rounded-2xl px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-2xl shrink-0">🧧</span>
                  <div className="flex-1 min-w-0">
                    <Link to={`/post/${rp.postId}`}
                      className="block text-sm font-medium text-gray-800 dark:text-gray-200 truncate hover:text-primary-600 transition"
                      title={rp.postTitle}>
                      {rp.postTitle || `帖子 #${rp.postId}`}
                    </Link>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-red-500">剩余 {rp.remainingCoins}/{rp.totalCoins} 积分</span>
                      <span className="text-[11px] bg-red-50 dark:bg-red-900/40 text-red-500 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                        已领 {rp.claimedCount}/{rp.totalPackets} 个
                      </span>
                      <span className="text-[11px] text-gray-400">剩 {rp.remainingPackets} 包</span>
                    </div>
                    <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-red-400 to-orange-400 rounded-full transition-all"
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <button onClick={() => setConfirmTarget(rp)}
                    className="shrink-0 px-2.5 py-1.5 text-xs border border-red-200 dark:border-red-900 text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition">
                    取消并退款
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 取消红包确认弹窗 */}
      <ConfirmModal
        open={!!confirmTarget}
        title="取消红包"
        message={`取消后剩余 ${confirmTarget?.remainingCoins ?? 0} 积分将退还到你的账户，已领取的部分无法收回。确定取消吗？`}
        confirmText="确认取消并退款"
        danger
        onConfirm={confirmCancel}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
