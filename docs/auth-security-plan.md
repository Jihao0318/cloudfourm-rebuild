# 登录系统安全修复方案（11 项）

> 日期：2026-08-12 ｜ 状态：方案已出，未实施（登录方案整体优化另行规划）
> 范围：worker/src（Hono+D1）+ frontend/src（React18）｜ 校园论坛场景，方案以「小步、可逆、低成本」为原则

---

## 1.【高危】存储型 XSS + localStorage token = 账号接管链

**现状**：PostDetail.tsx:350,544 用 `ReactMarkdown + rehypeRaw` 渲染用户帖/评论，零消毒；无 CSP；token 明文在 localStorage。

**方案（前端为主，三步）**：
1. **删掉用户内容上的 `rehypeRaw`**：react-markdown 默认对原始 HTML 转义，帖/评论/MarkdownEditor 预览三处去掉 rehypeRaw（`PostDetail.tsx`、`MarkdownEditor.tsx:349`）
2. 确需富媒体：用 `rehype-sanitize` 白名单（允许 img/video/iframe 标签但限制 src 为 https: 白名单域名：图床 tubed.your-domain.com + YouTube/Bilibili embed）；自定义 `img/video/iframe` 组件加 scheme 校验（只放行 https:，拦 javascript:/data:），不再 `{...props}` 透传任意属性
3. **加 CSP 兜底**：`frontend/index.html` 加 meta CSP（`default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; frame-src https://www.youtube.com https://player.bilibili.com`）
4. 与第 5 项（token 迁移 HttpOnly cookie）叠加后，XSS 偷不到 token，链路断开（双保险）

**涉及**：PostDetail.tsx、MarkdownEditor.tsx、index.html、package.json（rehype-sanitize）
**优先级**：⭐⭐⭐⭐⭐（上线前必修）

---

## 2.【高危】改密/登出无法终止会话

**现状**：改密不清 refresh token、不废旧 JWT（auth.ts:169-186）；前端登出只清本地 token、不调后端、不清 refresh_token（AuthContext.tsx:86-89）。

**方案（token 版本号 + 登出补全）**：
1. **users 表加 `token_version INTEGER DEFAULT 0`**（迁移 054）；JWT payload 加 `ver`（登录/刷新签发时写入当前值）
2. `requireAuth` 校验：`dbUser.token_version !== payload.ver` → 401 踢下线（middleware/auth.ts 加 1 次比较，已有 dbUser 查询，零额外 DB 开销）
3. **改密**（auth.ts:169）：`UPDATE users SET token_version = token_version + 1` + `DELETE FROM refresh_tokens WHERE user_id = ?` → 全部旧会话立即失效
4. **封禁/注销**同样 ver+1（可选，封禁已被中间件拦截，注销已有 cleanup）
5. **前端登出补全**（AuthContext.tsx）：调 `POST /api/auth/logout`（后端已实现，删 refresh token 哈希）+ `setRefreshToken(null)` 清本地
6. 改名后重新签发的 token 用 DB 最新 role/vip 而不是复制旧 payload（auth.ts:245、shop.ts:122 顺带修正）

**涉及**：迁移 054、utils/jwt.ts、middleware/auth.ts、handlers/auth.ts、handlers/shop.ts、AuthContext.tsx、api.ts
**优先级**：⭐⭐⭐⭐⭐

---

## 3.【高危】无账号级暴力破解防护

**现状**：限流全按 IP（可轮换/伪造绕过），无失败计数、无锁定。

**方案（账号级失败锁定，两层防线）**：
1. **登录失败计数**：新表 `login_attempts(user_id, fail_count, locked_until)`（迁移 054）：
   - 登录失败 → `INSERT ... ON CONFLICT(user_id) DO UPDATE SET fail_count = fail_count + 1`
   - fail_count ≥ 5 → 锁 15 分钟（locked_until = now + 15min）；≥ 10 → 锁 30 分钟（渐进）
   - 登录成功/锁定过期 → 清零
   - 锁定期内即使密码正确也拒绝（返回"尝试次数过多，请 15 分钟后再试"）
   - 用户不存在也计数（按邮箱哈希或统一 user_id=0 桶？——不存在用户无法锁定，统一返回"账号或密码错误"即可，计数挂 IP 限流兜底）
2. **生产强制 Cloudflare**：限流 IP 只信 `CF-Connecting-IP`（rateLimit.ts:6），非 CF 环境（本地 dev）才回落 X-Forwarded-For；`'unknown'` 桶单独 403 或大窗口
3. 保留 IP 限流（5/min）作为第二层

**涉及**：迁移 054、handlers/auth.ts（登录端点）、middleware/rateLimit.ts
**优先级**：⭐⭐⭐⭐

---

## 4.【高危】无密码重置 + 邮箱自动验证

**现状**：forgot/reset 端点不存在（queries.ts 的 verifications 工具函数闲置）；注册邮箱不验证（auth.ts:86）；改邮箱只需旧密码。

**方案（分两步，先止血后完善）**：
1. **第一步（无邮件基建，先止血）**：
   - **管理员重置密码**：admin 后台用户管理加"重置密码"按钮 → 生成一次性临时密码（如 8 位随机）→ 返回给管理员转交（或展示给用户改密提示）
   - **改邮箱加强**：改邮箱后 `token_version + 1` + 删 refresh tokens（复用第 2 项机制）→ 盗号者改邮箱也会踢掉自己的新会话？不对——改邮箱者是攻击者本人……改邮箱本身需要旧密码（已有），攻击者知道旧密码。真正的防线：**改邮箱/改密都踢掉所有会话 + 记录 security_log**（审计日志表，admin 可查）
   - 注册邮箱验证降级：靠邀请码（已强制）+ 3/h/IP 限流（已有）
2. **第二步（接邮件后完善）**：`POST /auth/forgot`（发 6 位验证码邮件）+ `POST /auth/reset`（验码改密）——用 queries.ts 现成 verifications 表，邮件可用 Cloudflare Email Service 或第三方 SMTP，需要单独的邮件接入方案

**涉及**：handlers/auth.ts、admin.ts、Admin.tsx、迁移 054（security_log 可选）
**优先级**：⭐⭐⭐⭐（第一步小步可做）

---

## 5.【中危】refresh_token 无轮换 / 前端不用 / 登出不清

**现状**：后端 /auth/refresh 已实现但不轮换、无限流；前端从不调用；登出不清 refresh_token。

**方案（分两档）**：
- **A 档（快速止血，localStorage 方案内完善）**：
  1. 前端接入 refresh 流程：`request()` 遇 401 → 调 `/auth/refresh`（refresh_token）→ 成功则更新 token + 重放原请求；失败才清 token 跳登录（api.ts 重构 request 为可重试）
  2. 后端 refresh 轮换：每次 refresh 删除旧 refresh token 行、签发新 refresh token（复用登录时的生成逻辑）；检测到已被使用的旧 token（重放攻击）→ 该用户所有 refresh token 全删（经典轮换检测）
  3. refresh 端点挂限流（如 10/min/IP）
  4. 登出清 refresh_token（第 2 项已含）
- **B 档（登录方案整体优化时做）**：token 迁移 **HttpOnly + SameSite=Strict + Secure cookie**（后端 Set-Cookie，前端不再碰 token），配合 CSRF token 或同源部署；JWT 缩短到 15 分钟-1 小时，refresh 7-30 天；管理员会话更短

**涉及**：api.ts、AuthContext.tsx、handlers/auth.ts（refresh）、routes.ts
**优先级**：⭐⭐⭐（B 档并入"登录方案优化"专项）

---

## 6.【中危】生产 CORS 无白名单（任意 Origin 回显）

**现状**：`FRONTEND_URL` 从未配置（wrangler.jsonc vars 缺失），生产走 cors.ts:11-12 无条件回显 Origin；allow-list 分支是死代码；无 Vary: Origin。

**方案（配置修复，零代码或微码）**：
1. wrangler.jsonc / CI secrets 配 `FRONTEND_URL`（前端线上域名），让 allow-list 生效
2. cors.ts：非白名单 Origin 返回 403 而非静默放行（当前实现不匹配时的行为先确认，改为明确拒绝）；补 `Vary: Origin` 头
3. 若前端与 worker 同域部署（同源），CORS 头可整体删除（最简）

**涉及**：wrangler.jsonc、.github/workflows/deploy-v2.yml、middleware/cors.ts
**优先级**：⭐⭐⭐（部署配置项，上线前配好）

---

## 7.【中危】verify-password/注销/refresh 等端点无限流

**现状**：verify-password、account（注销）、email、username、cancel-deletion、refresh 均无限流（routes.ts 只有 login/register/password 三个）。

**方案**：routes.ts 给这些端点挂 rateLimit：
- `verify-password`、`account`：5/min/IP（防 XSS 劫持后爆破密码）
- `email`、`username`、`cancel-deletion`：10/min/IP
- `refresh`：10/min/IP
- 注意 authHandler 是子应用路由，`app.use('/api/auth/*', ...)` 对子应用失效的坑——需要在这些路由内联中间件或在 auth.ts 的 handler 内调用 rateLimit 逻辑（参照 posts.ts 的 optionalAuth 内联模式）

**涉及**：routes.ts 或 handlers/auth.ts、middleware/rateLimit.ts
**优先级**：⭐⭐⭐

---

## 8.【中危】限流实现硬伤（非原子 / fail-open / 伪造头）

**现状**：rateLimit.ts SELECT→UPDATE/INSERT 非原子（并发可超窗）；catch 吞错放行（fail-open）；X-Forwarded-For 可伪造；429 无 Retry-After。

**方案**：
1. **原子计数**（rateLimit.ts 重写核心）：
   ```sql
   -- 先原子累加（行不存在则插入）
   UPDATE rate_limits SET count = count + 1 WHERE key = ? AND expires_at > datetime('now')
   -- changes = 0 → INSERT (key, 1, now + window)
   -- 再 SELECT count 判断是否 > max → 429
   ```
   单条 UPDATE 原子，无竞态；INSERT 用 ON CONFLICT 兜底
2. **fail-open 改为分场景**：登录/注册/refresh 类**认证端点 fail-closed**（D1 故障时拒绝登录，可接受）；内容类端点保持 fail-open（不影响读）
3. 429 响应加 `Retry-After` 头（剩余秒数）
4. 删掉过期行的 DELETE 改为惰性（UPDATE 的 WHERE expires_at > now 已天然处理过期，不用每次 DELETE）
5. IP 处理：生产只信 CF-Connecting-IP（同第 3 项）

**涉及**：middleware/rateLimit.ts
**优先级**：⭐⭐⭐

---

## 9.【中危】邀请码消耗 TOCTOU（一码多用）

**现状**：auth.ts:58-63 先查码、79-83 后条件 UPDATE，并发注册可都通过校验，仅一个 UPDATE 成功 → 码未消耗。

**方案（原子占码）**：
1. 注册校验顺序改为：**先原子占码** → 再建用户 → 失败释放码：
   ```sql
   UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL
   ```
   meta.changes = 1 才继续（并发第二个 changes = 0 → 400"邀请码已被使用"）
2. 用户创建（INSERT users，UNIQUE 约束兜底）失败 → 回滚释放码：`UPDATE invite_codes SET used_by = NULL, used_at = NULL WHERE used_by = ?`（指向刚占码的用户 id）
3. 返回前校验用户确实创建成功

**涉及**：handlers/auth.ts（register 分支）
**优先级**：⭐⭐⭐

---

## 10.【中危】首个注册用户自动变 admin（抢注风险）

**现状**：auth.ts:73-76 首个注册用户自动提权 admin；管理员存在前注册无邀请码门槛。

**方案（环境变量指定初始管理员）**：
1. 新增环境变量 `INITIAL_ADMIN_EMAIL`（wrangler.jsonc vars / CI secrets，如 `admin@forum.example.com`）
2. auth.ts 逻辑改为：`INITIAL_ADMIN_EMAIL` 存在时，注册邮箱匹配该值的用户提权 admin（仍要求邀请码或放开首个注册）；否则**不再自动提权**
3. 部署说明文档标注：上线前必须设置 INITIAL_ADMIN_EMAIL
4. 或更严：关闭自动提权，部署后用 d1 execute + 一次性脚本（或 admin 接口）手动建号

**涉及**：handlers/auth.ts、wrangler.jsonc、部署文档
**优先级**：⭐⭐⭐（上线前必做其一）

---

## 11.【中危】token payload 缓存 role/vip + AI 审核密钥明文

**现状**：JWT payload 含 role/is_vip/vip_tier（types/index.ts:227-233），当前全部鉴权走 DB（靠约定）；AI 审核密钥硬编码前端（api.ts:678）。

**方案**：
1. **payload 精简**：JWT payload 只保留 `userId` + `ver`（配合第 2 项 token_version）；role/vip 一律从 `c.get('dbUser')` 读（middleware 已提供）；删除 token 里 role/is_vip 的写入点（auth.ts 登录/注册、shop.ts:122 改名复制）——消除未来误用地雷
2. **AI 审核密钥后移**：新增 `POST /api/review-content` worker 代理端点（body: {content}，调 `ai.forum.your-domain.com/api/judge`，密钥放 wrangler secret `JUDGE_API_KEY`）；前端 api.ts:683 改调代理，删除硬编码密钥；代理端点挂限流（如 20/min/IP）防滥用

**涉及**：utils/jwt.ts、handlers/auth.ts、handlers/shop.ts、middleware/auth.ts、handlers/review.ts（新建）、routes.ts、api.ts、wrangler.jsonc
**优先级**：⭐⭐⭐

---

## 建议实施顺序

| 阶段 | 内容 | 理由 |
|---|---|---|
| **第一批（上线前）** | #1 XSS 消毒、#6 CORS 配置、#10 初始管理员 | 直接堵住最危险的攻击链 + 部署配置 |
| **第二批** | #2 会话吊销（token_version）、#5-A 前端 refresh + 轮换、#9 邀请码原子占码 | 改密/登出/续期链路完整性 |
| **第三批** | #3 账号锁定、#8 限流原子化、#7 端点补限流 | 防爆破纵深 |
| **第四批（登录方案优化专项）** | #5-B HttpOnly cookie、#11 payload 精简 + AI key 后移、#4 密码重置（含邮件接入） | 大改，单独规划 |

> 注：#11 的 payload 精简与 #2 的 token_version 同改 jwt.ts，建议合并实施。
