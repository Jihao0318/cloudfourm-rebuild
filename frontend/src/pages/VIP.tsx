import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { vip as vipApi, coins as coinsApi } from '../services/api';
import type { VipPlan } from '../services/api';
import { formatDateTime } from '../utils/date';

import ConfirmModal from '../components/ConfirmModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCrown } from '@fortawesome/free-solid-svg-icons';
import { faStar } from '@fortawesome/free-solid-svg-icons';
import { faGem } from '@fortawesome/free-solid-svg-icons';
import BackButton from '../components/BackButton';

const TIER_ORDER = ['none', 'vip', 's-vip', 'svip+'];

// 套餐天数：/vip/plans 接口未返回该字段，与后端 vip.ts daysMap 保持一致
const PLAN_DAYS: Record<string, number> = { vip: 30, 's-vip': 90, 'svip+': 365 };
const PLAN_BG: Record<string, string> = { vip: 'bg-amber-400', 's-vip': 'bg-purple-500', 'svip+': 'bg-red-500' };

const tierIcon = (tier: string) =>
  tier === 'vip' ? <FontAwesomeIcon icon={faCrown} />
  : tier === 's-vip' ? <FontAwesomeIcon icon={faStar} />
  : <FontAwesomeIcon icon={faGem} />;

export default function VIP() {
  const { user, refreshUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [vipStatus, setVipStatus] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [plans, setPlans] = useState<VipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [purchasing, setPurchasing] = useState(false);
  const [confirmTier, setConfirmTier] = useState<{ tier: string; price: number; label: string } | null>(null);

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 恢复登录态，避免刷新时 user 短暂为 null 误踢
    if (!user) { navigate('/login'); return; }
    loadData();
  }, [authLoading, user]);

  const loadData = async () => {
    setLoading(true);
    try {
      // 价格以 /vip/plans 返回为准（后端实扣 300/800/2800，勿硬编码）
      const [planList, vipRes, coinRes] = await Promise.all([vipApi.plans(), vipApi.status(), coinsApi.balance()]);
      if (planList.success && planList.data && planList.data.length > 0) setPlans(planList.data);
      if (vipRes.success) setVipStatus(vipRes.data);
      if (coinRes.success) setBalance(coinRes.data?.coins || 0);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handlePurchase = async (tier: string, price: number) => {
    if (balance < price) { setMessage(`积分不足，需要 ${price} 积分`); return; }
    setPurchasing(true);
    try {
      const res = await vipApi.purchase(tier);
      if (res.success) {
        setMessage(res.message || '购买成功');
        // 余额已变：通知 Layout 刷新导航栏余额，并刷新用户 VIP 状态
        window.dispatchEvent(new Event('coins:changed'));
        refreshUser?.();
        loadData();
      }
      else setMessage(res.error || '购买失败');
    } catch (err: any) { setMessage(err.message); }
    setPurchasing(false);
  };

  if (!user) return null;

  // 加载中骨架（避免按钮先闪「积分不足」）
  if (loading) return (
    <div className="max-w-3xl mx-auto space-y-6">
      <BackButton />
      <div className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
      <div className="grid md:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-2xl border p-6 animate-pulse">
            <div className="h-9 w-9 bg-gray-100 rounded-lg mb-3" />
            <div className="h-5 w-20 bg-gray-100 rounded mb-2" />
            <div className="h-8 w-28 bg-gray-100 rounded mb-3" />
            <div className="h-4 w-24 bg-gray-100 rounded mb-2" />
            <div className="h-4 w-32 bg-gray-100 rounded mb-4" />
            <div className="h-10 bg-gray-100 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );

  if (plans.length === 0) return (
    <div className="max-w-3xl mx-auto space-y-6">
      <BackButton />
      <div className="bg-white rounded-2xl border p-10 text-center">
        <p className="text-red-500 text-sm mb-4">套餐信息加载失败，请稍后重试</p>
        <button onClick={loadData} className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">重试</button>
      </div>
    </div>
  );

  const currentTier = vipStatus?.tier || 'none';
  const currentIdx = TIER_ORDER.indexOf(currentTier);
  const isVipActive = vipStatus?.is_vip;

  const tierLabel = vipStatus?.label || '';

  // 套餐功能文案（签到加成/转账费率取后端 plans 实际值：加成 2/3/5、费率 10%/5%/2%）
  const planFeatures = (plan: VipPlan): string[] => {
    const bonus = plan.check_in_bonus ?? 0;
    const fee = plan.transfer_fee ?? 15;
    if (plan.tier === 'vip') return ['VIP 徽章', '自定义头衔', `签到加成 +${bonus}`, `转账费率 ${fee}%`];
    if (plan.tier === 's-vip') return ['VIP 权益', '金色昵称', `签到加成 +${bonus}`, `转账费率 ${fee}%`, '专属评论框'];
    return ['S VIP 权益', '红金昵称', `签到加成 +${bonus}`, `转账费率 ${fee}%`, '发帖特殊标识'];
  };
  const planByTier = (tier: string) => plans.find(p => p.tier === tier);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 购买确认弹窗 */}
      <ConfirmModal
        open={!!confirmTier}
        title={`购买 ${confirmTier?.label || ''}`}
        message={`确定购买 ${confirmTier?.label || ''}？将消耗 ${confirmTier?.price || 0} 积分。`}
        confirmText={`消耗 ${confirmTier?.price || 0} 积分`}
        loading={purchasing}
        onConfirm={() => {
          if (!confirmTier) return;
          const t = confirmTier;
          setConfirmTier(null);
          handlePurchase(t.tier, t.price);
        }}
        onCancel={() => setConfirmTier(null)}
      />
      <BackButton />

      {message && (
        <div className={`px-4 py-3 rounded-xl text-sm border ${message.includes('成功') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
          {message}
        </div>
      )}

      {vipStatus?.is_vip && (
        <div className={`${PLAN_BG[vipStatus.tier] || 'bg-yellow-500'} rounded-2xl p-6 text-white`}>
          <div className="flex items-center gap-3">
            <span className="text-4xl">{tierIcon(vipStatus.tier)}</span>
            <div>
              <h2 className="text-xl font-bold">{tierLabel} 会员</h2>
              <p className="text-sm opacity-80">到期：{vipStatus.expires_at ? formatDateTime(vipStatus.expires_at) : '永久'}</p>
            </div>
          </div>
          <p className="text-xs opacity-70 mt-3">积分余额：<strong>{balance}</strong></p>
        </div>
      )}

      {/* 套餐卡片 */}
      <div className="grid md:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const planIdx = TIER_ORDER.indexOf(plan.tier);
          const isCurrent = vipStatus?.tier === plan.tier && !vipStatus?.expired;
          const isLowerTier = isVipActive && planIdx < currentIdx; // 已拥有更高级别
          const isUpgrade = isVipActive && planIdx > currentIdx; // 可升级到更高等级
          const currentTierPrice = isVipActive ? (plans.find(p => p.tier === vipStatus?.tier)?.price || 0) : 0;
          const displayPrice = isUpgrade ? plan.price - currentTierPrice : plan.price;

          // 判断按钮状态
          let btnText = '立即购买';
          let disabled = purchasing || balance < displayPrice;
          let btnBg = PLAN_BG[plan.tier] || 'bg-gray-500';

          if (isCurrent) {
            btnText = '当前会员';
            disabled = true;
          } else if (isLowerTier) {
            btnText = '已拥有更高等级';
            disabled = true;
            btnBg = 'bg-gray-300';
          } else if (balance < displayPrice) {
            btnText = '积分不足';
          }

          const isBest = plan.tier === 'svip+';
          return (
            <div key={plan.tier} className={`bg-white rounded-2xl border p-6 flex flex-col relative overflow-hidden transition-all duration-200 ${isCurrent ? 'ring-2 ring-primary-500 shadow-lg shadow-primary-100 scale-[1.02]' : isBest ? 'border-yellow-300 hover:shadow-lg' : 'hover:shadow-md'}`}>
              {isBest && !isCurrent && (
                <div className="absolute top-0 right-0 bg-gradient-to-l from-yellow-400 to-amber-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl">推荐</div>
              )}
              {isCurrent && (
                <div className="absolute top-3 right-3 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg">当前会员</div>
              )}
              <div className="text-3xl mb-2">{tierIcon(plan.tier)}</div>
              <h3 className="text-lg font-bold text-gray-900">{plan.label}</h3>
              <p className="text-2xl font-bold mt-1">
                {isUpgrade ? <><span className="text-sm text-gray-400 line-through mr-1">{plan.price}</span>{displayPrice}</> : displayPrice}
                <span className="text-sm text-gray-400 font-normal"> 积分</span>
              </p>
              {isUpgrade && <p className="text-xs text-green-600 font-medium">升级补差价 {displayPrice} 积分</p>}
              <p className="text-xs text-gray-400 mb-3">{PLAN_DAYS[plan.tier] || 30} 天</p>
              <ul className="space-y-1 flex-1 mb-4 text-sm">
                {planFeatures(plan).map(f => <li key={f} className="text-gray-600 flex items-center gap-1">✓ {f}</li>)}
              </ul>
              {isCurrent ? (
                <div className="w-full py-2 rounded-xl text-sm text-center bg-green-50 text-green-700 font-medium border border-green-200">当前会员</div>
              ) : (
                <button onClick={() => setConfirmTier({ tier: plan.tier, price: displayPrice, label: plan.label })} disabled={disabled}
                  className={`w-full py-2 rounded-xl text-sm font-medium transition disabled:opacity-50 text-white ${btnBg} hover:opacity-90`}>
                  {purchasing ? '处理中...' : btnText}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 权益对比表 */}
      <div className="bg-white rounded-2xl border p-6">
        <h3 className="font-bold text-gray-900 mb-4">权益对比</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b">
              <th className="text-left py-2 font-medium text-gray-500 sticky left-0 bg-white dark:bg-[#111] z-10">权益</th>
              <th className="text-center py-2 font-medium"><FontAwesomeIcon icon={faCrown} /> VIP</th>
              <th className="text-center py-2 font-medium"><FontAwesomeIcon icon={faStar} /> S VIP</th>
              <th className="text-center py-2 font-medium"><FontAwesomeIcon icon={faGem} /> S VIP+</th>
            </tr></thead>
            <tbody>
              <tr className="border-b"><td className="py-2 text-gray-700 sticky left-0 bg-white dark:bg-[#111] z-10">VIP 徽章</td><td className="text-center">✅</td><td className="text-center">✅</td><td className="text-center">✅</td></tr>
              <tr className="border-b"><td className="py-2 text-gray-700 sticky left-0 bg-white dark:bg-[#111] z-10">自定义头衔</td><td className="text-center">✅</td><td className="text-center">✅</td><td className="text-center">✅</td></tr>
              <tr className="border-b"><td className="py-2 text-gray-700 sticky left-0 bg-white dark:bg-[#111] z-10">昵称颜色</td><td className="text-center text-gray-400">灰色</td><td className="text-center text-yellow-600 font-medium">金色</td><td className="text-center text-orange-600 font-medium">红金</td></tr>
              <tr className="border-b"><td className="py-2 text-gray-700 sticky left-0 bg-white dark:bg-[#111] z-10">签到加成</td><td className="text-center">+{planByTier('vip')?.check_in_bonus ?? 0}</td><td className="text-center">+{planByTier('s-vip')?.check_in_bonus ?? 0}</td><td className="text-center">+{planByTier('svip+')?.check_in_bonus ?? 0}</td></tr>
              <tr className="border-b"><td className="py-2 text-gray-700 sticky left-0 bg-white dark:bg-[#111] z-10">专属评论框</td><td className="text-center">—</td><td className="text-center">✅</td><td className="text-center">✅</td></tr>
              <tr className="border-b"><td className="py-2 text-gray-700 sticky left-0 bg-white dark:bg-[#111] z-10">发帖标识</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✅</td></tr>
              <tr><td className="py-2 text-gray-700 sticky left-0 bg-white dark:bg-[#111] z-10">转账费率</td><td className="text-center">{planByTier('vip')?.transfer_fee ?? 15}%</td><td className="text-center">{planByTier('s-vip')?.transfer_fee ?? 15}%</td><td className="text-center">{planByTier('svip+')?.transfer_fee ?? 15}%</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
