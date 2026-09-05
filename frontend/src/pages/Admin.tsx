import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { admin as adminApi, categories as categoriesApi, site as siteApi } from '../services/api';
import { formatDateTime } from '../utils/date';
import type { Category } from '../types';
import BackButton from '../components/BackButton';

// =====================================================================
// 管理后台（侧边栏布局版）
// 调用逻辑见本文件底部「API 调用对照」与 services/api.ts admin 命名空间
// =====================================================================

// ===== 通用组件 =====
function Msg({ msg, onClose }: { msg: string; onClose: () => void }) {
  if (!msg) return null;
  const isErr = msg.includes('失败') || msg.includes('错误') || msg.includes('不足') || msg.includes('无效');
  return (
    <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${isErr ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
      <span className="mr-2">{msg}</span>
      <button onClick={onClose} className="float-right text-gray-400 hover:text-gray-600">✕</button>
    </div>
  );
}

function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize?: number; onChange: (p: number) => void }) {
  const ps = pageSize || 20;
  const pages = Math.max(1, Math.ceil(total / ps));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}
        className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50 transition">上一页</button>
      <span className="text-sm text-gray-500">{page}/{pages}</span>
      <button onClick={() => onChange(page + 1)} disabled={page >= pages}
        className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50 transition">下一页</button>
    </div>
  );
}

function ConfirmModal({ title, children, onConfirm, onCancel, confirmText, danger }: {
  title: string; children: React.ReactNode; onConfirm: () => void; onCancel: () => void;
  confirmText?: string; danger?: boolean;
}) {
  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-[100] p-0 md:p-4" onClick={onCancel}>
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="p-5 pb-0 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg">{title}</h3>
            <button onClick={onCancel} className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm">✕</button>
          </div>
          {children}
        </div>
        <div className="flex gap-2 justify-end p-5 border-t bg-white rounded-b-2xl flex-shrink-0">
          <button onClick={onCancel} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition flex-1 md:flex-none">取消</button>
          <button onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex-1 md:flex-none ${danger ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
            {confirmText || '确认'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function useConfirmModal() {
  const [target, setTarget] = useState<{ title: string; text: string; action: () => void } | null>(null);
  const confirm = (title: string, text: string, action: () => void) => setTarget({ title, text, action });
  const el = target ? (
    <ConfirmModal title={target.title} onConfirm={() => { target.action(); setTarget(null); }} onCancel={() => setTarget(null)} confirmText="确认" danger>
      <p className="text-sm text-gray-600">{target.text}</p>
    </ConfirmModal>
  ) : null;
  return { confirm, el };
}

function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }, (_, j) => <div key={j} className="h-6 bg-gray-100 rounded flex-1" />)}
        </div>
      ))}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-primary-500';
const thCls = 'text-left px-4 py-3 font-medium text-gray-600';
const tdCls = 'px-4 py-3';

// =====================================================================
// 概览
// =====================================================================
function StatsPanel({ go }: { go: (id: AdminMenuId) => void }) {
  const [stats, setStats] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [pendingReports, setPendingReports] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    adminApi.getStats().then(r => r.success && setStats(r.data));
    adminApi.getStatsDetail().then(r => r.success && setDetail(r.data));
    adminApi.listReports(1).then(r => { if (r.success) setPendingReports(r.total || 0); }).catch(() => {});
    adminApi.getSettings().then(r => { if (r.success) setAnnouncement((r.data || {}).announcement || ''); }).catch(() => {});
  }, []);

  if (!stats) return <TableSkeleton rows={2} cols={4} />;

  const items = [
    { label: '注册用户', value: stats.totalUsers || 0, color: 'bg-blue-500', bg: 'bg-blue-50' },
    { label: '论坛帖子', value: stats.totalPosts || 0, color: 'bg-emerald-500', bg: 'bg-emerald-50' },
    { label: '用户评论', value: stats.totalComments || 0, color: 'bg-amber-500', bg: 'bg-amber-50' },
    { label: '页面浏览', value: stats.totalViews || 0, color: 'bg-purple-500', bg: 'bg-purple-50' },
  ];

  return (
    <div className="space-y-4">
      {/* 主统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map(item => (
          <div key={item.label} className={`${item.bg} rounded-xl p-4 border`}>
            <div className={`w-2.5 h-2.5 rounded-full ${item.color} mb-2`} />
            <div className="text-2xl font-bold text-gray-900">{item.value.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-0.5">{item.label}</div>
          </div>
        ))}
      </div>

      {/* 待办 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => go('reports')}
          className={`flex items-center justify-between bg-white rounded-xl border p-4 text-left ${pendingReports > 0 ? 'border-red-200' : 'border-gray-100'}`}>
          <div>
            <p className="text-xs text-gray-400 mb-1">待审举报</p>
            <p className={`text-lg font-bold ${pendingReports > 0 ? 'text-red-600' : 'text-gray-400'}`}>{pendingReports} 条</p>
          </div>
          <span className="text-2xl">🚩</span>
        </button>
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 p-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">站点公告</p>
            <p className={`text-lg font-bold ${announcement ? 'text-green-600' : 'text-amber-600'}`}>{announcement ? '已设置' : '未设置'}</p>
          </div>
          <span className="text-2xl">📢</span>
        </div>
      </div>

      {/* 今日数据 + 分类统计 + 积分排行 */}
      {detail && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">今日数据</h3>
            <div className="grid grid-cols-3 text-center">
              <div><div className="text-xs text-gray-400 mb-1">注册</div><div className="text-xl font-bold text-blue-600">{detail.today.users}</div></div>
              <div><div className="text-xs text-gray-400 mb-1">帖子</div><div className="text-xl font-bold text-emerald-600">{detail.today.posts}</div></div>
              <div><div className="text-xs text-gray-400 mb-1">评论</div><div className="text-xl font-bold text-amber-600">{detail.today.comments}</div></div>
            </div>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">分类帖子数</h3>
            {detail.categories.length === 0 ? <p className="text-gray-400 text-sm">暂无数据</p> : (
              <div className="space-y-2">
                {detail.categories.slice(0, 8).map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <span className="w-20 truncate text-gray-600">{c.name}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${Math.min(100, (c.count / Math.max(...detail.categories.map((x: any) => x.count))) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-8 text-right">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">积分排行</h3>
            {detail.topUsers.length === 0 ? <p className="text-gray-400 text-sm">暂无数据</p> : (
              <div className="space-y-1.5">
                {detail.topUsers.slice(0, 8).map((u: any, i: number) => (
                  <div key={u.user_id || i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 truncate">{i + 1}. {u.username || '已注销'}</span>
                    <span className="font-medium">{u.coins ?? u.total_coins ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 置顶管理
// =====================================================================
function PinnedPanel() {
  const [list, setList] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const { confirm: confirmModal, el: confirmEl } = useConfirmModal();

  const load = () => adminApi.listPinned().then(r => r.success && setList(r.data || []));
  useEffect(() => { load(); }, []);

  const handleUnpin = async (id: number, title: string) => {
    try { await adminApi.unpinPost(id); setList(prev => prev.filter(p => p.id !== id)); setMsg(`已取消置顶「${title}」`); }
    catch (err: any) { setMsg(err.message); }
  };
  const handleMove = async (id: number, dir: 'up' | 'down') => {
    try { await adminApi.reorderPinned(id, dir); load(); } catch (err: any) { setMsg(err.message); }
  };

  return (
    <div className="max-w-2xl">
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="bg-white rounded-xl border p-4 md:p-6">
        <h3 className="font-bold mb-1">当前置顶的帖子</h3>
        <p className="text-xs text-gray-400 mb-4">使用上下箭头调整排序</p>
        {list.length === 0 ? <p className="text-gray-400 text-center py-8">暂无置顶帖子</p> : (
          <div className="divide-y">
            {list.map((post: any, i: number) => (
              <div key={post.id} className="py-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button onClick={() => handleMove(post.id, 'up')} disabled={i === 0}
                      className="text-xs px-1.5 py-0.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-20" title="上移">▲</button>
                    <button onClick={() => handleMove(post.id, 'down')} disabled={i === list.length - 1}
                      className="text-xs px-1.5 py-0.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-20" title="下移">▼</button>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm line-clamp-1">{post.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{post.username} · 浏览 {post.view_count}</p>
                  </div>
                </div>
                <button onClick={() => confirmModal('取消置顶', `确定取消置顶「${post.title}」？`, () => handleUnpin(post.id, post.title))}
                  className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded-lg hover:bg-red-50 shrink-0">取消置顶</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {confirmEl}
    </div>
  );
}

// =====================================================================
// 抽奖管理
// =====================================================================
function LotteryPanel() {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const CFG_DEFAULTS: Record<string, string> = {
    // 与后端 lottery-coins.ts DEFAULT_CFG 保持一致（加载时后端真实值会覆盖这些默认值）
    lottery_draw_cost: '40', lottery_draw10_cost: '360',
    lottery_rate_ssr: '5', lottery_rate_ssr_boost: '25', lottery_rate_sr: '15', lottery_rate_r: '30', lottery_rate_n: '50',
    lottery_pity_soft: '50', lottery_pity_hard: '80',
  };
  const [config, setConfig] = useState<Record<string, string>>({ ...CFG_DEFAULTS });
  const [edits, setEdits] = useState<Record<string, any>>({});
  const { confirm: confirmModal, el: confirmEl } = useConfirmModal();

  const load = async () => {
    try {
      const res = await (adminApi as any).lottery();
      if (res.success) {
        setData(res.data);
        setConfig({ ...CFG_DEFAULTS, ...(res.data.config || {}) });
        const e: Record<string, any> = { new: { name: '', emoji: '', type: 'coins', value: '', weight: 1, rarity: 'N' } };
        (res.data.prizes || []).forEach((p: any) => { e[p.id] = { ...p }; });
        setEdits(e);
      }
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    const nums: Record<string, number> = {};
    for (const [k, v] of Object.entries(config)) {
      const n = parseInt(v);
      if (!Number.isFinite(n) || n < 0) { setMsg(`配置项 ${k} 必须是数字`); return; }
      nums[k] = n;
    }
    if (nums.lottery_pity_soft >= nums.lottery_pity_hard) { setMsg('软保底抽数必须小于硬保底抽数'); return; }
    try { const r = await (adminApi as any).updateLotteryConfig(nums); setMsg(r.message || '已保存'); }
    catch (err: any) { setMsg(err.message); }
  };

  const savePrize = async (id: number | 'new') => {
    const row = edits[id];
    if (!row) return;
    try {
      if (id === 'new') { const r = await (adminApi as any).createLotteryPrize(row); if (r.success) { setMsg('奖品已添加'); load(); } }
      else { const r = await (adminApi as any).updateLotteryPrize(id, row); if (r.success) { setMsg('奖品已更新'); load(); } }
    } catch (err: any) { setMsg(err.message); }
  };
  const deletePrize = async (id: number) => {
    try { const r = await (adminApi as any).deleteLotteryPrize(id); if (r.success) { setMsg('奖品已删除'); load(); } }
    catch (err: any) { setMsg(err.message); }
  };
  const setCell = (id: number | 'new', key: string, val: any) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], [key]: val } }));

  if (!data) return <TableSkeleton rows={3} cols={6} />;
  const types = ['coins','rename','vip','bump','highlight','fortune','avatar_frame','title_badge','rainbow_title','announce'];
  const rarities = ['N','R','SR','SSR'];

  return (
    <div className="space-y-6">
      <Msg msg={msg} onClose={() => setMsg('')} />
      {/* 数值配置 */}
      <div className="bg-white rounded-xl border p-4 md:p-6">
        <h3 className="font-bold mb-1">⚙️ 抽奖数值配置</h3>
        <p className="text-xs text-gray-400 mb-4">价格、概率、保底抽数均可修改，保存后立即生效</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[['lottery_draw_cost','单抽价格（积分）'],['lottery_draw10_cost','十连价格（积分）'],['lottery_rate_ssr','SSR 基础概率 %'],['lottery_rate_ssr_boost','SSR 软保底概率 %'],['lottery_rate_sr','SR 概率 %'],['lottery_rate_r','R 概率 %'],['lottery_rate_n','N 概率 %（参考）'],['lottery_pity_soft','软保底抽数'],['lottery_pity_hard','硬保底抽数']].map(([k, label]) => (
            <div key={k}><label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input type="number" min="0" className={inputCls} value={config[k]} onChange={e => setConfig({ ...config, [k]: e.target.value })} /></div>
          ))}
        </div>
        <button onClick={saveConfig} className="mt-4 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition">保存配置</button>
      </div>
      {/* 奖池 */}
      <div className="bg-white rounded-xl border p-4 md:p-6">
        <h3 className="font-bold mb-1">🎁 奖池管理</h3>
        <p className="text-xs text-gray-400 mb-4">名称/概率（权重）/稀有度均可改；删除后不再产出</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50">
              <tr><th className={thCls}>名称</th><th className={thCls}>图标</th><th className={thCls}>类型</th><th className={thCls}>值</th><th className={thCls}>稀有度</th><th className={thCls}>权重</th><th className={`${thCls} text-right`}>操作</th></tr>
            </thead>
            <tbody className="divide-y">
              {(data.prizes || []).map((p: any) => {
                const e = edits[p.id] || p;
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className={tdCls}><input className={inputCls} value={e.name} onChange={ev => setCell(p.id, 'name', ev.target.value)} /></td>
                    <td className={tdCls}><input className={`${inputCls} w-16`} value={e.emoji} onChange={ev => setCell(p.id, 'emoji', ev.target.value)} /></td>
                    <td className={tdCls}><select className={inputCls} value={e.type} onChange={ev => setCell(p.id, 'type', ev.target.value)}>{types.map(t => <option key={t} value={t}>{t}</option>)}</select></td>
                    <td className={tdCls}><input className={inputCls} value={e.value} onChange={ev => setCell(p.id, 'value', ev.target.value)} placeholder="数量 / vip:天数" /></td>
                    <td className={tdCls}><select className={inputCls} value={e.rarity} onChange={ev => setCell(p.id, 'rarity', ev.target.value)}>{rarities.map(r => <option key={r} value={r}>{r}</option>)}</select></td>
                    <td className={tdCls}><input type="number" min="1" className={`${inputCls} w-20`} value={e.weight} onChange={ev => setCell(p.id, 'weight', parseInt(ev.target.value) || 1)} /></td>
                    <td className={`${tdCls} text-right whitespace-nowrap`}>
                      <button onClick={() => savePrize(p.id)} className="text-xs text-primary-600 hover:underline mr-2">保存</button>
                      <button onClick={() => confirmModal('删除奖品', `确定删除奖品「${p.name}」？`, () => deletePrize(p.id))} className="text-xs text-red-600 hover:underline">删除</button>
                    </td>
                  </tr>
                );
              })}
              {(() => { const e = edits.new || {}; return (
                <tr className="bg-gray-50/50">
                  <td className={tdCls}><input className={inputCls} placeholder="新奖品名称" value={e.name || ''} onChange={ev => setCell('new', 'name', ev.target.value)} /></td>
                  <td className={tdCls}><input className={`${inputCls} w-16`} value={e.emoji || ''} onChange={ev => setCell('new', 'emoji', ev.target.value)} /></td>
                  <td className={tdCls}><select className={inputCls} value={e.type || 'coins'} onChange={ev => setCell('new', 'type', ev.target.value)}>{types.map(t => <option key={t} value={t}>{t}</option>)}</select></td>
                  <td className={tdCls}><input className={inputCls} value={e.value || ''} onChange={ev => setCell('new', 'value', ev.target.value)} /></td>
                  <td className={tdCls}><select className={inputCls} value={e.rarity || 'N'} onChange={ev => setCell('new', 'rarity', ev.target.value)}>{rarities.map(r => <option key={r} value={r}>{r}</option>)}</select></td>
                  <td className={tdCls}><input type="number" min="1" className={`${inputCls} w-20`} value={e.weight || 1} onChange={ev => setCell('new', 'weight', parseInt(ev.target.value) || 1)} /></td>
                  <td className={`${tdCls} text-right`}><button onClick={() => savePrize('new')} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 transition">添加</button></td>
                </tr>
              ); })()}
            </tbody>
          </table>
        </div>
      </div>
      {/* 保底排名 */}
      <div className="bg-white rounded-xl border p-4 md:p-6">
        <h3 className="font-bold mb-1">🎯 保底排名（距上次 SSR）</h3>
        <p className="text-xs text-gray-400 mb-3">全站累计抽奖 {data.totalPulls} 次</p>
        {data.topPity.length === 0 ? <p className="text-gray-400 text-sm py-4">暂无数据</p> : (
          <div className="divide-y">
            {data.topPity.map((p: any) => (
              <div key={p.user_id} className="py-2 flex items-center justify-between text-sm">
                <Link to={`/user/${p.user_id}`} className="text-primary-600 hover:underline">{p.username}</Link>
                <div className="text-right"><span className="font-medium">{p.pulls_since_ssr}</span><span className="text-gray-400 text-xs ml-1">抽</span><span className="text-gray-400 ml-2">共{p.total_pulls}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
      {confirmEl}
    </div>
  );
}

// =====================================================================
// 用户管理
// =====================================================================
function UsersPanel() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [banTarget, setBanTarget] = useState<any>(null);
  const [banDays, setBanDays] = useState('7');
  const [banUnit, setBanUnit] = useState<'hours' | 'days'>('days');
  const [banReason, setBanReason] = useState('');
  const [delTarget, setDelTarget] = useState<any>(null);
  const [delConfirmNum, setDelConfirmNum] = useState('');
  const [renameTarget, setRenameTarget] = useState<any>(null);
  const [newName, setNewName] = useState('');
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(null);

  const load = async (p?: number) => {
    try {
      const res = await adminApi.listUsers(p || page);
      if (res.success) { setList(res.data || []); setTotal(res.total || 0); }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(1); }, 300); return () => clearTimeout(t); }, [search]);

  const doSearch = async () => {
    if (!search.trim()) { load(); return; }
    try {
      const r = await adminApi.searchUsers(search.trim());
      if (r.success) { setList(r.data || []); setTotal(r.data?.length || 0); }
    } catch (err: any) { setMsg(err.message); }
  };

  const handleRole = async (id: number, role: string) => {
    try { await adminApi.updateUserRole(id, role); setMsg('角色已更新'); load(); } catch (err: any) { setMsg(err.message); }
  };
  const handleBan = async () => {
    if (!banTarget) return;
    try { await adminApi.banUser(banTarget.id, parseInt(banDays) || 1, banUnit, banReason.trim() || undefined); setMsg(`已封禁 ${banTarget.username}`); setBanTarget(null); setBanReason(''); load(); }
    catch (err: any) { setMsg(err.message); }
  };
  const handleUnban = async (id: number) => {
    try { await adminApi.unbanUser(id); setMsg('已解封'); load(); } catch (err: any) { setMsg(err.message); }
  };
  const handleDelete = async () => {
    if (!delTarget) return;
    if (delConfirmNum !== '3') { setMsg('请输入 3 以确认删除（三次确认）'); return; }
    try { await adminApi.deleteUser(delTarget.id, 3); setMsg(`已删除 ${delTarget.username}`); setDelTarget(null); setDelConfirmNum(''); load(); }
    catch (err: any) { setMsg(err.message); }
  };
  const handleRename = async () => {
    if (!renameTarget || !newName.trim()) return;
    try { await adminApi.setUsername(renameTarget.id, newName.trim()); setMsg('用户名已修改'); setRenameTarget(null); setNewName(''); load(); }
    catch (err: any) { setMsg(err.message); }
  };
  const handleReset = async () => {
    if (!resetTarget) return;
    try {
      const r = await adminApi.resetPassword(resetTarget.id);
      if (r.success && r.data?.temporary_password) setResetTempPassword(r.data.temporary_password);
      else { setMsg(r.error || '重置失败'); setResetTarget(null); }
    } catch (err: any) { setMsg(err.message); setResetTarget(null); }
  };

  return (
    <div>
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="flex gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="搜索用户名或邮箱..." className={`${inputCls} max-w-md`} />
        <button onClick={doSearch} className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 transition">搜索</button>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        {/* 表格容器保持横向滚动：移动端左右滑动查看全部列 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-gray-50">
              <tr><th className={thCls}>用户</th><th className={thCls}>邮箱</th><th className={thCls}>邮箱验证</th><th className={thCls}>角色</th><th className={thCls}>状态</th><th className={`${thCls} text-right`}>操作</th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((u: any) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className={tdCls}><Link to={`/user/${u.id}`} className="text-primary-600 hover:underline">{u.username}</Link></td>
                  <td className={`${tdCls} text-gray-500`}>{u.email}</td>
                  <td className={tdCls}>
                    {u.email_verified
                      ? <span className="text-[11px] bg-green-50 text-green-600 px-2 py-0.5 rounded font-medium">✓ 已验证</span>
                      : <span className="text-[11px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded font-medium">⚠ 未验证</span>}
                  </td>
                  <td className={tdCls}>
                    <select value={u.role} onChange={e => handleRole(u.id, e.target.value)} className="px-2 py-1 border rounded-lg text-xs">
                      <option value="user">用户</option><option value="moderator">巡查员</option><option value="admin">管理员</option>
                    </select>
                  </td>
                  <td className={`${tdCls} text-xs`}>
                    {u.banned_until ? <span className="text-red-600">封禁中</span>
                      : u.deleted_at ? <span className="text-gray-400">已注销</span>
                      : <span className="text-green-600">正常</span>}
                  </td>
                  <td className={`${tdCls} text-right whitespace-nowrap`}>
                    {u.banned_until
                      ? <button onClick={() => handleUnban(u.id)} className="px-2.5 py-1.5 rounded-lg border text-xs text-green-600 border-green-200 hover:bg-green-50 mr-1.5">解封</button>
                      : <button onClick={() => { setBanTarget(u); setBanReason(''); }} className="px-2.5 py-1.5 rounded-lg border text-xs text-red-600 border-red-200 hover:bg-red-50 mr-1.5">封禁</button>}
                    <button onClick={() => setRenameTarget(u)} className="px-2.5 py-1.5 rounded-lg border text-xs text-primary-600 border-primary-200 hover:bg-primary-50 mr-1.5">改名</button>
                    <button onClick={() => setResetTarget(u)} className="px-2.5 py-1.5 rounded-lg border text-xs text-violet-600 border-violet-200 hover:bg-violet-50 mr-1.5">重置密码</button>
                    <button onClick={() => { setDelTarget(u); setDelConfirmNum(''); }} className="px-2.5 py-1.5 rounded-lg border text-xs text-red-600 border-red-200 hover:bg-red-50">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="text-gray-400 text-center py-8 text-sm">暂无用户</p>}
      </div>
      <Pagination page={page} total={total} onChange={setPage} />

      {/* 封禁弹窗 */}
      {banTarget && (
        <ConfirmModal title={`封禁用户 - ${banTarget.username}`} onConfirm={handleBan} onCancel={() => setBanTarget(null)} confirmText="确认封禁" danger>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input type="number" min="1" value={banDays} onChange={e => setBanDays(e.target.value)} className={inputCls} />
              <select value={banUnit} onChange={e => setBanUnit(e.target.value as any)} className={inputCls}>
                <option value="hours">小时</option><option value="days">天</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">封禁原因（解封审核时展示，建议注明违规内容）</label>
              <textarea value={banReason} onChange={e => setBanReason(e.target.value)} rows={2} maxLength={200} className={inputCls} placeholder="如：发布广告帖 / 辱骂他人，附帖子链接" />
            </div>
          </div>
        </ConfirmModal>
      )}
      {/* 改名弹窗 */}
      {renameTarget && (
        <ConfirmModal title={`修改昵称 - ${renameTarget.username}`} onConfirm={handleRename} onCancel={() => setRenameTarget(null)} confirmText="保存">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="新用户名" className={inputCls} />
        </ConfirmModal>
      )}
      {/* 删除弹窗（三次确认） */}
      {delTarget && (
        <ConfirmModal title={`删除用户 - ${delTarget.username}`} onConfirm={handleDelete} onCancel={() => setDelTarget(null)} confirmText="确认删除" danger>
          <p className="text-sm text-gray-600 mb-3">此操作不可恢复，将删除该用户全部数据。输入 <strong>3</strong> 确认：</p>
          <input value={delConfirmNum} onChange={e => setDelConfirmNum(e.target.value)} className={inputCls} placeholder="3" />
        </ConfirmModal>
      )}
      {/* 重置密码弹窗 */}
      {resetTarget && !resetTempPassword && (
        <ConfirmModal title={`重置密码 - ${resetTarget.username}`} onConfirm={handleReset} onCancel={() => setResetTarget(null)} confirmText="确认重置" danger>
          <p className="text-sm text-gray-600">确定重置该用户的密码？重置后原密码立即失效，用户需使用新密码登录。</p>
        </ConfirmModal>
      )}
      {/* 临时密码展示（仅显示一次） */}
      {resetTarget && resetTempPassword && (
        <ConfirmModal title="密码已重置" onConfirm={() => { setResetTarget(null); setResetTempPassword(null); }} onCancel={() => { setResetTarget(null); setResetTempPassword(null); }} confirmText="关闭">
          <p className="text-sm font-medium text-amber-600 mb-2">⚠️ 请立即告知用户，新密码仅显示一次</p>
          <div className="flex items-center gap-2">
            <input readOnly value={resetTempPassword} className={`${inputCls} font-mono`} onFocus={e => e.target.select()} />
            <button onClick={() => { navigator.clipboard.writeText(resetTempPassword); setMsg('临时密码已复制'); }}
              className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 transition shrink-0">复制</button>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

// =====================================================================
// 安全日志
// =====================================================================
function SecurityLogsPanel() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');

  const load = async (p?: number) => {
    try {
      const r = await adminApi.securityLogs(p || page);
      if (r.success) { setList(r.data || []); setTotal(r.total || 0); }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);

  const ACTION_LABELS: Record<string, string> = {
    change_password: '修改密码',
    reset_password: '管理员重置密码',
    change_email: '修改邮箱',
  };

  return (
    <div>
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-gray-50">
              <tr><th className={thCls}>时间</th><th className={thCls}>用户</th><th className={thCls}>动作</th><th className={thCls}>详情</th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((log: any) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className={`${tdCls} text-xs text-gray-500 whitespace-nowrap`}>{formatDateTime(log.created_at)}</td>
                  <td className={tdCls}><Link to={`/user/${log.user_id}`} className="text-primary-600 hover:underline">{log.username || `#${log.user_id}`}</Link></td>
                  <td className={tdCls}><span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">{ACTION_LABELS[log.action] || log.action}</span></td>
                  <td className={`${tdCls} text-xs text-gray-500`}>{log.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="text-gray-400 text-center py-8 text-sm">暂无安全日志</p>}
      </div>
      <Pagination page={page} total={total} onChange={setPage} />
    </div>
  );
}

// =====================================================================
// VIP 管理
// =====================================================================
function VipPanel() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [editTarget, setEditTarget] = useState<any>(null);
  const [tier, setTier] = useState('vip');
  const [days, setDays] = useState('30');
  const [grant, setGrant] = useState({ userId: '', username: '', tier: 'vip', days: '30' });
  const { confirm: confirmModal, el: confirmEl } = useConfirmModal();

  const load = async (p?: number) => {
    try {
      const res = await adminApi.listVips(p || page, search || undefined);
      if (res.success) { setList(res.data || []); setTotal(res.total || 0); }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(1); }, 300); return () => clearTimeout(t); }, [search]);

  const handleDelete = async (userId: number, username: string) => {
    try { await adminApi.deleteVip(userId); setMsg('VIP 已取消'); load(); } catch (err: any) { setMsg(err.message); }
  };
  const handleEdit = async () => {
    if (!editTarget) return;
    try { await adminApi.setVip(editTarget.user_id, tier, parseInt(days) || 30); setMsg('VIP 已更新'); setEditTarget(null); load(); }
    catch (err: any) { setMsg(err.message); }
  };
  const handleGrant = async () => {
    const uid = parseInt(grant.userId);
    if (!uid) { setMsg('请输入用户 ID'); return; }
    try {
      const r = await adminApi.setVip(uid, grant.tier, parseInt(grant.days) || 30);
      setMsg(r.message || 'VIP 已发放'); setGrant({ userId: '', username: '', tier: 'vip', days: '30' }); load();
    } catch (err: any) { setMsg(err.message); }
  };

  return (
    <div className="space-y-4">
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-bold mb-3">🎁 手动发放 VIP</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <div><label className="block text-xs text-gray-500 mb-1">用户 ID</label><input value={grant.userId} onChange={e => setGrant({ ...grant, userId: e.target.value })} className={`${inputCls} w-28`} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">等级</label>
            <select value={grant.tier} onChange={e => setGrant({ ...grant, tier: e.target.value })} className={`${inputCls} w-28`}>
              <option value="vip">VIP</option><option value="s-vip">S-VIP</option><option value="svip+">SVIP+</option>
            </select></div>
          <div><label className="block text-xs text-gray-500 mb-1">天数</label><input type="number" min="1" value={grant.days} onChange={e => setGrant({ ...grant, days: e.target.value })} className={`${inputCls} w-24`} /></div>
          <button onClick={handleGrant} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition">发放</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-4 pb-0"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索用户名..." className={`${inputCls} max-w-md`} /></div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-gray-50">
              <tr><th className={thCls}>用户</th><th className={thCls}>等级</th><th className={thCls}>到期时间</th><th className={`${thCls} text-right`}>操作</th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((v: any) => (
                <tr key={v.user_id} className="hover:bg-gray-50">
                  <td className={tdCls}><Link to={`/user/${v.user_id}`} className="text-primary-600 hover:underline">{v.username}</Link></td>
                  <td className={tdCls}><span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">{v.tier}</span></td>
                  <td className={`${tdCls} text-xs text-gray-500`}>{formatDateTime(v.expires_at)}</td>
                  <td className={`${tdCls} text-right whitespace-nowrap`}>
                    <button onClick={() => { setEditTarget(v); setTier(v.tier); setDays(String(v.days_remaining || 30)); }} className="text-xs text-primary-600 hover:underline mr-2">修改</button>
                    <button onClick={() => confirmModal('取消 VIP', `确定取消用户「${v.username}」的 VIP？`, () => handleDelete(v.user_id, v.username))} className="text-xs text-red-600 hover:underline">取消</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="text-gray-400 text-center py-8 text-sm">暂无 VIP 用户</p>}
      </div>
      <Pagination page={page} total={total} onChange={setPage} />
      {editTarget && (
        <ConfirmModal title={`修改 VIP - ${editTarget.username}`} onConfirm={handleEdit} onCancel={() => setEditTarget(null)} confirmText="保存">
          <div className="space-y-3">
            <select value={tier} onChange={e => setTier(e.target.value)} className={inputCls}>
              <option value="vip">VIP</option><option value="s-vip">S-VIP</option><option value="svip+">SVIP+</option>
            </select>
            <input type="number" min="1" value={days} onChange={e => setDays(e.target.value)} className={inputCls} placeholder="续期天数" />
          </div>
        </ConfirmModal>
      )}
      {confirmEl}
    </div>
  );
}

// =====================================================================
// 侧边栏菜单与主布局（面板在下方文件继续定义）
// =====================================================================
export type AdminMenuId =
  | 'stats' | 'users' | 'unban' | 'posts' | 'comments' | 'pinned' | 'reports'
  | 'boards' | 'coins' | 'vips' | 'lottery' | 'settings' | 'announcement' | 'invites' | 'sec_logs' | 'patrol';

const MENU: { section: string; items: { id: AdminMenuId; label: string; icon: string }[] }[] = [
  { section: '', items: [{ id: 'stats', label: '概览', icon: '📊' }] },
  {
    section: '内容运营',
    items: [      { id: 'patrol', label: '巡查台', icon: '🛡️' },
      { id: 'posts', label: '帖子管理', icon: '📝' },
      { id: 'comments', label: '评论管理', icon: '💬' },
      { id: 'pinned', label: '置顶管理', icon: '📌' },
      { id: 'reports', label: '举报审核', icon: '🚩' },
      { id: 'boards', label: '板块管理', icon: '🗂️' },
    ],
  },
  {
    section: '用户管理',
    items: [
      { id: 'users', label: '用户管理', icon: '👥' },
      { id: 'unban', label: '解封审核', icon: '🔓' },
    ],
  },
  {
    section: '财务',
    items: [
      { id: 'coins', label: '积分管理', icon: '🪙' },
      { id: 'vips', label: 'VIP 管理', icon: '👑' },
      { id: 'lottery', label: '抽奖管理', icon: '🎰' },
    ],
  },
  {
    section: '系统',
    items: [
      { id: 'announcement', label: '公告管理', icon: '📢' },
      { id: 'settings', label: '系统设置', icon: '⚙️' },
      { id: 'invites', label: '邀请码', icon: '🎫' },
      { id: 'sec_logs', label: '安全日志', icon: '🛡️' },
    ],
  },
];

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menu, setMenu] = useState<AdminMenuId>('stats');

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 加载完成，避免刷新时误踢登录
    if (!user) { navigate('/login', { state: { from: location.pathname } }); return; }
    if (user.role !== 'admin' && user.role !== 'moderator') navigate('/');
  }, [authLoading, user, navigate, location.pathname]);

  if (authLoading) return null;
  if (!user) return null;

  // 巡查员引导至巡查台
  if (user.role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="text-5xl mb-4">🛡️</div>
        <h1 className="text-2xl font-bold mb-2">此页面仅管理员可用</h1>
        <p className="text-gray-500 mb-6">巡查员请使用独立的「巡查台」处理举报与内容巡查</p>
        <Link to="/moderator" className="inline-block px-5 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition">前往巡查台</Link>
      </div>
    );
  }

  const renderPanel = () => {
    switch (menu) {
      case 'stats': return <StatsPanel go={setMenu} />;
      case 'pinned': return <PinnedPanel />;
      case 'lottery': return <LotteryPanel />;
      case 'users': return <UsersPanel />;
      case 'vips': return <VipPanel />;
      case 'posts': return <PostsPanel />;
      case 'comments': return <CommentsPanel />;
      case 'reports': return <ReportsPanel />;
      case 'coins': return <CoinsPanel />;
      case 'unban': return <UnbanPanel />;
      case 'boards': return <CategoriesPanel />;
      case 'settings': return <SettingsPanel />;
      case 'announcement': return <AnnouncementPanel />;
      case 'invites': return <InvitesPanel />;
      case 'sec_logs': return <SecurityLogsPanel />;
      default: return <StatsPanel go={setMenu} />;
    }
  };

  return (
    <div className="flex gap-6">
      {/* 侧边栏 */}
      <aside className="hidden md:block w-52 shrink-0">
        <div className="sticky top-24 space-y-5">
          {MENU.map(group => (
            <div key={group.section || 'main'}>
              {group.section && <div className="text-[11px] font-medium text-gray-400 px-3 mb-1">{group.section}</div>}
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <button key={item.id} onClick={() => item.id === 'patrol' ? navigate('/moderator') : setMenu(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition text-left ${
                      menu === item.id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                    }`}>
                    <span className="text-base leading-none">{item.icon}</span>{item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 移动端横向菜单（溢出横向滚动，右侧渐隐提示可滑动） */}
      <div className="md:hidden w-full mb-2">
        <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-2 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
          {MENU.flatMap(g => g.items).map(item => (
            <button key={item.id} onClick={() => item.id === 'patrol' ? navigate('/moderator') : setMenu(item.id)}
              className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition ${
                menu === item.id ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}>
              {item.icon} {item.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-0.5 px-1">← 滑动查看更多</p>
      </div>

      {/* 内容区 */}
      <main className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-4">
          <BackButton />
          <h1 className="text-xl md:text-2xl font-bold">管理后台</h1>
        </div>
        {renderPanel()}
      </main>
    </div>
  );
}

// =====================================================================
// 帖子管理（后台视图：匿名帖返回真实作者 + is_anonymous 标记，需显示「匿名」标签）
// =====================================================================
function PostsPanel() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const { confirm: confirmModal, el: confirmEl } = useConfirmModal();

  const load = async (p?: number) => {
    try {
      const r = await adminApi.listPosts(p || page, search || undefined);
      if (r.success) { setList(r.data || []); setTotal(r.total || 0); }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(1); }, 300); return () => clearTimeout(t); }, [search]);

  const handleDelete = async (id: number, title: string) => {
    try { await adminApi.deletePost(id); setMsg('帖子已删除'); load(); } catch (err: any) { setMsg(err.message); }
  };
  const handleRestore = async (id: number, title: string) => {
    try { await adminApi.restorePost(id); setMsg('帖子已恢复，重新进入待巡查队列'); load(); } catch (err: any) { setMsg(err.message); }
  };
  const handleLock = async (id: number, isLocked: boolean) => {
    try { await adminApi.lockPost(id, isLocked); setMsg(isLocked ? '帖子已锁定' : '帖子已解锁'); load(); } catch (err: any) { setMsg(err.message); }
  };

  // 筛选：只看已下架（软删）的帖子，便于集中管理/提前硬删
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const visibleList = showDeletedOnly ? list.filter((p: any) => p.deleted_at) : list;

  return (
    <div>
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="mb-4 flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索帖子标题或作者..." className={`${inputCls} max-w-md`} />
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showDeletedOnly} onChange={e => setShowDeletedOnly(e.target.checked)} className="accent-red-500" />
          只看已下架
        </label>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50">
              <tr><th className={thCls}>标题</th><th className={thCls}>作者</th><th className={thCls}>板块</th><th className={`${thCls} text-right`}>浏览/赞/评</th><th className={`${thCls} text-right`}>操作</th></tr>
            </thead>
            <tbody className="divide-y">
              {visibleList.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className={`${tdCls} max-w-[280px]`}>
                    <Link to={`/post/${p.id}`} className="text-gray-700 hover:text-primary-600 transition line-clamp-1">{p.title}</Link>
                    <div className="flex gap-1 mt-0.5">
                      {p.is_pinned ? <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">置顶</span> : null}
                      {p.is_locked ? <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">锁定</span> : null}
                      {p.is_anonymous === 1 ? <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">🕶️ 匿名</span> : null}
                      {p.deleted_at ? <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">已下架</span> : null}
                    </div>
                  </td>
                  <td className={`${tdCls} text-gray-500`}>{p.username || '已注销'}</td>
                  <td className={`${tdCls} text-xs text-gray-500`}>{p.category_name || '—'}</td>
                  <td className={`${tdCls} text-right text-xs text-gray-500`}>{p.view_count}/{p.like_count}/{p.comment_count}</td>
                  <td className={`${tdCls} text-right whitespace-nowrap`}>
                    <button onClick={() => handleLock(p.id, !p.is_locked)} className={`text-xs hover:underline mr-2 ${p.is_locked ? 'text-green-600' : 'text-orange-600'}`}>{p.is_locked ? '解锁' : '锁定'}</button>
                    {p.deleted_at ? (
                      <>
                        <button onClick={() => confirmModal('恢复帖子', `确定恢复「${p.title.slice(0, 30)}」？恢复后重新进入待巡查队列。`, () => handleRestore(p.id, p.title))} className="text-xs text-green-600 hover:underline mr-2">恢复</button>
                        <button onClick={() => confirmModal('彻底删除', `确定彻底删除「${p.title.slice(0, 30)}」？将物理删除该帖及其全部点赞/评论/举报数据，不可恢复（未抢完的红包余额会退回）。`, () => handleDelete(p.id, p.title))} className="text-xs text-red-600 hover:underline">彻底删除</button>
                      </>
                    ) : (
                      <button onClick={() => confirmModal('删除帖子', `确定删除帖子「${p.title.slice(0, 30)}」？此操作不可撤销。`, () => handleDelete(p.id, p.title))} className="text-xs text-red-600 hover:underline">删除</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleList.length === 0 && <p className="text-gray-400 text-center py-8 text-sm">{showDeletedOnly ? '没有已下架的帖子' : '暂无帖子'}</p>}
      </div>
      <Pagination page={page} total={total} onChange={setPage} />
      {confirmEl}
    </div>
  );
}

// =====================================================================
// 评论管理
// =====================================================================
function CommentsPanel() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const { confirm: confirmModal, el: confirmEl } = useConfirmModal();

  const load = async (p?: number) => {
    try {
      const r = await adminApi.listComments(p || page, search || undefined);
      if (r.success) { setList(r.data || []); setTotal(r.total || 0); }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(1); }, 300); return () => clearTimeout(t); }, [search]);

  const handleDelete = async (id: number) => {
    try { await adminApi.deleteComment(id); setMsg('评论已删除'); load(); } catch (err: any) { setMsg(err.message); }
  };

  return (
    <div>
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="mb-4"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索评论内容或作者..." className={`${inputCls} max-w-md`} /></div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead className="bg-gray-50">
              <tr><th className={thCls}>内容</th><th className={thCls}>作者</th><th className={`${thCls} text-right`}>点赞</th><th className={thCls}>时间</th><th className={`${thCls} text-right`}>操作</th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className={`${tdCls} max-w-[320px]`}><Link to={`/post/${c.post_id}`} className="text-gray-700 hover:text-primary-600 transition line-clamp-1">{c.content_preview}</Link></td>
                  <td className={`${tdCls} text-gray-500`}>{c.username || '已注销'}</td>
                  <td className={`${tdCls} text-right`}>{c.like_count}</td>
                  <td className={`${tdCls} text-xs text-gray-500`}>{formatDateTime(c.created_at)}</td>
                  <td className={`${tdCls} text-right`}>
                    <button onClick={() => confirmModal('删除评论', '确定删除此评论？此操作不可撤销。', () => handleDelete(c.id))} className="text-xs text-red-600 hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="text-gray-400 text-center py-8 text-sm">暂无评论</p>}
      </div>
      <Pagination page={page} total={total} onChange={setPage} />
      {confirmEl}
    </div>
  );
}

// =====================================================================
// 举报审核（resolve = 硬删目标 + 扣作者积分）
// =====================================================================
function ReportsPanel() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { confirm: confirmModal, el: confirmEl } = useConfirmModal();

  const load = async (p?: number) => {
    try {
      const r = await adminApi.listReports(p || page);
      if (r.success) { setList(r.data || []); setTotal(r.total || 0); }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);

  const handle = async (id: number, action: 'resolve' | 'dismiss') => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === 'resolve') await adminApi.resolveReport(id);
      else await adminApi.dismissReport(id);
      setMsg(action === 'resolve' ? '已确认违规并处理' : '已驳回');
      load();
    } catch (err: any) { setMsg(err.message); }
    setBusy(false);
  };

  return (
    <div>
      <Msg msg={msg} onClose={() => setMsg('')} />
      {list.length === 0 ? <p className="text-gray-400 text-center py-12 text-sm">暂无待审举报</p> : (
        <div className="space-y-3">
          {list.map((r: any) => (
            <div key={r.id} className="bg-white rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${r.target_type === 'post' ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-700'}`}>{r.target_type === 'post' ? '帖子' : '评论'}</span>
                <span className="text-sm font-medium text-gray-800">{r.post_title || r.comment_content || `#${r.target_id}`}</span>
                <span className="text-xs text-gray-400 ml-auto">{formatDateTime(r.created_at)}</span>
              </div>
              <div className="text-sm text-gray-600 mb-1">举报理由：{r.reason}</div>
              <div className="text-xs text-gray-400 mb-3">举报人：{r.reporter_name || '已注销'}</div>
              <div className="flex gap-2">
                <button onClick={() => confirmModal('确认违规', '将删除目标内容并扣除作者积分（不可撤销）', () => handle(r.id, 'resolve'))} disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50">确认违规 · 删除</button>
                <button onClick={() => confirmModal('驳回举报', '确定驳回此举报（不处理）？', () => handle(r.id, 'dismiss'))} disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">驳回</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} total={total} onChange={setPage} />
      {confirmEl}
    </div>
  );
}

// =====================================================================
// 积分管理
// =====================================================================
function CoinsPanel() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');
  const [target, setTarget] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const load = async (p?: number) => {
    try {
      const r = await adminApi.listCoins(p || page);
      if (r.success) { setList(r.data || []); setTotal(r.total || 0); }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);

  const handleAdjust = async () => {
    if (!target) return;
    const amt = parseInt(amount);
    if (!Number.isFinite(amt) || amt === 0) { setMsg('请输入非零整数'); return; }
    try { await adminApi.adjustCoins(target.user_id, amt, reason || undefined); setMsg('积分已调整'); setTarget(null); setAmount(''); setReason(''); load(); }
    catch (err: any) { setMsg(err.message); }
  };

  return (
    <div>
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-gray-50">
              <tr><th className={thCls}>用户</th><th className={`${thCls} text-right`}>余额</th><th className={`${thCls} text-right`}>累计赚取</th><th className={`${thCls} text-right`}>累计消费</th><th className={`${thCls} text-right`}>操作</th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((u: any) => (
                <tr key={u.user_id} className="hover:bg-gray-50">
                  <td className={tdCls}><Link to={`/user/${u.user_id}`} className="text-primary-600 hover:underline">{u.username}</Link></td>
                  <td className={`${tdCls} text-right font-medium`}>{u.coins}</td>
                  <td className={`${tdCls} text-right text-gray-500`}>{u.total_earned}</td>
                  <td className={`${tdCls} text-right text-gray-500`}>{u.total_spent}</td>
                  <td className={`${tdCls} text-right`}>
                    <button onClick={() => { setTarget(u); setAmount(''); setReason(''); }} className="text-xs text-primary-600 hover:underline">调整</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="text-gray-400 text-center py-8 text-sm">暂无数据</p>}
      </div>
      <Pagination page={page} total={total} onChange={setPage} />
      {target && (
        <ConfirmModal title={`调整积分 - ${target.username}`} onConfirm={handleAdjust} onCancel={() => setTarget(null)} confirmText="调整">
          <div className="space-y-3">
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} placeholder="金额（正数增加/负数扣除）" />
            <input value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder="原因（可选）" />
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

// =====================================================================
// 解封审核
// =====================================================================
function UnbanPanel() {
  const [requests, setRequests] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const { confirm: confirmModal, el: confirmEl } = useConfirmModal();

  const load = async (p?: number) => {
    try {
      const res = await (adminApi as any).unbanRequests(p || page);
      if (res.success) { setRequests(res.data || []); setTotal(res.total || 0); }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);

  const approve = async (id: number) => {
    try {
      const res = await (adminApi as any).approveUnban(id);
      if (res.success) { setMsg('已解封'); load(); }
    } catch (err: any) { setMsg(err.message); }
  };
  const reject = async () => {
    if (rejectId === null) return;
    try {
      const res = await (adminApi as any).rejectUnban(rejectId, rejectNote || undefined);
      if (res.success) { setMsg('已驳回，积分已退还'); setRejectId(null); setRejectNote(''); load(); }
    } catch (err: any) { setMsg(err.message); }
  };

  return (
    <div>
      <Msg msg={msg} onClose={() => setMsg('')} />
      {requests.length === 0 ? <p className="text-gray-400 text-center py-12 text-sm">暂无解封申请</p> : (
        <div className="space-y-3">
          {requests.map((r: any) => (
            <div key={r.id} className="bg-white rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Link to={`/user/${r.user_id}`} className="font-medium text-primary-600 hover:underline">{r.username || `#${r.user_id}`}</Link>
                <span className="text-xs text-gray-400">付费 {r.coins_paid} 积分申请解封</span>
                <span className="text-xs text-gray-400 ml-auto">{formatDateTime(r.created_at)}</span>
              </div>
              {r.reason && <div className="text-sm text-gray-600 mb-3">理由：{r.reason}</div>}
              {r.ban_reason ? (
                <div className="mb-3 px-3 py-2 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
                  <span className="font-medium">封禁原因：</span>{r.ban_reason}
                </div>
              ) : (
                <div className="mb-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-400">封禁时未填写原因</div>
              )}
              <div className="flex gap-2">
                <button onClick={() => confirmModal('通过解封申请', '确定通过此解封申请？用户将被解除封禁。', () => approve(r.id))}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-500 text-white hover:bg-green-600 transition">通过</button>
                <button onClick={() => setRejectId(r.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition">驳回</button>
              </div>
              {rejectId === r.id && (
                <div className="mt-3 flex gap-2">
                  <input value={rejectNote} onChange={e => setRejectNote(e.target.value)} placeholder="驳回原因" className={`${inputCls} flex-1`} />
                  <button onClick={reject} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm" disabled={!rejectNote.trim()}>确认驳回</button>
                  <button onClick={() => { setRejectId(null); setRejectNote(''); }} className="px-3 py-1.5 border rounded-lg text-sm">取消</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} total={total} pageSize={20} onChange={setPage} />
      {confirmEl}
    </div>
  );
}

// =====================================================================
// 板块管理（板块即 categories；匿名/付费/启停开关 + 帖子数）
// =====================================================================
function CategoriesPanel() {
  const [catList, setCatList] = useState<Category[]>([]);
  const [name, setName] = useState(''); const [slug, setSlug] = useState('');
  const [description, setDescription] = useState(''); const [sortOrder, setSortOrder] = useState(0);
  const [allowAnonymous, setAllowAnonymous] = useState(0); const [isActive, setIsActive] = useState(1);
  const [allowPaid, setAllowPaid] = useState(0); const [allowThanks, setAllowThanks] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [postCounts, setPostCounts] = useState<Record<number, number>>({});
  const { confirm: confirmModal, el: confirmEl } = useConfirmModal();

  useEffect(() => { loadCategories(); }, []);
  useEffect(() => {
    adminApi.getStatsDetail().then(r => {
      if (r.success && Array.isArray(r.data?.categories)) {
        const m: Record<number, number> = {};
        (r.data.categories as any[]).forEach((c: any) => { if (c && c.id != null) m[c.id] = c.count || 0; });
        setPostCounts(m);
      }
    }).catch(() => {});
  }, []);

  const loadCategories = async () => {
    // 加载全部（含已停用），前端分组展示；已停用的单独列「已停用」栏方便重新启用
    const r = await categoriesApi.list(true);
    if (r.success && r.data) setCatList(r.data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) { await categoriesApi.update(editingId, { name, slug, description, sort_order: sortOrder, allow_anonymous: allowAnonymous, is_active: isActive, allow_paid: allowPaid, allow_thanks: allowThanks }); setMsg('板块已更新'); }
      else { await categoriesApi.create(name, slug, description, sortOrder, allowAnonymous, isActive, allowPaid, allowThanks); setMsg('板块已创建'); }
      resetForm(); loadCategories();
    } catch (err: any) { setMsg(err.message); }
  };

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id); setName(cat.name); setSlug(cat.slug);
    setDescription(cat.description); setSortOrder(cat.sort_order);
    setAllowAnonymous(cat.allow_anonymous); setIsActive(cat.is_active); setAllowPaid(cat.allow_paid); setAllowThanks(cat.allow_thanks ?? 0);
  };
  const handleToggleActive = async (cat: Category) => {
    const next = cat.is_active === 1 ? 0 : 1;
    try { await categoriesApi.update(cat.id, { is_active: next }); setMsg(next === 1 ? '板块已启用' : '板块已停用'); loadCategories(); }
    catch (err: any) { setMsg(err.message); }
  };
  // 快捷切换板块感谢开关
  const handleToggleThanks = async (cat: Category) => {
    const next = cat.allow_thanks === 1 ? 0 : 1;
    try { await categoriesApi.update(cat.id, { allow_thanks: next }); setMsg(next === 1 ? '板块已启用感谢' : '板块已关闭感谢'); loadCategories(); }
    catch (err: any) { setMsg(err.message); }
  };
  const handleDelete = async (id: number) => {
    await categoriesApi.delete(id); setMsg('板块已删除'); loadCategories();
  };
  const resetForm = () => { setEditingId(null); setName(''); setSlug(''); setDescription(''); setSortOrder(0); setAllowAnonymous(0); setIsActive(1); setAllowPaid(0); setAllowThanks(0); };

  return (
    <div className="grid md:grid-cols-2 gap-4 md:gap-6">
      {/* 提示只占一横行（跨满两列），不挤占新增/列表区域 */}
      <div className="md:col-span-2"><Msg msg={msg} onClose={() => setMsg('')} /></div>
      <div className="bg-white rounded-xl border p-4 md:p-6">
        <h3 className="font-bold mb-4">{editingId ? '编辑板块' : '新增板块'}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
            <input type="text" value={name} onChange={e => { setName(e.target.value); if (!editingId) setSlug(e.target.value.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'untitled'); }} className={inputCls} required /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">标识</label>
            <input type="text" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^\w-]/g, ''))} className={inputCls} required /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={inputCls} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">排序</label>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(parseInt(e.target.value) || 0)} className={inputCls} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">允许匿名</label>
              <select value={allowAnonymous} onChange={e => setAllowAnonymous(parseInt(e.target.value))} className={inputCls}>
                <option value={0}>否</option><option value={1}>是</option>
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">支持付费</label>
              <select value={allowPaid} onChange={e => setAllowPaid(parseInt(e.target.value))} className={inputCls}>
                <option value={0}>否</option><option value={1}>是</option>
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">启用感谢</label>
              <select value={allowThanks} onChange={e => setAllowThanks(parseInt(e.target.value))} className={inputCls}>
                <option value={0}>关闭</option><option value={1}>启用</option>
              </select></div>
          </div>
          <div className="flex gap-2 justify-end">
            {editingId && <button type="button" onClick={resetForm} className="px-4 py-2 border rounded-lg text-sm text-gray-600">取消</button>}
            <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition">{editingId ? '更新' : '创建'}</button>
          </div>
        </form>
      </div>
      <div className="bg-white rounded-xl border p-4 md:p-6">
        <h3 className="font-bold mb-4">已有板块</h3>
        {catList.length === 0 ? <p className="text-gray-400 text-sm">暂无板块</p> : (
          <div className="space-y-4">
            {/* 启用中的板块 */}
            <div>
              <p className="text-xs font-semibold text-gray-400 mb-2">启用中（{catList.filter(c => c.is_active === 1).length}）</p>
              <div className="space-y-2">
                {catList.filter(c => c.is_active === 1).map(cat => (
                  <CategoryRow key={cat.id} cat={cat} postCounts={postCounts}
                    onToggleActive={handleToggleActive} onToggleThanks={handleToggleThanks}
                    onEdit={handleEdit} onDelete={(id) => confirmModal('删除板块', '确定删除此板块？板块下的帖子将无法再被归类。', () => handleDelete(id))} />
                ))}
              </div>
            </div>
            {/* 已停用的板块（单独列出，方便重新启用） */}
            {catList.some(c => c.is_active !== 1) && (
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-2">已停用（{catList.filter(c => c.is_active !== 1).length}）</p>
                <div className="space-y-2">
                  {catList.filter(c => c.is_active !== 1).map(cat => (
                    <div key={cat.id} className="flex items-center justify-between p-3 bg-gray-100/60 dark:bg-gray-800/40 rounded-lg opacity-80">
                      <div>
                        <p className="font-medium text-sm">{cat.name}</p>
                        <p className="text-xs text-gray-400">{cat.slug} · 排序 {cat.sort_order} · 匿名 {cat.allow_anonymous === 1 ? '是' : '否'} · 付费 {cat.allow_paid === 1 ? '是' : '否'} · 感谢 {cat.allow_thanks === 1 ? '✅ 启用' : '关闭'} · 帖子 {postCounts[cat.id] ?? '—'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleToggleActive(cat)} className="text-xs text-green-600 hover:underline">重新启用</button>
                        <button onClick={() => handleEdit(cat)} className="text-xs text-primary-600 hover:underline">编辑</button>
                        <button onClick={() => confirmModal('删除板块', '确定删除此板块？板块下的帖子将无法再被归类。', () => handleDelete(cat.id))} className="text-xs text-red-600 hover:underline">删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {confirmEl}
    </div>
  );
}

// 启用中板块单行
function CategoryRow({ cat, postCounts, onToggleActive, onToggleThanks, onEdit, onDelete }: {
  cat: Category;
  postCounts: Record<number, number>;
  onToggleActive: (c: Category) => void;
  onToggleThanks: (c: Category) => void;
  onEdit: (c: Category) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div key={cat.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
      <div>
        <p className="font-medium text-sm">{cat.name}</p>
        <p className="text-xs text-gray-400">{cat.slug} · 排序 {cat.sort_order} · 匿名 {cat.allow_anonymous === 1 ? '是' : '否'} · 付费 {cat.allow_paid === 1 ? '是' : '否'} · 感谢 {cat.allow_thanks === 1 ? '✅ 启用' : '关闭'} · 帖子 {postCounts[cat.id] ?? '—'}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => onToggleThanks(cat)} className={`text-xs hover:underline ${cat.allow_thanks === 1 ? 'text-primary-600' : 'text-gray-400'}`}>{cat.allow_thanks === 1 ? '关感谢' : '开感谢'}</button>
        <button onClick={() => onToggleActive(cat)} className={`text-xs hover:underline ${cat.is_active === 1 ? 'text-amber-600' : 'text-green-600'}`}>{cat.is_active === 1 ? '停用' : '启用'}</button>
        <button onClick={() => onEdit(cat)} className="text-xs text-primary-600 hover:underline">编辑</button>
        <button onClick={() => onDelete(cat.id)} className="text-xs text-red-600 hover:underline">删除</button>
      </div>
    </div>
  );
}

// =====================================================================
// 公告管理专栏：独立发布入口（不在系统设置里设置）
// =====================================================================
function AnnouncementPanel() {
  const [content, setContent] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    adminApi.getSettings().then(r => { if (r.success) setContent((r.data || {}).announcement || ''); }).catch(() => {});
    siteApi.announcement().then(r => {
      if (r.success && r.data?.announcement_updated_at) setInfo(`上次更新：${r.data.announcement_updated_at}`);
    }).catch(() => {});
  }, []);

  const publish = async () => {
    setPublishing(true);
    try {
      const r = await adminApi.updateSettings({ announcement: content });
      if (r.success) {
        setMsg('公告已发布——所有用户的公告提醒将重新显示');
        siteApi.announcement().then(r2 => {
          if (r2.success && r2.data?.announcement_updated_at) setInfo(`上次更新：${r2.data.announcement_updated_at}`);
        }).catch(() => {});
      } else setMsg(r.error || '发布失败');
    } catch (err: any) { setMsg(err.message); }
    setPublishing(false);
  };

  return (
    <div className="max-w-xl">
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="bg-white dark:bg-[#111] border rounded-2xl p-5">
        <h3 className="font-semibold mb-1">发布全站公告</h3>
        <p className="text-xs text-gray-400 mb-3">
          公告显示在首页侧边栏与顶栏横幅。每次发布后，所有用户的公告提醒会重新出现；用户点击「知道了，不再显示」后隐藏，直到下次发布。
        </p>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={6}
          placeholder="输入公告内容，支持多行…"
          className={inputCls} maxLength={2000} />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-400">{content.length}/2000{info && ` · ${info}`}</span>
          <button onClick={publish} disabled={publishing || !content.trim()}
            className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">
            {publishing ? '发布中...' : '发布公告'}
          </button>
        </div>
      </div>
      {/* 预览（侧边栏样式） */}
      <div className="bg-white dark:bg-[#111] border rounded-2xl p-5 mt-4">
        <h4 className="text-sm font-semibold mb-2">预览</h4>
        <div className="border border-primary-200 dark:border-primary-800 rounded-xl p-3 bg-primary-50/40 dark:bg-primary-950/30">
          <div className="text-xs font-semibold text-primary-600 dark:text-primary-400 mb-1">📢 全站公告</div>
          <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{content || '（空）'}</p>
        </div>
      </div>
    </div>
  );
}

// 系统设置（settings 键值对，白名单更新；公告已独立到「公告管理」专栏）
// =====================================================================
function SettingsPanel() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  useEffect(() => { adminApi.getSettings().then(r => r.success && setSettings(r.data || {})); }, []);

  const handleSave = async () => {
    try { await adminApi.updateSettings(settings); setMsg('设置已保存'); }
    catch (err: any) { setMsg(err.message); }
  };

  const labels: Record<string, string> = {
    site_name: '站点名称', site_description: '站点描述',
    registration_enabled: '允许注册', email_verification_required: '需要邮箱验证',
    register_enabled: '允许注册(旧)', invite_only: '仅邀请注册', check_in_enabled: '签到功能',
    post_audit_enabled: '发帖审核', default_user_coins: '新用户初始积分',
    maintenance_mode: '维护模式', contact_email: '联系邮箱',
    patrol_pass_limit: '帖子巡查-放行票数',
    patrol_violation_limit: '帖子巡查-违规票数',
    report_pass_limit: '举报审核-放行票数',
    report_violation_limit: '举报审核-违规票数',
    review_reject_coins: '打回扣分',
    review_takedown_coins: '举报下架扣分',
    report_reward_coins: '举报成功奖励',
    appeal_review_level: '已下架复审等级门槛',
    soft_delete_retention_days: '软删保留天数',
  };
  const groups: { title: string; keys: string[] }[] = [
    { title: '基础信息', keys: ['site_name', 'site_description', 'contact_email'] },
    { title: '注册与内容', keys: ['registration_enabled', 'email_verification_required', 'register_enabled', 'invite_only', 'check_in_enabled', 'post_audit_enabled', 'default_user_coins'] },
    {
      title: '巡查体系',
      keys: ['patrol_pass_limit', 'patrol_violation_limit', 'report_pass_limit', 'report_violation_limit', 'review_reject_coins', 'review_takedown_coins', 'report_reward_coins', 'appeal_review_level', 'soft_delete_retention_days'],
    },
    { title: '维护', keys: ['maintenance_mode'] },
  ];
  const groupedKeys = new Set(groups.flatMap(g => g.keys));
  const smtpKeys = new Set(['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from']);

  const renderField = (key: string, value: string) => (
    <div key={key}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{labels[key] || key}</label>
      {['registration_enabled','email_verification_required','register_enabled','invite_only','check_in_enabled','post_audit_enabled','maintenance_mode'].includes(key) ? (
        <select value={value} onChange={e => setSettings({ ...settings, [key]: e.target.value })} className={inputCls}>
          <option value="1">开启</option><option value="0">关闭</option>
        </select>
      ) : ['patrol_pass_limit','patrol_violation_limit','report_pass_limit','report_violation_limit'].includes(key) ? (
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={10} value={value} onChange={e => setSettings({ ...settings, [key]: e.target.value })}
            className={`${inputCls} w-24`} />
          <span className="text-xs text-gray-400">
            {key === 'patrol_pass_limit' ? '名巡查员投「没问题」后放行' :
             key === 'patrol_violation_limit' ? '名巡查员确认违规后打回重新编辑' :
             key === 'report_pass_limit' ? '名巡查员投「无违规」后放行取消举报' :
             '名巡查员确认违规后下架'}
            （管理员一票否决/一票通过不受此限制）
          </span>
        </div>
      ) : ['review_reject_coins','review_takedown_coins','report_reward_coins'].includes(key) ? (
        <div className="flex items-center gap-2">
          <input type="number" min={0} max={1000} value={value} onChange={e => setSettings({ ...settings, [key]: e.target.value })}
            className={`${inputCls} w-24`} />
          <span className="text-xs text-gray-400">
            {key === 'review_reject_coins' ? '打回重新编辑扣除的积分（超时未修改删除时同额再扣）' :
             key === 'review_takedown_coins' ? '举报确认违规下架时扣除作者的积分' :
             '举报确认有效时奖励举报人的积分（驳回不发）'}
          </span>
        </div>
      ) : key === 'appeal_review_level' ? (
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={20} value={value} onChange={e => setSettings({ ...settings, [key]: e.target.value })}
            className={`${inputCls} w-24`} />
          <span className="text-xs text-gray-400">巡查等级达到该等级才可见/使用「已下架复审」分区（管理员无限制）</span>
        </div>
      ) : key === 'soft_delete_retention_days' ? (
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={3650} value={value} onChange={e => setSettings({ ...settings, [key]: e.target.value })}
            className={`${inputCls} w-24`} />
          <span className="text-xs text-gray-400">软删帖保留天数，到期后自动物理删除（红包余额会退回）</span>
        </div>
      ) : (
        <input type="text" value={value} onChange={e => setSettings({ ...settings, [key]: e.target.value })} className={inputCls} />
      )}
    </div>
  );

  const allEntries = Object.entries(settings).filter(([key]) => !smtpKeys.has(key));

  return (
    <div className="max-w-xl">
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="space-y-4">
        {groups.map(g => {
          const entries = allEntries.filter(([key]) => g.keys.includes(key));
          if (entries.length === 0) return null;
          return (
            <div key={g.title} className="bg-white rounded-xl border p-4 md:p-6">
              <h3 className="font-bold text-sm text-gray-500 mb-4">{g.title}</h3>
              <div className="space-y-4">{entries.map(([k, v]) => renderField(k, v))}</div>
            </div>
          );
        })}
        {(() => { const others = allEntries.filter(([key]) => !groupedKeys.has(key)); return others.length === 0 ? null : (
          <div className="bg-white rounded-xl border p-4 md:p-6">
            <h3 className="font-bold text-sm text-gray-500 mb-4">其他</h3>
            <div className="space-y-4">{others.map(([k, v]) => renderField(k, v))}</div>
          </div>
        ); })()}
        <button onClick={handleSave} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition">保存设置</button>
      </div>
    </div>
  );
}

// =====================================================================
// 邀请码
// =====================================================================
function InvitesPanel() {
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const loadCodes = async () => {
    setLoading(true);
    try {
      const res = await adminApi.listInvites();
      if (res.success) setCodes(res.data || []);
    } catch (err: any) { setMsg(err.message); }
    setLoading(false);
  };
  useEffect(() => { loadCodes(); }, []);

  const handleCreate = async () => {
    try {
      const res = await adminApi.createInvite();
      if (res.success) { setMsg(`邀请码已生成：${res.data?.code}`); loadCodes(); }
    } catch (err: any) { setMsg(err.message); }
  };

  // 删除邀请码（未使用/已使用均可删）
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const handleDelete = async (code: string) => {
    try {
      const res = await adminApi.deleteInvite(code);
      if (res.success) { setMsg(`邀请码 ${code} 已删除`); setConfirmCode(null); loadCodes(); }
      else setMsg(res.error || '删除失败');
    } catch (err: any) { setMsg(err.message); }
  };

  const statusText = (c: any) => {
    if (c.used_by) return '已使用';
    if (c.expires_at && new Date(c.expires_at) < new Date()) return '已过期';
    return '未使用';
  };

  return (
    <div className="max-w-2xl">
      <Msg msg={msg} onClose={() => setMsg('')} />
      <div className="mb-4">
        <button onClick={handleCreate} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition">生成邀请码</button>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-gray-50">
              <tr><th className={thCls}>邀请码</th><th className={thCls}>状态</th><th className={thCls}>创建时间</th><th className={thCls}>操作</th></tr>
            </thead>
            <tbody className="divide-y">
              {codes.map((c: any) => (
                <tr key={c.code} className="hover:bg-gray-50">
                  <td className={`${tdCls} font-mono`}>{c.code}</td>
                  <td className={tdCls}><span className={`text-xs px-2 py-0.5 rounded ${c.used_by ? 'bg-gray-100 text-gray-500' : c.expires_at && new Date(c.expires_at) < new Date() ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{statusText(c)}</span></td>
                  <td className={`${tdCls} text-xs text-gray-500`}>{formatDateTime(c.created_at)}</td>
                  <td className={tdCls}>
                    <button onClick={() => setConfirmCode(c.code)} className="text-xs text-red-500 hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && codes.length === 0 && <p className="text-gray-400 text-center py-8 text-sm">暂无邀请码</p>}
      </div>

      {/* 删除确认 */}
      {confirmCode && (
        <ConfirmModal
          title="删除邀请码"
          confirmText="删除"
          danger
          onConfirm={() => handleDelete(confirmCode)}
          onCancel={() => setConfirmCode(null)}
        >
          确定删除邀请码 <code className="font-mono font-semibold">{confirmCode}</code> 吗？删除后不可恢复（已使用的码删除不影响已注册用户）。
        </ConfirmModal>
      )}
    </div>
  );
}