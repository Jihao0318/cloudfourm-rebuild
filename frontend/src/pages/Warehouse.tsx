import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { shop as shopApi, items as itemsApi, decorations as decorationsApi, posts as postsApi } from '../services/api';
import { POST_BG_OPTIONS, postBgClass } from '../utils/postBg';
import ItemDetailModal from '../components/ItemDetailModal';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBox } from '@fortawesome/free-solid-svg-icons';

const ITEM_ICONS: Record<string, string> = {
  rename_card: '🃏',
  shop_item: '🎨',
  lottery_item: '🎁',
  vip_ticket: '⭐',
};

const ITEM_LABELS: Record<string, string> = {
  rename_card: '改名卡 · 修改一次用户名',
  post_decoration: '帖子装饰 · 美化帖子外观',
  item_bump: '推荐卡 · 帖子在首页侧边栏推荐位展示12小时（可续费）',
  item_highlight: '高亮卡 · 帖子列表金色高亮24小时',
  item_fortune: '今日运势 · 为帖子添加随机运势标签',
  item_avatar_frame: '头像框 · 为头像添加个性边框',
  item_title_badge: '称号 · 在昵称旁显示特殊称号',
  item_rainbow_title: '炫彩标题 · 帖子标题渐变动画7天',
  item_announce: '大喇叭 · 全服广播公告（持续24小时）',
  custom_title: '自定义称号 · 昵称旁显示自定义文字3天',
  item_pin_top: '置顶卡 · 将帖子置顶24小时',
  item_post_bg: '帖子背景卡 · 为帖子更换渐变背景',
  item_red_packet: '积分红包卡 · 发帖挂红包时自动消耗',
  item_anonymous_card: '匿名卡 · 匿名发帖时自动消耗',
};

// 道具完整特性（「查看详情」弹窗展示，与商城详情一致）
const ITEM_DETAILS: Record<string, string> = {
  item_bump: '· 帖子进入首页侧边栏「🔥 推荐」曝光位\n· 每次使用增加 12 小时推荐时长，可重复使用续费\n· 单个帖子累计推荐时长上限 3 天（72 小时）\n· 推荐位共 5 个槽位，先到先得，到期自动下架\n· 槽位满时：可支付「被挤者剩余时长价值 × 2」的挤人费抢占\n· 被挤下的帖子自动获得剩余价值 × 1.15 的积分补偿\n· 不占用「效果管理」机会，不影响主页列表正常排序',
  item_highlight: '· 帖子在主页列表显示金色高亮背景与左侧色条\n· 持续 24 小时，到期自动恢复普通样式\n· 在「仓库」中选择帖子使用\n· 仅自己的帖子可用',
  item_fortune: '· 为帖子添加随机运势标签（大吉/中吉/凶等 7 种）\n· 在「仓库」中选择帖子使用，触发抽签动画\n· 运势标签在帖子列表与详情页展示',
  item_avatar_frame: '· 为头像添加个性化边框，资料页/评论/列表全站展示\n· 购买后到「仓库」选择使用\n· 持续 30 天，到期自动失效\n· 可叠加续期，总时长不限',
  item_rainbow_title: '· 帖子标题显示炫彩渐变动画效果\n· 在「仓库」或发帖页对帖子使用\n· 持续 7 天，到期自动失效\n· 全站唯一动态标题特效，醒目吸睛',
  item_announce: '· 全服广播公告，所有用户可见\n· 持续 24 小时\n· 每人每天限用 1 次',
  custom_title: '· 昵称旁显示自定义文字（最多 30 字）\n· 持续 3 天\n· 在「仓库」中使用；与 VIP 永久头衔互斥（已有 VIP 头衔时需先清除）',
  item_pin_top: '· 帖子置顶显示（列表顶部固定位置）\n· 持续 24 小时\n· 在「仓库」中选择帖子使用\n· 管理员可随时取消置顶\n· 与推荐位互不冲突，可同时生效',
  item_post_bg: '· 为帖子设置专属渐变背景（6 种样式可选）\n· 发帖时选择背景自动消耗 1 张；也可在「效果管理」中更换\n· 每个帖子仅一次「效果管理」机会（换背景/取消背景/加装饰）\n· 暗色模式下自动适配深色渐变，阅读不刺眼\n· 背景仅自己帖子可用',
  item_red_packet: '· 发帖时可挂一个积分红包，评论区用户评论即抢\n· 发帖时自动消耗 1 张红包卡\n· 红包总额 1-10000 积分，份数 1-100 份\n· 每份金额随机分配（二倍均值法），手气最佳有专属标识\n· 未抢完可随时取消，剩余积分全额退回\n· 抢红包进度与排行在帖子详情页实时展示',
  item_anonymous_card: '· 在不支持匿名的板块匿名发帖\n· 发帖时自动消耗：支持匿名的板块 1 张，不支持匿名的板块 3 张\n· 新用户注册自动获得 2 张\n· 匿名帖前台一律显示「匿名同学」，仅管理员可见真实作者\n· 收藏/详情等所有页面均脱敏展示',
};

// 自动消耗类道具（无使用按钮），卡片上显示提示
const ITEM_HINTS: Record<string, string> = {
  item_red_packet: '在发帖页挂红包时自动消耗',
  item_anonymous_card: '在不支持匿名的板块匿名发帖时自动消耗',
};

const RARITY_COLORS: Record<string, string> = {
  SSR: 'border-yellow-400 bg-yellow-50',
  SR: 'border-purple-400 bg-purple-50',
  R: 'border-blue-400 bg-blue-50',
};

function getItemPrice(item: { kind?: string; rarity?: string }): number {
  if (item.kind === 'vip_ticket') return 30;
  if (item.rarity === 'SSR' || item.rarity === 'SR') return 25;
  if (item.rarity === 'R') return 10;
  return 5;
}

// 积分变动后通知 Layout 刷新导航栏余额
function notifyCoinsChanged() {
  window.dispatchEvent(new Event('coins:changed'));
}

interface MyItem {
  id: number;
  kind: string;
  rarity?: string;
  used: number;
  applied_to: number | null;
  created_at: string;
  name: string;
  type: string;
  data: string;
}

export default function Warehouse() {
  const { user, refreshUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // 使用/回收请求进行中（防重入：禁用确认按钮）
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<string>('all');
  const [useModal, setUseModal] = useState<{ item: MyItem; postId?: string; value?: string; bgId?: number } | null>(null);
  const [fortuneAnim, setFortuneAnim] = useState<{ postId: string; item: MyItem } | null>(null);
  const [fortuneResult, setFortuneResult] = useState<string | null>(null);
  const [recycleModal, setRecycleModal] = useState<{ item: MyItem; count: number; ids: number[]; quantity: number } | null>(null);
  // 查看详情的道具
  const [detailItem, setDetailItem] = useState<MyItem | null>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);

  // 弹窗打开时加载用户最近的帖子（供道具使用选择）
  useEffect(() => {
    if (!useModal || useModal.item.type === 'item_announce' || !user) return;
    setLoadingPosts(true);
    const uid = (user as any).userId || (user as any).id;
    // excludeAnonymous：匿名帖不显示任何装饰，使用道具是浪费——选帖时默认排除
    postsApi.list({ userId: uid, pageSize: 50, excludeAnonymous: true })
      .then(res => { if (res.success) setUserPosts(res.data || []); })
      .catch(() => {})
      .finally(() => setLoadingPosts(false));
  }, [useModal, user]);

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 加载完成，避免刷新时误踢登录
    if (!user) { navigate('/login'); return; }
    loadItems();
  }, [authLoading, user]);

  const loadItems = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const json = await itemsApi.myItems();
      if (json.success) setItems(json.data || []);
      else setLoadError(json.error || '加载失败');
    } catch (e: any) { setLoadError(e?.message || '加载失败'); console.error(e); }
    setLoading(false);
  };

  const itemTypes = [...new Set(items.filter(i => !i.used).map(i => i.type))];
  const filtered = items.filter(i => tab === 'all' ? !i.used : (i.type === tab && !i.used));

  const useItem = async (item: MyItem) => {
    if (submitting) return;
    if (item.kind === 'vip_ticket') {
      // VIP 体验券
      setSubmitting(true);
      try {
        const json = await itemsApi.use('vip-ticket', item.id);
        if (json.success) { toast(json.message || 'VIP已激活', 'success'); notifyCoinsChanged(); loadItems(); refreshUser?.(); }
        else toast(json.error || '使用失败', 'error');
      } catch (err: any) { toast(err.message || '使用失败', 'error'); }
      setSubmitting(false);
      return;
    }
    if (item.type === 'rename_card') {
      setUseModal({ item });
      return;
    }
    if (item.type === 'item_avatar_frame') {
      const body = { frame: 'default' };
      setSubmitting(true);
      try {
        const json = await itemsApi.use('avatar-frame', undefined, body);
        if (json.success) { toast(json.message || '使用成功', 'success'); notifyCoinsChanged(); loadItems(); refreshUser?.(); }
        else toast(json.error || '使用失败', 'error');
      } catch (err: any) { toast(err.message || '使用失败', 'error'); }
      setSubmitting(false);
      return;
    }
    if (item.type === 'item_title_badge' || item.type === 'custom_title') {
      setUseModal({ item });
      return;
    }
    // 需要输入帖子ID
    setUseModal({ item });
  };

  const executeUse = async () => {
    if (!useModal || submitting) return;
    if (useModal.item.type !== 'item_announce' && !useModal.postId) return;
    const { item, postId } = useModal;

    setSubmitting(true);
    try {
      // 运势：触发抽签动画
      if (item.type === 'item_fortune') {
        setFortuneAnim({ postId: postId!, item });
        setUseModal(null);
        try {
          const json = await itemsApi.use('fortune', parseInt(postId || '0'));
          if (json.success) {
            const fortuneText = json.data?.fortune || json.message || '';
            notifyCoinsChanged();
            setFortuneResult(fortuneText);
          } else {
            toast(json.error || '使用失败', 'error');
            setFortuneAnim(null);
          }
        } catch (err: any) { toast(err.message || '使用失败', 'error'); setFortuneAnim(null); }
        return;
      }

      // 置顶卡：直接使用（选择帖子后）
      if (item.type === 'item_pin_top') {
        const json = await itemsApi.use('pin-top', parseInt(postId || '0'));
        if (json.success) { toast(json.message || '置顶成功', 'success'); notifyCoinsChanged(); setUseModal(null); loadItems(); }
        else toast(json.error || '使用失败', 'error');
        return;
      }
      // 背景卡：携带所选背景
      if (item.type === 'item_post_bg') {
        if (!useModal.bgId) return;
        const json = await itemsApi.use('post-bg', parseInt(postId || '0'), { bg_id: useModal.bgId });
        if (json.success) { toast(json.message || '背景已更换', 'success'); notifyCoinsChanged(); setUseModal(null); loadItems(); }
        else toast(json.error || '使用失败', 'error');
        return;
      }

      const typeMap: Record<string, string> = {
        post_decoration: 'decorations/apply',
        item_announce: 'items/use/announce',
        item_bump: 'items/use/bump',
        item_highlight: 'items/use/highlight',
        item_rainbow_title: 'items/use/rainbow-title',
      };
      const endpoint = typeMap[item.type];
      if (!endpoint) { toast('未知道具类型', 'error'); return; }

      const json = item.type === 'post_decoration'
        ? await decorationsApi.apply(parseInt(postId || '0'), item.id)
        : item.type === 'item_announce'
          ? await itemsApi.use('announce', undefined, { content: (useModal?.value || useModal.item.name) as string })
          : await itemsApi.use(endpoint.replace('items/use/', ''), parseInt(postId || '0'));
      if (json.success) { toast(json.message || '使用成功', 'success'); notifyCoinsChanged(); setUseModal(null); loadItems(); }
      else toast(json.error || '使用失败', 'error');
    } catch (err: any) {
      toast(err.message || '使用失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const getGroups = () => {
    const map = new Map<string, MyItem[]>();
    for (const item of filtered) {
      const key = item.type + '::' + item.name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
  };

  const removeDecoration = async (item: MyItem) => {
    if (!item.applied_to) return;
    try {
      const res = await decorationsApi.remove(item.applied_to);
      if (res.success) { toast('装饰已移除', 'success'); loadItems(); }
    } catch (err: any) { toast(err.message, 'error'); }
  };

  const handleRecycle = async () => {
    if (!recycleModal || submitting) return;
    const ids = recycleModal.ids.slice(0, Math.min(recycleModal.quantity, 100));
    setSubmitting(true);
    try {
      const json = await itemsApi.recycleBatch(ids);
      if (json.success) { toast(`回收成功，获得 ${ids.length * getItemPrice(recycleModal.item)} 积分`, 'success'); notifyCoinsChanged(); setRecycleModal(null); loadItems(); }
      else toast(json.error || '回收失败', 'error');
    } catch (err: any) { toast(err.message || '回收失败', 'error'); }
    setSubmitting(false);
  };

  if (!user) return null;

  return (
    <div className="max-w-3xl mx-auto py-6">
      <h1 className="text-2xl font-bold mb-1">我的仓库</h1>
      <p className="text-gray-500 text-sm mb-4">管理你拥有的道具和物品</p>

      {itemTypes.length > 0 && (
        <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-0.5 flex-wrap">
          <button onClick={() => setTab('all')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${tab === 'all' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            全部 ({items.filter(i => !i.used).length})
          </button>
          {itemTypes.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {ITEM_LABELS[t]?.split('·')[0]?.trim() || t}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-12">加载中...</div>
      ) : loadError ? (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-3">{loadError}</p>
          <button onClick={loadItems} className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition">重试</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          <div className="text-4xl mb-3"><FontAwesomeIcon icon={faBox} /></div>
          <p>仓库空空如也</p>
          <button onClick={() => navigate('/lottery')} className="mt-3 text-primary-500 text-sm hover:underline">去抽奖获取道具 →</button>
        </div>
      ) : (
        <div className="space-y-3">
          {getGroups().map(group => {
            const first = group.items[0];
            const count = group.items.length;
            return (
              <div key={group.key} className={`rounded-2xl p-4 hover:shadow-sm transition border-2 ${RARITY_COLORS[first.rarity || ''] || 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-gradient-to-br from-gray-50 to-gray-100 relative">
                      {first.kind === 'vip_ticket' ? '⭐' : ITEM_ICONS[first.type] || '📦'}
                      {count > 1 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-primary-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
                          {count}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{first.name}{count > 1 && <span className="text-gray-400 ml-1">×{count}</span>}</div>
                      <div className="text-xs text-gray-400 line-clamp-2">
                        {first.kind === 'vip_ticket' ? 'VIP体验券 · 在仓库使用激活' : (ITEM_LABELS[first.type] || first.type)}
                      </div>
                      {ITEM_HINTS[first.type] && (
                        <div className="text-[11px] text-amber-600 mt-0.5">{ITEM_HINTS[first.type]}</div>
                      )}
                      {ITEM_DETAILS[first.type] && (
                        <button onClick={() => setDetailItem(first)}
                          className="mt-0.5 text-[11px] text-primary-500 hover:underline">
                          查看详情 →
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {!first.applied_to ? (
                      ITEM_HINTS[first.type] ? (
                        <button onClick={() => setRecycleModal({ item: first, count, ids: group.items.map(i => i.id), quantity: count })}
                          className="px-2.5 py-1.5 border border-gray-200 text-gray-500 rounded-lg text-xs font-medium hover:bg-gray-50 transition">回收</button>
                      ) : (
                        <>
                          <button onClick={() => useItem(first)} disabled={submitting}
                            className="px-2.5 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition disabled:opacity-50 disabled:cursor-not-allowed">{submitting ? '处理中...' : '使用'}</button>
                          <button onClick={() => setRecycleModal({ item: first, count, ids: group.items.map(i => i.id), quantity: count })}
                            className="px-2.5 py-1.5 border border-gray-200 text-gray-500 rounded-lg text-xs font-medium hover:bg-gray-50 transition">回收</button>
                        </>
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 使用弹窗 — 根据 type 渲染对应内容，避免多个 Portal 同时出现 */}
      {useModal && (() => {
        const t = useModal.item.type;
        // 不需要弹窗直接执行的类型
        if (['item_avatar_frame'].includes(t)) return null;
        // 有独立弹窗的类型（称号、自定义称号、改名卡）
        if (['item_title_badge', 'custom_title', 'rename_card'].includes(t)) return null;
        // 其余：帖子选择弹窗
        return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setUseModal(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">使用 {useModal.item.name}</h3>
            <p className="text-gray-500 text-sm mb-3">{ITEM_LABELS[useModal.item.type] || ''}</p>
            {t === 'item_announce' ? (
              <textarea value={useModal.value || ''} onChange={e => setUseModal({ ...useModal, value: e.target.value })}
                placeholder="输入广播内容（全服可见）"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-primary-500 mb-4 resize-none"
                rows={3} maxLength={200} />
            ) : (
              <div>
                {t === 'item_post_bg' && (
                  <>
                    <p className="text-xs text-gray-500 mb-2">选择背景样式：</p>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {POST_BG_OPTIONS.map(opt => (
                        <button key={opt.id} onClick={() => setUseModal(m => m ? { ...m, bgId: opt.id } : m)}
                          className={`h-14 rounded-xl border-2 transition flex items-center justify-center ${postBgClass(opt.id)} ${useModal.bgId === opt.id ? 'border-primary-500 ring-2 ring-primary-300' : 'border-gray-200'}`}>
                          <span className="bg-white/80 text-gray-700 dark:bg-black/60 dark:text-gray-300 text-[10px] font-medium px-1.5 py-0.5 rounded">{opt.name}</span>
                        </button>
                      ))}
                    </div>
                    {useModal.bgId && <div className="text-xs text-green-600 mb-2">✅ 已选择背景</div>}
                  </>
                )}
                <p className="text-xs text-gray-500 mb-2">选择要使用道具的帖子：</p>
                {loadingPosts ? (
                  <div className="text-xs text-gray-400 py-4 text-center">加载中...</div>
                ) : userPosts.length === 0 ? (
                  <div className="text-xs text-gray-400 py-4 text-center">暂无帖子</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto mb-2 border border-gray-100 rounded-xl divide-y">
                    {userPosts.map((p: any) => (
                      <button key={p.id} onClick={() => setUseModal(m => m ? { ...m, postId: String(p.id) } : m)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition ${useModal.postId === String(p.id) ? 'bg-primary-50' : ''}`}>
                        <div className="font-medium text-gray-800 truncate">{p.title}</div>
                        <div className="text-xs text-gray-400">{new Date(p.created_at).toLocaleDateString('zh-CN')} · 💬 {p.comment_count}</div>
                      </button>
                    ))}
                  </div>
                )}
                {useModal.postId && (
                  <div className="text-xs text-green-600 mb-2">✅ 已选择帖子</div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setUseModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
              <button onClick={executeUse} disabled={submitting || (t === 'item_announce' ? false : t === 'item_post_bg' ? (!useModal.postId || !useModal.bgId) : !useModal.postId)}
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">{submitting ? '处理中...' : '确认'}</button>
            </div>
          </div>
        </div>,
        document.body
        );
      })()}

      {/* 回收弹窗 */}
      {recycleModal && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setRecycleModal(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">回收 {recycleModal.item.name}</h3>
            <p className="text-gray-500 text-sm mb-3">拥有 <strong>{recycleModal.count}</strong> 件，回收单价 <strong className="text-amber-600">{getItemPrice(recycleModal.item)}</strong> 积分</p>
            <p className="text-xs text-amber-600 mb-2">⚠️ 单次最多回收 100 件</p>
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setRecycleModal(prev => prev ? { ...prev, quantity: Math.max(1, prev.quantity - 1) } : prev)}
                className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-lg font-bold text-gray-600 hover:bg-gray-50 transition">−</button>
              <input type="number" min={1} max={Math.min(recycleModal.count, 100)}
                value={recycleModal.quantity}
                onChange={e => {
                  const v = parseInt(e.target.value) || 1;
                  setRecycleModal(prev => prev ? { ...prev, quantity: Math.min(Math.min(prev.count, 100), Math.max(1, v)) } : prev);
                }}
                className="w-20 text-center px-3 py-2 border border-gray-200 rounded-xl text-lg font-bold outline-none focus:border-primary-500" />
              <button onClick={() => setRecycleModal(prev => prev ? { ...prev, quantity: Math.min(prev.count, prev.quantity + 1) } : prev)}
                className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-lg font-bold text-gray-600 hover:bg-gray-50 transition">+</button>
              <button onClick={() => setRecycleModal(prev => prev ? { ...prev, quantity: Math.min(prev.count, 100) } : prev)}
                className="px-3 py-2 text-xs text-primary-600 font-medium hover:underline">最大</button>
            </div>
            <div className="text-sm text-gray-600 mb-4">回收可获得 <strong className="text-red-500">{recycleModal.quantity * getItemPrice(recycleModal.item)}</strong> 积分</div>
            <div className="flex gap-2">
              <button onClick={() => setRecycleModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
              <button onClick={handleRecycle} disabled={submitting}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition disabled:opacity-50 disabled:cursor-not-allowed">{submitting ? '处理中...' : '确认回收'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 称号弹窗 */}
      {useModal?.item.type === 'item_title_badge' && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setUseModal(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">使用称号道具</h3>
            <p className="text-gray-500 text-sm mb-3">输入自定义称号内容（有效期24小时）</p>
            <input type="text" value={useModal.value || ''} onChange={e => setUseModal({ ...useModal, value: e.target.value })}
              placeholder="输入称号文字（1-20个字符）" maxLength={20}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-primary-500 mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setUseModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
              <button onClick={async () => {
                if (!useModal?.value || submitting) return;
                setSubmitting(true);
                try {
                  const json = await itemsApi.use('title-badge', undefined, { badge: useModal.value });
                  if (json.success) { toast(json.message || '称号已启用', 'success'); notifyCoinsChanged(); setUseModal(null); loadItems(); refreshUser?.(); }
                  else toast(json.error || '使用失败', 'error');
                } catch (err: any) { toast(err.message || '使用失败', 'error'); }
                setSubmitting(false);
              }} disabled={!useModal?.value || useModal.value.length < 1 || submitting}
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">{submitting ? '处理中...' : '确认启用'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 自定义称号弹窗 */}
      {useModal?.item.type === 'custom_title' && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setUseModal(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">使用自定义称号</h3>
            <p className="text-gray-500 text-sm mb-3">输入自定义称号内容（有效期3天）</p>
            <input type="text" value={useModal.value || ''} onChange={e => setUseModal({ ...useModal, value: e.target.value })}
              placeholder="输入称号文字（1-20个字符）" maxLength={20}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-primary-500 mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setUseModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
              <button onClick={async () => {
                if (!useModal?.value || submitting) return;
                setSubmitting(true);
                try {
                  const json = await itemsApi.use('custom-title', undefined, { title: useModal.value });
                  if (json.success) { toast(json.message || '称号已启用', 'success'); notifyCoinsChanged(); setUseModal(null); loadItems(); refreshUser?.(); }
                  else toast(json.error || '使用失败', 'error');
                } catch (err: any) { toast(err.message || '使用失败', 'error'); }
                setSubmitting(false);
              }} disabled={!useModal?.value || useModal.value.length < 1 || submitting}
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">{submitting ? '处理中...' : '确认启用'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 改名卡弹窗 */}
      {useModal?.item.type === 'rename_card' && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setUseModal(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">使用改名卡</h3>
            <p className="text-gray-500 text-sm mb-3">输入新用户名</p>
            <input type="text" value={useModal.value || ''} onChange={e => setUseModal({ ...useModal, value: e.target.value })}
              placeholder="新用户名（3-20个字符）" maxLength={20}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-primary-500 mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setUseModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
              <button onClick={async () => {
                if (!useModal?.value || submitting) return;
                setSubmitting(true);
                try {
                  const json = await shopApi.useRename(useModal.value);
                  if (json.success) {
                    const res = json as any;
                    if (res.token) { import('../services/api').then(m => m.setToken(res.token)); }
                    toast('用户名已修改！', 'success'); notifyCoinsChanged(); setUseModal(null); loadItems(); refreshUser?.();
                  }
                  else toast(json.error || '修改失败', 'error');
                } catch (err: any) { toast(err.message || '修改失败', 'error'); }
                setSubmitting(false);
              }} disabled={(useModal.value?.length || 0) < 3 || submitting}
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">{submitting ? '处理中...' : '确认修改'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 运势抽签动画 */}
      {fortuneAnim && createPortal(
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center"
          onClick={() => { setFortuneAnim(null); setFortuneResult(null); }}>
          <div className="text-center" onClick={e => e.stopPropagation()}>
            {!fortuneResult ? (
              <div className="animate-bounce">
                <div className="text-8xl mb-4 fortune-shake">🎋</div>
                <div className="text-white text-lg font-medium animate-pulse">抽签中...</div>
              </div>
            ) : (
              <div className="animate-[zoomIn_0.5s_ease-out]">
                <div className="bg-white/95 dark:bg-black/70 backdrop-blur-sm rounded-3xl px-10 py-8 shadow-2xl">
                  <div className="text-5xl mb-3">🎋</div>
                  <div className={`text-2xl font-bold mb-2 ${
                    fortuneResult.includes('大吉') ? 'text-red-500' :
                    fortuneResult.includes('凶') ? 'text-gray-600' :
                    'text-amber-600'
                  }`}>
                    {fortuneResult}
                  </div>
                  <div className="text-xs text-gray-400 mt-4">点击任意处关闭</div>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* 道具详情弹窗 */}
      <ItemDetailModal
        open={!!detailItem}
        name={detailItem?.name || ''}
        description={detailItem ? (ITEM_LABELS[detailItem.type] || '') : undefined}
        detail={detailItem ? ITEM_DETAILS[detailItem.type] : undefined}
        onClose={() => setDetailItem(null)}
      />
    </div>
  );
}
