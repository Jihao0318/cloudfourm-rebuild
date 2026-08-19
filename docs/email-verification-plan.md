# 邮箱验证全链路计划书

> 日期：2026-08-12 ｜ 状态：方案待确认，未实施
> 目标：把"该要邮箱验证的地方"全部打通——改邮箱、改密码、注册验证 + 安全通知
> 基础：verifications 表（type 已支持 email_verify/password_reset/twofa）+ createVerification/verifyCode 工具 + sendMail 邮件服务（mail.your-domain.com）均已就绪

---

## 一、现状盘点

| 操作 | 当前验证方式 | 缺什么 |
|---|---|---|
| 忘记密码（forgot/reset） | ✅ 6 位验证码邮件（10 分钟） | 已完成，无需改 |
| 修改邮箱（PUT /auth/email） | ❌ 只验旧密码 | **缺新邮箱验证码** |
| 修改密码（PUT /auth/password） | ❌ 只验旧密码 | **缺注册邮箱验证码**（双因素） |
| 注册 | ❌ 注册即 email_verified=1（自动） | **缺真实邮箱验证** |
| 注销账号 | 旧密码两步确认 | 可不加（账号将删除） |
| 封禁自赎 | 非邮箱场景 | 不加 |

---

## 二、需要邮箱验证的场景（含取舍）

### ✅ 必做（本次全链路范围）

**场景 1：修改邮箱 —— 两步验证（验新邮箱）**
- 理由：改邮箱是账号易主的高危操作，必须证明新邮箱归属
- 流程：
  1. `POST /auth/email/request` `{new_email, password}`：验旧密码 + 检查新邮箱未被占用 → 向**新邮箱**发 6 位验证码
  2. `POST /auth/email/verify` `{code}`：验码 → 更新邮箱 + `token_version+1` 踢全部会话 + security_log
- 前端：Profile 编辑资料面板"修改邮箱"改为两步表单（新邮箱+旧密码 → 验证码 → 完成）

**场景 2：修改密码 —— 两步验证（验注册邮箱，双因素）**
- 理由：旧密码可能已泄露（撞库/社工），邮箱验证码兜底；与"忘记密码"流程同构，实现成本低
- 流程：
  1. `POST /auth/password/request` `{old_password}`：验旧密码 → 向**注册邮箱**发验证码
  2. `POST /auth/password/verify` `{code, new_password}`：验码 → 改密 + `token_version+1` + 删 refresh tokens + security_log
- 兼容：旧 `PUT /auth/password`、`PUT /auth/email` 端点废弃或保留为内部（前端全部切两步）

**场景 3：注册邮箱验证**
- 理由：注册时 email_verified=1 是假的，补真实验证；防垃圾注册（配合邀请码双门槛）
- 流程：注册成功 → 自动向注册邮箱发验证码 → 资料页显示"未验证邮箱"徽章 + "发送验证码/验证"按钮
- 策略（两种，二选一，建议 A）：
  - **A 宽松**：未验证不限制功能，仅提示（校园论坛有邀请码门槛，够用）
  - **B 严格**：未验证不能发帖/评论（防滥用，需处理存量未验证用户）
- 倾向 A：改动小、体验好，邀请码已是门槛

**场景 4：安全通知邮件（改密/改邮箱成功后通知原邮箱）**
- 理由：账号被攻破后，攻击者改密/改邮箱时受害者能第一时间收到提醒
- 流程：改密成功 → 发"您的密码已被修改"到原邮箱；改邮箱成功 → 发"您的邮箱已被修改为 xxx"到**旧邮箱**（防劫持提醒）
- 成本：每事件 1 封，个人规模额度充足

### ⛔ 明确排除（额度考量）

- **登录成功/失败通知邮件**：QQ SMTP 额度约 **100 封/天**，登录通知会瞬间烧完额度，且是骚扰性邮件——排除
- **异地登录提醒**：同上，且需 IP 库，排除
- **注销二次通知**：账号即将删除，无意义，排除

### 🟡 可选（后续单独规划）

- **2FA（TOTP）**：`users.twofa_secret` 列已存在，用 TOTP 不占邮件额度，比邮箱验证码更适合做双因素；本期不做，避免与场景 2 的邮箱验证混淆

---

## 三、通用机制（全部复用，无新基建）

- **验证码**：`createVerification(db, userId, 'email_verify', code, 10)` —— 6 位数字、10 分钟、一次性（verifyCode 校验后置 used=1）、旧码自动作废
- **邮件**：`sendMail()` —— 已就绪（env 凭据、https 校验、超时）
- **防枚举**：request 类端点统一返回"验证码已发送"（成功与否同文案，仅记日志）
- **限流**：所有 request/verify 端点挂 rateLimit（5min/5 次），防验证码爆破
- **防爆破**：verify 端点 5 次错误后不锁定账号（验证码本身 6 位、10 分钟有效，可加错误次数上限：同用户 5 次错误即作废当前码）
- **安全**：所有验证通过后的写操作保持 `token_version+1`（踢会话）惯例

---

## 四、实施细节（按实施顺序）

### 阶段 1：修改邮箱两步验证
后端（handlers/auth.ts）：
- 新增 `POST /auth/email/request`：验旧密码 → 新邮箱格式/占用校验 → `createVerification(..., 'email_verify', code, 10)` → sendMail 到新邮箱 → 统一响应
- 新增 `POST /auth/email/verify`：验码 → `UPDATE users SET email = 新邮箱, token_version = token_version + 1`（新邮箱存哪？——**改 schema**：verifications 表加 `data TEXT` 列存待改邮箱，或 request 时把新邮箱暂存；建议 verifications 加 data 列（迁移 055），避免会话状态）→ 删 refresh + security_log → 通知旧邮箱
- 迁移 055：`ALTER TABLE verifications ADD COLUMN data TEXT DEFAULT ''`（存待变更目标，如新邮箱/新密码哈希？**新密码不走暂存**——verify 时直接传新密码，避免明文落库）

前端：
- api.ts：auth.changeEmailRequest / auth.changeEmailVerify
- Profile.tsx："修改邮箱"两步表单（新邮箱+密码 → 验证码 → 成功提示重新登录）

### 阶段 2：修改密码两步验证
后端：
- 新增 `POST /auth/password/request`：验旧密码 → 发验证码到注册邮箱
- 新增 `POST /auth/password/verify`：验码 + validatePassword + 改密 + token_version+1 + 删 refresh + security_log + 通知邮件
- 旧 `PUT /auth/password`、`PUT /auth/email` 保留但前端不再调用（或加注释 deprecated）

前端：
- Profile.tsx："修改密码"两步表单（旧密码 → 验证码+新密码 → 成功）

### 阶段 3：注册邮箱验证（策略 A 宽松）
后端：
- 注册成功时：`createVerification(..., 'email_verify', code, 60)`（60 分钟宽松）+ sendMail 到注册邮箱（失败仅日志，不阻塞注册）
- 新增 `POST /auth/email/verify-register` `{code}`：验码 → `verifyUserEmail`（置 email_verified=1）
- 新增 `POST /auth/email/resend`（60s 限流 1 次/5min 3 次）：重发验证码
- me/profile 返回 email_verified（已有）

前端：
- Register.tsx：注册成功提示"验证码已发送到邮箱"
- Profile.tsx：email_verified=0 时显示"📧 未验证邮箱 [发送验证码] [验证]"

### 阶段 4：安全通知（随阶段 1/2 一起做，不单独排期）
- 改密成功 → 通知原邮箱
- 改邮箱成功 → 通知旧邮箱

---

## 五、实施顺序与验证

| 阶段 | 内容 | 依赖 |
|---|---|---|
| 1 | 改邮箱两步验证（request/verify + 前端两步表单 + 迁移 055） | 无 |
| 2 | 改密码两步验证（request/verify + 前端两步表单 + 通知） | 无（可并行） |
| 3 | 注册验证（注册发码 + 资料页验证/重发） | 无 |
| 4 | 联调验证 | 1-3 |

**验证清单**：
- 迁移 055 应用 ✓ esbuild ✓ 前端 tsc/build ✓
- 改邮箱：错误旧密码拒绝 → 正确密码发码（真发信）→ 错码拒绝 → 正码生效 → 新邮箱登录 → 旧 token 失效 → 旧邮箱收到通知
- 改密码：旧密码错误拒绝 → 发码 → 错码拒绝 → 正码改密 → 旧会话全踢 → 新密码登录 → 原邮箱收到通知
- 注册验证：新注册收到验证码邮件 → 验证后 email_verified=1 → me 返回状态
- 限流：request/verify 超限 429
- 防枚举：request 对不存在邮箱统一响应

---

## 六、风险与注意

- **邮件额度 100 封/天**：注册验证 + 改密/改邮箱 + 忘记密码，单用户正常生命周期约 3-5 封，校园规模（几百用户）足够；**严禁**加登录类通知
- **验证码暂存**：新邮箱存 verifications.data 列（迁移 055），避免 session 状态；新密码不暂存（verify 时提交）
- **防枚举**：request 统一响应；verify 错误不区分"邮箱/验证码"错误
- **存量用户**：注册验证（策略 A）不影响存量用户（email_verified 已是 1）
- 若未来做严格策略 B（未验证禁发帖），需单独评估存量未验证用户处理

---

## 七、决策点（实施前请确认）

1. **注册验证策略**：A 宽松（仅提示+徽章，推荐）还是 B 严格（未验证禁发帖/评论）？
2. **旧端点处理**：`PUT /auth/email`、`PUT /auth/password` 前端全部切换后是否直接删除（推荐删除，避免绕过验证的旧路径残留）？
3. **改密码是否要邮箱验证**：确认按双因素做（场景 2），还是保持"旧密码足够"（只加改密通知邮件）？——用户已明确要验证，默认按场景 2 执行
