import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import BackButton from '../components/BackButton';

export default function Login() {
  const [loginField, setLoginField] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  // 回跳路径：优先 state（页面内守卫跳转），其次 query（会话过期整页跳转带 ?from=）
  const from = (location.state as { from?: string })?.from
    || new URLSearchParams(location.search).get('from')
    || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(loginField, password);
      if (result.success) {
        toast('登录成功', 'success');
        navigate(from, { replace: true });
      } else {
        setError(result.error || '登录失败');
      }
    } catch (err: any) {
      setError(err.message || '登录失败');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto mt-8">
      <BackButton />
      <div className="bg-white rounded-xl border p-8">
        <h1 className="text-2xl font-bold text-center mb-6">登录</h1>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-field" className="block text-sm font-medium text-gray-700 mb-1">用户名 / 邮箱</label>
            <input
              id="login-field"
              name="login"
              type="text"
              value={loginField}
              onChange={(e) => setLoginField(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full px-3 py-2 text-base border rounded-lg focus:border-primary-500 outline-none"
              required
              placeholder="用户名或邮箱"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              id="login-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 text-base border rounded-lg focus:border-primary-500 outline-none"
              required
              placeholder="••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? '处理中...' : '登录'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          还没有账号？{' '}
          <Link to="/register" className="text-primary-600 hover:underline">
            立即注册
          </Link>
          <span className="mx-2 text-gray-300">|</span>
          <Link to="/forgot-password" className="text-gray-400 hover:text-primary-600 hover:underline">
            忘记密码？
          </Link>
        </p>
      </div>
    </div>
  );
}
