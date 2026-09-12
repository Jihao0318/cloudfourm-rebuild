import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { lotteryCoins as lotteryApi, type LotteryStatus, type LotteryDrawResult } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCoins, faDice, faGem, faCrown, faRocket, faMagic, faStar, faGift, faTrophy, faBolt } from '@fortawesome/free-solid-svg-icons';

// ─── 稀有度视觉体系 ───
const RARITY = {
  N:    { label: '普通', color: '#9CA3AF', ring: 'ring-gray-300',   bg: 'from-gray-50 to-gray-100',       glow: '' },
  R:    { label: '高级', color: '#3B82F6', ring: 'ring-blue-400',   bg: 'from-blue-50 to-blue-100',       glow: 'shadow-[0_0_14px_rgba(59,130,246,0.35)]' },
  SR:   { label: '稀有', color: '#A855F7', ring: 'ring-purple-400', bg: 'from-purple-50 to-purple-100',   glow: 'shadow-[0_0_18px_rgba(168,85,247,0.45)]' },
  SSR:  { label: '传说', color: '#F59E0B', ring: 'ring-amber-400',  bg: 'from-yellow-50 to-amber-100',    glow: 'shadow-[0_0_24px_rgba(245,158,11,0.55)]' },
} as const;

const ICON_MAP: Record<string, any> = {
  '🪙': faCoins, '💰': faCoins, '💎': faGem, '👑': faCrown,
  '🃏': faDice, '🚀': faRocket, '✨': faMagic, '🔮': faStar,
  '⭐': faStar, '🌟': faStar, '🖼️': faGift, '🏅': faTrophy,
  '🌈': faMagic, '📢': faBolt,
};

export default function LotteryCoins() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<LotteryStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  // 九宫格灯效
  const [lightIdx, setLightIdx] = useState(-1);
  // 灯效停格冻结：停格格显示实际中奖奖品（奖池可能大于 9 格，保证停格与结果一致）
  const [lightFrozen, setLightFrozen] = useState(false);
  const lightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 十连结果（翻牌弹窗）
  const [tenData, setTenData] = useState<LotteryDrawResult | null>(null);
  // 结果
  const [result, setResult] = useState<LotteryDrawResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (lightTimerRef.current) clearTimeout(lightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 加载完成，避免刷新时误踢登录
    if (!user) { navigate('/login'); return; }
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, navigate]);

  const loadStatus = async () => {
    setLoadingStatus(true);
    setStatusError('');
    try {
      const res = await lotteryApi.status();
      if (!mountedRef.current) return;
      if (res.success && res.data) setStatus(res.data);
      else setStatusError(res.error || '加载失败');
    } catch (err: any) {
      if (mountedRef.current) setStatusError(err.message || '网络错误');
    }
    if (mountedRef.current) setLoadingStatus(false);
  };

  const prizes = status?.prizes || [];
  // 九宫格展示：按稀有度精选代表（SSR/SR/R/N 各取前 2），呈现奖池全貌
  // 停格时格子会切换为实际中奖奖品，与展示内容无关（保证停格与结果一致）
  const gridPrizes = (() => {
    const order = ['SSR', 'SR', 'R', 'N'] as const;
    const picked: typeof prizes = [];
    for (const r of order) {
      picked.push(...prizes.filter(p => p.rarity === r).slice(0, 2));
    }
    return picked.slice(0, 8);
  })();

  // 灯效轮播：加速→减速，停在目标格；停格后冻结显示中奖奖品，稍后弹窗（期间不刷新余额）
  const runLight = (targetIdx: number, onDone: () => void) => {
    const total = gridPrizes.length || 1;
    const t = targetIdx % total;
    const spins = 2 + Math.floor(Math.random() * 2);
    const steps = spins * total + t;
    let i = 0;
    const tick = () => {
      setLightIdx(i % total);
      i++;
      if (i > steps) {
        // 停格：该格显示实际中奖奖品（与结果一致），短暂停顿后弹窗
        setTimeout(() => {
          if (!mountedRef.current) return;
          setLightFrozen(true);
          setTimeout(() => {
            if (!mountedRef.current) return;
            setShowResult(true);
            onDone();
          }, 700);
        }, 200);
        return;
      }
      const progress = i / steps;
      const delay = 70 + progress * progress * 260; // 加速后减速
      lightTimerRef.current = setTimeout(tick, delay);
    };
    tick();
  };

  // 抽奖动画揭示完成后统一刷新余额/状态（点击瞬间到动画结束前不更新，保持未知性）
  const refreshAfterReveal = () => {
    loadStatus();
    window.dispatchEvent(new Event('coins:changed'));
  };

  // 单抽
  const doDraw = async () => {
    if (drawing) return;
    setDrawing(true);
    setResult(null);
    setShowResult(false);
    setLightIdx(-1);
    setLightFrozen(false);
    setTenData(null);
    try {
      const res = await lotteryApi.draw();
      if (res.success && res.data) {
        const data = res.data;
        setResult(data);
        if (mode === 'single') {
          // 停格对齐中奖等级：如抽到 R 级 → 转盘停在 R 代表格（gridPrizes 按稀有度精选，等级必存在）
          const targetRarity = data.items[0]?.rarity || 'N';
          const idx = gridPrizes.findIndex(p => p.rarity === targetRarity);
          // drawing 保持到灯效+弹窗出现才解除（防灯效期间重复点击并行轮播导致弹窗卡住）
          runLight(idx >= 0 ? idx : 0, () => { refreshAfterReveal(); setDrawing(false); });
        } else {
          setShowResult(true);
          setDrawing(false);
        }
        return;
      }
    } catch (err: any) {
      toast(err.message || '抽奖失败', 'error');
    }
    setDrawing(false);
  };

  // 十连：拉取结果后直接弹「3D 翻牌」弹窗（TenPullResult 内部逐张翻转 + 汇总）
  const doDraw10 = async () => {
    if (drawing) return;
    setDrawing(true);
    setResult(null);
    setShowResult(false);
    setLightIdx(-1);
    setLightFrozen(false);
    setTenData(null);
    try {
      const res = await lotteryApi.draw10();
      if (res.success && res.data) {
        setTenData(res.data); // 触发翻牌弹窗
        refreshAfterReveal(); // 立即刷新余额（翻牌动画期间无需等待）
      }
    } catch (err: any) {
      toast(err.message || '抽奖失败', 'error');
    }
    setDrawing(false);
  };

  const closeResult = () => {
    setShowResult(false);
    setResult(null);
    setLightIdx(-1);
    setLightFrozen(false);
  };

  // 关闭十连翻牌弹窗
  const closeTen = () => {
    setTenData(null);
    setLightIdx(-1);
    setLightFrozen(false);
  };

  const canDraw = !!status && status.balance >= status.draw_cost;
  const canDraw10 = !!status && status.balance >= status.draw10_cost;
  const pity = status?.pity;

  if (statusError && !status) {
    return (
      <div className="max-w-3xl mx-auto py-6">
        <div className="text-center py-16">
          <p className="text-red-500 text-sm mb-3">{statusError}</p>
          <button onClick={loadStatus} disabled={loadingStatus}
            className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition">
            {loadingStatus ? '加载中...' : '重新加载'}
          </button>
        </div>
      </div>
    );
  }

  if (loadingStatus && !status) {
    return (
      <div className="max-w-3xl mx-auto py-6">
        <div className="text-center py-16">
          <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-5">
      {/* ═══ Hero 区：深色紫金渐变 ═══ */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-purple-900 to-fuchsia-900 text-white p-6 md:p-8 shadow-2xl shadow-purple-900/30">
        {/* 装饰光斑 */}
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-amber-400/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-64 h-64 rounded-full bg-fuchsia-500/20 blur-3xl pointer-events-none" />
        <div className="absolute top-4 right-8 text-7xl opacity-10 select-none pointer-events-none">🎰</div>

        <div className="relative">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold tracking-widest mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            积分抽奖
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-wide">
            一发入魂，欧气满满<span className="text-amber-300">✨</span>
          </h1>
          <p className="text-purple-200/80 text-sm mt-1.5">消耗积分，赢取稀有道具与大奖 · 十连 9 折</p>

          {/* 数据行：flex-wrap 防 375px 溢出，gap-x/gap-y 分开控制换行间距 */}
          <div className="flex items-end flex-wrap gap-x-6 gap-y-3 md:gap-x-10 mt-6">
            <div>
              <div className="text-[11px] text-purple-200/70 mb-0.5">我的积分</div>
              <div className="text-2xl sm:text-3xl font-black text-amber-300 flex items-center gap-1.5">
                <FontAwesomeIcon icon={faCoins} className="text-2xl" />
                {status?.balance.toLocaleString() ?? '--'}
              </div>
            </div>
            <div className="h-10 w-px bg-white/15" />
            <div>
              <div className="text-[11px] text-purple-200/70 mb-0.5">单抽</div>
              <div className="text-xl font-bold">{status?.draw_cost ?? '--'}<span className="text-xs text-purple-200/70 ml-1">分</span></div>
            </div>
            <div>
              <div className="text-[11px] text-purple-200/70 mb-0.5">十连 <span className="text-amber-300/80">9折</span></div>
              <div className="text-xl font-bold">{status?.draw10_cost ?? '--'}<span className="text-xs text-purple-200/70 ml-1">分</span></div>
            </div>
            {pity && (
              <div className="ml-auto text-right">
                <div className="text-[11px] text-purple-200/70 mb-0.5">当前 SSR 概率</div>
                <div className="text-xl font-bold text-amber-300">{pity.ssr_chance}%</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ 抽奖机：左转盘 + 右操作区（模式切换/圆形按钮/保底进度垂直居中，填满右侧） ═══ */}
      <div className="bg-white dark:bg-[#111] border rounded-3xl p-4 md:p-5">
        <div className="flex flex-col md:flex-row items-center md:items-center gap-4 md:gap-8">
          {/* 左：九宫格转盘（纯展示；停格时落在与中奖同等级的格子上） */}
          <div className="grid grid-cols-3 gap-2 max-w-[264px] w-full shrink-0 mx-auto md:mx-0">
            {gridPrizes.map((p, i) => {
              const lit = lightIdx === i;
              // 停格冻结：单抽显示中奖奖品（十连已改为翻牌弹窗，不走灯效停格）
              const frozenWin = lit && lightFrozen && mode === 'single'
                ? result?.items[0]
                : null;
              const rc = RARITY[p.rarity as keyof typeof RARITY] || RARITY.N;
              const winRc = frozenWin ? (RARITY[frozenWin.rarity as keyof typeof RARITY] || RARITY.N) : null;
              // 性能：未点亮格仅过渡 transform（transition-all 会为阴影/ring 也建过渡负担）；
              // 点亮格加 will-change: transform 预建合成层，灯效轮播更顺
              return (
                <div key={p.id}
                  className={`relative aspect-square rounded-xl bg-gradient-to-br ${winRc ? winRc.bg : rc.bg} border-2 flex flex-col items-center justify-center gap-0.5 transition-transform duration-150 select-none
                    ${lit ? `will-change-transform ${winRc ? winRc.ring : rc.ring} ring-4 scale-105 ${winRc ? winRc.glow : rc.glow} z-10` : 'border-gray-200 dark:border-gray-700'}`}>
                  {frozenWin ? (
                    // 停格揭示：显示实际中奖奖品
                    <>
                      <span className="text-xl md:text-2xl leading-none">{frozenWin.emoji}</span>
                      <span className="text-[9px] md:text-[10px] font-semibold text-gray-600 dark:text-gray-300 px-1 truncate w-full text-center">{frozenWin.name}</span>
                      <span className="absolute -top-1.5 -right-1.5 text-[10px]">✨</span>
                    </>
                  ) : (
                    // 平时：只显示稀有度层级
                    <>
                      <span className="text-lg md:text-xl font-black leading-none" style={{ color: rc.color }}>{p.rarity}</span>
                      <span className="text-[9px] md:text-[10px] font-medium text-gray-500 dark:text-gray-400">{rc.label}</span>
                    </>
                  )}
                </div>
              );
            })}
            {/* 中心格：稀有度标识 */}
            <div className="relative aspect-square rounded-xl bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/30 dark:to-pink-900/30 border-2 border-purple-200 dark:border-purple-800 flex flex-col items-center justify-center gap-0.5">
              <span className="text-xl leading-none">✨</span>
              <span className="text-[9px] font-bold text-purple-500 dark:text-purple-400">SSR ↑</span>
            </div>
          </div>

          {/* 右：操作区（模式切换 → 圆形大按钮 → 保底进度 → 说明，垂直居中填满留白） */}
          <div className="flex-1 w-full flex flex-col items-center justify-center gap-3.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMode('single')}
                className={`px-5 py-2 rounded-full text-sm font-bold transition ${mode === 'single' ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
                单抽 {status?.draw_cost}分
              </button>
              <button
                onClick={() => setMode('multi')}
                className={`px-5 py-2 rounded-full text-sm font-bold transition ${mode === 'multi' ? 'bg-green-600 text-white shadow-md shadow-green-500/30' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
                十连 {status?.draw10_cost}分<span className="text-[10px] ml-1 opacity-80">9折</span>
              </button>
            </div>

            {/* 圆形大抽奖按钮：渐变 + 双层旋转光环，作为视觉焦点 */}
            <button
              onClick={mode === 'single' ? doDraw : doDraw10}
              disabled={drawing || (mode === 'single' ? !canDraw : !canDraw10)}
              className="relative w-32 h-32 md:w-40 md:h-40 rounded-full bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 text-white flex flex-col items-center justify-center gap-0.5 shadow-xl shadow-purple-500/40 hover:shadow-purple-500/60 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {/* 双层旋转光环 */}
              <span className="absolute inset-0 rounded-full border-2 border-white/30 animate-spin [animation-duration:6s] pointer-events-none" />
              <span className="absolute inset-1.5 rounded-full border border-white/20 animate-spin [animation-duration:9s] [animation-direction:reverse] pointer-events-none" />
              {drawing ? (
                <svg className="animate-spin w-8 h-8" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <>
                  <span className="text-3xl leading-none">{mode === 'single' ? '🎡' : '🎰'}</span>
                  <span className="text-sm font-black tracking-widest">开始抽奖</span>
                  <span className="text-[10px] opacity-80">{mode === 'single' ? `${status?.draw_cost} 分` : `${status?.draw10_cost} 分`}</span>
                </>
              )}
            </button>

            {/* SSR 保底进度（整合进操作区，填满右侧空间） */}
            {status && pity && (
              <div className="w-full max-w-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1">
                    <span className="text-amber-500">🛡️</span>SSR 保底
                  </span>
                  <span className="text-[11px] text-gray-400">
                    已抽 {pity.pulls_since_ssr} 次 · {pity.to_hard_pity > 0 ? `再抽 ${pity.to_hard_pity} 次必出` : '已触发！'}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (pity.pulls_since_ssr / Math.max(1, pity.pulls_since_ssr + (pity.to_hard_pity ?? 80))) * 100)}%` }} />
                </div>
                <div className="flex justify-between flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-gray-400">
                  <span>软保底：{pity.to_soft_pity > 0 ? `再抽 ${pity.to_soft_pity} 次 ×5` : '已触发'}</span>
                  <span>硬保底：{pity.to_hard_pity > 0 ? `再抽 ${pity.to_hard_pity} 次` : '已触发'}</span>
                </div>
              </div>
            )}

            <p className="text-[11px] text-gray-400">
              {mode === 'single' ? '单抽可触发保底进度' : '十连必出 SR 及以上'}
            </p>
          </div>
        </div>
      </div>

      {/* ═══ 奖品图鉴 ═══ */}
      <div className="bg-white dark:bg-[#111] border rounded-3xl p-5 md:p-6">
        <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <FontAwesomeIcon icon={faTrophy} className="text-amber-500" />奖品图鉴
        </h2>
        {/* 稀有度图例 */}
        <div className="flex gap-3 text-xs text-gray-400 mb-4">
          {(['SSR', 'SR', 'R', 'N'] as const).map(r => (
            <span key={r} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: RARITY[r].color }} />{RARITY[r].label}
            </span>
          ))}
        </div>

        <div className="space-y-3">
          {(['SSR', 'SR', 'R', 'N'] as const).map(rarity => {
            const pool = prizes.filter(p => p.rarity === rarity);
            if (pool.length === 0) return null;
            const rc = RARITY[rarity];
            return (
              <div key={rarity} className={`rounded-2xl border overflow-hidden ${rarity === 'SSR' ? 'border-amber-300 dark:border-amber-800' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className={`px-4 py-2 text-sm font-bold flex items-center gap-2 bg-gradient-to-r ${rc.bg} ${rarity === 'SSR' ? 'text-amber-700 dark:text-amber-400' : rarity === 'SR' ? 'text-purple-700 dark:text-purple-400' : rarity === 'R' ? 'text-blue-700 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
                  <span className="text-base">{rarity === 'SSR' ? '✨' : rarity === 'SR' ? '💜' : rarity === 'R' ? '💙' : ''}</span>
                  {rarity} 级 · {rc.label}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-gray-100 dark:bg-gray-800">
                  {pool.map(p => (
                    <div key={p.id} className="bg-white dark:bg-[#111] flex items-center gap-2 px-3 py-2">
                      <span className="text-lg">{p.emoji}</span>
                      <div className="min-w-0">
                        <div className="text-xs text-gray-700 dark:text-gray-200 truncate">{p.name}</div>
                        {p.type === 'coins' && <div className="text-[10px] text-amber-600 dark:text-amber-400">+{p.value} 积分</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ 单抽结果弹窗 ═══ */}
      {showResult && result && mode === 'single' && (
        <SingleResult
          item={result.items[0]}
          gain={result.summary.total_coins_gain}
          onClose={closeResult}
          onAgain={() => { closeResult(); doDraw(); }}
        />
      )}

      {/* ═══ 十连结果：3D 翻牌弹窗 ═══ */}
      {tenData && (
        <TenPullResult
          result={tenData}
          onClose={closeTen}
          onAgain={() => { closeTen(); doDraw10(); }}
        />
      )}
    </div>
  );
}

// ─── 单抽结果弹窗（稀有度定制） ───
function SingleResult({ item, gain, onClose, onAgain }: {
  item: { name: string; emoji: string; rarity: string; converted_coins?: number };
  gain: number;
  onClose: () => void;
  onAgain: () => void;
}) {
  const rc = RARITY[item?.rarity as keyof typeof RARITY] || RARITY.N;
  const isSSR = item?.rarity === 'SSR';
  const isSR = item?.rarity === 'SR';
  // portal 到 body：避免被困在 main z-10 堆叠上下文（否则遮罩盖不住根级底部导航 z-50）
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      {/* SSR/SR 光效 */}
      {(isSSR || isSR) && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className={`absolute inset-0 animate-pulse ${isSSR ? 'bg-amber-400/10' : 'bg-purple-400/10'}`} />
          {isSSR && [...Array(8)].map((_, i) => (
            <div key={i} className="absolute w-1 h-14 rounded-full bg-amber-300/40"
              style={{ left: `${10 + i * 12}%`, top: `${15 + (i % 3) * 25}%`, animation: `sparkle ${1.2 + i * 0.25}s ease-in-out infinite`, transform: `rotate(${i * 40}deg)` }} />
          ))}
        </div>
      )}
      {/* 对话提示框：居中圆角卡片，背景/边框/光晕按稀有度着色 */}
      <div className={`relative rounded-3xl p-7 md:p-8 text-center max-w-xs w-full animate-[zoomIn_0.35s_ease-out] bg-gradient-to-br ${rc.bg} ${isSSR ? 'border-2 border-amber-400' : isSR ? 'border-2 border-purple-400' : 'border-2 border-gray-300 dark:border-gray-600'} ${rc.glow} shadow-2xl`}
        onClick={e => e.stopPropagation()}>
        {isSSR && <div className="text-amber-500 text-xs font-bold tracking-widest mb-1.5 animate-pulse">✦ 传说降临 ✦</div>}
        {isSR && !isSSR && <div className="text-purple-500 text-xs font-bold tracking-widest mb-1.5">✦ 稀有浮现 ✦</div>}
        <div className={`text-6xl mb-3 ${isSSR ? 'animate-bounce' : ''}`}>{item?.emoji}</div>
        <div className="text-xl font-black text-gray-900 dark:text-gray-100 mb-1">{item?.name}</div>
        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold mb-3"
          style={{ background: `${rc.color}1a`, color: rc.color }}>
          {rc.label} · {item?.rarity}
        </span>
        {gain > 0 && (
          <div className="inline-block bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 font-bold px-4 py-2 rounded-xl text-lg mb-1">+{gain} 积分</div>
        )}
        {/* 称号类奖品对 VIP 用户无用，抽中当场折算（后端已按同档积分折算，这里说明来源） */}
        {!!item?.converted_coins && (
          <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-lg px-3 py-2 mb-1">
            ♻️ 你已是 VIP，称号无需再抽：本奖品已自动折算为 {item.converted_coins} 积分
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={onAgain}
            className={`flex-1 py-3 rounded-xl font-bold text-white transition hover:shadow-lg ${isSSR ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-purple-500 to-pink-500'}`}>
            再来一次
          </button>
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            收下
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── 十连结果翻牌组件（3D翻转卡片）：光效 → 逐张翻转（自动+点击加速） → 汇总 ───
function TenPullResult({ result, onClose, onAgain }: {
  result: LotteryDrawResult;
  onClose: () => void;
  onAgain: () => void;
}) {
  const [revealCount, setRevealCount] = useState(0);
  const [phase, setPhase] = useState<'shine' | 'reveal' | 'done'>('shine');
  // 已完成「第二次翻牌」（折算成积分）的卡片下标
  const [revealedConvert, setRevealedConvert] = useState<Record<number, boolean>>({});
  const total = result.items.length;

  // 按品质从高到低排序（SSR → SR → R → N），翻牌顺序先展示高品质，仪式感更强
  const rarityOrder: Record<string, number> = { SSR: 0, SR: 1, R: 2, N: 3 };
  const sortedItems = [...result.items].sort((a, b) => (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9));
  // 需要折算的卡片（VIP 抽到称号类奖品：后端已折成积分，前端多翻一次展示结果）
  const convertIdx = sortedItems.map((it, i) => (it.converted_coins ? i : -1)).filter(i => i >= 0);

  // 光效阶段定时器（SSR 2s / SR 1.2s / 普通 0.6s）
  useEffect(() => {
    const hasSSR = result.items.some(i => i.rarity === 'SSR');
    const hasSR = result.items.some(i => i.rarity === 'SR');
    const shineMs = hasSSR ? 2000 : hasSR ? 1200 : 600;
    const t = setTimeout(() => setPhase('reveal'), shineMs);
    return () => clearTimeout(t);
  }, [result]);

  // reveal 阶段：自动每 250ms 翻一张（点击卡片可额外加速）
  useEffect(() => {
    if (phase !== 'reveal') return;
    const id = setInterval(() => {
      setRevealCount(c => Math.min(c + 1, total));
    }, 250);
    return () => clearInterval(id);
  }, [phase, total]);

  // 第二次翻牌：卡片第一面翻完（600ms 动画）后，再翻一次露出折算后的积分
  const convertTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    if (phase === 'shine') return;
    for (const i of convertIdx) {
      if (i >= revealCount) continue;
      if (revealedConvert[i] || convertTimers.current[i]) continue;
      convertTimers.current[i] = setTimeout(() => {
        delete convertTimers.current[i];
        setRevealedConvert(prev => ({ ...prev, [i]: true }));
      }, 700);
    }
  }, [revealCount, phase]);
  // 卸载时清掉未触发的第二次翻牌定时器
  useEffect(() => () => { Object.values(convertTimers.current).forEach(clearTimeout); }, []);

  // 全部翻完（含折算的第二次翻牌）→ done（展示汇总与按钮）
  const convertPending = convertIdx.filter(i => !revealedConvert[i]).length;
  useEffect(() => {
    if (phase === 'reveal' && revealCount >= total && convertPending === 0) setPhase('done');
  }, [phase, revealCount, total, convertPending]);

  // 点击卡片：手动翻开下一张（与自动翻并行，点即加速）
  const flipNext = () => {
    if (phase === 'reveal') setRevealCount(c => Math.min(c + 1, total));
  };

  // 跳过动画：直接展开全部卡片与折算结果，进入汇总
  const skipAll = () => {
    const all: Record<number, boolean> = {};
    convertIdx.forEach(i => { all[i] = true; });
    Object.values(convertTimers.current).forEach(clearTimeout);
    convertTimers.current = {};
    setRevealedConvert(all);
    setRevealCount(total);
  };

  const totalCoins = result.items.reduce((s, i) => s + (i.coins || 0) + (i.converted_coins || 0), 0);
  const ssrCount = result.items.filter(i => i.rarity === 'SSR').length;
  const convertedList = sortedItems.filter(i => i.converted_coins);
  const convertedTotal = convertedList.reduce((s, i) => s + (i.converted_coins || 0), 0);

  // 稀有度对应卡片边框光效
  const rarityCardStyle = (r: string) => {
    const map: Record<string, string> = {
      SSR: 'border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.5)]',
      SR: 'border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.4)]',
      R: 'border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]',
      N: 'border-gray-300',
    };
    return map[r] || 'border-gray-300';
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/85 p-4" onClick={phase === 'done' ? onClose : undefined}>
      {/* 光效 */}
      {phase === 'shine' && ssrCount > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-yellow-400/15 via-yellow-300/5 to-transparent animate-pulse" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="absolute w-1 h-16 bg-yellow-400/30 rounded-full"
              style={{
                left: `${15 + i * 14}%`,
                top: `${10 + (i % 3) * 20}%`,
                animation: `sparkle ${1.5 + i * 0.3}s ease-in-out infinite`,
                transform: `rotate(${i * 30}deg)`,
              }}
            />
          ))}
        </div>
      )}
      {phase === 'shine' && !ssrCount && result.items.some(i => i.rarity === 'SR') && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-400/10 via-transparent to-transparent animate-pulse" />
        </div>
      )}

      {/* 标题 */}
      <div className="text-white text-center mb-5" onClick={e => e.stopPropagation()}>
        {phase === 'shine' && <div className="text-xl font-bold tracking-wider">
          {ssrCount > 0 ? <span className="text-yellow-400 animate-pulse">✦ 传说光芒 ✦</span>
          : result.items.some(i => i.rarity === 'SR') ? <span className="text-purple-400">✦ 紫光浮现 ✦</span>
          : <span className="text-gray-400">✦ 抽奖中 ✦</span>}
        </div>}
        {phase === 'done' && <div className="text-xl font-bold">🎊 抽奖结果</div>}
      </div>

      {/* 卡片网格 — 3D翻转（按稀有度从高到低排序后逐张翻开；点击卡片加速翻下一张） */}
      <div className="grid grid-cols-5 gap-2.5 sm:gap-3 max-w-sm mx-auto mb-5 cursor-pointer"
        onClick={e => { e.stopPropagation(); flipNext(); }}
      >
        {sortedItems.map((item, i) => {
          const flipped = i < revealCount;
          const converted = !!revealedConvert[i];
          const border = rarityCardStyle(item.rarity);
          const isGold = item.rarity === 'SSR';
          const isPurple = item.rarity === 'SR';
          return (
            <div key={i} className={`perspective-600 w-14 h-[76px] sm:w-[68px] sm:h-[92px] ${flipped && isGold ? 'animate-[zoomIn_0.45s_ease-out]' : flipped && isPurple ? 'animate-[zoomIn_0.45s_ease-out]' : ''}`}>
              {/* 外层缩放特效（不影响内部 rotateY 翻转）；卡面仅保留光晕（box-shadow 不与 transform 冲突） */}
              {/* 折算卡翻两圈：0° 卡背 → 180° 奖品 → 360° 折算结果（正面内容在翻转途中已换成积分） */}
              <div className={`relative w-full h-full transition-transform duration-600 ${converted ? '[transform:rotateY(360deg)]' : flipped ? '[transform:rotateY(180deg)]' : ''}`}
                style={{ transformStyle: 'preserve-3d' }}
              >
                {/* 正面（0°/360°）：未翻时是白色卡背，折算完成后变为积分面 */}
                {converted ? (
                  <div className="absolute inset-0 rounded-xl border-2 border-amber-300 flex flex-col items-center justify-center p-0.5 bg-white shadow-[0_0_18px_rgba(251,191,36,0.4)]"
                    style={{ backfaceVisibility: 'hidden' }}
                  >
                    <span className="text-lg sm:text-2xl leading-none">🪙</span>
                    <span className="text-[7px] sm:text-[9px] font-bold leading-tight text-center mt-0.5 px-0.5 text-amber-600">+{item.converted_coins}积分</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 rounded-xl border-2 flex items-center justify-center bg-gradient-to-br from-white to-gray-100 border-gray-200 shadow-[inset_0_0_12px_rgba(0,0,0,0.05)]"
                    style={{ backfaceVisibility: 'hidden' }}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-primary-400/70" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
                      </svg>
                      <span className="text-[10px] font-bold tracking-widest text-gray-300">★</span>
                    </div>
                  </div>
                )}
                {/* 背面（180°）：抽到的奖品本体；SSR/SR 保留光晕强化 */}
                <div className={`absolute inset-0 rounded-xl border-2 flex flex-col items-center justify-center p-0.5
                  [transform:rotateY(180deg)] ${border} bg-white ${flipped && isGold ? 'shadow-[0_0_28px_rgba(251,191,36,0.65)]' : flipped && isPurple ? 'shadow-[0_0_24px_rgba(168,85,247,0.55)]' : ''}`}
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  <span className="text-lg sm:text-2xl leading-none">{item.emoji}</span>
                  <span className={`text-[7px] sm:text-[9px] font-bold leading-tight text-center mt-0.5 px-0.5 ${
                    isGold ? 'text-amber-600' : isPurple ? 'text-purple-600' : 'text-gray-600'
                  }`}>{item.name}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 汇总 */}
      {phase === 'done' && (
        <div className="text-white text-center mb-4 space-y-1.5 animate-fadeInUp" onClick={e => e.stopPropagation()}>
          {ssrCount > 0 && <div className="text-yellow-400 font-bold text-lg">🎉 获得 {ssrCount} 件传说级奖品！</div>}
          {totalCoins > 0 && <div className="text-green-400 font-medium text-sm">+{totalCoins} 积分</div>}
          {convertedList.length > 0 && (
            <div className="text-amber-300 text-xs">
              ♻️ 你已是 VIP，{convertedList.map(i => `「${i.name}」`).join('')} 已自动折算为 {convertedTotal} 积分
            </div>
          )}
          {result.summary.item_count > 0 && <div className="text-blue-300 text-sm">获得 {result.summary.item_count} 件道具</div>}
          {result.summary.vip_granted && <div className="text-purple-300 text-sm">🎟️ 获得 VIP 体验券</div>}
        </div>
      )}

      {/* 按钮 */}
      {phase === 'done' && (
        <div className="flex gap-3" onClick={e => e.stopPropagation()}>
          <button onClick={onAgain}
            className="px-6 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-bold text-sm hover:shadow-lg hover:shadow-purple-500/30 transition-all">
            再来十连
          </button>
          <button onClick={onClose}
            className="px-6 py-2.5 bg-white/10 text-white rounded-xl font-medium text-sm hover:bg-white/20 transition">
            关闭
          </button>
        </div>
      )}

      {/* 跳过动画：立即展开全部卡片（含折算的第二次翻牌）并进入汇总 */}
      {phase !== 'done' && (
        <button onClick={e => { e.stopPropagation(); skipAll(); }}
          className="mt-4 px-4 py-1.5 text-xs text-gray-300 border border-gray-600 rounded-full hover:text-white hover:border-gray-400 transition">
          跳过动画 →
        </button>
      )}
    </div>
  );
}
