import { useState, useEffect, useCallback } from 'react';
import { exchange, coins as coinsApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import BackButton from '../components/BackButton';

/**
 * 限时兑换商店：管理员配置限时上架的道具，用积分兑换。
 * 与商城的区别：限时/限量/限购，错过就要等下一期。
 */
export default function Exchange() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [offers, setOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await exchange.offers();
      if (res.success) setOffers(res.data || []);
      else setError(res.error || '加载失败');
      if (user) {
        const bal = await coinsApi.balance();
        if (bal.success && bal.data) setBalance(bal.data.coins);
      }
    } catch (err: any) {
      setError(err.message || '加载失败');
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { if (user) load(); }, [user, load]);

  const buy = async (id: number) => {
    setBuyingId(id);
    try {
      const res = await exchange.buy(id);
      if (res.success) {
        toast(res.message || '兑换成功，已放入仓库', 'success');
        window.dispatchEvent(new Event('coins:changed'));
        load();
      } else {
        toast(res.error || '兑换失败', 'error');
      }
    } catch (err: any) {
      toast(err.message || '兑换失败', 'error');
    }
    setBuyingId(null);
  };

  const fmtEnds = (ends: string | null) => {
    if (!ends) return '长期有效';
    const d = new Date(ends.replace(' ', 'T'));
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    return days > 0 ? `${days} 天后截止` : '即将截止';
  };

  return (
    <div className="max-w-3xl mx-auto py-6">
      <BackButton />
      <h1 className="text-2xl font-bold mb-1">限时兑换</h1>
      <p className="text-gray-500 text-sm mb-5">限时限量上架的道具，用积分直接兑换（兑换后放入仓库）</p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="text-gray-400 text-sm py-10 text-center">加载中…</div>
      ) : offers.length === 0 ? (
        <div className="bg-white border rounded-2xl py-16 text-center">
          <p className="text-3xl mb-3">⏳</p>
          <p className="text-gray-500 text-sm">本期没有上架的兑换道具</p>
          <p className="text-xs text-gray-400 mt-1">下一期开放时会在这里出现</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {offers.map(o => {
            const canBuy = (balance ?? 0) >= o.price && (o.per_user_limit <= 0 || o.my_count < o.per_user_limit) && (o.stock < 0 || o.stock > 0);
            return (
              <div key={o.id} className={`bg-white border rounded-2xl p-5 ${canBuy ? 'border-gray-200 hover:shadow-md' : 'border-gray-100 opacity-70'} transition`}>
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-base">{o.name}</h3>
                  <span className="bg-amber-50 text-amber-700 font-bold px-2.5 py-0.5 rounded-lg text-sm whitespace-nowrap">{o.price} 积分</span>
                </div>
                {o.description && <p className="text-gray-500 text-xs mb-3 leading-relaxed">{o.description}</p>}
                <div className="text-[11px] text-gray-400 space-y-0.5 mb-3">
                  {o.duration_days ? <p>· 有效期 {o.duration_days} 天</p> : null}
                  {o.stock >= 0 && <p>· 仅剩 {o.stock} 件</p>}
                  {o.per_user_limit > 0 && <p>· 每人限兑 {o.per_user_limit} 件{Number(o.my_count) > 0 ? `（已兑 ${o.my_count}）` : ''}</p>}
                  <p>· {fmtEnds(o.ends_at)}</p>
                </div>
                {canBuy ? (
                  <button onClick={() => setConfirmId(o.id)} disabled={buyingId === o.id}
                    className="w-full py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition">
                    {buyingId === o.id ? '兑换中…' : '立即兑换'}
                  </button>
                ) : o.per_user_limit > 0 && Number(o.my_count) >= o.per_user_limit ? (
                  <div className="w-full py-2 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">已达到限购数量</div>
                ) : o.stock >= 0 && o.stock <= 0 ? (
                  <div className="w-full py-2 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">已兑完</div>
                ) : (
                  <div className="w-full py-2 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
                    {balance !== null && balance < o.price ? '积分不足' : '暂时无法兑换'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 兑换确认弹窗 */}
      {confirmId !== null && (() => {
        const o = offers.find(x => x.id === confirmId);
        if (!o) return null;
        return (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmId(null)}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-base mb-2">确认兑换</h3>
              <p className="text-sm text-gray-600 mb-1">{o.name}</p>
              <p className="text-sm text-gray-500 mb-4">消耗 <strong className="text-amber-600">{o.price} 积分</strong>，兑换后放入仓库</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmId(null)} className="flex-1 py-2 border rounded-xl text-sm hover:bg-gray-50 transition">取消</button>
                <button onClick={() => { buy(o.id); setConfirmId(null); }} disabled={buyingId === o.id}
                  className="flex-1 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">确认兑换</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
