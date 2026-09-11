import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { markdownSchema, isSafeMediaSrc } from '../utils/markdownSanitize';
import { useAuth } from '../contexts/AuthContext';
import { admin as adminApi, moderation as moderationApi, appeals as appealsApi } from '../services/api';
import type { PatrolStats } from '../types';
import { formatDateTime } from '../utils/date';
import EmptyState from '../components/EmptyState';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFlag, faNewspaper, faEye, faRobot } from '@fortawesome/free-solid-svg-icons';
import BackButton from '../components/BackButton';

// 巡查预览的 markdown 渲染配置（与 PostDetail 一致：GFM/换行/富媒体/iframe 白名单）
const patrolMarkdownComponents = {
  img: ({ src, alt }: { src?: string; alt?: string }) =>
    isSafeMediaSrc(src, 'img') ? (
      <img src={src} alt={alt || ''} className="max-w-full max-h-80 md:max-h-96 w-auto rounded-lg my-3 object-contain" />
    ) : null,
  video: ({ src, controls }: { src?: string; controls?: boolean }) =>
    isSafeMediaSrc(src, 'video') ? (
      <video src={src} controls className="w-full max-h-[70vh] rounded-lg my-3 shadow-md bg-black" />
    ) : null,
  iframe: ({ src, title }: { src?: string; title?: string }) =>
    isSafeMediaSrc(src, 'iframe') ? (
      <div className="relative w-full aspect-video my-3 rounded-lg overflow-hidden shadow-md bg-black">
        <iframe src={src} title={title || '嵌入式视频'} loading="lazy"
          className="absolute inset-0 w-full h-full" allowFullScreen />
      </div>
    ) : null,
};

// 灰色占位头像（不显示任何内容，保护被巡查/被举报用户隐私）
function GrayAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap = { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-14 h-14' };
  return <div className={`${sizeMap[size]} bg-gray-200 dark:bg-gray-700 rounded-full flex-shrink-0`} aria-hidden />;
}

// ===== 简版分页（Admin 的组件不跨文件复用） =====
function Pager({ page, total, pageSize = 10, onChange }: { page: number; total: number; pageSize?: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}
        className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 bg-white text-gray-600">上一页</button>
      <span className="text-sm text-gray-500">{page} / {pages}</span>
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}
        className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 bg-white text-gray-600">下一页</button>
    </div>
  );
}

type Tab = 'overview' | 'reports' | 'posts' | 'appeals' | 'ailogs';

// ===== 概览 =====
function OverviewTab({ go, stats }: { go: (t: Tab) => void; stats: PatrolStats | null }) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [postTotal, setPostTotal] = useState<number | null>(null);

  useEffect(() => {
    adminApi.listReports(1).then(r => { if (r.success) setPendingCount(r.total || 0); }).catch(() => {});
    // 「最新帖子」= 待巡查（pending）剩余数：新发布未审核、还需巡查的帖子数量
    moderationApi.reviewPosts('pending').then(r => { if (r.success) setPostTotal(r.total || 0); }).catch(() => {});
  }, []);

  const cards = [
    { icon: faFlag, label: '待审举报', value: pendingCount, color: 'text-red-600', bg: 'bg-red-50', tab: 'reports' as Tab, emphasize: true },
    { icon: faNewspaper, label: '待巡查帖子', value: postTotal, color: 'text-primary-600', bg: 'bg-primary-50', tab: 'posts' as Tab },
  ];

  // 巡查等级进度：expNeededForLevel 为 null 或 ≤ 本级经验时视为封顶（进度条满格）
  const needed = stats?.expNeededForLevel;
  const capped = needed == null || needed <= (stats?.expInLevel || 0);
  const pct = needed && needed > 0
    ? Math.min(100, Math.round(((stats?.expInLevel || 0) / needed) * 100))
    : 100;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(c => (
          <button key={c.label} onClick={() => go(c.tab)}
            className={`bg-white rounded-xl border p-5 text-left hover:shadow-lg transition ${c.emphasize && pendingCount ? 'border-red-200' : 'border-gray-100'}`}>
            <div className={`inline-flex w-10 h-10 items-center justify-center rounded-lg ${c.bg} ${c.color} mb-3`}>
              <FontAwesomeIcon icon={c.icon} />
            </div>
            <p className="text-2xl font-bold">{c.value === null ? '—' : c.value}</p>
            <p className="text-sm text-gray-500">{c.label}{c.emphasize && pendingCount ? '（有新的需处理）' : ''}</p>
          </button>
        ))}
      </div>
      {/* 我的巡查战绩（成就与等级；未加载成功时静默降级为加载提示） */}
      <div className="mt-6 bg-white rounded-xl border border-gray-100 p-4">
        {stats === null ? (
          <p className="text-sm text-gray-400 text-center py-6">数据加载中…</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded font-medium">
                Lv.{stats.level ?? '--'} {stats.tierName ?? ''}
              </span>
              <span className="text-xs text-gray-500">今日已巡 {stats.todayCount || 0} 帖</span>
            </div>
            {/* 经验进度条（封顶时 100% 满格） */}
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {capped
                ? '已满级 🎉'
                : `本级 ${stats.expInLevel || 0}/${stats.expNeededForLevel || 0} 经验 · 累计 ${stats.exp || 0}`}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              {[
                { label: '累计巡查', value: `${stats.totalReviews || 0} 帖` },
                { label: '参与下架', value: `${stats.totalTakedowns || 0} 帖` },
                { label: '平反', value: `${stats.totalClears || 0} 帖` },
                { label: '已解锁成就', value: `${(stats.unlocked || []).length} 个` },
              ].map(s => (
                <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-gray-800">{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="mt-6 bg-white rounded-xl border border-gray-100 p-5 text-sm text-gray-600 leading-relaxed">
        <p className="font-semibold text-gray-800 mb-2">🛡️ 巡查说明</p>
        <p>· 举报审核：确认违规会<strong className="text-red-600">删除目标内容</strong>并扣除作者积分；驳回则不处理。</p>
        <p>· 巡查员无直接删除权限，站内删除/编辑仅限作者本人与管理员。</p>
        <p>· 可疑内容可打开帖子详情查看，再决定是否举报或提交管理员处理。</p>
      </div>
    </div>
  );
}

// ===== 举报审核（多人复核制：违规/放行双计数竞争，先到阈值生效；管理员一票） =====
function ReportsTab() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(3); // 确认违规阈值（后台 report_violation_limit，默认 3）
  const [passLimit, setPassLimit] = useState(3); // 「没问题」放行阈值（后台 report_pass_limit，默认 3）
  // 跳过队列：跳过的目标排到末尾，全部处理完后再回来（除非已被受理完成——重新加载后自动消失）
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());

  const load = async (p?: number) => {
    try {
      const r = await adminApi.listReports(p || page);
      if (r.success) {
        setList(r.data || []);
        setTotal(r.total || 0);
        setIndex(0); // 翻页/刷新后回到列表头，避免 index 越界显示空态
        if (r.limit) setLimit(r.limit);
        if (r.passLimit) setPassLimit(r.passLimit);
        // 清理已不在当前列表中的跳过项（已处理/已受理的目标自动移除）
        setSkippedKeys(prev => {
          if (prev.size === 0) return prev;
          const present = new Set((r.data || []).map((x: any) => `${x.target_type}:${x.target_id}`));
          const next = new Set([...prev].filter(k => present.has(k)));
          return next.size === prev.size ? prev : next;
        });
      }
    } catch (err: any) { setMsg(err.message); }
  };
  useEffect(() => { load(); }, [page]);

  // 投票：confirm(确认违规) / pass(无违规)；达阈值或管理员一票时后端自动执行下架/放行
  const vote = async (id: number, action: 'confirm' | 'pass') => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await adminApi.reviewReport(id, action);
      setMsg(r.message || (action === 'confirm' ? '已确认违规' : '已投没问题'));
      // 投过票后该目标对自己隐藏 → 跳到下一条（或刷新当前队列）
      if (index + 1 < ordered.length) setIndex(index + 1);
      else load();
    } catch (err: any) { setMsg(err.message); }
    setBusy(false);
  };

  // 跳过：本轮不处理，移到队列末尾（保留在列表里，处理完其他项后会再回来）
  const skip = (key: string) => {
    setSkippedKeys(prev => new Set(prev).add(key));
    if (index + 1 < ordered.length) setIndex(index + 1);
    else { setIndex(0); load(); }
  };

  // 同一被举报内容可能有多条举报记录，展示时合并为一条（保留首条 id 用于操作）
  const merged: any[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const k = `${r.target_type}:${r.target_id}`;
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }
  // 排序：未跳过的在前，跳过的在后（全部未跳过项处理完后自然回到跳过的）
  const ordered = [...merged.filter(r => !skippedKeys.has(`${r.target_type}:${r.target_id}`)),
                   ...merged.filter(r => skippedKeys.has(`${r.target_type}:${r.target_id}`))];
  const current = ordered[index];

  // 用户匿名编号：按 user_id 首次出现顺序分配「用户一/用户二/…」
  const buildUserLabel = (list: any[]) => {
    const map = new Map<number, string>();
    const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const collect = (uid: number | null | undefined) => {
      if (!uid) return;
      if (!map.has(uid)) map.set(uid, `用户${CN[map.size] || (map.size + 1)}`);
    };
    for (const r of list) {
      collect(r.post_user_id);
      for (const cc of r.comment_chain || []) collect(cc.user_id);
    }
    return map;
  };
  const userLabel = buildUserLabel(merged);

  return (
    <div>
      {msg && <div className="mb-3 px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700">{msg}</div>}
      {ordered.length === 0 ? (
        <EmptyState icon={faFlag} title="暂无待审举报" description="收到举报后会显示在这里" />
      ) : !current ? (
        <EmptyState icon={faFlag} title="已处理完当前页" description="切换到下一页继续处理" />
      ) : (
        <>
          {/* 单条举报卡片：模拟正常帖子浏览样式（匿名编号，保护被审用户隐私） */}
          <div className="bg-white rounded-2xl border overflow-hidden">
              {/* 顶栏：类型 + 举报人 */}
              <div className="px-4 py-2.5 bg-gray-50/60 border-b flex flex-wrap items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${current.target_type === 'post' ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-700'}`}>
                  {current.target_type === 'post' ? '📄 帖子举报' : '💬 评论举报'}
                </span>
                <span className="text-xs text-gray-400 ml-auto">
                  举报人：{current.reporter_name || '已注销'} · {formatDateTime(current.created_at)}
                </span>
              </div>

              {/* 举报理由：醒目横幅 */}
              <div className="px-4 py-3 bg-red-50/70 border-b border-red-100 flex items-start gap-2">
                <span className="text-red-400 text-sm mt-0.5"><FontAwesomeIcon icon={faFlag} /></span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-0.5">举报理由</p>
                  <p className="text-sm font-medium text-red-700 leading-relaxed">{current.reason || '（未填写理由）'}</p>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {/* 所属帖子（帖子举报即目标；评论举报为上下文）——头像/用户名匿名化为编号 */}
                <div className="rounded-xl border bg-gray-50/40 p-3.5">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <GrayAvatar size="sm" />
                    <span className="text-sm font-medium text-gray-800">{userLabel.get(current.post_user_id) || '用户一'}</span>
                    {current.category_name && (
                      <span className="text-[10px] bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded font-medium">{current.category_name}</span>
                    )}
                    <span className="text-[10px] text-gray-400 ml-auto">
                      {current.target_type === 'comment' ? '所属帖子' : '被举报帖子'}
                    </span>
                  </div>
                  {current.post_title && <div className="text-base font-semibold text-gray-900 mb-1.5">{current.post_title}</div>}
                  {current.post_content && (
                    <div className="text-sm text-gray-600 leading-relaxed prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]} components={patrolMarkdownComponents}>
                        {current.post_content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>

                {/* 评论上下文（仅评论举报）：完整帖子 + 完整祖先链（顶层 → 被举报评论，逐级缩进）——用户匿名编号 + 回复关系 */}
                {current.target_type === 'comment' && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-gray-400">💬 评论上下文（完整对话链）</div>
                    {/* 祖先链：comment_chain = [顶层 → ... → 被举报评论]，由后端递归 CTE 返回 */}
                    {(current.comment_chain || []).map((cc: any, idx: number) => {
                      const isTarget = cc.is_target;
                      const authorLabel = userLabel.get(cc.user_id) || `用户${idx + 1}`;
                      // 回复关系：找父评论的作者编号（父评论 = 链中前一条）
                      const parentCc = (current.comment_chain || [])[idx - 1];
                      const replyTo = idx > 0 && parentCc ? userLabel.get(parentCc.user_id) || '用户' : null;
                      // 逐级缩进：顶层 0，每深一级 +2.5（与帖子详情评论树视觉一致）
                      const indent = idx > 0 ? { marginLeft: `${Math.min(idx, 4) * 20}px` } : undefined;
                      return (
                        <div key={cc.id} style={indent}>
                          <div className={`rounded-xl px-3 py-2 ${isTarget ? 'border-2 border-red-200 bg-red-50/40' : 'bg-gray-50 border border-gray-100'}`}>
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              <GrayAvatar size="sm" />
                              <span className={`text-[11px] font-medium ${isTarget ? 'text-red-600' : 'text-gray-600'}`}>
                                {isTarget ? '⚠️ 被举报评论' : `第${idx + 1}层`} · {authorLabel}
                              </span>
                              {replyTo && (
                                <span className="text-[10px] text-gray-400">↩️ 回复 {replyTo}</span>
                              )}
                              {cc.created_at && (
                                <span className="text-[10px] text-gray-400 ml-auto">{formatDateTime(cc.created_at)}</span>
                              )}
                            </div>
                            <div className="text-[13px] leading-relaxed prose prose-sm max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]} components={patrolMarkdownComponents}>
                                {cc.content || ''}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>

              {/* 底部操作区（卡片内部最底部）：导航 + 判断按钮 + 跳过 */}
              <div className="px-4 py-3 border-t bg-gray-50/60 dark:bg-gray-800/40 space-y-2">
                {/* 导航：与帖子巡查一致的单条切换 */}
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}
                    className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">← 上一条</button>
                  <span className="text-xs text-gray-400">{index + 1} / {ordered.length}{skippedKeys.size > 0 ? `（已跳过 ${skippedKeys.size} 条）` : ''}</span>
                  <button onClick={() => setIndex(Math.min(ordered.length - 1, index + 1))} disabled={index >= ordered.length - 1}
                    className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">下一条 →</button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => vote(current.id, 'confirm')} disabled={busy || current.my_action === 'confirm'}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50 ${current.my_action === 'confirm' ? 'bg-red-100 text-red-600' : 'bg-red-600 text-white hover:bg-red-700'}`}>
                    {current.my_action === 'confirm' ? '✅ 已确认违规' : `🚫 确认违规（${current.confirm_count || 0}/${limit}）`}
                  </button>
                  <button onClick={() => vote(current.id, 'pass')} disabled={busy || current.my_action === 'pass'}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50 ${current.my_action === 'pass' ? 'bg-green-100 text-green-600' : 'border border-green-200 text-green-600 hover:bg-green-50'}`}>
                    {current.my_action === 'pass' ? '✅ 已投没问题' : `✅ 无违规（${current.pass_count || 0}/${passLimit}）`}
                  </button>
                </div>
                <button onClick={() => skip(`${current.target_type}:${current.target_id}`)}
                  className="w-full py-2 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 text-sm font-medium hover:border-orange-400 hover:text-orange-500 hover:bg-orange-50 transition">
                  ⏭ 跳过这条（稍后处理，处理完其他后会自动回来）
                </button>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  多人复核制：<strong className="text-gray-500">{current.confirm_count || 0}/{limit}</strong> 人确认违规后下架并扣作者积分；<strong className="text-gray-500">{current.pass_count || 0}/{passLimit}</strong> 人确认无违规即放行取消举报；先到阈值生效；管理员一票否决/一票通过。
                </p>
              </div>
            </div>
        </>
      )}
      <Pager page={page} total={total} onChange={setPage} />
    </div>
  );
}

// ===== 帖子巡查（合并队列：待巡查在前、待复核接后，连续浏览；多人复核制 + 管理员一票否决） =====
function PostsPatrol() {
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [flaggedRows, setFlaggedRows] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [msg, setMsg] = useState('');
  const [violationLimit, setViolationLimit] = useState(3); // 违规打回所需票数（后台可配，默认 3）
  const [passLimit, setPassLimit] = useState(2); // 「没问题」放行所需票数（后台可配，默认 2）
  const [adminVeto, setAdminVeto] = useState(false);
  // 跳过队列：跳过的帖排到末尾，全部处理完后再回来（除非已被受理完成——重新加载后自动消失）
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set());
  const { user } = useAuth();

  const load = async () => {
    setLoading(true);
    try {
      // 合并加载两个队列：待巡查在前、待复核接后，连续浏览（不再分 tab）
      const [pr, fr] = await Promise.all([
        moderationApi.reviewPosts('pending'),
        moderationApi.reviewPosts('flagged'),
      ]);
      const pl = pr.success ? (pr.data || []) : [];
      const fl = fr.success ? (fr.data || []) : [];
      setPendingRows(pl);
      setFlaggedRows(fl);
      setIndex(0);
      // 清理已不在当前列表中的跳过项（已处理/已受理的帖自动移除）
      setSkippedIds(prev => {
        if (prev.size === 0) return prev;
        const present = new Set([...pl, ...fl].map((p: any) => p.id));
        const next = new Set([...prev].filter(id => present.has(id)));
        return next.size === prev.size ? prev : next;
      });
      if ((pr as any).passLimit) setPassLimit((pr as any).passLimit);
      if ((pr as any).violationLimit) setViolationLimit((pr as any).violationLimit);
      if ((pr as any).adminVeto) setAdminVeto(true);
      if (!pr.success && !fr.success) setMsg(pr.error || fr.error || '加载失败');
    } catch (e: any) { setMsg(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // 合并浏览序：未跳过的在前（待巡查段 → 待复核段），跳过的排到整个队列末尾
  const ordered = [
    ...pendingRows.filter(p => !skippedIds.has(p.id)),
    ...flaggedRows.filter(p => !skippedIds.has(p.id)),
    ...pendingRows.filter(p => skippedIds.has(p.id)),
    ...flaggedRows.filter(p => skippedIds.has(p.id)),
  ];
  const current = ordered[index];
  // 帖子所处队列：pending = 待巡查（3 按钮）；questionable/violation = 待复核（2 按钮）
  const currentIsPending = current ? current.review_status === 'pending' : false;

  const act = async (action: string) => {
    if (!current || acting) return;
    setActing(true);
    try {
      const r = await moderationApi.reviewPost(current.id, action);
      if (r.success) {
        setMsg(r.message || '已处理');
        // 投过票后该帖对自己隐藏 → 跳到下一条（队列尾部则刷新）
        if (index + 1 < ordered.length) setIndex(index + 1);
        else load();
      } else setMsg(r.error || '操作失败');
    } catch (e: any) { setMsg(e.message); }
    setActing(false);
  };

  // 跳过：移到队列末尾（保留在列表里，处理完其他帖后会再回来）
  const skipCurrent = () => {
    if (!current) return;
    setSkippedIds(prev => new Set(prev).add(current.id));
    if (index + 1 < ordered.length) setIndex(index + 1);
    else { setIndex(0); load(); }
  };

  return (
    <div className="space-y-3">
      {msg && <div className="text-xs text-gray-500">{msg}</div>}

      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">加载中...</div>
      ) : !current ? (
        <EmptyState icon={faNewspaper} title="暂无待巡查 / 待复核帖子"
          description="新发布的帖子会进入待巡查；被标记存疑或违规的帖子会进入待复核，按顺序连续浏览处理" />
      ) : (
        <>
          {/* 单帖预览卡：模拟正常帖子浏览样式（头像/用户名用灰色占位与匿名名，保护被审用户隐私） */}
          <div className="bg-white dark:bg-[#111] rounded-2xl border overflow-hidden">
            {/* 作者行：灰色占位头像 + 匿名编号（用户一）+ 时间 + 状态标签 */}
            <div className="px-4 py-3 border-b flex items-center gap-3 bg-gray-50/60 dark:bg-gray-800/40">
              <GrayAvatar size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">用户一</span>
                  <span className="text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded font-medium">{current.category_name || '未分类'}</span>
                  {/* 付费帖标注：队列内照常展示正文（审核需要读内容），但明确提示这是付费帖及其价格 */}
                  {!!current.price && (
                    <span className="text-[11px] bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded font-medium">
                      🔒 付费帖 · 需 {current.price} 积分
                    </span>
                  )}
                  {currentIsPending ? (
                    <>
                      {current.ai_action === 'approved' && (
                        <span className="text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">
                          🤖 AI 判定无问题{current.ai_confidence != null ? `（${Math.round(current.ai_confidence * 100)}%）` : ''}
                        </span>
                      )}
                      {(current.pass_count || 0) > 0 && (
                        <span className="text-[11px] bg-green-50 text-green-600 px-2 py-0.5 rounded font-medium">
                          ✅ 通过确认中（{current.pass_count}/{passLimit} 人）
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${current.review_status === 'violation' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                      {current.review_status === 'violation' ? `违规复核中（违规 ${current.violation_count}/${violationLimit} 人）` : 'AI 不确定 · 存疑复核中'}
                    </span>
                  )}
                  {skippedIds.has(current.id) && (
                    <span className="text-[11px] bg-orange-50 text-orange-500 px-2 py-0.5 rounded font-medium">⏭ 已跳过</span>
                  )}
                </div>
                {current.flagged_reason && <div className="text-[11px] text-gray-400 mt-0.5">标记原因：{current.flagged_reason}</div>}
                <div className="text-xs text-gray-400 mt-0.5">{formatDateTime(current.created_at)}</div>
              </div>
            </div>
            {/* 正文：完整 Markdown 渲染（GFM/图片/视频/Bilibili iframe 与正常帖子一致），内容完整展开不内嵌滚动 */}
            <div className="px-4 py-4">
              <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-2">{current.title}</h3>
              <div className="text-[15px] text-gray-700 dark:text-gray-300 leading-relaxed prose prose-sm max-w-none">
                {current.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]} components={patrolMarkdownComponents}>
                    {current.content}
                  </ReactMarkdown>
                ) : <p className="text-gray-400">（无内容）</p>}
              </div>
            </div>

            {/* 浏览进度 + 上/下一条（跨队列连续） */}
            <div className="px-4 py-2 border-t flex items-center justify-between bg-gray-50/60 dark:bg-gray-800/40">
              <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index <= 0}
                className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">← 上一条</button>
              <span className="text-xs text-gray-400">{index + 1} / {ordered.length}{skippedIds.size > 0 ? `（已跳过 ${skippedIds.size} 条）` : ''}</span>
              <button onClick={() => setIndex(Math.min(ordered.length - 1, index + 1))} disabled={index >= ordered.length - 1}
                className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">下一条 →</button>
            </div>

            {/* 动作按钮：待巡查 3 按钮 / 待复核 2 按钮（按帖子当前状态自动切换） */}
            {currentIsPending ? (
              <div className="px-4 py-3 border-t grid grid-cols-3 gap-2">
                <button onClick={() => act('pass')} disabled={acting}
                  className="py-2.5 rounded-xl bg-green-500 text-white text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition">✅ 没问题</button>
                <button onClick={() => act('question')} disabled={acting}
                  className="py-2.5 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition">🤔 存疑</button>
                <button onClick={() => act('violation')} disabled={acting}
                  className="py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition">🚫 有违规</button>
              </div>
            ) : (
              <div className="px-4 py-3 border-t grid grid-cols-2 gap-2">
                <button onClick={() => act('pass')} disabled={acting}
                  className="py-2.5 rounded-xl bg-green-500 text-white text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition">✅ 没问题（放行）</button>
                <button onClick={() => act('confirm')} disabled={acting}
                  className="py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition">🚫 确认违规（{current.violation_count || 0}/{violationLimit}）</button>
              </div>
            )}
            {/* 跳过：显眼虚线按钮，移到队列末尾（处理完其他后再回来） */}
            <div className="px-4 pb-4">
              <button onClick={skipCurrent}
                className="w-full py-2 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 text-sm font-medium hover:border-orange-400 hover:text-orange-500 hover:bg-orange-50 transition">
                ⏭ 跳过这条（稍后处理，处理完其他后会自动回来）
              </button>
              <p className="text-[11px] text-gray-400 text-center mt-2">
                {adminVeto
                  ? '管理员一票否决可直接打回，一票通过可移出巡查'
                  : `「没问题」需 ${passLimit} 人放行；违规确认达到 ${violationLimit} 人打回重新编辑（先到阈值生效）`}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ===== 已下架复审（作者申诉 → 达标巡查员单人判定：恢复重新巡查 / 维持下架） =====
function AppealsReview() {
  const [list, setList] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = async (p?: number) => {
    setLoading(true);
    try {
      const r = await appealsApi.pendingList(p || page);
      if (r.success) { setList(r.data || []); setTotal(r.total || 0); setIndex(0); }
      else setMsg(r.error || '加载失败');
    } catch (e: any) { setMsg(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [page]);

  const current = list[index];

  const decide = async (action: 'approve' | 'reject') => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const r = await appealsApi.decide(current.appeal_id, action);
      setMsg(r.message || (action === 'approve' ? '已恢复' : '已驳回'));
      // 判定后跳下一条（或刷新）
      if (index + 1 < list.length) setIndex(index + 1);
      else load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      {msg && <div className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700">{msg}</div>}
      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">加载中...</div>
      ) : !current ? (
        <EmptyState icon={faFlag} title="暂无待复审申诉" description="作者对已下架帖子的申诉会显示在这里" />
      ) : (
        <>
          {/* 申诉预览卡（模拟正常帖子浏览样式，匿名编号） */}
          <div className="bg-white dark:bg-[#111] rounded-2xl border overflow-hidden">
            {/* 作者行 */}
            <div className="px-4 py-3 border-b flex items-center gap-3 bg-gray-50/60 dark:bg-gray-800/40">
              <GrayAvatar size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">用户一</span>
                  <span className="text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded font-medium">{current.category_name || '未分类'}</span>
                  <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded font-medium">已下架</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">下架于 {formatDateTime(current.deleted_at)} · 申诉于 {formatDateTime(current.appeal_created_at)}</div>
              </div>
            </div>
            {/* 正文：完整 Markdown 渲染 */}
            <div className="px-4 py-4">
              <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-2">{current.title}</h3>
              <div className="text-[15px] text-gray-700 dark:text-gray-300 leading-relaxed prose prose-sm max-w-none">
                {current.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]} components={patrolMarkdownComponents}>
                    {current.content}
                  </ReactMarkdown>
                ) : <p className="text-gray-400">（无内容）</p>}
              </div>
            </div>
            {/* 申诉理由 */}
            <div className="px-4 py-3 bg-blue-50/60 dark:bg-blue-950/20 border-t border-blue-100">
              <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">作者申诉理由</p>
              <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed whitespace-pre-wrap">{current.appeal_reason || '（未填写）'}</p>
              {current.flagged_reason && (
                <p className="text-[11px] text-gray-500 mt-2">原下架原因：{current.flagged_reason}</p>
              )}
            </div>
          </div>

          {/* 底部操作区：导航 + 单人判定 */}
          <div className="px-4 py-3 border-t bg-gray-50/60 dark:bg-gray-800/40 space-y-2 rounded-2xl">
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}
                className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">← 上一条</button>
              <span className="text-xs text-gray-400">{index + 1} / {list.length}</span>
              <button onClick={() => setIndex(Math.min(list.length - 1, index + 1))} disabled={index >= list.length - 1}
                className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">下一条 →</button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => decide('approve')} disabled={busy}
                className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition">✅ 恢复帖子（重新巡查）</button>
              <button onClick={() => decide('reject')} disabled={busy}
                className="flex-1 py-2.5 rounded-xl bg-gray-400 text-white text-sm font-medium hover:bg-gray-500 disabled:opacity-50 transition">🚫 维持下架</button>
            </div>
            <p className="text-[11px] text-gray-400 text-center">单人判定立即生效；恢复后帖子重新进入待巡查队列</p>
          </div>
        </>
      )}
      <Pager page={page} total={total} pageSize={20} onChange={setPage} />
    </div>
  );
}

// ===== 巡查台主页面 =====
// ===== AI 审核日志（aiReview.ts 消费端写入，仅保留最近 20 条）=====
function AiLogsTab() {
  const [logs, setLogs] = useState<any[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    moderationApi.aiLogs().then(r => { if (r.success) setLogs(r.data || []); }).catch(() => {});
  }, []);

  const badge = (action: string) => {
    switch (action) {
      case 'approved': return { text: '通过', cls: 'bg-green-100 text-green-700' };
      case 'uncertain': return { text: 'AI 不确定 → 待复核', cls: 'bg-amber-100 text-amber-700' };
      case 'takedown': return { text: 'AI 下架', cls: 'bg-red-100 text-red-700' };
      case 'failed': return { text: '审核失败', cls: 'bg-gray-100 text-gray-600' };
      default: return { text: action, cls: 'bg-gray-100 text-gray-600' };
    }
  };
  const statusText: Record<string, string> = {
    pending: '待巡查', cleared: '已通过', questionable: '待复核',
    violation: '违规待复核', rejected: '已打回',
  };

  if (logs === null) return <div className="text-center py-10 text-gray-400 text-sm">加载中...</div>;
  if (logs.length === 0) return <EmptyState icon={faRobot} title="暂无 AI 审核记录" description="新帖子触发 AI 审核后会显示在这里（仅保留最近 20 条）" />;

  return (
    <div className="space-y-3">
      {logs.map(l => {
        const b = badge(l.action);
        let reasons: string[] = [];
        try { reasons = l.reasons ? JSON.parse(l.reasons) : []; } catch {}
        return (
          <div key={l.id} className="bg-white border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${b.cls}`}>{b.text}</span>
              <span className="text-[11px] text-gray-400">{l.created_at}</span>
            </div>
            <button onClick={() => l.post_id && navigate(`/post/${l.post_id}`)}
              className="text-sm font-medium text-gray-800 hover:text-primary-600 text-left block w-full truncate">
              {l.post_title || `帖子 #${l.post_id ?? '?'}`}
            </button>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>作者：{l.author_name || (l.author_id ? `#${l.author_id}` : '匿名/已注销')}</span>
              {l.confidence != null && <span>置信度：{Math.round(l.confidence * 100)}%</span>}
              {l.verdict && <span>AI 判定：{l.verdict === 'pass' ? '无问题' : '检出问题'}</span>}
              {reasons.length > 0 && <span>原因：{reasons.join('、')}</span>}
              <span>当前状态：{l.post_deleted ? '已删除' : (statusText[l.current_status] || l.current_status || '不存在')}</span>
              {l.summary && <span className="w-full text-gray-600">{l.summary}</span>}
              {l.error && <span className="w-full text-red-500">失败原因：{l.error}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Moderator() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [patrolStats, setPatrolStats] = useState<PatrolStats | null>(null);
  // 已下架复审访问权限（管理员无限制；巡查员需达到复审等级门槛，默认 5 级后台可配）
  const [appealAccess, setAppealAccess] = useState<{ allowed: boolean; level: number; requiredLevel: number } | null>(null);

  useEffect(() => {
    if (loading) return; // 等待 AuthContext 加载完成，避免刷新时 user 为 null 被误踢
    if (!user || (user.role !== 'moderator' && user.role !== 'admin')) {
      navigate('/login', { state: { from: '/moderator' } });
    }
  }, [loading, user, navigate]);

  // 巡查员成就与等级（仅 moderator/admin 拉取；未登录/非巡查员/网络失败静默降级，不报错）
  useEffect(() => {
    if (loading || !user || (user.role !== 'moderator' && user.role !== 'admin')) return;
    moderationApi.patrolStats()
      .then(r => { if (r.success) setPatrolStats(r.data || null); })
      .catch(() => setPatrolStats(null));
    appealsApi.access()
      .then(r => { if (r.success) setAppealAccess(r.data || null); })
      .catch(() => setAppealAccess(null));
  }, [loading, user]);

  if (loading || !user || (user.role !== 'moderator' && user.role !== 'admin')) return null;

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: '巡查概览', icon: faEye },
    { id: 'reports', label: '举报审核', icon: faFlag },
    { id: 'posts', label: '帖子巡查', icon: faNewspaper },
    { id: 'ailogs', label: 'AI 审核日志', icon: faRobot },
  ];

  // 已下架复审分区：达标巡查员 / 管理员可见可用
  const canAppealReview = appealAccess?.allowed || user.role === 'admin';
  if (canAppealReview) {
    tabs.push({ id: 'appeals', label: '已下架复审', icon: faFlag });
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <BackButton />
        <h1 className="text-xl md:text-2xl font-bold">巡查台</h1>
        {patrolStats && <span className="text-[11px] bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded font-medium">Lv.{patrolStats.level ?? '--'} {patrolStats.tierName ?? ''}</span>}
        {user.role === 'admin' && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-medium">管理员视角</span>}
      </div>

      <div className="flex gap-1 mb-4 border-b overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 px-3 py-2.5 text-sm font-medium border-b-2 transition -mb-px whitespace-nowrap ${
              tab === t.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <FontAwesomeIcon icon={t.icon} className="mr-1.5" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab go={setTab} stats={patrolStats} />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'posts' && <PostsPatrol />}
      {tab === 'appeals' && <AppealsReview />}
      {tab === 'ailogs' && <AiLogsTab />}
    </div>
  );
}