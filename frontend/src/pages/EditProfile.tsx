import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { auth, users, shop as shopApi } from '../services/api';
import { getVipNickClass, getVipNickStyle } from '../components/VIPBadge';
import BackButton from '../components/BackButton';
import ConfirmModal from '../components/ConfirmModal';

// S VIP+ 专属昵称主题（与后端 /users/nick-theme 可接受值一致）
const NICK_THEMES = [
  { id: 'theme1', label: '红金', colors: 'from-red-500 via-amber-400 to-red-500' },
  { id: 'theme2', label: '紫粉', colors: 'from-purple-500 via-pink-500 to-purple-500' },
  { id: 'theme3', label: '蓝紫', colors: 'from-cyan-500 via-blue-500 to-purple-500' },
  { id: 'theme4', label: '绿金', colors: 'from-emerald-500 via-green-400 to-amber-400' },
];

// 免费改名冷却（与后端 RENAME_COOLDOWN_MS 一致）
const RENAME_COOLDOWN_MS = 14 * 24 * 3600 * 1000;

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
  // 自定义渐变（SVIP+）：2-3 个色号
  const [customColors, setCustomColors] = useState<string[]>(['#ff512f', '#dd2476', '#f9d423']);
  const [customEnabled, setCustomEnabled] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 改名：占用检查 + 冷却确认弹窗
  const [nameCheck, setNameCheck] = useState<{ available: boolean; reason: string } | null>(null);
  const [checkingName, setCheckingName] = useState(false);
  const [confirmRename, setConfirmRename] = useState(false);

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
    const nt = user.nick_theme;
    if (nt?.startsWith('custom:')) {
      const stops = nt.slice(7).split(',').map(h => `#${h.toUpperCase()}`);
      setCustomColors([...stops, ...['#ff512f', '#dd2476', '#f9d423']].slice(0, 3));
      setCustomEnabled(true);
      setTheme('custom');
    } else {
      setTheme(nt && nt !== 'default' ? nt : 'theme1');
    }
    setLoaded(true);
  }, [user, loaded]);

  // 改名冷却：距上次改名 <14 天 = 冷却中（后端 RENAME_COOLDOWN_MS 同值）
  const lastChangedAt = user?.username_changed_at ? new Date(user.username_changed_at.replace(' ', 'T') + 'Z').getTime() : null;
  const cooldownLeftMs = lastChangedAt ? Math.max(0, RENAME_COOLDOWN_MS - (Date.now() - lastChangedAt)) : 0;
  const inCooldown = cooldownLeftMs > 0;
  const cooldownDaysLeft = Math.ceil(cooldownLeftMs / (24 * 3600 * 1000));

  // 用户名占用实时检查（输入变化 500ms 防抖；与当前用户名相同则不查）
  useEffect(() => {
    const name = username.trim();
    if (!name || name === (user?.username || '') || !loaded) { setNameCheck(null); return; }
    setCheckingName(true);
    const t = setTimeout(async () => {
      try {
        const r = await auth.checkUsername(name);
        setNameCheck(r.success && r.data ? { available: r.data.available, reason: r.data.reason } : null);
      } catch { setNameCheck(null); }
      setCheckingName(false);
    }, 500);
    return () => clearTimeout(t);
  }, [username, user?.username, loaded]);

  const isVip = !!user?.is_vip;
  const isSvip = user?.vip_tier === 'svip+';
  const savedTheme = user?.nick_theme && user.nick_theme !== 'default' ? user.nick_theme : 'theme1';
  // 自定义渐变开启时，实际保存的是 custom: 色号串（后端正则校验 2-3 个色号）
  const customThemeString = `custom:${customColors.map(c => c.replace('#', '').toUpperCase()).join(',')}`;
  const effectiveTheme = isSvip && customEnabled ? customThemeString : theme;
  const customValid = customColors.every(c => /^[0-9a-fA-F]{6}$/.test(c.replace('#', '')));

  // 确认弹窗打开时拉一次改名卡现价（后台「商城物价」可调，不写死）
  const [cardPrice, setCardPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!confirmRename) return;
    shopApi.items().then((r: any) => {
      const card = (r?.data || []).find((i: any) => i.type === 'rename_card');
      if (card) setCardPrice(card.price);
    }).catch(() => {});
  }, [confirmRename]);

  if (!authLoading && !user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const nextUsername = username.trim();
    const changed = {
      username: nextUsername !== (user?.username || ''),
      bio: bio !== (user?.bio || ''),
      title: isVip && title !== (user?.custom_title || ''),
      theme: isSvip && effectiveTheme !== savedTheme,
    };
    if (!Object.values(changed).some(Boolean)) {
      toast('资料没有变化');
      return;
    }
    if (changed.username && nameCheck && !nameCheck.available) {
      setError(nameCheck.reason || '该用户名不可用');
      return;
    }
    setSaving(true);
    try {
      if (changed.username) {
        // 冷却期内：弹窗确认（优先用仓库改名卡，没有则一键购卡）
        if (inCooldown) {
          setConfirmRename(true);
          setSaving(false);
          return; // 用户在弹窗确认后由 doSaveUsername 继续
        }
        const r = await auth.changeUsername(nextUsername);
        if (!r.success) throw new Error(r.error || '用户名修改失败');
      }
      await saveRest(changed);
      return;
    } catch (err: any) {
      setError(err?.message || '保存失败，请稍后再试');
      setSaving(false);
    }
  };

  // 冷却确认弹窗点「确认」后：带 auto_buy 改名 + 保存其余字段
  const doRenameConfirmed = async () => {
    setConfirmRename(false);
    setError('');
    setSaving(true);
    try {
      const r = await auth.changeUsername(username.trim(), true);
      if (!r.success) throw new Error(r.error || '用户名修改失败');
      toast(r.message || '用户名已更新', 'success');
      await refreshUser();
      navigate('/profile?tab=settings', { replace: true });
    } catch (err: any) {
      setError(err?.message || '保存失败，请稍后再试');
      setSaving(false);
    }
  };

  // 保存除用户名外的字段 + 收尾跳转
  const saveRest = async (changed: { username: boolean; bio: boolean; title: boolean; theme: boolean }) => {
    try {
      if (changed.bio) {
        const r = await users.updateProfile({ bio });
        if (!r.success) throw new Error(r.error || '简介保存失败');
      }
      if (changed.title) {
        const r = await users.updateTitle(title);
        if (!r.success) throw new Error(r.error || '头衔保存失败');
      }
      if (changed.theme) {
        const r = await users.updateNickTheme(effectiveTheme);
        if (!r.success) throw new Error(r.error || '主题保存失败');
      }
      await refreshUser();
      toast('资料已保存', 'success');
      navigate('/profile?tab=settings', { replace: true });
    } catch (err: any) {
      setError(err?.message || '保存失败，请稍后再试');
      setSaving(false);
    }
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
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-sm font-medium text-gray-700">用户名</label>
              {inCooldown ? (
                <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                  ⏳ 免费改名冷却中 · 还剩 {cooldownDaysLeft} 天
                </span>
              ) : (
                <span className="text-[11px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
                  🟢 可免费改名
                </span>
              )}
            </div>
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
            {checkingName && <p className="text-xs text-gray-400 mt-1">检查用户名中…</p>}
            {!checkingName && nameCheck && (
              <p className={`text-xs mt-1 ${nameCheck.available ? 'text-green-600' : 'text-red-500'}`}>
                {nameCheck.available ? '✓ 该用户名可用' : `✗ ${nameCheck.reason || '该用户名不可用'}`}
              </p>
            )}
            {inCooldown && (
              <p className="text-xs text-amber-600 mt-1">
                冷却期内改名：优先使用仓库改名卡；没有则自动购买（{cardPrice ?? 1000} 积分），保存时会再确认
              </p>
            )}
            {!inCooldown && <p className="text-xs text-gray-400 mt-1">3-20 个字符，可用字母、数字、下划线和中文；每 14 天可免费改一次</p>}
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
                  const active = !customEnabled && theme === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => { setTheme(t.id); setCustomEnabled(false); }}
                      className={`px-3 py-2 rounded-xl text-xs font-medium border-2 transition ${active ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200 hover:border-gray-300'}`}>
                      <span className={`text-transparent bg-clip-text bg-gradient-to-r ${t.colors} font-bold`}>{t.label}</span>
                    </button>
                  );
                })}
                {/* 自定义渐变：2-3 个取色器，保存为 custom: 色号串 */}
                <button type="button" onClick={() => setCustomEnabled(true)}
                  className={`px-3 py-2 rounded-xl text-xs font-medium border-2 transition ${customEnabled ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200 hover:border-gray-300'}`}>
                  🎨 自定义
                </button>
              </div>
              {customEnabled && (
                <div className="flex flex-wrap items-center gap-3 mb-3 p-3 border border-primary-100 bg-primary-50/40 rounded-xl">
                  {customColors.map((c, i) => (
                    <label key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
                      <input type="color" value={c} maxLength={7}
                        onChange={e => setCustomColors(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                        className="w-8 h-8 rounded cursor-pointer border border-gray-200 bg-transparent p-0" />
                      色 {i + 1}
                    </label>
                  ))}
                  {customColors.length < 3 && (
                    <button type="button" onClick={() => setCustomColors(prev => [...prev, '#f9d423'])}
                      className="text-xs text-primary-600 hover:underline">+ 加一色</button>
                  )}
                  {customColors.length > 2 && (
                    <button type="button" onClick={() => setCustomColors(prev => prev.slice(0, -1))}
                      className="text-xs text-gray-400 hover:text-red-500">减一色</button>
                  )}
                </div>
              )}
              <div className="p-3 bg-gray-50 rounded-xl text-center">
                <span className="text-xs text-gray-400">预览效果：</span>
                <div style={getVipNickStyle(user?.vip_tier, customEnabled && customValid ? customThemeString : theme)}
                  className={`text-lg font-bold mt-1 ${getVipNickClass(user?.vip_tier, customEnabled && customValid ? customThemeString : theme) || 'text-gray-900'}`}>{user?.username || '用户名'}</div>
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

        {/* 冷却期改名确认：优先用仓库改名卡，没有则一键购卡 */}
        <ConfirmModal
          open={confirmRename}
          title="冷却期内改名"
          message={`免费改名冷却中还剩 ${cooldownDaysLeft} 天。本次改名将优先使用仓库中的改名卡；如果没有，将自动购买 1 张（${cardPrice ?? 1000} 积分）并完成改名。确定继续吗？`}
          confirmText={`确认改名${cardPrice ? `（${cardPrice} 积分）` : ''}`}
          onCancel={() => setConfirmRename(false)}
          onConfirm={doRenameConfirmed}
        />
      </div>
    </div>
  );
}
