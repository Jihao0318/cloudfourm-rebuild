import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { shop as shopApi, coins as coinsApi } from '../services/api';
import { useNavigate } from 'react-router-dom';
import ItemDetailModal from '../components/ItemDetailModal';

interface ShopItem {
  id: number;
  name: string;
  type: string;
  price: number;
  data: string;
}

// 单次购买数量上限（与后端 MAX_BUY_QUANTITY 一致）
const MAX_BUY_QUANTITY = 10;

// 在仓库中使用的道具类型（提示文案用）
const WAREHOUSE_TYPES = new Set([
  'item_red_packet', 'item_anonymous_card', 'item_pin_top', 'item_post_bg',
  'item_avatar_frame', 'item_rainbow_title', 'item_bump', 'item_highlight',
]);

export default function Shop() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<number>(0);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  // 正在购买的道具 id（防重入：仅锁住该商品自身的按钮，其它商品照常可买）
  const [buyingId, setBuyingId] = useState<number | null>(null);
  // 每个商品的购买数量（滑块 1..MAX_BUY_QUANTITY，默认 1 件）
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  // 查看详情的道具
  const [detailItem, setDetailItem] = useState<ShopItem | null>(null);
  // 底部浮出提示（购买成功，2 秒自动消失）
  const [bottomToast, setBottomToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [itemsRes, balRes] = await Promise.all([
        shopApi.items(),
        user ? coinsApi.balance() : Promise.resolve({ success: true, data: null }),
      ]);
      if (itemsRes.success && itemsRes.data) setItems(itemsRes.data);
      else setLoadError(itemsRes.error || '道具列表加载失败');
      if (balRes.success && balRes.data) setBalance(balRes.data.coins);
    } catch (err: any) {
      setLoadError(err.message || '道具列表加载失败');
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const showToast = (msg: string) => {
    setBottomToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setBottomToast(''), 2000);
  };

  const quantityOf = (id: number) => quantities[id] || 1;
  const setQuantity = (id: number, qty: number) => {
    const clamped = Math.min(MAX_BUY_QUANTITY, Math.max(1, Math.round(qty) || 1));
    setQuantities(prev => ({ ...prev, [id]: clamped }));
  };

  const buy = async (item: ShopItem) => {
    if (!user) { navigate('/login'); return; }
    if (buyingId === item.id) return; // 防重入：仅同一商品请求期间禁用其按钮
    const quantity = quantityOf(item.id);
    setError('');
    setBuyingId(item.id);
    try {
      const res = await shopApi.buy(item.id, quantity);
      if (res.success) {
        // 底部轻提示，可继续购买（道具可重复购买）
        showToast(`✅ 购买成功：${item.name}${quantity > 1 ? ` ×${quantity}` : ''}${WAREHOUSE_TYPES.has(item.type) ? '，已放入仓库' : ''}`);
        // 通知 Layout 刷新导航栏余额
        window.dispatchEvent(new Event('coins:changed'));
        // 刷新积分余额（购买后顶部余额实时更新）
        const balRes = await coinsApi.balance();
        if (balRes.success && balRes.data) setBalance(balRes.data.coins);
      } else {
        setError(res.error || '购买失败');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBuyingId(null);
    }
  };

  if (loading) return (
    <div className="max-w-3xl mx-auto py-6 animate-pulse">
      <div className="h-16 bg-gray-100 rounded-2xl mb-5" />
      <div className="h-8 w-32 bg-gray-100 rounded-lg mb-1" />
      <div className="h-4 w-48 bg-gray-100 rounded mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[1,2,3,4].map(i => (
          <div key={i} className="border rounded-2xl p-5">
            <div className="h-5 w-20 bg-gray-100 rounded mb-2" />
            <div className="h-4 w-32 bg-gray-100 rounded mb-3" />
            <div className="h-10 bg-gray-100 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );

  if (loadError && items.length === 0) return (
    <div className="max-w-3xl mx-auto py-6">
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-8 rounded-2xl text-center">
        <p className="text-sm mb-4">{loadError}</p>
        <button onClick={loadData} className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition">
          重试
        </button>
      </div>
    </div>
  );

  const parseData = (data: string | null | undefined): any => {
    if (typeof data !== 'string' || data === '') return {};
    try { return JSON.parse(data); } catch { return {}; }
  };

  return (
    <div className="max-w-3xl mx-auto py-6">
      {/* 实时积分 */}
      <div className="flex items-center justify-between bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900 dark:to-yellow-950 border border-amber-200 dark:border-amber-800 rounded-2xl px-5 py-3 mb-5">
        <div>
          <span className="text-sm text-gray-500 dark:text-gray-400">当前积分</span>
          <span className="text-2xl font-bold text-amber-700 dark:text-amber-300 ml-2">{balance} 🪙</span>
        </div>
        <button onClick={() => navigate('/warehouse')} className="text-sm text-primary-500 hover:underline">
          我的仓库 →
        </button>
      </div>

      <h1 className="text-2xl font-bold mb-1">积分商城</h1>
      <p className="text-gray-500 text-sm mb-6">使用积分购买各种道具</p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {items.map(item => {
          const data = parseData(item.data);
          const qty = quantityOf(item.id);
          return (
            <div key={item.id} className="border rounded-2xl p-5 transition-all duration-200 card-hover border-gray-200">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-lg">{item.name}</h3>
                  <p className="text-gray-500 text-sm">{data.description || (item.type === 'post_decoration' ? data.name : '')}</p>
                  {data.detail && (
                    <button onClick={() => setDetailItem(item)}
                      className="mt-1 text-xs text-primary-500 hover:underline">
                      查看详情 →
                    </button>
                  )}
                </div>
                <div className="bg-amber-50 text-amber-700 font-bold px-3 py-1 rounded-lg text-sm whitespace-nowrap">{item.price} 🪙 /件</div>
              </div>

              {/* 购买数量滑块（1..10，默认 1 件） */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>购买数量</span>
                  <span className="tabular-nums">
                    共 <span className="text-amber-700 font-bold">{item.price * qty} 🪙</span>
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={1}
                    max={MAX_BUY_QUANTITY}
                    step={1}
                    value={qty}
                    onChange={e => setQuantity(item.id, parseInt(e.target.value))}
                    aria-label={`${item.name} 购买数量`}
                    className="flex-1 h-1.5 cursor-pointer appearance-none rounded-full bg-gray-200 accent-primary-500"
                  />
                  <span className="w-8 text-center text-sm font-bold tabular-nums text-gray-700">{qty}</span>
                </div>
                <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
                  <span>1</span>
                  <span>{MAX_BUY_QUANTITY}（单次上限）</span>
                </div>
              </div>

              <button onClick={() => buy(item)} disabled={buyingId === item.id}
                className="w-full py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                {buyingId === item.id ? '购买中...' : `购买${qty > 1 ? ` ×${qty}` : ''}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* 购买后到仓库使用 */}
      <div className="mt-6 text-center">
        <p className="text-xs text-gray-400">购买后到 <button onClick={() => navigate('/warehouse')} className="text-primary-500 hover:underline">仓库</button> 使用道具</p>
      </div>

      {/* 底部浮出提示（购买成功，2 秒自动消失）— portal 到 body 避免被困 main z-10；
          bottom 用 calc 避让移动端底部导航（h-16 + safe-area） */}
      {bottomToast && createPortal(
        <div className="fixed bottom-[calc(4rem_+_env(safe-area-inset-bottom)_+_0.5rem)] md:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-900/95 text-white text-sm px-5 py-2.5 rounded-lg shadow-lg whitespace-nowrap">
          {bottomToast}
        </div>,
        document.body
      )}

      {/* 道具详情弹窗 */}
      <ItemDetailModal
        open={!!detailItem}
        name={detailItem?.name || ''}
        description={detailItem ? parseData(detailItem.data).description : undefined}
        detail={detailItem ? parseData(detailItem.data).detail : undefined}
        price={detailItem?.price}
        onClose={() => setDetailItem(null)}
      />
    </div>
  );
}
