import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { coins as coinsApi, users as usersApi } from '../services/api';
import { formatDateTime } from '../utils/date';
import BackButton from '../components/BackButton';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShoppingBag, faBox, faCalendarAlt, faEdit, faComments, faHeart, faDice, faTrophy, faCoins } from '@fortawesome/free-solid-svg-icons';

export default function Coins() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<{ coins: number; total_earned: number; total_spent: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [todayEarnings, setTodayEarnings] = useState<{ today_total: number; daily_max: number; details: { type: string; amount: number; count: number }[] } | null>(null);

  // 转账状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: number; username: string; avatar_url: string }[]>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: number; username: string } | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferState, setTransferState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [transferResult, setTransferResult] = useState<{ name: string; amount: number; fee: number } | null>(null);

  // 费率（与后端一致）
  const feeRates: Record<string, number> = { vip: 10, 's-vip': 5, 'svip+': 2 };
  const myFeeRate = (user?.vip_tier && feeRates[user.vip_tier] !== undefined) ? feeRates[user.vip_tier] : 15;
  const feeLabel = `手续费 ${myFeeRate}%`;

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 恢复登录态，避免刷新时 user 短暂为 null 误踢
    if (!user) { navigate('/login'); return; }
    loadData();
  }, [authLoading, user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [balRes, earnRes] = await Promise.all([
        coinsApi.balance(),
        coinsApi.todayEarnings(),
      ]);
      if (balRes.success && balRes.data) setBalance(balRes.data);
      if (earnRes.success && earnRes.data) setTodayEarnings(earnRes.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // 合一搜索：支持 @用户名 / #用户ID / 普通用户名搜索
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      const isIdQuery = searchQuery.startsWith('#');
      const raw = searchQuery.replace(/^[@#]/, '').trim();
      if (!raw) { setSearchResults([]); return; }

      if (isIdQuery) {
        // #ID 模式：直接查 profile
        const id = parseInt(raw);
        if (!id || id < 1) { setSearchResults([]); return; }
        try {
          const profileRes = await usersApi.getProfile(id);
          if (profileRes.success && profileRes.data) {
            const u = profileRes.data;
            setSelectedUser({ id: u.id, username: u.username });
            setSearchQuery(`@${u.username}`);
            setSearchResults([]);
          } else {
            setSearchResults([]);
          }
        } catch { setSearchResults([]); }
        return;
      }

      try {
        const res = await usersApi.search(raw);
        if (res.success && res.data) setSearchResults(res.data.filter(u => u.id !== user?.id));
      } catch (e) { console.error(e); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, user?.id]);

  const handleSelectUser = (u: { id: number; username: string }) => {
    setSelectedUser(u);
    setSearchQuery(`@${u.username}`);
    setSearchResults([]);
  };

  const handleTransferClick = async () => {
    const targetUser = selectedUser;
    const amount = parseInt(transferAmount);
    if (!targetUser || !amount || amount < 1) { setMessage('请选择收款人并输入有效数量'); return; }
    const totalCost = amount + (myFeeRate > 0 ? Math.ceil(amount * myFeeRate / 100) : 0);
    if (totalCost > (balance?.coins || 0)) { setMessage('积分不足'); return; }
    setTransferState('sending');
    setMessage('');
    try {
      const res = await coinsApi.transfer(targetUser.id, amount);
      if (res.success) {
        setTransferResult({ name: targetUser.username, amount, fee: myFeeRate > 0 ? Math.ceil(amount * myFeeRate / 100) : 0 });
        setTransferState('done');
        // 成功后只清金额，保留收钱人以便再次转账
        setTransferAmount('');
        // 通知 Layout 刷新导航栏余额
        window.dispatchEvent(new Event('coins:changed'));
        loadData();
      } else {
        setMessage(res.error || '转账失败');
        setTransferState('idle');
      }
    } catch (err: any) {
      setMessage(err.message);
      setTransferState('idle');
    }
  };

  if (!user) return null;

  // 加载中显示骨架，避免余额先闪 0 再跳变
  if (loading) return (
    <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
      <BackButton />
      <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
        <div className="h-8 w-32 bg-white/30 rounded-lg mb-2" />
        <div className="h-10 w-44 bg-white/30 rounded-lg" />
      </div>
      <div className="bg-white rounded-2xl border p-6">
        <div className="h-5 w-32 bg-gray-100 rounded mb-3" />
        <div className="h-20 bg-gray-100 rounded" />
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <BackButton />

      {message && (
        <div className={`px-4 py-2 rounded-xl text-sm border ${message.includes('成功') || message.includes('已') ? 'bg-green-50 text-green-600 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
          {message}
          <button onClick={() => setMessage('')} className="ml-2 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* 余额卡片 */}
      <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <p className="text-sm opacity-80">当前积分</p>
            <p className="text-3xl sm:text-4xl font-bold mt-1 break-all">{(balance?.coins || 0).toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-sm opacity-80">我的 ID</p>
            <p className="text-2xl font-mono font-bold mt-1 select-all cursor-pointer" title="点击复制"
              onClick={() => { navigator.clipboard.writeText(String(user?.id)); }}>
              #{user?.id}
            </p>
          </div>
        </div>
        <div className="flex gap-4 text-xs opacity-80 flex-wrap">
          <span>累计获得 {(balance?.total_earned || 0).toLocaleString()}</span>
          <span>累计消费 {(balance?.total_spent || 0).toLocaleString()}</span>
        </div>
        <div className="mt-3 text-xs opacity-70 bg-white/15 rounded-lg px-3 py-1.5 inline-block whitespace-nowrap">
          {feeLabel}
          <span className="mx-1.5 opacity-40">|</span>
          <Link to="/vip" className="underline opacity-80 hover:opacity-100">VIP 费率更低 →</Link>
        </div>
      </div>

      {/* 交易记录入口 — 独立页面查看 */}
      <Link to="/transactions" className="bg-white rounded-2xl border p-5 flex items-center gap-4 hover:border-primary-300 hover:shadow-sm transition group">
        <div className="w-11 h-11 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center text-lg shrink-0">
          <FontAwesomeIcon icon={faCoins} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 group-hover:text-primary-600 transition">交易记录</p>
          <p className="text-xs text-gray-400 mt-0.5">收支明细、积分流向一目了然</p>
        </div>
        <span className="text-gray-300 group-hover:text-primary-500 transition text-lg">→</span>
      </Link>

      {/* 我的红包入口 — 独立页面实时管理进行中的红包 */}
      <Link to="/red-packets" className="bg-white rounded-2xl border p-5 flex items-center gap-4 hover:border-red-300 hover:shadow-sm transition group">
        <div className="w-11 h-11 rounded-xl bg-red-50 text-red-500 flex items-center justify-center text-lg shrink-0">
          <span>🧧</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 group-hover:text-red-500 transition">我的红包</p>
          <p className="text-xs text-gray-400 mt-0.5">实时查看剩余金额，可随时取消退款</p>
        </div>
        <span className="text-gray-300 group-hover:text-red-400 transition text-lg">→</span>
      </Link>

      {/* 今日收入概况（合并进度条 + 获取方式） */}
      <div className="bg-white rounded-2xl border p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900">今日收入概况</h3>
          {todayEarnings && (
            <span className="text-sm text-gray-500">
              已赚 <strong className={todayEarnings.today_total >= todayEarnings.daily_max ? 'text-green-600' : 'text-primary-600'}>
                {todayEarnings.today_total}
              </strong> / {todayEarnings.daily_max} 分
            </span>
          )}
        </div>

        {/* 进度条 */}
        {todayEarnings ? (
          <>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-1">
              <div className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (todayEarnings.today_total / todayEarnings.daily_max) * 100)}%` }} />
            </div>
            <p className="text-xs text-gray-400 mb-4">
              {todayEarnings.today_total >= todayEarnings.daily_max
                ? '今日收入已达上限！'
                : `还可赚 ${todayEarnings.daily_max - todayEarnings.today_total} 分`}
            </p>
          </>
        ) : (
          <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-4 animate-pulse" />
        )}

        {/* 各项收入明细 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {[
            { type: 'check_in', label: '每日签到', icon: '📅', range: '+1~20（7 天阶梯）' },
            { type: 'post', label: '发布帖子', icon: '📝', range: '+10' },
            { type: 'comment', label: '发表评论', icon: '💬', range: '+3' },
            { type: 'liked', label: '内容被点赞', icon: '❤️', range: '+2' },
          ].map(item => {
            const detail = todayEarnings?.details.find(d => d.type === item.type);
            return (
              <div key={item.type} className={`rounded-xl p-3 text-center transition ${detail ? 'bg-green-50 border border-green-100' : 'bg-gray-50'}`}>
                <div className="text-lg mb-0.5">{item.icon}</div>
                <div className="text-gray-700 text-xs font-medium">{item.label}</div>
                <div className="text-xs mt-0.5">
                  {detail ? (
                    <span className="text-green-600 font-medium">+{detail.amount}</span>
                  ) : (
                    <span className="text-gray-400">{item.range}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 积分相关功能入口 */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <button onClick={() => navigate('/shop')} className="bg-white border border-gray-200 rounded-2xl p-3.5 sm:p-4 text-center hover:border-primary-300 hover:shadow-sm transition">
          <div className="text-xl sm:text-2xl mb-1"><FontAwesomeIcon icon={faShoppingBag} /></div>
          <div className="text-sm font-medium text-gray-700">积分商城</div>
          <div className="text-xs text-gray-400">购买道具</div>
        </button>
        <button onClick={() => navigate('/warehouse')} className="bg-white border border-gray-200 rounded-2xl p-3.5 sm:p-4 text-center hover:border-primary-300 hover:shadow-sm transition">
          <div className="text-xl sm:text-2xl mb-1"><FontAwesomeIcon icon={faBox} /></div>
          <div className="text-sm font-medium text-gray-700">我的仓库</div>
          <div className="text-xs text-gray-400">管理物品</div>
        </button>
        <button onClick={() => navigate('/lottery')} className="bg-white border border-gray-200 rounded-2xl p-3.5 sm:p-4 text-center hover:border-primary-300 hover:shadow-sm transition">
          <div className="text-xl sm:text-2xl mb-1"><FontAwesomeIcon icon={faDice} /></div>
          <div className="text-sm font-medium text-gray-700">积分抽奖</div>
          <div className="text-xs text-gray-400">试试手气</div>
        </button>
        <button onClick={() => navigate('/leaderboard')} className="bg-white border border-gray-200 rounded-2xl p-3.5 sm:p-4 text-center hover:border-primary-300 hover:shadow-sm transition">
          <div className="text-xl sm:text-2xl mb-1"><FontAwesomeIcon icon={faTrophy} /></div>
          <div className="text-sm font-medium text-gray-700">积分排行</div>
          <div className="text-xs text-gray-400">TOP 50</div>
        </button>
        <button onClick={() => navigate('/active-effects')} className="bg-white border border-gray-200 rounded-2xl p-3.5 sm:p-4 text-center hover:border-primary-300 hover:shadow-sm transition">
          <div className="text-xl sm:text-2xl mb-1">⏳</div>
          <div className="text-sm font-medium text-gray-700">活跃效果</div>
          <div className="text-xs text-gray-400">倒计时管理</div>
        </button>
      </div>

      {/* 转账 */}
      <div className="bg-white rounded-2xl border p-4 sm:p-6">
        <h3 className="font-bold text-gray-900 mb-3">转账积分</h3>
        <div className="space-y-3">
          {/* 可用余额 */}
          <div className="text-xs text-gray-500">
            可用余额: <span className="font-semibold text-gray-800">{balance?.coins?.toLocaleString() || 0}</span> 分
          </div>

          {/* 合一输入：@用户名 / #ID / 名字搜索 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">收款人</label>
            <div className="relative">
              {selectedUser ? (
                <div className="flex items-center gap-2 px-3 py-2 border rounded-xl bg-gray-50">
                  <span className="text-sm">👤</span>
                  <span className="font-medium text-sm">{selectedUser.username}</span>
                  <span className="text-xs text-gray-400">#{selectedUser.id}</span>
                  <button onClick={() => { setSelectedUser(null); setSearchQuery(''); setTransferState('idle'); }}
                    className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>
              ) : (
                <>
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="@用户名 / #用户ID / 搜索..."
                    className="w-full px-3 py-2 border rounded-xl text-sm outline-none focus:border-primary-500" />
                  {searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto">
                      {searchResults.map(u => (
                        <button key={u.id} onClick={() => handleSelectUser(u)}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 border-b last:border-0">
                          <span className="font-medium">{u.username}</span>
                          <span className="text-gray-400">#{u.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 金额 + 快捷按钮 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">数量</label>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {[10, 50, 100, 200].map(v => (
                <button key={v} onClick={() => setTransferAmount(String(v))}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    transferAmount === String(v) ? 'bg-primary-100 text-primary-700 border border-primary-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
                  }`}>
                  {v}
                </button>
              ))}
            </div>
            <input type="number" min={1} max={balance?.coins || 0} value={transferAmount}
              onChange={e => setTransferAmount(e.target.value)}
              placeholder="输入积分数量"
              className="w-full px-3 py-2 border rounded-xl text-sm outline-none focus:border-primary-500" />
          </div>

          {/* 费率预览 */}
          {selectedUser && transferAmount && parseInt(transferAmount) > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between text-gray-600">
                <span>对方收到</span>
                <span className="font-medium">{parseInt(transferAmount)} 积分</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>手续费 ({myFeeRate}%)</span>
                <span>{myFeeRate > 0 ? `${Math.ceil(parseInt(transferAmount) * myFeeRate / 100)} 积分` : '免手续费'}</span>
              </div>
              <div className="flex justify-between text-gray-800 font-medium border-t pt-1 text-red-600">
                <span>你需支付</span>
                <span>{parseInt(transferAmount) + (myFeeRate > 0 ? Math.ceil(parseInt(transferAmount) * myFeeRate / 100) : 0)} 积分</span>
              </div>
            </div>
          )}

          {/* 状态区：转账按钮 / 成功提示 */}
          {transferState === 'done' && transferResult ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <div className="text-2xl mb-1">✅</div>
              <p className="text-sm text-green-700 font-medium">转账成功！</p>
              <p className="text-xs text-green-600 mt-1">
                已向 <strong>{transferResult.name}</strong> 转账 {transferResult.amount} 积分
                {transferResult.fee > 0 ? `（手续费 ${transferResult.fee}）` : ''}
              </p>
              <button onClick={() => { setTransferState('idle'); setTransferResult(null); }}
                className="mt-3 px-4 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
                继续转账
              </button>
            </div>
          ) : (
            (() => {
              const amt = parseInt(transferAmount);
              const totalCost = amt + (myFeeRate > 0 ? Math.ceil(amt * myFeeRate / 100) : 0);
              const canTransfer = selectedUser && amt > 0 && totalCost <= (balance?.coins || 0);
              return (
                <button onClick={handleTransferClick}
                  disabled={!canTransfer || transferState === 'sending'}
                  className={`w-full py-2.5 rounded-xl text-sm font-medium transition ${
                    !canTransfer
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-primary-600 text-white hover:bg-primary-700'
                  }`}>
                  {transferState === 'sending' ? '转账中...'
                    : selectedUser && amt > 0
                      ? `向 ${selectedUser.username} 转账 ${amt} 分`
                      : !selectedUser ? '请选择收款人' : amt <= 0 ? '请输入金额'
                      : '余额不足'}
                </button>
              );
            })()
          )}
        </div>
      </div>

      {/* 费率标签 */}
      <div className="text-center text-xs text-gray-400">
        {feeLabel} · <Link to="/vip" className="text-primary-500 hover:underline">升级 VIP 降费率</Link>
      </div>
    </div>
  );
}