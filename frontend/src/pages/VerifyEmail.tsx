import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { auth } from '../services/api';
import BackButton from '../components/BackButton';

// 登录前邮箱验证页：require_email_verify 开启时未验证用户无法登录。
// 支持用户名或邮箱定位账号；发送成功后展示脱敏绑定邮箱（帮用户回忆绑的是哪个邮箱）。
export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [account, setAccount] = useState(searchParams.get('account') || '');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCd, setResendCd] = useState(0);
  const { toast } = useToast();
  const navigate = useNavigate();

  // 重发倒计时（60s 防连点，与后端限流 3/5min 配合）
  useEffect(() => {
    if (resendCd <= 0) return;
    const t = setTimeout(() => setResendCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCd]);

  // 打开页面时自动发一次验证码（注册成功跳转 / 登录被拦跳转都带 account）：
  // resend-guest 会作废旧码重发新码，保证页面展示与邮箱里的码一致；发完进入 60s 重发倒计时
  const autoSentRef = useRef(false);
  useEffect(() => {
    const acc = (searchParams.get('account') || '').trim();
    if (!acc || autoSentRef.current) return;
    autoSentRef.current = true;
    setLoading(true);
    auth.resendEmailGuest(acc)
      .then(res => {
        setMaskedEmail(res.data?.masked_email || '');
        toast(res.message || '验证码已发送，请查收邮箱', 'success');
        setResendCd(60);
      })
      .catch((err: any) => setError(err.message || '发送失败，请稍后再试'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 发送/重发验证码：账号（用户名或邮箱）定位，后端发码到绑定邮箱并返回脱敏邮箱
  const handleSend = async () => {
    if (!account.trim()) { setError('请输入注册时的用户名或邮箱'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await auth.resendEmailGuest(account.trim());
      setMaskedEmail(res.data?.masked_email || '');
      toast(res.message || '验证码已发送，请查收邮箱', 'success');
      setResendCd(60);
    } catch (err: any) {
      setMaskedEmail('');
      setError(err.message || '发送失败，请稍后再试');
    }
    setLoading(false);
  };

  // 提交验证：成功后跳登录页（带账号预填 + 已验证标记）
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account.trim() || !code.trim()) { setError('请输入账号和验证码'); return; }
    setError('');
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
        <form onSubmit={handleVerify} className="space-y-4">
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
      </div>
    </div>
  );
}
