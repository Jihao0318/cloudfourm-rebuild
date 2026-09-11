import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { auth, users } from '../services/api';
import { getVipNickClass } from '../components/VIPBadge';
import BackButton from '../components/BackButton';

// S VIP+ 专属昵称主题（与后端 /users/nick-theme 可接受值一致）
const NICK_THEMES = [
  { id: 'theme1', label: '红金', colors: 'from-red-500 via-amber-400 to-red-500' },
  { id: 'theme2', label: '紫粉', colors: 'from-purple-500 via-pink-500 to-purple-500' },
  { id: 'theme3', label: '蓝紫', colors: 'from-cyan-500 via-blue-500 to-purple-500' },
  { id: 'theme4', label: '绿金', colors: 'from-emerald-500 via-green-400 to-amber-400' },
];

/**
 * 编辑资料（独立页面）：用户名 / 个人简介 / 自定义头衔（VIP）/ 昵称主题（S VIP+），一次保存。
 * 后端各字段是独立端点，提交时只调用发生变化的那几项。
 */
export default function EditProfile() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState('theme1');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 未登录守卫（与 ChangeEmail / ChangePassword 同款）
  useEffect(() => {
    if (!authLoading && !user) navigate('/login', { replace: true });
  }, [authLoading, user, navigate]);

  // 用当前会话资料回填表单（会话异步恢复，用户信息到位后填一次）
  useEffect(() => {
    if (!user || loaded) return;
    setUsername(user.username || '');
    setBio(user.bio || '');
    setTitle(user.custom_title || '');
    setTheme(user.nick_theme && user.nick_theme !== 'default' ? user.nick_theme : 'theme1');
    setLoaded(true);
  }, [user, loaded]);

  const isVip = !!user?.is_vip;
  const isSvip = user?.vip_tier === 'svip+';
  const savedTheme = user?.nick_theme && user.nick_theme !== 'default' ? user.nick_theme : 'theme1';

  if (!authLoading && !user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const nextUsername = username.trim();
    const changed = {
      username: nextUsername !== (user?.username || ''),
      bio: bio !== (user?.bio || ''),
      title: isVip && title !== (user?.custom_title || ''),
      theme: isSvip && theme !== savedTheme,
    };
    if (!Object.values(changed).some(Boolean)) {
      toast('资料没有变化');
      return;
    }
    setSaving(true);
    try {
      if (changed.username) {
        const r = await auth.changeUsername(nextUsername);
        if (!r.success) throw new Error(r.error || '用户名修改失败');
      }
      if (changed.bio) {
        const r = await users.updateProfile({ bio });
        if (!r.success) throw new Error(r.error || '简介保存失败');
      }
      if (changed.title) {
        const r = await users.updateTitle(title);
        if (!r.success) throw new Error(r.error || '头衔保存失败');
      }
      if (changed.theme) {
        const r = await users.updateNickTheme(theme);
        if (!r.success) throw new Error(r.error || '主题保存失败');
      }
      await refreshUser();
      toast('资料已保存', 'success');
      navigate('/profile?tab=settings', { replace: true });
    } catch (err: any) {
      setError(err?.message || '保存失败，请稍后再试');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-md mx-auto mt-8">
      <BackButton />
      <div className="bg-white rounded-xl border p-8">
        <h1 className="text-2xl font-bold text-center mb-2">编辑资料</h1>
        <p className="text-center text-sm text-gray-500 mb-6">修改后点底部「保存资料」一次提交</p>
        {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              maxLength={20}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="3-20 个字符"
              required
            />
            <p className="text-xs text-gray-400 mt-1">3-20 个字符，可用字母、数字、下划线和中文</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">个人简介</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              placeholder="介绍一下自己..."
            />
            <p className="text-xs text-gray-400 mt-1">最多 500 字（当前 {bio.length}）</p>
          </div>

          {isVip && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                自定义头衔 <span className="text-primary-500">VIP</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value.slice(0, 30))}
                maxLength={30}
                className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="设置你的 VIP 头衔"
              />
              <p className="text-xs text-gray-400 mt-1">最多 30 字，显示在用户名下方</p>
            </div>
          )}

          {isSvip && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                昵称主题 <span className="text-red-500">S VIP+</span>
              </label>
              <div className="flex flex-wrap gap-2 mb-3">
                {NICK_THEMES.map(t => {
                  const active = theme === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setTheme(t.id)}
                      className={`px-3 py-2 rounded-xl text-xs font-medium border-2 transition ${active ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200 hover:border-gray-300'}`}>
                      <span className={`text-transparent bg-clip-text bg-gradient-to-r ${t.colors} font-bold`}>{t.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="p-3 bg-gray-50 rounded-xl text-center">
                <span className="text-xs text-gray-400">预览效果：</span>
                <div className={`text-lg font-bold mt-1 ${getVipNickClass(user?.vip_tier, theme) || 'text-gray-900'}`}>{user?.username || '用户名'}</div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存资料'}
          </button>
        </form>
      </div>
    </div>
  );
}
