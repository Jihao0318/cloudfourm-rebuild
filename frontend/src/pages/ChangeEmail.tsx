import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { auth } from '../services/api';
import BackButton from '../components/BackButton';

/**
 * 更换邮箱（登录态专用页）：当前邮箱 + 身份确认（密码）+ 新邮箱验证码两步流程。
 * - 普通换邮箱：验证成功自动落库
 * - 被责令场景：改邮箱成功即自动清除责令标记（后端 /auth/email/verify 已处理），
 *   因改邮箱会踢掉全部会话（token_version+1），完成后需重新登录
 */
export default function ChangeEmail() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [newEmail, setNewEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCd, setResendCd] = useState(0);

  // 未登录守卫（页面内守卫，与 Profile 同款模式）
  useEffect(() => {
    if (!authLoading && !user) navigate('/login', { replace: true });
  }, [authLoading, user, navigate]);

  // 重发倒计时
  useEffect(() => {
    if (resendCd <= 0) return;
    const t = setTimeout(() => setResendCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCd]);

  // 第一步：校验密码 → 发验证码到新邮箱
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !emailPw) { setError('请填写新邮箱和当前密码'); return; }
    setError('');
    setLoading(true);
    try {
      const r = await auth.emailRequest(newEmail.trim(), emailPw);
      if (r.success) {
        setStep(2);
        setResendCd(60);
        toast(`验证码已发送至新邮箱 ${newEmail.trim()}`, 'success');
      } else {
        setError(r.error || '发送失败');
      }
    } catch (err: any) {
      setError(err.message || '发送失败，请稍后再试');
    }
    setLoading(false);
  };

  // 重发（复用 request 端点，后端会作废旧码重发新码）
  const handleResend = async () => {
    setError('');
    setLoading(true);
    try {
      const r = await auth.emailRequest(newEmail.trim(), emailPw);
      if (r.success) { toast('验证码已重新发送', 'success'); setResendCd(60); }
      else setError(r.error || '发送失败');
    } catch (err: any) {
      setError(err.message || '发送失败，请稍后再试');
    }
    setLoading(false);
  };

  // 第二步：验证码确认 → 换绑成功（后端同时清除责令标记）→ 踢会话 → 重新登录
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) { setError('请输入验证码'); return; }
    setError('');
    setLoading(true);
    try {
      const r = await auth.emailVerify(code.trim());
      if (r.success) {
        toast('邮箱已更换，请使用新邮箱重新登录', 'success');
        navigate('/login?email-changed=1', { replace: true });
      } else {
        setError(r.error || '更换失败');
      }
    } catch (err: any) {
      setError(err.message || '更换失败，请稍后再试');
    }
    setLoading(false);
  };

  if (!authLoading && !user) return null;

  return (
    <div className="max-w-md mx-auto mt-8">
      <BackButton />
      <div className="bg-white rounded-xl border p-8">
        <h1 className="text-2xl font-bold text-center mb-2">更换绑定邮箱</h1>
        <p className="text-center text-sm text-gray-500 mb-6">
          当前邮箱：<span className="text-gray-700 font-medium">{user?.email}</span>
        </p>
        {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}
        {step === 1 ? (
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">新邮箱</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="输入你要绑定的新邮箱"
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">当前密码</label>
              <input
                type="password"
                value={emailPw}
                onChange={e => setEmailPw(e.target.value)}
                placeholder="输入当前密码确认身份"
                autoComplete="current-password"
                className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {loading ? '发送中...' : '发送验证码'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-primary-600">验证码已发送至新邮箱 {newEmail.trim()}，30 分钟内有效</p>
            <div className="flex items-center justify-between">
              <button type="button" onClick={handleResend} disabled={resendCd > 0 || loading}
                className="text-xs text-primary-600 hover:underline disabled:text-gray-300 disabled:no-underline transition">
                没有收到邮件？{resendCd > 0 ? `重新发送（${resendCd}s）` : '重新发送'}
              </button>
              <button type="button" onClick={() => { setStep(1); setError(''); }}
                className="text-xs text-gray-400 hover:text-gray-600 transition">← 返回上一步</button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">验证码</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6 位数字验证码"
                className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 tracking-widest"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {loading ? '确认中...' : '确认更换'}
            </button>
          </form>
        )}
        {step === 2 && (
          <p className="text-center text-xs text-gray-400 mt-6">
            更换完成后需 <button onClick={() => navigate('/login')} className="text-primary-600 hover:underline">重新登录</button>
          </p>
        )}
      </div>
    </div>
  );
}
