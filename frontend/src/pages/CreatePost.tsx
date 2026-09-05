import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { posts as postsApi, categories as categoriesApi, items as itemsApi } from '../services/api';
import type { Category } from '../types';
import { POST_BG_OPTIONS } from '../utils/postBg';
import MarkdownEditor from '../components/MarkdownEditor';
import ConfirmModal from '../components/ConfirmModal';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClipboard } from '@fortawesome/free-solid-svg-icons';

const DRAFT_KEY = 'forum-create-draft';

export default function CreatePost() {
  const { id } = useParams();
  const isEdit = !!id;
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [postPrice, setPostPrice] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [redPacketTotal, setRedPacketTotal] = useState('');
  const [redPacketCount, setRedPacketCount] = useState('');
  const [postBgId, setPostBgId] = useState<number | ''>('');
  const [hasRedPacketCard, setHasRedPacketCard] = useState(false);
  const [hasPostBgCard, setHasPostBgCard] = useState(false);
  // 仓库中未使用的匿名卡数量（决定匿名选项是否显示 + 消耗提示）
  const [anonCardCount, setAnonCardCount] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftData, setDraftData] = useState<{ title: string; content: string; categoryId: number | ''; savedAt: number } | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>();
  const submitted = useRef(false);
  // 登录态初始化保护：authLoading 完成前不跳转，避免刷新受保护页被误踢
  const authInitRef = useRef(false);
  // 编辑模式原帖加载中（加载完成前禁止提交，防止空内容覆盖原帖）
  const [postLoading, setPostLoading] = useState(false);
  const [postLoaded, setPostLoaded] = useState(false);
  // 取消按钮的离开确认弹窗
  const [confirmLeave, setConfirmLeave] = useState(false);

  const restoreDraft = useCallback(() => {
    if (!draftData) return;
    setTitle(draftData.title || '');
    setContent(draftData.content || '');
    setCategoryId(draftData.categoryId || '');
    setDraftRestored(true);
    setDraftData(null);
  }, [draftData]);

  const discardDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
    setDraftData(null);
  }, []);

  const hasContent = title.trim().length > 0 || content.trim().length > 0;

  // 浏览器关闭/刷新时提示
  useEffect(() => {
    if (!isEdit && hasContent) {
      const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  }, [isEdit, hasContent]);

  // 自动保存草稿（新建模式，有内容时每 5 秒存一次）
  useEffect(() => {
    if (isEdit) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content, categoryId, savedAt: Date.now() }));
      } catch (e) { console.error(e); }
    }, 5000);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [title, content, categoryId, isEdit]);

  // 进入页面时恢复草稿
  useEffect(() => {
    if (isEdit) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.title || draft.content) {
        setDraftData(draft);
      }
    } catch (e) { console.error(e); }
  }, [isEdit]);

  useEffect(() => {
    if (authLoading) return; // 等待 AuthContext 加载完成，避免刷新时 user 为 null 被误踢
    if (!user) { navigate('/login', { state: { from: isEdit ? `/create/${id}` : '/create' } }); return; }
    if (authInitRef.current) return; // 仅首次加载分类/原帖，防止依赖变化重复请求
    authInitRef.current = true;
    loadCategories();
    if (isEdit) loadPost();
  }, [authLoading, user, isEdit, id, navigate]);

  const loadCategories = async () => {
    try {
      const res = await categoriesApi.list();
      if (res.success && res.data) {
        const filtered = user?.role === 'admin'
          ? res.data : res.data.filter(c => c.slug !== 'announcements');
        setCategories(filtered);
      }
    } catch (e) { console.error(e); }
  };

  const loadPost = async () => {
    setPostLoading(true);
    try {
      const res = await postsApi.get(parseInt(id!));
      if (res.success && res.data) {
        setTitle(res.data.title); setContent(res.data.content);
        setCategoryId(res.data.category_id || '');
        setPostPrice(res.data.price ? String(res.data.price) : '');
        setPostLoaded(true);
      } else {
        setError(res.error || '加载失败');
      }
    } catch (err: any) { setError(err.message || '加载失败'); }
    setPostLoading(false);
  };

  // 新建模式：检测是否持有红包卡/背景卡/匿名卡（仅决定表单区是否显示，真正校验在后端）
  useEffect(() => {
    if (!user || isEdit) return;
    itemsApi.myItems().then(res => {
      if (res.success && Array.isArray(res.data)) {
        setHasRedPacketCard(res.data.some(i => i.type === 'item_red_packet'));
        setHasPostBgCard(res.data.some(i => i.type === 'item_post_bg'));
        setAnonCardCount(res.data.filter(i => i.type === 'item_anonymous_card' && !i.used).length);
      }
    }).catch(() => {});
  }, [user, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) { setError('标题和内容不能为空'); return; }
    setError(''); setLoading(true); submitted.current = true;
    try {
      // 前端不再做发帖前同步 AI 审核：帖子直接发布，AI 异步审核在后端队列进行
      // （不确定 → 待复核；确定违规 → AI 下架，详见 worker/src/aiReview.ts）

      if (isEdit) {
        const res = await postsApi.update(parseInt(id!), {
          title: title.trim(),
          content: content.trim(),
          category_id: categoryId || undefined,
          price: postPrice ? parseInt(postPrice) : null,
        });
        toast(res.message || '编辑成功', 'success'); navigate(`/post/${id}`);
      } else {
        const res = await postsApi.create(title.trim(), content.trim(), categoryId || undefined, postPrice ? parseInt(postPrice) : undefined, isAnonymous ? 1 : 0, {
          redPacketTotal: redPacketTotal ? parseInt(redPacketTotal) : undefined,
          redPacketCount: redPacketCount ? parseInt(redPacketCount) : undefined,
          postBgId: postBgId === '' ? undefined : postBgId,
        });
        if (res.success && res.data) {
          localStorage.removeItem(DRAFT_KEY);
          // 挂红包/消耗道具可能扣积分，通知 Layout 刷新导航栏余额
          window.dispatchEvent(new Event('coins:changed'));
          toast('发布成功', 'success'); navigate(`/post/${res.data.id}`);
        } else {
          toast(res.error || '发布失败', 'error'); setError(res.error || '发布失败');
          submitted.current = false;
        }
      }
    } catch (err: any) {
      toast(err.message || '发布失败', 'error');
      setError(err.message || '发布失败');
      submitted.current = false;
    }
    setLoading(false);
  };

  // Ctrl+Enter 发布
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('post-submit-btn')?.click();
    }
  };

  const titleOver = title.length > 200;

  if (!user) return null;

  // 编辑模式：原帖加载完成前不渲染表单，防止提交空内容覆盖原帖
  if (isEdit && postLoading) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">编辑帖子</h1>
        <div className="text-center py-16 text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{isEdit ? '编辑帖子' : '发布新帖'}</h1>

      {draftRestored && (
        <div className="bg-blue-50 text-blue-700 px-4 py-2.5 rounded-xl mb-4 text-sm flex items-center justify-between">
          <span><FontAwesomeIcon icon={faClipboard} /> 已恢复本地草稿</span>
          <button onClick={() => { localStorage.removeItem(DRAFT_KEY); setDraftRestored(false); }}
            className="text-blue-500 hover:text-blue-700 underline text-xs">清除草稿</button>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}

      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-5">
        {/* 标题 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">标题</label>
          <div className="relative">
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-primary-500 text-lg transition-shadow pr-16"
              placeholder="输入帖子标题" maxLength={200} required />
            <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${titleOver ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
              {title.length}/200
            </span>
          </div>
        </div>

        {/* 分类 — 标签样式 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">分类</label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCategoryId('')}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${categoryId === '' ? 'bg-gray-200 border-gray-300 text-gray-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              不限
            </button>
{categories.map(cat => (
              <button key={cat.id} type="button" onClick={() => {
                setCategoryId(cat.id);
                // 切到不支持付费的板块时清空存量价格/密码
                if (cat.allow_paid !== 1) { setPostPrice(''); }
              }}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${categoryId === cat.id ? 'bg-primary-100 border-primary-300 text-primary-700 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-200'}`}>
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* 付费设置 — 仅板块开放付费时显示（编辑模式保留，兼容存量付费帖） */}
        {(isEdit || (categoryId !== '' && categories.some(c => c.id === categoryId && c.allow_paid === 1))) && (
        <div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">付费金额（积分）</label>
            <input type="number" min="1" max="99999" value={postPrice} onChange={e => setPostPrice(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-primary-500"
              placeholder="留空免费" />
          </div>
        </div>
        )}

        {/* 匿名发布 — 仅新建且已选分类时显示；有足够匿名卡才显示选项：
            支持匿名的板块消耗 1 张，不支持匿名的板块消耗 3 张（卡不足则不显示） */}
        {!isEdit && categoryId !== '' && (() => {
          const catAllowAnon = categories.some(c => c.id === categoryId && c.allow_anonymous === 1);
          const anonCost = catAllowAnon ? 1 : 3;
          if (anonCardCount < anonCost) return null;
          return (
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                匿名发布（对外显示为匿名同学）
              </label>
              {isAnonymous && (
                <p className="text-xs text-amber-600 mt-1">
                  {catAllowAnon
                    ? `将消耗 1 张匿名卡（仓库剩余 ${anonCardCount} 张）`
                    : `该板块不支持匿名，将消耗 3 张匿名卡（仓库剩余 ${anonCardCount} 张）`}
                </p>
              )}
            </div>
          );
        })()}

        {/* 红包挂载 — 仅新建且持有红包卡时显示（后端校验） */}
        {!isEdit && hasRedPacketCard && (
          <div className="bg-red-50/50 border border-red-100 rounded-xl p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">🧧 挂红包（将消耗 1 张红包卡）</label>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">红包总额（积分）</label>
                <input type="number" min="1" max="10000" value={redPacketTotal} onChange={e => setRedPacketTotal(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-primary-500"
                  placeholder="1-10000" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">红包份数</label>
                <input type="number" min="1" max="100" value={redPacketCount} onChange={e => setRedPacketCount(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-primary-500"
                  placeholder="1-100" />
              </div>
            </div>
          </div>
        )}

        {/* 帖子背景 — 仅新建且持有背景卡时显示（后端校验） */}
        {!isEdit && hasPostBgCard && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">帖子背景（将消耗 1 张背景卡）</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {POST_BG_OPTIONS.map(opt => (
                <button key={opt.id} type="button" onClick={() => setPostBgId(postBgId === opt.id ? '' : opt.id)}
                  title={opt.name}
                  className={`h-14 rounded-lg border-2 transition ${opt.className} ${
                    postBgId === opt.id ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200 hover:border-gray-300'
                  }`} />
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {postBgId !== '' ? `已选择：${POST_BG_OPTIONS.find(o => o.id === postBgId)?.name || ''}` : '选择帖子背景（不选则无背景）'}
            </p>
          </div>
        )}

        {/* 内容 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            内容 <span className="text-gray-400 font-normal">(支持 Markdown，Ctrl+Enter 发布)</span>
          </label>
          <MarkdownEditor value={content} onChange={setContent} placeholder="写点什么..." minHeight="320px" />
        </div>

        {/* 按钮 */}
        <div className="flex items-center gap-3 pt-2">
          <button id="post-submit-btn" type="submit" disabled={loading || titleOver || (isEdit && !postLoaded)}
            className="bg-primary-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2">
            {loading && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />}
            {loading ? '发布中...' : isEdit ? '保存修改' : '发布帖子'}
          </button>
          <button type="button" onClick={() => {
            if (hasContent && !submitted.current) { setConfirmLeave(true); return; }
            navigate(-1);
          }}
            className="px-6 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 font-medium transition-colors">
            取消
          </button>
        </div>
      </form>
      <ConfirmModal
        open={!!draftData}
        title="恢复草稿"
        message={`检测到 ${draftData ? new Date(draftData.savedAt).toLocaleString('zh-CN') : ''} 的未发布草稿，是否恢复？`}
        confirmText="恢复草稿"
        cancelText="不要了"
        onConfirm={restoreDraft}
        onCancel={discardDraft}
      />
      <ConfirmModal
        open={confirmLeave}
        title="离开页面"
        message="有未保存的内容，确定要离开吗？"
        confirmText="离开"
        danger
        onConfirm={() => { setConfirmLeave(false); navigate(-1); }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}