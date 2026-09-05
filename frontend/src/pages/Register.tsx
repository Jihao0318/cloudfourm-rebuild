import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import BackButton from '../components/BackButton';

const TERMS_MD = `# 用户协议（完整版 · 责任完全免责）

**版本生效日期：2026年6月17日**  
**最后更新日期：2026年6月17日**

## 欢迎使用本论坛

本论坛（以下简称"本平台"）是一个由个人站长（以下简称"站长"）运营的技术交流社区，部署于第三方云服务平台之上。**任何人在注册或使用本论坛前，应仔细阅读本协议全部内容。注册或使用本论坛即表示用户（以下简称"你"）已完全理解并无条件接受本协议所有条款。若你不同意其中任何条款，应立即停止注册并离开本论坛。**

---

## 一、账号注册与真实性验证

1. **注册资格**：本论坛仅允许使用 **@qq.com** 后缀的电子邮箱进行注册。注册即代表你声明该QQ号码为你本人合法持有。
2. **验证权**：站长保留随时对已注册账号的QQ邮箱真实性进行独立核查的权利，核查方式包括但不限于通过腾讯公开接口查询该QQ号码是否存在、对比注册信息等。
3. **删除权**：若出现下列任一情况，站长有权在不事先通知、不提供任何理由、不承担任何赔偿责任的情况下，直接删除该账号及其所有历史数据（包括帖子、评论、私信等）：
   - 注册所用的QQ号码在腾讯系统中不存在；
   - 站长无法通过合理方式确认该QQ号码归属于注册人；
   - 有证据表明该QQ号码被冒用或存在归属争议。
4. **账号使用**：账号仅限本人使用，不得出借、转让、出租或出售。用户对账号下的一切操作（包括发帖、回复、私信等）承担全部法律后果。
5. **密码安全**：用户应自行保管账号密码，因密码泄露、设备丢失等造成的损失，站长不承担任何责任。

---

## 二、用户行为规范（详细禁止内容）

用户在使用本论坛时，**严禁发布、传播、链接、引导或暗示任何包含以下性质的内容**。若违反，站长有权随时删除内容、封禁账号，且无需提前警告或说明理由：

1. 违反中华人民共和国宪法、法律、行政法规及地方性法规的规定；
2. 危害国家安全、泄露国家秘密、颠覆国家政权、破坏国家统一、损害国家荣誉和利益；
3. 歪曲、丑化、亵渎、否定英雄烈士事迹和精神，侮辱、诽谤英雄烈士；
4. 宣扬恐怖主义、极端主义、民族仇恨、民族歧视、地域歧视、宗教歧视；
5. 含有淫秽、色情（包括软色情、性暗示）、赌博、暴力、凶杀、恐怖、教唆犯罪的内容；
6. 侮辱、诽谤、诬陷、恐吓他人，或公开他人隐私（人肉搜索）、侵犯他人名誉权、肖像权、隐私权等；
7. 侵犯他人知识产权的任何内容（如未经许可转载文字、图片、音视频、代码、软件等）；
8. 发布恶意软件、病毒、木马、钓鱼链接或其他危害网络安全的代码或信息；
9. 恶意引战、人身攻击、骚扰、纠缠、网络暴力；
10. 大量重复发布无意义内容（灌水）、刷屏、发布商业广告或未经授权的推广信息；
11. 冒用他人身份或组织名义发布内容，误导其他用户；
12. 其他违反公序良俗、社会公德或本论坛管理要求的内容。

---

## 三、内容版权与授权条款

1. **版权归属**：用户在本平台发布的原创内容（包括但不限于文字、图片、图形、音频、视频、代码等），其版权归创作者所有。
2. **授权许可**：用户一旦发布内容，即视为**永久、不可撤销、全球范围内、免许可费、可再许可、可转让**地授予站长和本平台运营方对该内容进行复制、修改、改编、翻译、分发、展示、存储、备份、推广及以任何已知或未来技术手段进行使用的权利，且无需向用户支付任何报酬。
3. **用户保证**：用户保证其发布内容不侵犯任何第三方的知识产权、隐私权、名誉权或其他合法权益。若因用户内容产生侵权索赔或诉讼，用户应承担全部赔偿责任（包括但不限于赔偿金、律师费、诉讼费、差旅费等）。
4. **投诉处理**：站长在收到第三方侵权投诉后，有权（但无义务）删除涉嫌侵权内容。站长不对删除的及时性、准确性做任何承诺，也不因此承担任何责任。

---

## 四、隐私与数据收集（有限告知）

1. **收集范围**：本平台仅收集提供服务所必需的最少信息，包括注册邮箱、IP地址、访问时间、发帖/评论内容及操作记录。
2. **使用目的**：所收集信息仅用于身份验证、内容展示、安全防护及改善服务，不会出售或用于广告营销。
3. **数据存储**：因本平台基于全球云服务架构，用户数据可能存储于多个国家/地区的服务器。用户使用即视为同意数据跨境传输。
4. **用户权利**：用户可自行在个人设置中修改部分信息，但本平台不提供数据导出服务，也不承诺随时删除所有记录。站长保留根据法律要求或备份需要保留数据的权利。
5. **未成年人**：本平台不面向未满14周岁的儿童，若发现未经监护人同意注册，站长有权删除账号。

---

## 五、服务可用性及变更

1. **现状提供**：本平台以"现状"和"现有可用性"为基础提供，不承诺无错误、无中断、无病毒。
2. **服务中断**：因系统维护、升级、硬件故障、第三方服务商问题、网络攻击、自然灾害等任何原因导致的服务暂停或数据丢失，站长不承担任何赔偿责任。
3. **服务终止**：站长有权在任何时候，以任何理由，永久关闭本平台，或删除任何用户账号及内容，且无需事先通知。

---

## 六、第三方内容与链接

本平台可能包含指向第三方网站或资源的链接，或引用第三方内容。该类内容由第三方独立提供，站长不对其准确性、合法性、安全性做任何担保，也不视为站长认可。用户访问第三方链接所产生的一切风险由用户自行承担，与站长无关。

---

## 七、免责声明（核心，全面免除站长责任）

**在适用法律允许的最大范围内，站长对本平台及用户承担的全部责任，仅限于零。具体免责事项包括但不限于：**

1. **用户内容**：所有用户发布的内容仅代表该用户的个人观点，与站长立场无关。站长不对任何用户内容的真实性、合法性、完整性、安全性负责，也不对因用户内容引发的任何争议、诉讼、行政处罚、人身财产损害承担任何责任。
2. **用户间纠纷**：用户之间因论坛交流产生的任何矛盾、侵权、违约等，均由当事人自行通过协商、仲裁或诉讼解决，站长不参与、不调解、不承担任何连带或补充责任。
3. **服务缺陷**：对于本平台的任何技术瑕疵、性能问题、安全漏洞，站长不承担任何修理、更换或赔偿义务。
4. **损失豁免**：在任何情况下（包括但不限于合同、侵权、过失、严格责任），站长均不对任何直接损失、间接损失、附带损失、特殊损失、惩罚性赔偿（包括但不限于利润损失、数据丢失、业务中断、商誉损害）承担责任，即使站长已知悉该等损失的可能。
5. **第三方行为**：因黑客攻击、网络供应商故障、云服务商中断、政府行为、战争、罢工等不可抗力导致服务异常，站长不承担责任。
6. **账号删除**：因任何原因（包括但不限于违反协议、验证不通过、服务终止等）导致账号被删除，用户自行承担内容丢失等一切后果，站长无恢复义务。
7. **法律变更**：因法律、法规、政策变化导致本平台无法继续运营或需调整，站长不承担任何赔偿责任。

**用户明确理解并同意：使用本论坛的风险完全由用户自行承担。若用户对平台或协议有任何不满，唯一的救济措施是立即停止使用并注销账号。**

---

## 八、赔偿义务（用户补偿站长）

用户同意，若因以下任何一种情况导致站长遭受任何形式的损失（包括但不限于第三方索赔、行政处罚、律师费、诉讼费、和解金、差旅费等），用户应全额赔偿站长：

- 用户违反本协议任何条款；
- 用户使用本平台的行为侵犯了任何第三方权益；
- 用户发布的内容引发任何法律纠纷或监管调查。

---

## 九、法律适用与管辖

1. **适用法律**：本协议的解释、效力、履行及争议解决，均适用 **中华人民共和国法律**，不考虑法律冲突原则。
2. **争议解决**：因本协议或使用本平台产生的任何争议，双方应首先通过友好协商解决；协商不成的，任何一方应将争议提交至 **站长所在地（中华人民共和国境内）有管辖权的人民法院** 诉讼解决。
3. **管辖豁免**：用户明确放弃以"服务器位于境外"、"不方便法院"或任何其他程序性理由对本条管辖约定提出异议的权利。

---

## 十、协议修改与通知

1. 站长有权随时修订本协议，修订后的版本将在论坛公告区公布，并更新"最后更新日期"。
2. 若用户不同意修改内容，应立即停止使用并自行注销账号。用户在新版协议公布后继续使用，即视为完全接受修改后的条款。
3. 站长不承担单独通知每个用户的义务，用户应定期查看公告。

---

## 十一、其他杂项条款

1. **完整协议**：本协议构成双方之间就本平台使用的完整且排他性约定，取代此前所有口头或书面沟通。
2. **条款可分割**：若本协议任何条款被有管辖权的法院认定为无效或不可执行，不影响其余条款的效力。
3. **权利不行使**：站长未行使或延迟行使本协议项下的任何权利，不构成对该权利的放弃。
4. **无第三方受益人**：本协议不赋予任何第三方任何权利。
5. **无代理关系**：用户与站长之间不存在代理、合伙、合资或雇佣关系。

---

**郑重声明：本平台由个人站长独立运营，不设任何形式的客服、投诉邮箱或即时通讯渠道。站长不回应任何用户请求、投诉或法律函件。凡使用本论坛者，即视为已完全知悉并接受上述全部条款，自愿承担全部风险。**

**若你无法接受上述任何条款，请勿注册或使用本论坛。**`;

export default function Register() {
  const location = useLocation();
  // 邀请链接进入时自动预填邀请码（/invite/:code → register state）
  const initialInvite = ((location.state as { invite_code?: string })?.invite_code || '').toUpperCase();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInvite);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [registered, setRegistered] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    setLoading(true);

    try {
      const result = await register(username, email, password, inviteCode || undefined);
      if (result.success) {
        // 注册成功（用户信息已入库）→ 直接进入邮箱验证页，验证通过后即可登录
        navigate(`/verify-email?account=${encodeURIComponent(email.trim())}`);
        return;
      } else {
        setError(result.error || '注册失败');
      }
    } catch (err: any) {
      setError(err.message || '注册失败');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto mt-8">
      <BackButton />
      <div className="bg-white rounded-xl border p-8">
        <h1 className="text-2xl font-bold text-center mb-6">注册</h1>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>
        )}

        {registered ? (
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h2 className="text-lg font-bold mb-2">注册成功 🎉</h2>
            <p className="text-xs text-gray-500 mb-6">验证码已发送至你的邮箱，完成邮箱验证后即可登录</p>
            <button onClick={() => navigate(`/verify-email?account=${encodeURIComponent(email.trim())}`)}
              className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 transition mb-3">
              去验证邮箱
            </button>
            <button onClick={() => navigate('/')}
              className="w-full border text-gray-600 py-2.5 rounded-lg font-medium hover:bg-gray-50 transition">
              暂时跳过，去首页
            </button>
          </div>
        ) : (
        <>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="username" autoCapitalize="none"
              className="w-full px-3 py-2 text-base border rounded-lg focus:border-primary-500 outline-none"
              required minLength={3} maxLength={20} placeholder="3-20 个字符" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" autoCapitalize="none" autoCorrect="off"
              className="w-full px-3 py-2 text-base border rounded-lg focus:border-primary-500 outline-none"
              required placeholder="yourname@qq.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              className={`w-full px-3 py-2 text-base border rounded-lg outline-none focus:border-primary-500 ${password ? (password.length >= 6 && /[A-Z]/.test(password) && /[0-9]/.test(password) ? 'border-green-400' : 'border-red-300') : ''}`}
              required minLength={6} placeholder="如: Abc123" />
            <div className="mt-1.5 space-y-1">
              <p className={`text-xs flex items-center gap-1 ${/[A-Z]/.test(password) ? 'text-green-600' : password ? 'text-red-500' : 'text-gray-400'}`}>
                <span>{/[A-Z]/.test(password) ? '✓' : '•'}</span> 包含大写字母
              </p>
              <p className={`text-xs flex items-center gap-1 ${/[0-9]/.test(password) ? 'text-green-600' : password ? 'text-red-500' : 'text-gray-400'}`}>
                <span>{/[0-9]/.test(password) ? '✓' : '•'}</span> 包含数字
              </p>
              <p className={`text-xs flex items-center gap-1 ${password.length >= 6 ? 'text-green-600' : password ? 'text-red-500' : 'text-gray-400'}`}>
                <span>{password.length >= 6 ? '✓' : '•'}</span> 至少 6 位字符
              </p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">确认密码</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className={`w-full px-3 py-2 text-base border rounded-lg outline-none focus:border-primary-500 ${confirmPassword ? (confirmPassword === password ? 'border-green-400' : 'border-red-300') : ''}`}
              required placeholder="再次输入密码" />
            {confirmPassword && (
              <p className={`text-xs mt-1 flex items-center gap-1 ${confirmPassword === password ? 'text-green-600' : 'text-red-500'}`}>
                {confirmPassword === password ? '✓ 密码一致' : '✗ 两次密码不一致'}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邀请码</label>
            <input type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg outline-none focus:border-primary-500"
              placeholder="请输入邀请码（必填）" />
          </div>

          {/* 用户协议勾选框 */}
          <label className="flex items-start gap-2 text-sm text-gray-500 cursor-pointer">
            <input type="checkbox" checked={agreeToTerms} onChange={e => setAgreeToTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500" />
            <span>
              我已阅读并同意{' '}
              <button type="button" onClick={() => setShowTerms(true)}
                className="text-primary-600 hover:underline font-medium cursor-pointer">
                《用户协议》
              </button>
            </span>
          </label>

          <button type="submit" disabled={loading || !agreeToTerms}
            className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50">
            {loading ? '注册中...' : '注册'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          已有账号？ <Link to="/login" className="text-primary-600 hover:underline">立即登录</Link>
        </p>
        </>
        )}
      </div>

      {/* 用户协议弹窗 — portal 到 body，避免被困在 main z-10 堆叠上下文（否则遮罩盖不住根级底部导航 z-50） */}
      {showTerms && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowTerms(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-bold text-gray-900">用户协议</h2>
              <button onClick={() => setShowTerms(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition">
                ✕
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{TERMS_MD}</ReactMarkdown>
            </div>
            <div className="px-6 py-4 border-t flex justify-end">
              <button onClick={() => setShowTerms(false)}
                className="bg-primary-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition">
                关闭
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
