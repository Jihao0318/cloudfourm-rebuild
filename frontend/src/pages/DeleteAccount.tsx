import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { auth } from '../services/api';
import BackButton from '../components/BackButton';

/**
 * 注销账户（独立页面）：先看清后果并勾选确认，再走三步确认流程
 * （警告 → 验证密码 → 5 秒冷静倒计时 → 提交），提交后进入 3 天冷静期。
 * 已提交注销时本页显示倒计时与「取消注销」。
 */
export default function DeleteAccount() {
  const { user, loading: authLoading, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [agreed, setAgreed] = useState(false);
  const [modal, setModal] = useState<{ step: 1 | 2 | 3; password: string; countdown: number; error?: string; verifying?: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // 未登录守卫（与 ChangeEmail / ChangePassword 同款）
  useEffect(() => {
    if (!authLoading && !user) navigate('/login', { replace: true });
  }, [authLoading, user, navigate]);

  if (!authLoading && !user) return null;

  // ── 已提交注销：显示剩余时间 + 取消入口 ──
  if (user?.scheduled_deleted_at) {
    const d = new Date(user.scheduled_deleted_at.replace(' ', 'T') + 'Z');
    const totalHours = Math.max(0, Math.floor((d.getTime() - Date.now()) / 3600000));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const remainingText = days > 0 ? `${days}天${hours}小时` : `${hours}小时`;
    return (
      <div className="max-w-md mx-auto mt-8">
        <BackButton />
        <div className="bg-white rounded-xl border p-8">
          <h1 className="text-2xl font-bold text-center mb-6">注销账户</h1>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <p className="text-sm text-yellow-800 font-medium mb-1">⏳ 账户注销待处理</p>
            <p className="text-xs text-yellow-700 mb-3">
              将在 <strong>{remainingText}</strong> 后自动注销，期间可随时取消。
            </p>
            <button
              onClick={async () => {
                setCancelling(true);
                try {
                  const r = await auth.cancelDeletion();
                  if (r.success) { await refreshUser(); toast('已取消账户注销', 'success'); }
                  else toast(r.error || '取消失败', 'error');
                } catch (err: any) {
                  toast(err.message || '取消失败', 'error');
                }
                setCancelling(false);
              }}
              disabled={cancelling}
              className="w-full px-4 py-2 bg-white border border-yellow-300 text-yellow-700 rounded-xl text-sm font-medium hover:bg-yellow-50 transition disabled:opacity-50"
            >
              {cancelling ? '处理中...' : '取消注销'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!modal) return;
    setModal({ ...modal, verifying: true, error: '' });
    try {
      const r = await auth.deleteAccount(modal.password);
      if (r.success) {
        setModal(null);
        toast('账户将在 3 天后自动注销', 'success');
        setTimeout(() => { logout(); navigate('/'); }, 2000);
      } else {
        setModal({ ...modal, verifying: false, error: r.error || '提交失败' });
      }
    } catch (err: any) {
      setModal({ ...modal, verifying: false, error: err.message || '提交失败' });
    }
  };

  return (
    <div className="max-w-md mx-auto mt-8">
      <BackButton />
      <div className="bg-white rounded-xl border p-8">
        <h1 className="text-2xl font-bold text-center mb-2">注销账户</h1>
        <p className="text-center text-sm text-gray-500 mb-6">提交后进入 3 天冷静期，期间可随时取消</p>

        <div className="space-y-3 mb-5">
          <div className="flex gap-3 p-3 bg-red-50 border border-red-100 rounded-xl">
            <span className="text-lg leading-none">⚠️</span>
            <div>
              <p className="text-sm font-medium text-red-700">这是一项不可逆的操作</p>
              <p className="text-xs text-red-500 mt-0.5">冷静期结束后数据永久删除，无法恢复</p>
            </div>
          </div>
          <div className="flex gap-3 p-3 bg-gray-50 rounded-xl">
            <span className="text-lg leading-none">🕒</span>
            <div>
              <p className="text-sm font-medium text-gray-800">提交后进入 3 天冷静期</p>
              <p className="text-xs text-gray-500 mt-0.5">期间可随时取消注销</p>
            </div>
          </div>
          <div className="flex gap-3 p-3 bg-gray-50 rounded-xl">
            <span className="text-lg leading-none">🗑</span>
            <div>
              <p className="text-sm font-medium text-gray-800">冷静期结束后数据永久删除</p>
              <p className="text-xs text-gray-500 mt-0.5">账号、帖子、收藏等均不可恢复</p>
            </div>
          </div>
          <div className="flex gap-3 p-3 bg-gray-50 rounded-xl">
            <span className="text-lg leading-none">🔐</span>
            <div>
              <p className="text-sm font-medium text-gray-800">提交需验证账号密码</p>
              <p className="text-xs text-gray-500 mt-0.5">并通过 5 秒冷静倒计时二次确认</p>
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
            className="w-4 h-4 accent-red-600" />
          <span className="text-sm text-gray-700">我已阅读并理解上述风险</span>
        </label>

        <button
          onClick={() => setModal({ step: 1, password: '', countdown: 5 })}
          disabled={!agreed}
          className="w-full bg-red-600 text-white py-2.5 rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          提交注销申请
        </button>
        <button onClick={() => navigate('/profile?tab=settings')}
          className="w-full mt-2 text-sm text-gray-500 hover:text-gray-700 transition py-2">
          再想想，返回设置
        </button>
      </div>

      {/* 三步确认弹窗：警告 → 验证密码 → 5 秒冷静倒计时（portal 到 body，避免被布局堆叠上下文困住） */}
      {modal && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            {modal.step === 1 && (
              <>
                <h3 className="text-lg font-bold text-red-600 mb-3">⚠️ 确认注销</h3>
                <p className="text-sm text-gray-600 mb-2">你确定要注销账户吗？</p>
                <p className="text-xs text-gray-400 mb-5">注销后有 <strong>3 天冷静期</strong>，期间可以随时取消。</p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setModal(null)} className="px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
                  <button onClick={() => setModal({ ...modal, step: 2 })} className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition">下一步</button>
                </div>
              </>
            )}
            {modal.step === 2 && (
              <>
                <h3 className="text-lg font-bold text-red-600 mb-3">🔐 验证密码</h3>
                <p className="text-xs text-gray-500 mb-4">请输入密码验证身份，验证通过后将进入 5 秒冷静倒计时。</p>
                <input type="password" value={modal.password}
                  onChange={e => setModal({ ...modal, password: e.target.value, error: '' })}
                  className="w-full px-3 py-2 border border-red-300 rounded-xl outline-none focus:border-red-500 text-sm mb-2"
                  placeholder="输入密码" />
                {modal.error && <p className="text-xs text-red-500 mb-3">{modal.error}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setModal(null)} className="px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
                  <button disabled={!modal.password || modal.verifying}
                    onClick={async () => {
                      setModal({ ...modal, verifying: true, error: '' });
                      try {
                        const r = await auth.verifyPassword(modal.password);
                        if (r.success) {
                          // 密码正确 → 进入 5 秒冷静倒计时
                          setModal({ ...modal, step: 3, verifying: false, countdown: 5 });
                          const timer = setInterval(() => {
                            setModal(prev => {
                              if (!prev || prev.countdown <= 1) { clearInterval(timer); return prev ? { ...prev, countdown: 0 } : null; }
                              return { ...prev, countdown: prev.countdown - 1 };
                            });
                          }, 1000);
                        } else {
                          setModal({ ...modal, verifying: false, error: r.error || '密码错误' });
                        }
                      } catch (err: any) {
                        setModal({ ...modal, verifying: false, error: err.message || '验证失败' });
                      }
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                    {modal.verifying ? '验证中...' : '验证密码'}
                  </button>
                </div>
              </>
            )}
            {modal.step === 3 && (
              <>
                <h3 className="text-lg font-bold text-red-600 mb-3">⏳ 冷静倒计时</h3>
                <p className="text-sm text-gray-600 mb-1">请等待 <strong>{modal.countdown}</strong> 秒后点击确认提交注销。</p>
                <p className="text-xs text-gray-400 mb-5">冷静期内可随时取消操作。</p>
                <div className="flex items-center justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                    <span className="text-2xl font-bold text-red-600">{modal.countdown}</span>
                  </div>
                </div>
                {modal.error && <p className="text-xs text-red-500 mb-3 text-center">{modal.error}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setModal(null)} className="px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
                  <button disabled={modal.countdown > 0 || modal.verifying} onClick={handleSubmit}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                    {modal.verifying ? '提交中...' : '确认提交'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
