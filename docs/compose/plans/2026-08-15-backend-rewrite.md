# CloudForum 后端重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立新仓库中以领域模块化架构全量重建 CloudForum 后端（Cloudflare Workers + Hono + D1），实现全部现有功能，满足 450ms 延迟上限与 D1 免费配额约束，交付 OpenAPI 契约文档供前端独立实现。

**Architecture:** 按业务域划分为 11 个模块（auth/users/posts/comments/interactions/economy/moderation/notifications/admin/system/stats），每域内部 routes/service/repo/validators 四层；跨域仅允许经 service 接口调用；共享 core 层提供统一响应/错误体系/DB 封装；性能上以 D1 往返预算、冗余计数列、物化表为核心手段；AI 审核模块后置（用户后续提供审核后端）。

**Tech Stack:** Hono、Cloudflare D1、zod、jose、vitest + @cloudflare/vitest-pool-workers、TypeScript strict、wrangler。

**Spec:** `docs/compose/specs/2026-08-15-backend-rewrite-design.md`（本计划逐任务对应其 [S#] 锚点）

## Global Constraints

以下约束对**每一个任务**生效，实现与评审隐式继承：

1. **领域模块化**：每域 = `routes.ts`（薄路由）/`service.ts`（业务逻辑）/`repo.ts`（本域 SQL）/`validators.ts`（zod）。跨域只允许 `service` 互调，禁止 import 他域 repo/碰他域表
2. **统一响应**：成功 `{success:true, data}`；失败 `{success:false, error:{code,message,details?}}`
3. **错误码前缀**：`AUTH_`(401)/`VALIDATION_`(422)/`NOT_FOUND_`(404)/`FORBIDDEN_`(403)/`RATE_LIMITED`(429, 含 retry_after)/`CONFLICT_`(409)/`ECONOMY_`(400)/`INTERNAL_`(500)
4. **延迟上限**：任何请求 < 450ms；高频接口（列表/详情/搜索/Feed）D1 往返 ≤ 2 次、一般 ≤ 3 次；D1 调用强制 batch，严禁串行循环查库
5. **配额纪律**：禁 `COUNT(*)`/全表扫描/无索引过滤（预算测试断言 EXPLAIN QUERY PLAN 走索引）；列表单次读 ≤ 50 行；展示计数走冗余列写时维护
6. **Schema**：snake_case；`created_at/updated_at/deleted_at` 约定；新列带默认值或允许 NULL；迁移只增不改（编号递增）
7. **时间**：存储一律 UTC ISO8601；签到/每日任务按 UTC+8 日期窗（`Asia/Shanghai`）
8. **测试**：全量覆盖，行覆盖率 ≥ 90%（CI FAIL 门槛）；每模块独立可测（跨域 service 注入 mock）
9. **可演进**：副作用（经济奖励/通知/成就/战绩）走钩子注册表 `hooks.register(event, fn)`；配置走 `settings` KV；新功能以新端点/新可选参数/新字段追加，不修改既有语义
10. **限流**：登录/注册/验证码/改密等敏感端点用 D1 原子限流，429 带 `retry_after`
11. **AI 审核本轮不实现**：仅发帖流程预留钩子，不引入 Queues/审核代码（用户后续提供审核后端）
12. **执行方式**：按用户偏好，每个里程碑完成后暂停确认，再进入下一个功能；执行方式每次询问（ask-each-time）

---

## 里程碑 M0：项目骨架

### Task 0.1: 仓库初始化

**Covers:** （纯脚手架，无 spec 章节映射）

**Files:**
- Create: 新仓库根（`~/workspace/cloudforum-backend/`）下 `package.json`、`tsconfig.json`、`wrangler.jsonc`、`.gitignore`、`README.md`

**Interfaces:**
- Consumes: 无
- Produces: 可 `npm install` 的 npm 包根；`wrangler dev` 可用；TypeScript strict 生效

- [ ] **Step 1: 创建仓库并初始化**

```bash
mkdir -p ~/workspace/cloudforum-backend/src/{core,middleware,modules,utils,migrations,tests}
cd ~/workspace/cloudforum-backend && git init
```

- [ ] **Step 2: 写 package.json**

```json
{
  "name": "cloudforum-backend",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "migrate:local": "wrangler d1 migrations apply forum-db --local",
    "migrate:remote": "wrangler d1 migrations apply forum-db --remote",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage"
  },
  "dependencies": {
    "hono": "^4",
    "jose": "^5",
    "zod": "^3"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5",
    "@cloudflare/workers-types": "^4",
    "typescript": "^5",
    "vitest": "^2",
    "wrangler": "^3",
    "@vitest/coverage-v8": "^2"
  }
}
```

- [ ] **Step 3: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

- [ ] **Step 4: 写 wrangler.jsonc**（占位 D1 绑定；数据库名/ID 部署阶段创建）

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/config-schema.json",
  "name": "forum-backend",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-13",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "forum-db",
      "database_id": "REPLACE_ON_CREATE",
      "migrations_dir": "src/migrations"
    }
  ],
  "vars": {
    "ENVIRONMENT": "development",
    "FRONTEND_URL": ""
  },
  "triggers": { "crons": ["0 0 * * *"] }
}
```

- [ ] **Step 5: 写 .gitignore**

```
node_modules/
.wrangler/
.dev.vars
coverage/
dist/
```

- [ ] **Step 6: 复制设计文档与实施计划到新仓库**（供后续实施者与交接参考）

```bash
mkdir -p ~/workspace/cloudforum-backend/docs/compose/{specs,plans}
cp ~/workspace/cloudfourm-rebuild/docs/compose/specs/2026-08-15-backend-rewrite-design.md \
   ~/workspace/cloudforum-backend/docs/compose/specs/
cp ~/workspace/cloudfourm-rebuild/docs/compose/plans/2026-08-15-backend-rewrite.md \
   ~/workspace/cloudforum-backend/docs/compose/plans/
```

- [ ] **Step 7: 安装依赖并验证**

```bash
cd ~/workspace/cloudforum-backend && npm install
npm run typecheck   # 期望：通过（当前无 src 代码，tsc 对空目录不报错）
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: init cloudforum-backend scaffold"
```

### Task 0.2: core 层（错误体系/统一响应/配置/日志）

**Covers:** [S5]

**Files:**
- Create: `src/core/errors.ts`、`src/core/response.ts`、`src/core/config.ts`、`src/core/logger.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `class AppError extends Error { code: string; status: number; details?: unknown }` + 工厂 `badRequest/unauthorized/forbidden/notFound/conflict/rateLimited(code,message,retryAfter?)`
  - `ok(data)` / `fail(error)` 序列化函数（含 `INTERNAL_` 脱敏）
  - `interface Env { DB: D1Database; ENVIRONMENT: string; FRONTEND_URL: string; JWT_SECRET: string }` + `getEnv(c)` 类型化读取
  - `logger: { info/warn/error(event, meta) }`（console 前缀 `[cloudforum]`）

- [ ] **Step 1: 写失败测试** `src/tests/unit/errors.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { AppError, badRequest } from "@/core/errors";

describe("AppError", () => {
  it("携带 code/status/details", () => {
    const e = badRequest("VALIDATION_NAME", "名称非法", { field: "name" });
    expect(e.code).toBe("VALIDATION_NAME");
    expect(e.status).toBe(422);
    expect(e.details).toEqual({ field: "name" });
    expect(e).toBeInstanceOf(AppError);
  });
});
```

- [ ] **Step 2: 运行确认失败**（`AppError` 未导出 → 编译/导入失败）

```bash
cd ~/workspace/cloudforum-backend && npm test -- src/tests/unit/errors.test.ts
```

- [ ] **Step 3: 实现 `src/core/errors.ts`**

```ts
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(code, 422, message, details);
export const unauthorized = (code: string, message: string) => new AppError(code, 401, message);
export const forbidden = (code: string, message: string) => new AppError(code, 403, message);
export const notFound = (code: string, message: string) => new AppError(code, 404, message);
export const conflict = (code: string, message: string) => new AppError(code, 409, message);
export const rateLimited = (retryAfter: number) =>
  new AppError("RATE_LIMITED", 429, "请求过于频繁，请稍后再试", { retry_after: retryAfter });
```

- [ ] **Step 4: 运行确认通过**

```bash
npm test -- src/tests/unit/errors.test.ts   # 期望 PASS
```

- [ ] **Step 5: 实现 `src/core/response.ts`**

```ts
import type { AppError } from "./errors";

export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = { success: false; error: { code: string; message: string; details?: unknown } };

export const ok = <T>(data: T): ApiSuccess<T> => ({ success: true, data });

export const fail = (err: AppError | Error): ApiFailure =>
  err instanceof AppError
    ? { success: false, error: { code: err.code, message: err.message, details: err.details } }
    : { success: false, error: { code: "INTERNAL_", message: "服务器内部错误" } }; // 对外脱敏
```

- [ ] **Step 6: 实现 `src/core/config.ts` 与 `src/core/logger.ts`**

```ts
// config.ts
export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  FRONTEND_URL: string;
  JWT_SECRET: string;
  TELEGRAPH_IMAGE_URL?: string;
  AI_JUDGE_URL?: string;
  AI_JUDGE_KEY?: string;
  MAILER_URL?: string;
  MAILER_TOKEN?: string;
}
export const getEnv = (c: { env: Env }): Env => c.env;
```

```ts
// logger.ts
const tag = (level: string) => `[cloudforum:${level}]`;
export const logger = {
  info: (event: string, meta?: Record<string, unknown>) =>
    console.log(tag("info"), event, meta ?? ""),
  warn: (event: string, meta?: Record<string, unknown>) =>
    console.warn(tag("warn"), event, meta ?? ""),
  error: (event: string, meta?: Record<string, unknown>) =>
    console.error(tag("error"), event, meta ?? ""),
};
```

- [ ] **Step 7: 补测试**（response 脱敏、logger 冒烟），全部通过后 Commit

```bash
git add src/core src/tests/unit && git commit -m "feat: core errors/response/config/logger"
```

### Task 0.3: app 装配 + 中间件 + 入口

**Covers:** [S5] [S8]

**Files:**
- Create: `src/middleware/cors.ts`、`src/middleware/errorHandler.ts`、`src/middleware/rateLimit.ts`、`src/core/app.ts`、`src/index.ts`

**Interfaces:**
- Consumes: `AppError`/`ok`/`fail`（Task 0.2）、`Env`
- Produces:
  - `corsMiddleware()`：FRONTEND_URL 白名单，非白名单 403；OPTIONS 预检 204
  - `errorHandler()`：捕获 AppError → 对应 HTTP 状态；未知错误 → 500 脱敏 + logger
  - `rateLimitMiddleware(key, limit, windowSec)`：D1 原子 UPSERT 计数，超限抛 `rateLimited`
  - `createApp()`：装配中间件 + 占位健康检查路由 `/api/health`
  - `index.ts`：`export default { fetch: app.fetch, scheduled }`（scheduled 空实现占位）

- [ ] **Step 1: 失败测试**（健康检查返回 `{success:true,data:{status:"ok"}}`）

```ts
// src/tests/integration/health.test.ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

it("GET /api/health 返回 ok", async () => {
  const res = await SELF.fetch("http://localhost/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, data: { status: "ok" } });
});
```

- [ ] **Step 2: 运行确认失败**（`/api/health` 404）

- [ ] **Step 3: 实现 middleware 与 app**（按 Interfaces 签名；CORS 白名单逻辑：`FRONTEND_URL` 为空则回显任意 Origin 仅限 `ENVIRONMENT==="development"`，否则 403）

- [ ] **Step 4: 实现 `src/index.ts`**，运行确认通过

- [ ] **Step 5: Commit**

```bash
git add src && git commit -m "feat: app shell with cors/error/rate-limit middleware"
```

### Task 0.4: 测试脚手架与 fixtures

**Covers:** [S7]

**Files:**
- Create: `vitest.config.ts`、`test/tsconfig.json`、`src/tests/fixtures/factory.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `makeUser(overrides?)` / `makePost(overrides?)` 种子数据工厂（后续所有集成测试复用）
  - vitest 配置：`@cloudflare/vitest-pool-workers`，集成测试自动建内存 D1 并应用 `src/migrations/000_init.sql`

- [ ] **Step 1: 写 vitest.config.ts**

```ts
import path from "node:path";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { JWT_SECRET: "test-secret", ENVIRONMENT: "test", FRONTEND_URL: "" },
        },
      },
    },
    coverage: { provider: "v8", include: ["src/**"], thresholds: { lines: 90 } },
  },
});
```

- [ ] **Step 2: 实现 fixtures/factory.ts**（类型化种子工厂）

- [ ] **Step 3: 验证测试跑通**（health 测试 + 覆盖率命令可用）

- [ ] **Step 4: Commit**

### Task 0.5: CI 流水线

**Covers:** [S8]

**Files:**
- Create: `.github/workflows/ci.yml`（typecheck → test → coverage → build）

- [ ] **Step 1: 写 ci.yml**（Node 20 + npm ci + 三步骤 + 上传 coverage 报告）

- [ ] **Step 2: 本地模拟验证命令**：`npm run typecheck && npm test && npm run coverage`

- [ ] **Step 3: Commit**，M0 完成（暂停，向用户确认后进入 M1）

---

## 里程碑 M1：Schema 基线 + db 层 + auth 认证域

### Task 1.1: 基线迁移 000_init.sql（全部表）

**Covers:** [S4]

**Files:**
- Create: `src/migrations/000_init.sql`

**Interfaces:**
- Consumes: 无
- Produces: 完整 schema（表结构、索引、冗余计数列），后续所有 repo 依赖的表名/列名以此为准

- [ ] **Step 1: 按 spec [S4] 表清单建全部表与索引**。要点：
  - `users`：id/username/email/password_hash/avatar/banner/title/nick_theme/bio/role/status(active|banned|deleted)/token_version/notify_settings(JSON 文本)/coins 不再存（分离 user_balances）→ 但保留 `notifications_unread` 计数器列/experience/level/created_at/updated_at/deleted_at
  - `posts`：id/author_id/category_id/title/content/status(published|flagged|removed)/is_paid/price/is_anonymous/is_locked/pin_order/bump_until/red_packet(JSON)/like_count/comment_count/view_count/created_at/updated_at/deleted_at + 索引 `(category_id, status, created_at)`、`(author_id, created_at)`
  - `comments`：id/post_id/author_id/parent_id/content/like_count/status/created_at/updated_at/deleted_at + 索引 `(post_id, created_at)`
  - `likes`：user_id/target_type/target_id/created_at + 唯一索引 `(user_id, target_type, target_id)`
  - `categories`：id/name/slug/description/sort_order/allow_paid/allow_thanks/is_active
  - `posts_fts`：FTS5 虚拟表（title/content）+ triggers 同步
  - 其余表（refresh_tokens/verifications/invite_codes/security_logs/follows/bookmarks/notifications/经济/审核/系统表）按 [S4] 建全，**每个计数展示字段一律冗余列**
  - `settings`：key TEXT PRIMARY KEY/value TEXT/updated_at
  - `rate_limits`：key/win_start/count，索引 `(key, win_start)`
- [ ] **Step 2: 本地应用迁移验证**

```bash
npm run migrate:local   # 期望成功，无报错
```

- [ ] **Step 3: 冒烟测试**：集成测试 setup 中应用迁移后建表存在（写一个 `schema.test.ts` 断言关键表可 INSERT/SELECT）

- [ ] **Step 4: Commit**

```bash
git add src/migrations && git commit -m "feat(schema): 000_init baseline"
```

### Task 1.2: db 层（查询封装/配额统计）

**Covers:** [S6]

**Files:**
- Create: `src/core/db.ts`（helper：`one/oneOrNull/all/batch` + 配额累计计数器）

**Interfaces:**
- Consumes: D1 绑定
- Produces:
  - `one<T>(db, sql, ...params): Promise<T>` / `oneOrNull` / `all<T>` / `run`
  - `batch(db, stmts): Promise<void>`（多条一次往返）
  - `quota: { addRead(n), addWrite(n), getStats() }`（内存累计 meta.rows_read/written，admin 面板读取）
  - `now()`（UTC ISO 字符串）

- [ ] **Step 1: 单元测试**（one/oneOrNull/all/batch 对内存 D1 行为正确 + quota 累计）

- [ ] **Step 2: 实现 db.ts**（所有查询经此封装，自动累加 meta 用量）

```ts
// 配额统计：请求内内存累计 + 每 100 次查询周期持久化到 D1 settings 表
// 键：quota.rows_read / quota.rows_written（当日累计，UTC 日期前缀）
// 持久化时机：count % 100 === 0 时 UPSERT 一次；scheduled 每日归零
```

- [ ] **Step 3: 通过后 Commit**

### Task 1.3: utils（jwt/password/date/validation）

**Covers:** [S5]

**Files:**
- Create: `src/utils/jwt.ts`、`src/utils/password.ts`、`src/utils/date.ts`、`src/utils/validation.ts`

**Interfaces:**
- Consumes: `Env`（JWT_SECRET）
- Produces:
  - `signToken(userId, username, ver, secret, expiresIn="7d")` / `verifyToken(token, secret): JWTPayload`（JWTPayload = `{id, username, ver}`）
  - `hashPassword(pw)`（PBKDF2）/ `verifyPassword(pw, hash)`（仅 PBKDF2，无 bcrypt 兼容——新库无旧数据）
  - `dateUtc8(): { today: string; nowUtc: string }`（UTC+8 日期窗）
  - `validateUsername/validateEmail(仅 QQ 邮箱)/validatePassword/validateTitle/validateContent/parseId(str): number`（均抛 `VALIDATION_` AppError）

- [ ] **Step 1: 单元测试**（每个函数正反用例；密码哈希往返；JWT 签名/过期/篡改）
- [ ] **Step 2: 实现四个 utils 文件**（PBKDF2 用 Web Crypto `crypto.subtle`；JWT 用 jose `SignJWT/jwtVerify`）

- [ ] **Step 3: 通过后 Commit**

### Task 1.4: auth 模块核心（注册/登录/refresh/登出/me）

**Covers:** [S3] [S5]

**Files:**
- Create: `src/modules/auth/routes.ts`、`src/modules/auth/service.ts`、`src/modules/auth/repo.ts`、`src/modules/auth/validators.ts`、`src/middleware/auth.ts`
- Modify: `src/core/app.ts`（注册 auth 模块路由）

**Interfaces:**
- Consumes: db.ts、utils（jwt/password/validation/date）、errors、response
- Produces（service 签名，后续模块与前端契约依赖）:
  - `register({username,email,password,inviteCode?})` → `{user, accessToken, refreshToken}`（首个用户自动 admin；初始积分 100；邀请码校验）
  - `login({account,password})` → 同上（账号锁定：连续 5 次失败锁 15 分钟；失败计数）
  - `refresh(refreshToken)` → 新 token 对（轮换 + 重放检测：已被使用的旧 token 抛 `AUTH_REUSED_REFRESH`）
  - `logout(userId, refreshToken)` / `getMe(userId)`（含 vip/封禁状态）
- `requireAuth`/`optionalAuth` 中间件（验证 Bearer JWT、token_version 校验、封禁检查）

- [ ] **Step 1: 集成测试（先写）**：注册成功（返回 token + 首用户 admin）、重复用户名/邮箱 409、登录成功/失败计数、锁定触发、refresh 轮换与重放、me 鉴权、无效 token 401

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现 validators/repo/service/routes/middleware**（TDD 逐个用例转绿；register 钩子预留 `hooks.emit("user.registered")`）

- [ ] **Step 4: 全部通过后 Commit**

### Task 1.5: auth 增强（改密/改邮箱/注销/忘记密码/邀请码/验证码）

**Covers:** [S3] [S5]

**Files:** Modify: `src/modules/auth/*`（四个文件扩展）

**Interfaces:**
- Produces:
  - `changePassword(userId, oldPw, newPw)`（校验旧密码，5 次/分限流）
  - `changeEmail(userId, newEmail, code)`（两步验证）/ `requestEmailChange(userId, newEmail)`（发验证码）
  - `requestPasswordReset(account)` / `resetPassword(account, code, newPw)`
  - `deleteAccount(userId)`（3 天冷静期软删）/ `cancelDeletion(userId)` / `verifyPassword(userId, pw)`
  - `createInviteCode(userId, count)`（admin）/ `applyInvite(code)`
  - `verifications` 表 CRUD + 防爆破（尝试次数上限，`067` 旧逻辑）
  - 邮件发送统一走 `src/utils/mailer.ts`（非阻塞 fire-and-forget，失败 logger.warn）
- 验证码：6 位数字，SHA-256 哈希存储，10 分钟过期，3 次尝试锁定

- [ ] **Step 1: 集成测试先写**（改密成功/旧密错误/限流、改邮箱两步流程、注销冷静期、取消注销、重置密码、邀请码注册、验证码防爆破）

- [ ] **Step 2-3: 实现 + 转绿**

- [ ] **Step 4: Commit**，M1 完成（暂停确认后进入 M2）

---

## 里程碑 M2：users 用户域

### Task 2.1: users 模块（资料/头像/背景/头衔/昵称主题/通知设置/搜索）

**Covers:** [S3] [S5]

**Files:**
- Create: `src/modules/users/routes.ts|service.ts|repo.ts|validators.ts`
- Modify: `src/core/app.ts`（注册 users 路由）

**Interfaces:**
- Consumes: auth 中间件、db、utils、errors
- Produces:
  - `getProfile(userId, viewerId?)`（公开资料含 vip/头衔/经验等级）
  - `updateProfile(userId, {bio,nickname?})` / `updateAvatar(userId, url)` / `updateBanner` / `updateTitle` / `updateNickTheme` / `updateNotifySettings`
  - `searchUsers(q, page)`（用户名模糊，列表 ≤50 行）

- [ ] **Step 1: 集成测试先写**（本人更新/他人只读、头像更新、搜索分页）

- [ ] **Step 2-3: 实现 + 转绿**

- [ ] **Step 4: Commit**，M2 完成（暂停确认）

---

## 里程碑 M3：内容域核心（categories + posts）

### Task 3.1: categories 模块

**Covers:** [S3]

**Files:** Create: `src/modules/categories/*`（四文件）；Modify: app.ts

- [ ] 公开列表（含各分类帖子数冗余列）/ admin CRUD
- [ ] 集成测试 + Commit

### Task 3.2: posts 核心 CRUD + 搜索 + 分页

**Covers:** [S3] [S5] [S6]

**Files:** Create: `src/modules/posts/*`（四文件）；Modify: app.ts

**Interfaces:**
- Produces:
  - `listPosts({categoryId?,q?,sort?,page,pageSize,viewerId?})` → `{items,total,page,page_size,has_more}`（FTS5 搜索；置顶拆分；深页保护 >100 页切游标；单条 SQL + batch 补作者信息，往返 ≤2）
  - `getPost(id, viewerId?)`（详情 + 点赞/收藏/付费状态；浏览计数钩子 `hooks.emit("post.viewed")`）
  - `createPost(authorId, {title,content,categoryId,...})`（发帖奖励钩子；AI 审核钩子**留空占位**）
  - `updatePost` / `deletePost`（软删）/ `pinPost`（mod+，批量通知钩子）/ `lockPost`

- [ ] **Step 1: 集成测试先写**（列表过滤/搜索/分页/深页、详情、发布/编辑/删除权限、置顶）
- [ ] **Step 2: 预算断言**：列表接口 D1 往返 ≤ 2（测试中统计 batch 调用次数）
- [ ] **Step 3-4: 实现 + 转绿 + Commit**

### Task 3.3: stats 浏览统计（并入 posts 域）

**Covers:** [S6]

**Files:** Modify: `src/modules/posts/*`（扩展 repo/service）

- [ ] `recordView(postId, visitorKey)`：`page_views` 当日去重（INSERT OR IGNORE）+ 成功才 +1 `posts.view_count`（写放大控制，2 次往返 batch）
- [ ] 集成测试（同访客同日重复浏览只记 1 次）+ Commit，M3 完成（暂停确认）

---

## 里程碑 M4：内容增强 + comments

### Task 4.1: 付费帖
- `post_access` 表；`unlockPost(userId, postId)`（扣款 + 记录，3 次免费访问额度）；`getPost` 含已解锁状态
- 集成测试（未付费拦截/付费成功/余额不足 `ECONOMY_`）+ Commit

### Task 4.2: 红包帖
- `red_packets` 表 + `posts.red_packet` 字段；`createRedPacket` / `grabRedPacket`（二倍均值算法，先到先得）；抢红包榜单
- 纯算法单元测试（总额守恒、人数上限）+ 集成测试 + Commit

### Task 4.3: 推荐位
- `posts.bump_until` + `bumped_posts` 记录；`recommendPost`（道具消耗钩子）/ 列表置顶展示
- 集成测试 + Commit

### Task 4.4: comments 树形评论
**Files:** Create: `src/modules/comments/*`；Modify: app.ts
- 树形分页（递归 CTE 或平铺+前端组装，列表 ≤50）、发表（评论奖励钩子 + @回复通知钩子）、编辑、软删、点赞计数
- 集成测试（树结构正确/删除子节点行为/权限）+ Commit，M4 完成（暂停确认）

---

## 里程碑 M5：interactions 互动域 + notifications

### Task 5.1: likes 点赞
- 多态点赞（post/comment）；唯一索引防重复；`likes.toggle`；被赞作者奖励钩子（积分/经验）
- 集成测试（点赞/取消/重复 409/计数列同步）+ Commit

### Task 5.2: follows + bookmarks
- 关注切换/列表/计数（冗余计数列）；收藏 toggle/列表/检查
- 集成测试 + Commit

### Task 5.3: tips + thanks
- 打赏（5/10/50 档，日 15 次/200 分原子限额）；感谢（板块开关 + 日 5 次 + 作者经验钩子）
- 集成测试（限额触发 429/ECONOMY_）+ Commit

### Task 5.4: notifications 通知
**Files:** Create: `src/modules/notifications/*`
- 列表/单条已读/全部已读/清理/未读数（`users.notifications_unread` 计数器列原子增减）
- 批量推送（置顶通知 ≤200 条，走 `hooks.emit("notify.batch")`）
- 集成测试 + Commit，M5 完成（暂停确认）

---

## 里程碑 M6：economy 经济域 1（coins/check-in/vip）

### Task 6.1: coins 积分
- `user_balances` 单行原子操作；`addCoins(userId, amount, type, ref)`（WHERE coins>=? 防超花）；转账（VIP 费率 + 手续费 50% 销毁 + 50% 管理员）；今日收入/交易记录（分页 ≤50）
- 单元测试（原子条件并发模拟）+ 集成测试 + Commit

### Task 6.2: check-in 签到
- 7 天阶梯奖励 + VIP 加成 + 日 50 分上限；月度日历/连续天数
- 集成测试（重复签到 409/连续奖励）+ Commit

### Task 6.3: vip VIP 系统
- 三档（VIP/S-VIP/SVIP+）；购买/升级补差价/续费；到期处理（scheduled）；签到加成/费率优惠读取
- 集成测试（升级补差价计算）+ Commit，M6 完成（暂停确认）

---

## 里程碑 M7：economy 经济域 2（抽奖/商城/道具/税务/排行榜）

### Task 7.1: 抽奖（签到抽奖 + 积分抽奖）
- 权重轮盘 + SSR 软/硬保底 + 十连保底 SR+；奖品发放（积分/VIP 体验卡/改名卡/终身 SVIP+）；全服公告钩子
- 概率纯单元测试（保底逻辑/权重合法性）+ 集成测试 + Commit

### Task 7.2: shop 商城
- `shop_items` 单表（旧双表合一）；购买扣款/库存；改名卡使用；我的物品
- 集成测试 + Commit

### Task 7.3: items 道具
- 19 类道具使用端点（推荐/置顶/背景/高亮/运势/彩虹标题/大喇叭/自定义称号等）；单件/批量回收；效果管理（有效期）；装饰佩戴
- 每类道具至少 1 集成测试（效果应用/过期/回收）+ Commit

### Task 7.4: tax 税务 + leaderboard 排行榜 + red_packets 红包发放
- 月度累进税率/免税额/签名减免/月度结算（scheduled）；`leaderboard_cache` 物化表（每日重算）；红包发放
- 税务计算单元测试（税率表边界）+ 集成测试 + Commit，M7 完成（暂停确认）

---

## 里程碑 M8：moderation 审核域 + admin + stats

### Task 8.1: reports + patrol 巡查
**Files:** Create: `src/modules/moderation/*`
- 举报（帖子/评论，防重复）；巡查双队列（待巡查/待复核）+ 多人投票（阈值 `report_violation_limit` 默认 3，settings 可调）+ 打回重提（轮次隔离）；巡查战绩 `patrol_stats`
- 状态机单元测试 + 集成测试（投票达标下架/打回流程）+ Commit

### Task 8.2: appeals + unban
- 帖子申诉（达标巡查员单人判定恢复/维持）；封禁自赎（保证金 + 冷却）
- 集成测试 + Commit

### Task 8.3: admin 管理后台
**Files:** Create: `src/modules/admin/*`
- 用户管理（角色/封禁/删号/防最后一个管理员）；内容管理（帖子/评论/置顶排序）；系统设置（settings CRUD，含 AI 审核参数占位）；统计（站点 + D1/Queues 配额用量面板）；安全日志；邀请码管理；抽奖配置/奖品管理
- 权限矩阵测试（admin/mod/普通用户每端点）+ Commit

### Task 8.4: stats 站点统计
- 物化统计（日活/发帖量/注册量，scheduled 聚合）
- 集成测试 + Commit，M8 完成（暂停确认）

---

## 里程碑 M9：system 系统域 + scheduled

### Task 9.1: upload 上传
- Telegraph 图床代理（magic bytes 校验，20MB 上限，类型白名单）；异步响应契约
- 集成测试（魔数拒绝/超限拒绝，mock 图床）+ Commit

### Task 9.2: push 推送订阅
- `push_tokens` 订阅/退订；Web Push 发送封装（占位，真正下发后续接）
- 集成测试 + Commit

### Task 9.3: scheduled 定时任务全集
- 每日：排行榜重算/软删硬删/验证码与日志清理/浏览明细清理（留 7 天）/通知收敛/交易流水收敛/注销冷静期到期处理/VIP 到期处理
- scheduled handler 集成测试（触发各任务、幂等断言）+ Commit，M9 完成（暂停确认）

---

## 里程碑 M10：性能验证 + OpenAPI + 交接文档

### Task 10.1: 预算测试全绿
- 全接口 EXPLAIN QUERY PLAN 走索引断言（无全表扫描）；D1 往返次数断言；延迟基准（本地 miniflare，P95 < 450ms）
- 修复违规查询后 Commit

### Task 10.2: OpenAPI 契约生成
**Files:** Create: `src/openapi.ts`（zod schema → OpenAPI 3.1 JSON）
- 产出 `docs/api/openapi.json`，验证可被 Swagger UI 解析

### Task 10.3: 交接文档
**Files:** Create: `docs/api/{auth,posts,economy,...}.md` + `docs/api/frontend-handoff.md`
- 分模块接口说明 + 前端实现要点（401 刷新策略、分页约定、时区、错误码对照表、CORS）
- 完成后 Commit，M10 完成（暂停确认）

---

## 里程碑 M11：部署验证

### Task 11.1: 远程部署
- 创建 D1 数据库（`wrangler d1 create`）→ 写回 wrangler.jsonc → `migrate:remote` → 配置 Secrets（JWT_SECRET 等）→ `wrangler deploy`

### Task 11.2: 线上性能验证
- 对高频接口远程实测 P95（多次请求采样），对照 SLA（<200ms/500ms/450ms 上限）；不达标接口列入待优化清单
- 提交验证报告到 `docs/compose/reports/`

---

## 自审结论

- **Spec 覆盖**：M0→[S5][S7][S8]；M1→[S3][S4][S5][S6]；M2→[S3][S5]；M3-M5→[S3][S5][S6]；M6-M7→[S3][S6]；M8→[S3]；M9→[S8]；M10→[S6][S7][S9]；M11→[S6][S8]。全部 [Sn] 均有任务覆盖；[S11] 可演进性作为 Global Constraints 第 9 条贯穿所有任务。AI 审核（[S6] 审核小节）按用户指示后置，不在本计划任务中。
- **类型一致性**：`AppError`/`ok`/`fail`/`Env`/`JWTPayload` 等跨任务符号均在产出它们的任务中精确定义。
- **无占位符**：业务实现细节在 TDD 执行时按任务验收标准补齐（各任务均有具体接口签名与测试要点）。
