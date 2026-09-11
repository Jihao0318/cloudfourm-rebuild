import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../services/api';
import BackButton from '../components/BackButton';

export default function ForgotPassword() {
  // 已登录场景（「修改密码」页 → 忘记原密码 → 通过邮箱重置）：邮箱锁定为当前账号绑定邮箱，
  // 不允许改成别的邮箱；未登录场景才允许手动输入任意注册邮箱
  const { user } = useAuth();
  const lockedEmail = user?.email || '';
  const [email, setEmail] = useState(lockedEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resendCd, setResendCd] = useState(0);
  const { toast } = useToast();
  const navigate = useNavigate();

  // 会话异步恢复 → 用户信息到位后回填锁定邮箱
  useEffect(() => {
    if (lockedEmail) setEmail(lockedEmail);
  }, [lockedEmail]);

  // 实际提交用邮箱：已登录时强制取绑定邮箱（输入框只读，即便被脚本/自动填充改值也不生效）；
  // 未登录时才用输入框里的值
  const effectiveEmail = (lockedEmail || email).trim();

  // 重发倒计时（60s 防连点）
  useEffect(() => {
    if (resendCd <= 0) return;
    const t = setTimeout(() => setResendCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCd]);

  // 第一步：发送验证码
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.forgot(effectiveEmail);
      setStep('reset');
      toast('验证码已发送，请查收邮箱', 'success');
    } catch (err: any) {
      setError(err.message || '发送失败，请稍后再试');
    }
    setLoading(false);
  };

  // 重发验证码（复用 forgot 端点，后端会作废旧码生成新码）
  const handleResend = async () => {
    setError('');
    setLoading(true);
    try {
      await auth.forgot(effectiveEmail);
      toast('验证码已重新发送', 'success');
      setResendCd(60);
    } catch (err: any) {
      setError(err.message || '发送失败，请稍后再试');
    }
    setLoading(false);
  };

  // 第二步：验证码 + 新密码
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.reset(effectiveEmail, code.trim(), newPassword);
      setStep('done');
      toast('密码已重置，请重新登录', 'success');
    } catch (err: any) {
      setError(err.message || '重置失败，请稍后再试');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto mt-8">
      <BackButton />
      <div className="bg-white rounded-xl border p-8">
        {step === 'email' && (
          <>
            <h1 className="text-2xl font-bold text-center mb-2">{lockedEmail ? '重置密码' : '忘记密码'}</h1>
            <p className="text-center text-sm text-gray-500 mb-6">
              {lockedEmail ? '将向你账号绑定的邮箱发送 6 位验证码' : '输入注册邮箱，我们将发送 6 位验证码'}
            </p>
            {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-1">
                  {lockedEmail ? '账号绑定邮箱' : '注册邮箱'}
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    // 已登录：只读兜底——脚本/浏览器自动填充绕过 readOnly 改值时直接撤销
                    if (lockedEmail) { e.target.value = lockedEmail; return; }
                    setEmail(e.target.value);
                  }}
                  readOnly={!!lockedEmail}
                  aria-readonly={!!lockedEmail}
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  title={lockedEmail ? '已登录账号的绑定邮箱，不可修改' : undefined}
                  className={`w-full px-3 py-2 text-base border rounded-lg outline-none ${
                    lockedEmail ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'focus:border-primary-500'
                  }`}
                  required
                  placeholder="you@example.com"
                />
                {!!lockedEmail && (
                  <p className="text-xs text-gray-400 mt-1">已登录账号的绑定邮箱，不可修改；如需换绑请到个人设置里的「更换邮箱」</p>
                )}
              </div>
              <button type="submit" disabled={loading} className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50">
                {loading ? '发送中...' : '发送验证码'}
              </button>
            </form>
          </>
        )}

        {step === 'reset' && (
          <>
            <h1 className="text-2xl font-bold text-center mb-2">重置密码</h1>
            <p className="text-center text-sm text-gray-500 mb-6">验证码已发送至 {effectiveEmail}，10 分钟内有效</p>
            {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label htmlFor="reset-code" className="block text-sm font-medium text-gray-700 mb-1">验证码</label>
                <div className="flex gap-2">
                  <input
                    id="reset-code"
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="flex-1 min-w-0 w-full px-3 py-2 text-base border rounded-lg focus:border-primary-500 outline-none"
                    required
                    placeholder="6 位数字验证码"
                    maxLength={6}
                  />
                  <button type="button" onClick={handleResend} disabled={resendCd > 0 || loading}
                    className="shrink-0 min-h-[40px] px-3 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                    {resendCd > 0 ? `重新发送（${resendCd}s）` : '重新发送'}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="reset-password" className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                <div className="relative">
                  <input
                    id="reset-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-full px-3 py-2 pr-11 text-base border rounded-lg focus:border-primary-500 outline-none"
                    required
                    placeholder="至少 6 位，含大写字母和数字"
                  />
                  <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
                    aria-label={showNewPassword ? '隐藏密码' : '显示密码'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-gray-400 hover:text-gray-600 transition">
                    {showNewPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50">
                {loading ? '重置中...' : '重置密码'}
              </button>
            </form>
          </>
        )}

        {step === 'done' && (
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">密码已重置</h1>
            <p className="text-sm text-gray-500 mb-6">请使用新密码重新登录</p>
            <button onClick={() => navigate('/login')} className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700">
              去登录
            </button>
          </div>
        )}

        <p className="text-center text-sm text-gray-500 mt-6">
          想起来了？{' '}
          <Link to="/login" className="text-primary-600 hover:underline">返回登录</Link>
        </p>
      </div>
    </div>
  );
}
