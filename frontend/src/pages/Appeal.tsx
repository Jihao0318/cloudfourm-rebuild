import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { appeals as appealsApi } from '../services/api';
import BackButton from '../components/BackButton';

// 申诉页：作者对已下架（软删）帖子提交申诉，等待巡查员复审
export default function Appeal() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [info, setInfo] = useState<{ post_id: number; title: string; deleted: boolean; appeal: any } | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate('/login', { state: { from: `/appeal/${postId}` } }); return; }
    appealsApi.info(parseInt(postId!)).then(r => {
      if (r.success) setInfo(r.data || null);
      else setMsg(r.error || '加载失败');
    }).catch((e: any) => setMsg(e.message));
  }, [loading, user, postId, navigate]);

  const submit = async () => {
    if (busy || !reason.trim()) return;
    setBusy(true);
    try {
      const r = await appealsApi.submit(parseInt(postId!), reason.trim());
      setMsg(r.message || (r.success ? '申诉已提交' : r.error || '提交失败'));
      if (r.success) { setReason(''); setInfo(prev => prev ? { ...prev, appeal: { status: 'pending' } } : prev); }
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  if (loading || !user || !info) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10">
        <BackButton />
        <p className="text-center text-sm text-gray-400 py-10">{msg || '加载中...'}</p>
      </div>
    );
  }

  const appeal = info.appeal;

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <BackButton />
      <h1 className="text-xl md:text-2xl font-bold mt-3 mb-2">帖子申诉</h1>
      <div className="bg-white rounded-2xl border p-5">
        {/* 帖子信息 */}
        <div className="mb-5">
          <p className="text-xs text-gray-400 mb-1">被下架帖子</p>
          <p className="font-semibold text-gray-900">{info.title}</p>
          {!info.deleted && (
            <p className="text-xs text-green-600 mt-2">✅ 该帖子当前已恢复，无需申诉</p>
          )}
        </div>

        {/* 已有申诉状态 */}
        {appeal && (
          <div className={`rounded-xl px-4 py-3 text-sm mb-4 ${
            appeal.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : appeal.status === 'approved' ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {appeal.status === 'pending' && '⏳ 你的申诉正在等待巡查员复审'}
            {appeal.status === 'approved' && '✅ 你的申诉已通过：帖子已恢复'}
            {appeal.status === 'rejected' && '❌ 你的申诉未通过：帖子维持下架（管理员仍可在后台处理）'}
          </div>
        )}

        {info.deleted && (!appeal || appeal.status === 'rejected') && (
          <>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">申诉理由</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={5}
              maxLength={1000}
              placeholder="请说明为什么认为该帖子不应被下架（2-1000 字）..."
              className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 resize-y"
            />
            <p className="text-[11px] text-gray-400 mt-1 mb-3">{reason.length}/1000</p>
            {appeal && appeal.status === 'rejected' && (
              <p className="text-xs text-red-500 mb-3">⚠️ 该帖子已申诉过一次且被驳回，不能再提交</p>
            )}
            <button onClick={submit} disabled={busy || reason.trim().length < 2 || appeal?.status === 'rejected'}
              className="w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">
              {busy ? '提交中...' : '提交申诉'}
            </button>
            {msg && <p className="text-xs text-gray-500 mt-2">{msg}</p>}
          </>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mt-4 text-center">
        申诉提交后由达到等级的巡查员复审；<Link to="/moderator" className="text-primary-600 hover:underline">查看复审</Link> 由巡查员处理
      </p>
    </div>
  );
}
