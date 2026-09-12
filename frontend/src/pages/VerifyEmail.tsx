import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../services/api';
import BackButton from '../components/BackButton';

/**
 * 邮箱验证 / 责令换邮箱（双模式）：
 * - 验证模式（guest）：账号已绑定邮箱但未验证——发码到绑定邮箱，验证后登录
 *   （注册成功跳转 / 登录被拦跳转，带账号预填并自动发码）
 * - 责令模式（change）：管理员责令更换邮箱——登录被拦时携带 change_token 跳入，
 *   输入新邮箱收码确认，换绑成功后直接进入登录态
 */
export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { applySession } = useAuth();

  // 责令模式参数（Login 跳转时经 state 传入，不进 URL）
  const ordered = (location.state as { change_token?: string; reason?: string } | null);
  const changeMode = !!(ordered?.change_token);
  // 注册跳转标记：注册接口已经发过验证码，本页不再自动重发（否则同一账号连收两封、首封的码还会被作废）
  const regState = location.state as { code_sent?: boolean; masked_email?: string } | null;
  const codeSentByRegister = !changeMode && !!regState?.code_sent;

  const [account, setAccount] = useState(searchParams.get('account') || '');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCd, setResendCd] = useState(0);
  // 责令模式打开时不自动发码：用户先填新邮箱才有收件目标
  const autoSentRef = useRef(false);

  // 重发倒计时（60s 防连点，与后端限流 3/5min 配合）
  useEffect(() => {
    if (resendCd <= 0) return;
    const t = setTimeout(() => setResendCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCd]);

  // 验证模式：打开页面时自动发一次验证码（仅限「登录被拦跳转」等尚未发过码的场景；
  // 注册跳转（code_sent 标记）里注册接口已经发过一封，这里只展示已发送状态，不再重复触发）
  useEffect(() => {
    if (changeMode) return;
    const acc = (searchParams.get('account') || '').trim();
    if (!acc || autoSentRef.current) return;
    autoSentRef.current = true;
    if (codeSentByRegister) {
      if (regState?.masked_email) setMaskedEmail(regState.masked_email);
      toast('验证码已发送，请查收邮箱', 'success');
      setResendCd(60);
      return;
    }
    setLoading(true);
    auth.resendEmailGuest(acc)
      .then(res => {
        setMaskedEmail(res.data?.masked_email || '');
        // 后端 60 秒静默期内不会重复发信：明确告知用户查收上一封，避免以为系统没发
        if (res.data?.code_silenced) toast('验证码已发送过，请查收上一封邮件（约 1 分钟后可重新发送）', 'info');
        else toast(res.message || '验证码已发送，请查收邮箱', 'success');
        setResendCd(60);
      })
      .catch((err: any) => setError(err.message || '发送失败，请稍后再试'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 发送/重发验证码
  const handleSend = async () => {
    setError('');
    if (changeMode) {
      if (!newEmail.trim()) { setError('请输入新邮箱'); return; }
      setLoading(true);
      try {
        const res = await auth.changeEmailGuestRequest(ordered!.change_token!, newEmail.trim());
        setMaskedEmail(res.data?.masked_email || '');
        if (res.data?.code_silenced) toast('验证码已发送过，请查收上一封邮件（约 1 分钟后可重新发送）', 'info');
        else toast(res.message || '验证码已发送，请查收新邮箱', 'success');
        setResendCd(60);
      } catch (err: any) {
        setError(err.message || '发送失败，请稍后再试');
      }
      setLoading(false);
      return;
    }
    if (!account.trim()) { setError('请输入注册时的用户名或邮箱'); return; }
    setLoading(true);
    try {
      const res = await auth.resendEmailGuest(account.trim());
      setMaskedEmail(res.data?.masked_email || '');
      if (res.data?.code_silenced) toast('验证码已发送过，请查收上一封邮件（约 1 分钟后可重新发送）', 'info');
      else toast(res.message || '验证码已发送，请查收邮箱', 'success');
      setResendCd(60);
    } catch (err: any) {
      setError(err.message || '发送失败，请稍后再试');
    }
    setLoading(false);
  };

  // 提交验证/更换
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (changeMode) {
      if (!newEmail.trim() || !code.trim()) { setError('请输入新邮箱和验证码'); return; }
      setLoading(true);
      try {
        const res = await auth.changeEmailGuestConfirm(ordered!.change_token!, newEmail.trim(), code.trim());
        toast(res.message || '邮箱更换成功', 'success');
        // 后端已直接签发登录态：写入会话后进站
        applySession(res.data!.token, res.data!.refresh_token, res.data!.user);
        navigate('/', { replace: true });
      } catch (err: any) {
        setError(err.message || '更换失败，请稍后再试');
      }
      setLoading(false);
      return;
    }
    if (!account.trim() || !code.trim()) { setError('请输入账号和验证码'); return; }
    setLoading(true);
    try {
      const res = await auth.verifyEmailGuest(account.trim(), code.trim());
      toast(res.message || '邮箱验证成功，请登录', 'success');
      navigate(`/login?verified=1&account=${encodeURIComponent(account.trim())}`, { replace: true });
    } catch (err: any) {
      setError(err.message || '验证失败，请稍后再试');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto mt-8">
      <BackButton />
      <div className="bg-white rounded-xl border p-8">
        {changeMode ? (
          <>
            <h1 className="text-2xl font-bold text-center mb-2">更换绑定邮箱</h1>
            {ordered?.reason && (
              <div className="bg-orange-50 text-orange-600 px-4 py-2 rounded-lg mb-4 text-sm">
                管理员要求你更换邮箱（原因：{ordered.reason}）。输入新邮箱完成更换后即可进入论坛。
              </div>
            )}
            {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}
            {maskedEmail && (
              <div className="bg-green-50 text-green-700 px-4 py-2 rounded-lg mb-4 text-sm">
                验证码已发送至：<span className="font-medium">{maskedEmail}</span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || resendCd > 0 || !newEmail.trim()}
                className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resendCd > 0 ? `验证码已发送，重新发送（${resendCd}s）` : '发送验证码'}
              </button>
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
                {loading ? '处理中...' : '完成更换并登录'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-center mb-2">验证邮箱</h1>
            <p className="text-center text-sm text-gray-500 mb-6">
              输入注册时的用户名或邮箱，验证完成后即可登录
            </p>
            {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}
            {maskedEmail && (
              <div className="bg-green-50 text-green-700 px-4 py-2 rounded-lg mb-4 text-sm">
                验证码已发送至：<span className="font-medium">{maskedEmail}</span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用户名 / 注册邮箱</label>
                <input
                  type="text"
                  value={account}
                  onChange={e => setAccount(e.target.value)}
                  placeholder="用户名或注册邮箱"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
              </div>
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || resendCd > 0 || !account.trim()}
                className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resendCd > 0 ? `验证码已发送，重新发送（${resendCd}s）` : '发送验证码'}
              </button>
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
                {loading ? '验证中...' : '完成验证'}
              </button>
            </form>
            <p className="text-center text-xs text-gray-400 mt-6">
              验证成功后前往 <Link to="/login" className="text-primary-600 hover:underline">登录</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
