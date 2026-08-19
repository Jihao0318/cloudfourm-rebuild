# CloudForum 后端重构设计文档

> 日期：2026-08-15
> 状态：已与用户确认全部设计决策
> 目标仓库：独立新仓库（后端），与现有 cloudfourm-rebuild 仓库分离

## [S1] 背景与目标

现有代码（cloudfourm-rebuild，Cloudflare Workers + Hono + D1）经历多轮迭代形成"屎山"：单文件巨大（auth.ts 883 行 / admin.ts 1255 行 / items.ts 1084 行）、73 个补丁式迁移、schema 冗余混杂。用户决定**全量功能 1:1 重建**，目标：

- **模块化**：按业务域划分，每域独立可理解、可测试、可替换
- **维护友好**：职责单一、跨域依赖显式化、全量测试保障
- **运行轻量**：依赖极简（hono + jose + zod），冷启动 < 50ms
- **访问迅速**：量化 SLA——高频接口 P95 < 200ms，一般接口 P95 < 500ms，**任何请求绝对上限 450ms**
- **可演进性**：**所有功能与代码必须考虑后期增量修改的可能**——新功能以增量方式接入（新模块/新端点/新列/新钩子），不修改既有语义（详见 [S11]）

交付方式：**先完成后端，产出 API 契约文档（OpenAPI + 分模块说明 + 前端交接要点）**，前端由另一会话/开发者独立实现。后端代码放置于**独立新 Git 仓库**。

用户约束（已确认）：

| 决策点 | 结论 |
|--------|------|
| 技术栈 | 保持 Cloudflare Workers + Hono + D1 |
| 数据库 | 重新设计 schema，**不考虑旧数据**，全新 D1 库 |
| 功能范围 | 全量功能 1:1 重建（含经济/巡查等所有模块） |
| 测试 | 全量测试覆盖，覆盖率 ≥ 90% |
| 性能 | 查询优化为主 + 量化 SLA（见上），D1 免费版配额纳入设计 |
| 代码放置 | 独立新仓库，前端后续另建仓库 |

## [S2] 技术栈与仓库结构

### 技术选型

| 项 | 选择 | 理由 |
|----|------|------|
| 运行时 | Cloudflare Workers | 边缘分发、冷启动快、免费额度、与 Pages 前端同平台 |
| 框架 | Hono | 轻量（~14KB）、原生 Workers 支持、子路由天然适合模块化 |
| 数据库 | D1 (SQLite) | 免费、无运维、全球复制 |
| 校验 | zod | 运行时校验 + 类型推导 + OpenAPI 生成 |
| JWT | jose | Workers 原生 Web Crypto 支持 |
| 测试 | vitest + @cloudflare/vitest-pool-workers | 官方方案，内存 D1 + 真实 Worker 运行时 |

### 仓库结构（新仓库 `cloudforum-backend`）

```
cloudforum-backend/
├── src/
│   ├── core/              # 共享基础设施
│   │   ├── app.ts         # Hono app 装配（模块注册）
│   │   ├── db.ts          # D1 访问封装（batch/事务/配额统计）
│   │   ├── errors.ts      # 错误体系（AppError + 错误码）
│   │   ├── response.ts    # 统一响应封装
│   │   ├── config.ts      # Env 类型与配置读取
│   │   └── logger.ts      # 结构化日志（含请求耗时）
│   ├── middleware/        # auth / cors / rateLimit / errorHandler
│   ├── modules/           # 11 个领域模块（见 S3）
│   ├── utils/             # jwt / password / mailer / date(UTC+8) / crypto
│   ├── migrations/        # 000_init.sql 基线 + 增量
│   ├── tests/             # unit / integration / performance / fixtures
│   ├── index.ts           # Worker 入口 + scheduled
│   └── openapi.ts         # OpenAPI 契约生成
├── docs/api/              # 交接产物（openapi.json + 分模块文档）
├── test/ 配置             # vitest.config.ts 等
├── package.json / tsconfig.json / wrangler.jsonc
└── README.md
```

## [S3] 领域模块划分与目录结构

### 模块清单（11 域，1:1 映射现有功能）

| 模块 | 覆盖功能（对照旧 handlers） |
|------|------|
| `auth` | 注册（邀请码/初始管理员/新手礼包）、登录（锁定/失败计数）、登出、refresh token 轮换+重放检测、改密/改邮箱两步验证、注销冷静期、忘记密码、邀请码生成、验证码 |
| `users` | 资料/头像/背景/头衔/昵称主题/通知设置/搜索、邮箱验证 |
| `posts` | CRUD/置顶/付费解锁（3 次访问）/红包帖/推荐位/锁定/浏览统计 |
| `comments` | 树形评论/编辑/软删除/红包二倍均值 |
| `interactions` | 点赞/关注/收藏/打赏/感谢（合并旧 5 个 handler） |
| `economy` | 积分/签到/VIP/抽奖（签到+积分）/商城/道具/税务/排行榜/红包发放 |
| `moderation` | 举报/巡查 v2（双队列/多人投票/打回轮次）/申诉/AI 审核（异步）/自赎 |
| `notifications` | 通知列表/已读/全部已读/清理/未读数/批量推送 |
| `admin` | 用户/角色/封禁/删号、内容管理、系统设置、统计、安全日志、邀请码管理、抽奖配置、D1 配额面板 |
| `system` | 上传（图床代理）、推送订阅、分类管理 |
| `stats` | 浏览记录/浏览量查询 |

### 模块内部结构（每域 4 文件）

```
src/modules/posts/
├── routes.ts      # 薄路由：参数解析 → service → 统一响应
├── service.ts     # 业务逻辑（唯一允许跨域调用的入口）
├── repo.ts        # 本域专属 SQL（类型化参数）
└── validators.ts  # zod 输入校验
```

### 跨域依赖规则

- 跨域调用**只允许经 service 接口**（如 `posts.service.create` → `economy.service.earnCoins`）
- 模块间禁止直接 import 对方 repo 或碰对方表
- 每模块可独立测试（跨域依赖经 service 层注入 mock）

## [S4] 数据库 Schema 设计

### 表清单（按域分组，约 30 表）

| 域 | 表 |
|------|------|
| 用户认证 | `users`、`refresh_tokens`、`verifications`、`invite_codes`、`security_logs` |
| 内容 | `categories`、`posts`、`post_access`、`comments`、`posts_fts`(FTS5)、`likes` |
| 社交 | `follows`、`bookmarks`、`notifications` |
| 经济 | `user_balances`、`coin_transactions`、`check_ins`、`user_vips`、`shop_items`、`user_items`、`user_vip_tickets`、`red_packets`、`tax_logs`、`fortune_records` |
| 任务成就 | `daily_tasks`、`achievements`、`thanks` |
| 审核 | `reports`、`report_votes`、`appeals`、`unban_requests`、`patrol_stats` |
| 系统 | `settings`、`page_views`、`push_tokens`、`leaderboard_cache`(物化)、`rate_limits` |

### 相对旧库的关键改进

- **合并冗余**：shop_items/shop_extras 双表合一；decorations 并入 items 体系；抽奖记录合并单表
- **命名规范**：snake_case，统一 `created_at`/`updated_at`/`deleted_at` 约定
- **冗余计数列**：`posts.like_count/comment_count/view_count`、`users.notifications_unread` 等，**写时原子增减、读时零计算**（禁止 COUNT）
- **索引先行**：按高频查询建索引（posts(category_id,status,created_at)、likes(user_id,target_type,target_id) 唯一索引、coin_transactions(user_id,created_at) 等）
- **迁移策略**：`000_init.sql` 单一基线全量建表 + 后续按需增量，不再有补丁式迁移
- **可演进约束（SQLite 特性）**：新列一律带默认值或允许 NULL（SQLite 无法为带非默认 NOT NULL 的 ADD COLUMN）；`settings` KV 表承载新配置项；枚举类字段（如状态/类型）用字符串值，新值向后兼容追加

## [S5] API 契约与错误约定

### 统一响应格式

```jsonc
// 成功
{ "success": true, "data": { ... } }
// 失败
{ "success": false, "error": { "code": "AUTH_INVALID_TOKEN", "message": "登录已过期", "details": { ... } } }
```

### 错误码体系

| 前缀 | 示例 | HTTP |
|------|------|------|
| `AUTH_` | `AUTH_INVALID_TOKEN` / `AUTH_EXPIRED` / `AUTH_LOCKED` | 401 |
| `VALIDATION_` | zod 校验失败，details 含字段级错误 | 422 |
| `NOT_FOUND_` | `NOT_FOUND_POST` | 404 |
| `FORBIDDEN_` | `FORBIDDEN_NOT_ADMIN` | 403 |
| `RATE_LIMITED` | 含 retry_after | 429 |
| `CONFLICT_` | `CONFLICT_DUPLICATE_EMAIL` | 409 |
| `ECONOMY_` | `ECONOMY_INSUFFICIENT_COINS` | 400 |
| `INTERNAL_` | 对外不泄露细节 | 500 |

### 关键约定

- 分页：`?page=1&page_size=20` → `{ items, total, page, page_size, has_more }`；深页保护（>100 页切时间游标）
- 认证：`Authorization: Bearer <jwt>`；`POST /auth/refresh` 轮换
- 时间：UTC ISO8601，前端自行转本地时区
- 校验：zod schema 同时驱动运行时校验 + OpenAPI 生成（文档与实现一致）
- 私信功能**不包含**（旧前端已移除，handlers 已删除）
- **API 兼容性约定（增量扩展友好）**：既有端点语义不变，新功能一律以新端点/新可选参数/新响应字段形式追加；删除或改名端点需契约文档同步升级版本并公告

## [S6] 性能、配额与延迟预算

### 延迟预算（450ms 绝对上限，SLA 分解）

| 组成 | 预算 |
|------|------|
| Worker 处理 | ≤ 50ms |
| D1 往返（每次 ~30-100ms） | 高频 ≤2 次 / 一般 ≤3 次 → ≤ 300ms |
| 外部调用 | **不进入请求路径**（异步化） |
| **合计** | **P95 ≤ 300ms，任何请求 < 450ms** |

### 外部依赖非阻塞化

| 依赖 | 方案 |
|------|------|
| AI 审核 | **异步化**（已确认）：发帖立即返回，`ctx.waitUntil()` 后台执行审核；违规帖置「待审核」+ 通知作者/巡查（衔接巡查体系）。详见下方「AI 审核异步执行细则」 |
| 邮件 | 非阻塞发送，失败日志化 |
| 图床 | 仅上传接口同步（预期大请求），其余接口不触碰 |

### AI 审核异步执行细则（Cloudflare Queues 方案）

> **实施状态：后置（本轮重构不实现）**。AI 审核后端地址/凭据由用户在整个项目核心完成后提供，届时按本节设计接入。本节仅作设计预留，架构上为发帖流程预留审核钩子（见 [S11] 钩子注册表），不影响其他功能交付。

**架构**：发帖成功 → 向审核队列投递消息 → 队列 Consumer（同 Worker 的 `queue` handler）执行审核 → 写回状态 + 通知。

```
发帖 POST /posts
  → 写入 published（立即响应，不等待审核）
  → queue.send({ post_id })          # 投递审核任务
  → Queue Consumer（queue handler）
      → D1 读取帖子正文
      → 构造 prompt，调用审核服务
      → 按结果更新帖子状态 + 通知作者/巡查
      → 失败自动重试（队列内置，次数可配），超限进 DLQ
```

**要点**：

- **可靠性**：队列内置重试与 backoff（不随 Worker 实例回收丢失，优于 `ctx.waitUntil`），超重试上限进死信队列（DLQ）收尾
- **消息体积**：仅含 `post_id`（<64KB 单 op；正文由 consumer 查 D1 获取，避免 >64KB 双倍计费）
- **免费额度预算**：10,000 ops/天 ≈ 3,333 条审核消息/天（含重试），发帖量超出时自动降级为跳过审核（日志记录）
- **参数全部后台可调**（settings KV，admin「AI 审核设置」面板，无需改代码）：
  - `ai_review_enabled` 启用开关（默认开）
  - `ai_review_confidence_threshold` 置信阈值（默认 0.7）
  - `ai_review_max_retries` 队列重试上限（默认 3）
  - `ai_review_timeout_ms` 审核调用超时（默认 1500）
  - `ai_review_prompt` **提示词内容（后台可改，默认用下方规范内置模板）**
  - `ai_review_circuit_break_threshold` 熔断阈值（默认 20）
- **审核状态流转**：`published` →（AI 判违规）→ `flagged`（待审核）→ 巡查复核：确认下架 `removed` / 恢复 `published`；作者可走申诉通道
- **熔断机制（简化）**：连续 N 次（阈值可配，默认 20）审核调用失败 → 自动停用审核开关并记录状态；admin 面板可见并可一键恢复；熔断期间发帖直接 published，功能不受影响
- **超额后备**：审核服务超额/无响应 → 帖子保持 `published`（fail-open 不误伤），消息由队列重试（≤ 上限），超限进 DLQ 待人工；连续失败触发熔断（开关置关）

### AI 审核提示词与响应格式规范

**提示词**（默认模板存于代码常量；**内容可经 `settings.ai_review_prompt` 后台覆盖**，admin「AI 审核设置」面板编辑，无需改代码）：

```
你是一个中文社区论坛的内容审核员。请审核以下帖子是否违规。
违规类别：illegal（违法/涉政/毒品/赌博）、porn（色情低俗）、ads（广告营销）、abuse（人身攻击/辱骂/引战）、fraud（诈骗）、privacy（隐私泄露：电话/身份证/住址）、spam（垃圾灌水）。
审核时注意：正常讨论、中性表达、无明显恶意的不算违规；对事实性争议话题保持中立。

【帖子标题】{title}
【帖子正文】{text}
【板块】{category}

只输出 JSON，不要输出其他内容，格式如下：
{"verdict": "pass|flag", "confidence": 0.0-1.0, "reasons": ["类别1"], "summary": "一句话说明"}
verdict=flag 表示违规，confidence 为判定置信度；reasons 从违规类别中选取。
```

**响应解析**：AI 返回内容解析为 JSON 并校验字段；`verdict=flag` 且 `confidence ≥ 阈值`（默认 0.7，后台可调）→ 置 `flagged`；`confidence < 阈值` → 同样标记但自动进巡查人工复核队列；解析失败/非 JSON → 视为调用失败走后备。

**超额后备方案**（AI 超额度/无响应）：

| 场景 | 处理 |
|------|------|
| HTTP 错误 / 超时 / 空 body | fail-open：帖子保持 published；队列消息自动重试（次数后台可配，默认 3） |
| 返回非 JSON / 字段缺失 | 同失败处理，记结构化日志 |
| 超过队列重试上限 | 消息进死信队列（DLQ），待人工/定时处理 |
| 连续失败达熔断阈值（默认 20，后台可调） | 熔断：暂停投递新审核任务，admin 面板可见并可手动恢复 |
| 熔断期间 / 审核关闭 | 发帖不等待审核，直接 published（功能不受影响，运营可改回） |

### D1 免费版配额预算（读 5M/天、写 100k/天、存储 5GB）

- **写放大控制**：浏览量当日去重（INSERT OR IGNORE，同访客+同帖+同日 1 次）、批量通知限 ≤200 条、软删除替代硬删、日志限量留存、硬清理统一 scheduled
- **读浪费杜绝**：全表扫描/无索引过滤/COUNT(*) 一律禁止（预算测试断言 EXPLAIN QUERY PLAN 走索引）；列表单次读 ≤50 行；展示计数走冗余列/物化表
- **用量可见**：db 层统一收集 meta.rows_read/written 累计，admin 提供「D1 配额用量」面板（当日用量/剩余/超限预警）
- **存储**：软删内容 scheduled 定期硬删；图片外置图床不占存储

### 查询纪律

- 所有 D1 调用强制 batch（一次往返多条 SQL），严禁串行循环查库
- 每 handler 标注往返预算，预算测试断言实际往返次数
- 列表接口单表 SELECT + ≤1 层简单 JOIN，复杂聚合一律物化表

## [S7] 测试基础设施

- **vitest + @cloudflare/vitest-pool-workers**：内存 D1 + 真实 Worker 运行时，HTTP 级集成测试
- **三层测试**：
  - 单元：纯逻辑（JWT/PBKDF2/校验/抽奖概率/红包算法/税务计算/成就判定/时区）
  - 集成：每模块每端点（成功/鉴权失败/权限/校验/业务错误/限流）
  - 预算：EXPLAIN QUERY PLAN 走索引断言、D1 往返次数断言、延迟基准
- **覆盖率 ≥ 90%**（行覆盖率），CI 未达标 FAIL
- 每模块独立可测（跨域 service 注入 mock）
- fixtures 种子数据工厂

## [S8] 运行时与部署

### Secrets 与环境变量

| 变量 | 用途 |
|------|------|
| `JWT_SECRET` | JWT 签名（Secret） |
| `FRONTEND_URL` | CORS 白名单（未来前端域名，严格模式） |
| `TELEGRAPH_IMAGE_URL` | 图床地址 |
| `AI_JUDGE_URL` / `AI_JUDGE_KEY` | AI 审核（异步） |
| `MAILER_URL` / `MAILER_TOKEN` | 邮件（非阻塞） |

### 运行时配置

- **Queues**：审核队列（producer `queue.send` + 同 Worker `queue` handler 消费），wrangler 配置 `max_retries`/`dead_letter_queue`；消息仅含 `post_id`
- **Cron**：每日 00:00 UTC——排行榜重算、过期清理（软删硬删/验证码/日志/浏览明细）、通知收敛
- **限流**：登录/注册/验证码/改密等敏感端点（D1 原子计数，429 带 retry_after）
- **D1**：全新数据库（新库名），000_init 基线迁移
- **时区**：UTC 存储，签到/每日任务按 UTC+8 日期窗

### CI/CD（GitHub Actions）

类型检查 → 单元 → 集成 → 预算测试 → 覆盖率（≥90%）→ 构建 → D1 迁移 → 部署

## [S9] 交接产物（后端完成后交付）

```
docs/api/
├── openapi.json          # 完整 OpenAPI 规范（zod 驱动生成）
├── auth.md / posts.md / economy.md / ...  # 分模块接口说明
└── frontend-handoff.md   # 前端实现要点（401 刷新策略、分页、时区、错误码处理对照表）
```

前端由另一会话/开发者基于契约文档独立实现（React 技术栈，另建仓库）。

## [S10] 里程碑划分（实施顺序）

> 实施原则（用户确认）：**每个功能一个一个来**，逐个功能完成、验证、交付后再进入下一个。AI 审核模块**本轮不实施**（后端信息由用户后续提供，见 S6）。

| 里程碑 | 内容 | 验收 |
|--------|------|------|
| M0 | 新仓库初始化 + 骨架（core/middleware/测试脚手架/vitest 配置） | 空 app 可跑通测试 |
| M1 | Schema 基线迁移 + db 层 + auth 认证域 | 认证全流程集成测试通过 |
| M2 | users 用户域（资料/头像/搜索/邮箱验证） | 用户接口测试通过 |
| M3 | 内容域：categories + posts 核心（CRUD/置顶/锁定） | 帖子接口测试通过 |
| M4 | 内容增强：付费帖/红包/推荐位 + comments 评论 | 评论与增强功能测试通过 |
| M5 | interactions 互动域（likes/follows/bookmarks/tips/thanks）+ notifications | 互动与通知测试通过 |
| M6 | economy 经济域 1：coins/check-in/vip | 经济基础测试通过 |
| M7 | economy 经济域 2：lottery/shop/items/tax/leaderboard | 经济扩展测试通过 |
| M8 | moderation 审核域（reports/patrol/appeals/unban）+ admin + stats | 审核与管理测试通过 |
| M9 | system 系统域（upload/push）+ scheduled 定时任务 | 系统功能测试通过 |
| M10 | 性能验证（预算测试全绿、往返断言）+ OpenAPI 生成 + 交接文档 | 契约文档齐备 |
| M11 | 部署验证（远程 D1 迁移、实测 P95 对照 SLA） | 线上接口达标 |
| （后置） | AI 审核接入（用户提供审核后端后按 S6 实施） | — |

每个里程碑独立可交付、可回归，依赖 compose:plan 拆分为任务执行。

## [S11] 可演进性设计（增量修改友好）

**总原则：任何新功能都应能以「新增」方式接入，而不是「修改既有代码」。** 分层落实如下：

### 1. Schema 层

- **迁移纪律**：新结构一律新增增量迁移文件（编号递增），**永不修改已应用的迁移**
- **SQLite 约束**：新列带默认值或允许 NULL；枚举用字符串值追加新值；新配置项走 `settings` KV 表（无需建表）
- **数据回填**：需要为存量数据补字段时，用一次性回填迁移（如旧库 056 模式），与结构变更分离

### 2. API 层

- 新功能 = 新端点 / 新可选查询参数 / 新响应字段（data 内追加），既有端点语义不变
- 错误码可新增前缀分类，不改变既有错误码含义
- OpenAPI 契约随版本演进，删除/改名端点需文档版本升级并公告

### 3. 代码层（扩展点设计）

- **新域接入零成本**：新模块 = 新目录（routes/service/repo/validators）+ app 注册一行，自动获得统一响应/错误处理/测试脚手架
- **副作用钩子注册表**：经济奖励、通知、成就、巡查战绩这类「操作后的副作用」通过**钩子注册表**挂接（如 `hooks.register('post.created', handler)`），新功能可挂钩而不改核心逻辑——这是防止未来新增功能时侵入旧代码的关键机制
- **配置驱动**：功能开关（feature flag）经 `settings` KV 或环境变量读取，新功能可灰度/随时关闭，不影响已发布功能
- **service 接口稳定**：对外签名稳定，内部实现可独立重构（测试保障行为不变）

### 4. 测试层

- 新模块直接复用既有测试脚手架与 fixtures 工厂，零额外配置
- 新钩子/新功能要求配套测试，覆盖率门槛（≥90%）自动保障增量质量

### 5. 生命周期

- 代码评审关注点含「是否符合可演进性约束」：新代码未走钩子/未走 settings 而是硬编码侵入既有逻辑 → 打回重写
