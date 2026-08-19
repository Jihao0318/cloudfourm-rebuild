import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { coins as coinsApi } from '../services/api';
import { formatDateTime } from '../utils/date';
import BackButton from '../components/BackButton';

const typeLabels: Record<string, string> = {
  check_in: '每日签到', post: '发布帖子', comment: '发表评论', liked: '内容被赞',
  transfer_out: '转账支出', transfer_in: '转账收入', shop: '商城消费',
  lottery_draw: '积分抽奖', lottery_win: '抽奖获得', lottery_recycle: '回收道具',
  red_packet_pool: '发布红包', red_packet: '抢到红包', red_packet_refund: '红包退回',
  level_up: '升级礼包', task_reward: '任务奖励', task_bonus: '任务宝箱',
  achievement: '成就奖励', invite_reward: '邀请奖励', admin: '管理员调整',
  vip: 'VIP 购买', report_reward: '举报奖励', tip_out: '打赏支出',
  tip_in: '打赏收入', unban_deposit: '解封押金', unban_refund: '解封退款',
  bounty: '悬赏支出', bounty_reward: '悬赏奖励',
  // 后端实际使用的补充键（worker handlers）
  purchase: 'VIP 购买', fee_burn: '手续费', announce_use: '大喇叭',
  featured_knockout: '挤位支出', featured_knockout_refund: '被挤补偿',
  // posts.ts 直接以中文写入 type
  '付费查看': '付费查看', '帖子收入': '帖子收入',
  '举报有效处理奖励': '举报奖励', '管理员扣除': '管理员扣除', '管理员操作': '管理员操作',
};

const txIcon = (type: string): string => ({
  check_in: '📅', post: '📝', comment: '💬', liked: '❤️',
  transfer_out: '📤', transfer_in: '📥', shop: '🛍️',
  lottery_draw: '🎰', lottery_win: '🎉', lottery_recycle: '♻️',
  red_packet_pool: '🧧', red_packet: '🧧', red_packet_refund: '🧧',
  level_up: '🎓', task_reward: '✅', task_bonus: '🎁',
  achievement: '🏅', invite_reward: '🤝', admin: '🛠️',
  vip: '👑', report_reward: '🚩', tip_out: '💸',
  tip_in: '💸', unban_deposit: '🔓', unban_refund: '🔓',
  bounty: '🎯', bounty_reward: '🎯',
  purchase: '👑', fee_burn: '🔥', announce_use: '📢',
  featured_knockout: '⚔️', featured_knockout_refund: '🛡️',
  '付费查看': '🔓', '帖子收入': '💰',
}[type] || '💰');

export default function Transactions() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [txs, setTxs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [txFilter, setTxFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // 本地缓存：数据库只保留最近 15 条，更早的历史记录从 localStorage 补（上限 500 条防占满）
  const CACHE_KEY = `cf_tx_cache_${user?.id}`;
  const CACHE_LIMIT = 500;

  const readCache = (): any[] => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };
  const writeCache = (list: any[]) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(0, CACHE_LIMIT))); } catch { /* 存满忽略 */ }
  };

  const loadTxs = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const cached = readCache();
      const res = await coinsApi.transactions(1);
      if (res.success && res.data) {
        // 合并：数据库最新 15 条为准，缓存补更早历史（按 id 去重，最新在前）
        const dbTx: any[] = res.data as any[];
        const merged = [...dbTx];
        for (const tx of cached) {
          if (!merged.some(t => t.id === tx.id)) merged.push(tx);
        }
        merged.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        writeCache(merged);
        setTxs(merged);
        setTotal(merged.length);
      } else if (cached.length > 0) {
        // 接口失败但有缓存：展示离线缓存并提示
        setTxs(cached);
        setTotal(cached.length);
        setLoadError('网络异常，以下展示离线缓存');
      } else {
        setLoadError(res.error || '交易记录加载失败');
      }
    } catch (e: any) {
      console.error(e);
      const cached = readCache();
      if (cached.length > 0) {
        setTxs(cached);
        setTotal(cached.length);
        setLoadError('网络异常，以下展示离线缓存');
      } else {
        setLoadError(e?.message || '交易记录加载失败');
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 恢复登录态，避免刷新时 user 短暂为 null 误踢
    if (!user) { navigate('/login'); return; }
    loadTxs();
  }, [authLoading, user]);

  const filtered = txs.filter(tx => {
    if (txFilter === 'all') return true;
    if (txFilter === 'income') return tx.amount > 0;
    return tx.amount < 0;
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <BackButton />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">交易记录</h1>
        <span className="text-sm text-gray-400">共 {total} 条</span>
      </div>

      {/* 筛选 Tab */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
        {(['all', 'income', 'expense'] as const).map(f => (
          <button key={f} onClick={() => setTxFilter(f)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${txFilter === f ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {f === 'all' ? '全部' : f === 'income' ? '收入' : '支出'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border p-6">
        {loading ? (
          <p className="text-center text-gray-400 py-8 text-sm">加载中...</p>
        ) : loadError && txs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-red-500 text-sm mb-3">{loadError}</p>
            <button onClick={loadTxs} className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition">重试</button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">暂无记录</p>
        ) : (
          <div className="space-y-1">
            {filtered.slice((page - 1) * 20, page * 20).map((tx: any) => {
              const isPositive = tx.amount > 0;
              return (
                <div key={tx.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${isPositive ? 'bg-green-100' : 'bg-red-100'}`}>
                    {txIcon(tx.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      {typeLabels[tx.type] || tx.type}
                      {tx.type === 'transfer_out' && tx.description && (() => {
                        const displayName = tx.other_username || '#' + (tx.description.match(/to:(\d+)/)?.[1] || tx.description.match(/(?:转给用户|to:)\s*(\d+)/)?.[1] || '?');
                        const fee = parseInt(tx.description.match(/fee:(\d+)/)?.[1] || '0');
                        const transferAmt = Math.abs(tx.amount) - fee;
                        return <span className="text-gray-500 font-normal"> → {displayName} {transferAmt}分{fee > 0 ? `（手续费 ${fee}）` : ''}</span>;
                      })()}
                      {tx.type === 'transfer_in' && tx.description && (
                        <span className="text-gray-500 font-normal"> ← {tx.other_username || '#' + (tx.description.match(/from:(\d+)/)?.[1] || tx.description.match(/(?:来自用户|from:)\s*(\d+)/)?.[1] || '?')} {tx.amount}分</span>
                      )}
                      {tx.type === 'admin' && tx.description && (
                        <span className="text-gray-500 font-normal"> — {tx.description}</span>
                      )}
                      {tx.type === 'tip_out' && tx.description && (
                        <span className="text-gray-500 font-normal"> → {tx.other_username || '#' + (tx.description.match(/to:(\d+)/)?.[1] || '?')}</span>
                      )}
                      {tx.type === 'tip_in' && tx.description && (
                        <span className="text-gray-500 font-normal"> ← {tx.other_username || '#' + (tx.description.match(/from:(\d+)/)?.[1] || '?')}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">{formatDateTime(tx.created_at)}</p>
                  </div>
                  <span className={`font-medium text-sm ${tx.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {total > 20 && (
          <div className="flex justify-center items-center gap-2 mt-4">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3.5 py-1.5 min-h-[36px] border rounded text-sm disabled:opacity-50">上一页</button>
            <span className="px-3.5 py-1.5 text-sm text-gray-500">{page}/{Math.ceil(total / 20)}</span>
            <button onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(total / 20)} className="px-3.5 py-1.5 min-h-[36px] border rounded text-sm disabled:opacity-50">下一页</button>
          </div>
        )}
        {loadError && txs.length > 0 && (
          <p className="text-center text-[11px] text-amber-600 mt-3">{loadError}</p>
        )}
        {total > 15 && (
          <p className="text-center text-[11px] text-gray-400 mt-3">数据库仅保留最近 15 条，更早记录来自本机缓存</p>
        )}
      </div>
    </div>
  );
}
