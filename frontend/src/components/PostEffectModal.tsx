import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { items as itemsApi } from '../services/api';
import { POST_BG_OPTIONS, postBgClass } from '../utils/postBg';
import { parseDate, formatRelativeTime } from '../utils/date';
import { effectQuota, canApplyEffect, EFFECT_LABELS, MAX_POST_EFFECTS, type PostEffectKind } from '../utils/postEffects';
import type { Post } from '../types';
import ItemDetailModal from './ItemDetailModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRocket, faMagic } from '@fortawesome/free-solid-svg-icons';

// 道具完整特性（与商城/仓库详情一致）
const DECO_DETAILS: Record<string, string> = {
  item_bump: '· 帖子进入首页侧边栏「🔥 推荐」曝光位\n· 每次使用增加 12 小时推荐时长，可重复使用续费\n· 单个帖子累计推荐时长上限 3 天（72 小时）\n· 推荐位共 5 个槽位，先到先得，到期自动下架\n· 槽位满时：可支付「被挤者剩余时长价值 × 2」的挤人费抢占\n· 被挤下的帖子自动获得剩余价值 × 1.15 的积分补偿\n· 占用 1 个效果额度（与背景/高亮/运势共用「同帖最多 2 种」限制），续费不额外占用',
  item_highlight: '· 帖子在主页列表显示金色高亮背景与左侧色条\n· 持续 24 小时，到期自动恢复普通样式\n· 在「仓库」中选择帖子使用\n· 仅自己的帖子可用\n· 占用 1 个效果额度（与背景/推荐/运势共用「同帖最多 2 种」限制），续期不额外占用',
};

interface Props {
  open: boolean;
  post: Post | null;
  onClose: () => void;
  onChanged: () => void; // 操作成功后刷新帖子详情
}

// 效果管理弹窗：管理本帖的背景/装饰效果
// 额度规则：同一帖同时最多 MAX_POST_EFFECTS 种效果（背景/推荐/高亮/运势），
// 同类续期或替换不占新额度，取消效果立即释放额度。
export default function PostEffectModal({ open, post, onClose, onChanged }: Props) {
  const { toast } = useToast();
  const [cards, setCards] = useState<{ type: string; count: number }[]>([]);
  const [selBg, setSelBg] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 查看详情的装饰道具
  const [decoDetail, setDecoDetail] = useState<string | null>(null);

  // 打开时锁定背景滚动（保存前值，嵌套弹窗按 LIFO 正确恢复）
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  // 打开时加载可用道具库存（提升/高亮/背景卡）
  useEffect(() => {
    if (!open || !post) return;
    setLoaded(false);
    setSelBg(null);
    itemsApi.myItems().then(res => {
      if (res.success) {
        const counts: Record<string, number> = {};
        for (const it of (res.data || []) as any[]) {
          if (it.used) continue;
          counts[it.type] = (counts[it.type] || 0) + 1;
        }
        setCards(Object.entries(counts).map(([type, count]) => ({ type, count })));
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [open, post]);

  if (!open || !post) return null;

  const quota = effectQuota(post);
  const cardCount = (type: string) => cards.find(c => c.type === type)?.count || 0;

  // 当前生效的效果（用于显示"取消"入口）
  const bumpActive = !!post.bumped_until && (parseDate(post.bumped_until)?.getTime() ?? 0) > Date.now();
  const highlightActive = !!post.highlighted_until && (parseDate(post.highlighted_until)?.getTime() ?? 0) > Date.now();

  const run = async (fn: () => Promise<{ success: boolean; error?: string; message?: string }>, successMsg: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if (res.success) {
        toast(successMsg, 'success');
        onChanged();
        onClose();
      } else {
        toast(res.error || '操作失败', 'error');
      }
    } catch (e: any) {
      toast(e?.message || '操作失败', 'error');
    }
    setBusy(false);
  };

  // 不能使用时返回原因文案（按钮置灰但仍可点击 → 点击给出明确提示，避免"点了没反应"）
  const blockedReason = (kind: PostEffectKind, cardType: string): string | null => {
    if (!canApplyEffect(quota, kind)) {
      return `本帖已用满 ${quota.max} 种效果（${quota.used}/${quota.max}），取消一个已生效效果后可继续使用`;
    }
    if (cardCount(cardType) === 0) return '没有可用的卡片，去商城购买后再使用';
    return null;
  };

  const apply = (kind: PostEffectKind, cardType: string, fn: () => Promise<{ success: boolean; error?: string; message?: string }>, okMsg: string) => {
    const reason = blockedReason(kind, cardType);
    if (reason) { toast(reason, 'error'); return; }
    run(fn, okMsg);
  };

  const blockedClass = 'opacity-40 cursor-not-allowed';
  const quotaFull = quota.remaining === 0;

  // portal 到 body：避免被困在 main z-10 堆叠上下文（否则遮罩盖不住根级底部导航 z-50）；
  // z-[90] 低于全局 Toast z-[100]，保证操作失败时错误提示可见
  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#111] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">效果管理</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* 额度计数器：剩余次数 / 已生效效果 / 是否还能管理 */}
          <div className={`rounded-xl border px-3.5 py-3 ${
            quotaFull
              ? 'bg-amber-50/70 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900'
              : 'bg-blue-50/70 border-blue-100 dark:bg-blue-950/30 dark:border-blue-900'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">效果额度</span>
              <span className={`text-base font-bold ${quotaFull ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-300'}`}>
                剩余 {quota.remaining}/{quota.max}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              已生效：{quota.active.length ? quota.active.map(k => EFFECT_LABELS[k]).join('、') : '无'}
            </p>
            <p className={`text-[11px] mt-1 leading-relaxed ${quotaFull ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
              {quotaFull
                ? `额度已用满（${quota.used}/${MAX_POST_EFFECTS}），暂时不能再加新效果；取消下面任意一个已生效效果即可继续管理。`
                : `每个帖子最多同时生效 ${MAX_POST_EFFECTS} 种效果，还能再添加 ${quota.remaining} 种。`}
            </p>
          </div>

          {!loaded && <p className="text-xs text-gray-400 text-center py-4">加载中...</p>}

          {/* 帖子背景 */}
          {loaded && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                <span>🖼️</span>帖子背景
                {post.post_bg_id && <span className="text-[10px] font-normal text-green-600">已生效（占 1 个额度）</span>}
              </h4>
              {post.post_bg_id && (
                <div className={`h-12 rounded-xl border mb-2 flex items-center justify-center ${postBgClass(post.post_bg_id)}`}>
                  <span className="text-xs bg-white/70 dark:bg-black/50 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">
                    当前背景：{POST_BG_OPTIONS.find(o => o.id === post.post_bg_id)?.name || `#${post.post_bg_id}`}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {POST_BG_OPTIONS.map(opt => (
                  <button key={opt.id} type="button" onClick={() => setSelBg(selBg === opt.id ? null : opt.id)}
                    title={opt.name}
                    className={`h-10 rounded-lg border-2 transition ${postBgClass(opt.id)} ${
                      selBg === opt.id ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200 dark:border-gray-700'
                    }`} />
                ))}
              </div>
              <div className="flex gap-2 mt-2.5">
                <button onClick={() => apply('bg', 'item_post_bg', () => itemsApi.use('post-bg', post.id, { bg_id: selBg }), '背景已更新')}
                  disabled={!selBg || busy}
                  className={`flex-1 px-3 py-2 rounded-lg bg-primary-600 text-white text-xs font-medium transition ${
                    !selBg || busy || blockedReason('bg', 'item_post_bg') ? blockedClass : 'hover:bg-primary-700'
                  }`}>
                  {post.post_bg_id ? '更换背景' : '应用背景'}{cardCount('item_post_bg') > 0 ? `（消耗 1 张背景卡）` : ''}
                </button>
                {post.post_bg_id && (
                  <button onClick={() => run(() => itemsApi.cancelEffect(`bg_${post.id}`), '已取消帖子背景')}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-500 hover:text-red-500 hover:border-red-200 transition">
                    取消背景
                  </button>
                )}
              </div>
              {canApplyEffect(quota, 'bg') && cardCount('item_post_bg') === 0 && (
                <p className="text-[11px] text-gray-400 mt-1.5">
                  没有背景卡，<Link to="/shop" className="text-primary-500 hover:underline">去商城购买 →</Link>
                </p>
              )}
              {!canApplyEffect(quota, 'bg') && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">
                  额度已用满，取消一个已生效效果后可更换背景。
                </p>
              )}
            </div>
          )}

          {/* 帖子装饰 */}
          {loaded && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                <FontAwesomeIcon icon={faMagic} className="text-amber-500" />帖子装饰
              </h4>
              <div className="space-y-2">
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800">
                  <FontAwesomeIcon icon={faRocket} className="text-orange-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">推荐卡</p>
                    <p className="text-[11px] text-gray-400">首页侧边栏推荐位展示 12 小时（可续费，上限 3 天）</p>
                    {bumpActive && (
                      <p className="text-[11px] text-green-600 mt-0.5">✅ 推荐中（{formatRelativeTime(post.bumped_until!)} 到期，占 1 个额度）</p>
                    )}
                    <button onClick={() => setDecoDetail(DECO_DETAILS.item_bump)}
                      className="mt-0.5 text-[11px] text-primary-500 hover:underline">
                      查看详情 →
                    </button>
                  </div>
                  {bumpActive ? (
                    <button onClick={() => run(() => itemsApi.cancelEffect(`bump_${post.id}`), '已取消推荐效果')}
                      disabled={busy}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-500 hover:text-red-500 hover:border-red-200 transition">
                      取消
                    </button>
                  ) : (
                    <button onClick={() => apply('bump', 'item_bump', () => itemsApi.use('bump', post.id), '已进入推荐位')}
                      disabled={busy}
                      className={`shrink-0 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium transition ${
                        busy || blockedReason('bump', 'item_bump') ? blockedClass : 'hover:bg-primary-700'
                      }`}>
                      {cardCount('item_bump') > 0 ? `使用（余 ${cardCount('item_bump')}）` : '去商城'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800">
                  <FontAwesomeIcon icon={faMagic} className="text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">高亮卡</p>
                    <p className="text-[11px] text-gray-400">帖子列表金色高亮 24 小时</p>
                    {highlightActive && (
                      <p className="text-[11px] text-green-600 mt-0.5">✅ 高亮中（{formatRelativeTime(post.highlighted_until!)} 到期，占 1 个额度）</p>
                    )}
                    <button onClick={() => setDecoDetail(DECO_DETAILS.item_highlight)}
                      className="mt-0.5 text-[11px] text-primary-500 hover:underline">
                      查看详情 →
                    </button>
                  </div>
                  {highlightActive ? (
                    <button onClick={() => run(() => itemsApi.cancelEffect(`highlight_${post.id}`), '已取消高亮效果')}
                      disabled={busy}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-500 hover:text-red-500 hover:border-red-200 transition">
                      取消
                    </button>
                  ) : (
                    <button onClick={() => apply('highlight', 'item_highlight', () => itemsApi.use('highlight', post.id), '帖子已高亮')}
                      disabled={busy}
                      className={`shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium transition ${
                        busy || blockedReason('highlight', 'item_highlight') ? blockedClass : 'hover:bg-amber-600'
                      }`}>
                      {cardCount('item_highlight') > 0 ? `使用（余 ${cardCount('item_highlight')}）` : '去商城'}
                    </button>
                  )}
                </div>
              </div>
              {quotaFull && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                  提示：额度已用满（{quota.used}/{quota.max}）时点击上面的按钮会提示原因，取消已生效效果即可腾出额度。
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 装饰道具详情弹窗 */}
      <ItemDetailModal
        open={!!decoDetail}
        name={decoDetail === DECO_DETAILS.item_bump ? '推荐卡' : decoDetail === DECO_DETAILS.item_highlight ? '高亮卡' : ''}
        description={decoDetail === DECO_DETAILS.item_bump ? '帖子进入首页侧边栏推荐位展示12小时' : '帖子列表金色高亮，持续24小时'}
        detail={decoDetail || undefined}
        onClose={() => setDecoDetail(null)}
      />
    </div>,
    document.body
  );
}
