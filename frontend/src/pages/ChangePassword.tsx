import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { auth } from '../services/api';
import BackButton from '../components/BackButton';

/**
 * 修改密码（登录态专用页）：验证当前密码后一步直改，无需邮箱验证码。
 * - 后端会校验新密码规则（6-128 位、含大写字母与数字）并递增 token_version 踢掉全部会话
 * - 因此修改成功后需重新登录（与更换邮箱页同款收尾）
 * - 忘记密码请走 /forgot-password 的邮件重置流程
 */
export default function ChangePassword() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 未登录守卫（与 Profile / ChangeEmail 同款页面内守卫）
  useEffect(() => {
    if (!authLoading && !user) navigate('/login', { replace: true });
  }, [authLoading, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPw) { setError('请输入当前密码'); return; }
    if (!newPw) { setError('请输入新密码'); return; }
    if (confirmPw !== newPw) { setError('两次输入的新密码不一致'); return; }
    setError('');
    setLoading(true);
    try {
      const r = await auth.changePassword(currentPw, newPw);
      if (r.success) {
        toast('密码已修改，请重新登录', 'success');
        navigate('/login', { replace: true });
      } else {
        setError(r.error || '修改失败');
      }
    } catch (err: any) {
      setError(err.message || '修改失败，请稍后再试');
    }
    setLoading(false);
  };

  if (!authLoading && !user) return null;

  return (
    <div className="max-w-md mx-auto mt-8">
      <BackButton />
      <div className="bg-white rounded-xl border p-8">
        <h1 className="text-2xl font-bold text-center mb-2">修改密码</h1>
        <p className="text-center text-sm text-gray-500 mb-6">
          账号：<span className="text-gray-700 font-medium">{user?.username}</span>
        </p>
        {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">当前密码</label>
            <input
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              placeholder="输入当前密码确认身份"
              autoComplete="current-password"
              className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="至少 6 位，需包含大写字母和数字"
              autoComplete="new-password"
              className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
            <input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="再输入一次新密码"
              autoComplete="new-password"
              className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>
          <p className="text-xs text-gray-400">至少 6 位，需包含大写字母和数字。修改成功后需重新登录。</p>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50"
          >
            {loading ? '提交中...' : '确认修改'}
          </button>
          <p className="text-center text-xs text-gray-400">
            忘记密码？<button type="button" onClick={() => navigate('/forgot-password')} className="text-primary-600 hover:underline">通过邮箱重置</button>
          </p>
        </form>
      </div>
    </div>
  );
}
