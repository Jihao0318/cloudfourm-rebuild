# CloudForum 项目解析

> 本文档解析 `cloudfourm-rebuild` 项目的完整结构与各文件职责，供阅读与接手开发参考。
> 基于 2026-08-15 的代码现状整理（README.md 已部分过时，差异见第 9 节）。

---

## 1. 项目概览

**CloudForum** 是一个基于 **Cloudflare Workers + Pages + D1** 的全栈论坛系统，功能涵盖传统论坛的帖子/评论/用户体系，并叠加了积分经济、VIP、抽奖、商城、道具、成就、巡查审核等游戏化运营模块。

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 18 + TypeScript | Vite 5 构建，HMR 开发 |
| 路由 | React Router v6 | 客户端 SPA 路由（24 条懒加载路由） |
| 样式 | TailwindCSS 3 | 原子化 CSS，支持 `.dark` 暗色模式 |
| 后端 | Hono（Cloudflare Workers） | 轻量路由框架 |
| 数据库 | Cloudflare D1（SQLite） | 73 个迁移文件逐步演进 |
| 图床 | Telegraph-Image | 图片/视频上传代理 |
| 认证 | JWT（jose）+ Refresh Token | 7 天主令牌 + 刷新令牌（SHA-256 哈希存储） |
| 密码 | PBKDF2（Web Crypto） | 兼容旧 bcrypt，登录时自动升级 |
| 搜索 | SQLite FTS5 | 帖子标题/内容全文索引 |
| 邮件 | 外部邮件服务代理 | `utils/mailer.ts`（SSRF 防护） |
| 推送 | Web Push | `push_tokens` 表 + push handler |
| AI 审核 | 外部审核 API | 发帖前内容审核（fail-open） |
| CI/CD | GitHub Actions | 类型检查 + 构建 + D1 迁移 + 部署 |

### 系统架构（请求流程）

```
用户 → forum.域名.com
         ↓
    Cloudflare Pages（前端静态资源，Edge 全球加速）
         ↓
    ┌─ /api/* ? ──────────────────────────┐
    │    YES → Cloudflare Worker (Hono)    │
    │           D1 数据库 (SQLite)          │
    │           返回 JSON 响应               │
    └─ 其他路径 ?                           │
        → 返回 index.html（React SPA）      │
           React Router 接管前端路由         │
    └──────────────────────────────────────┘
```

---

## 2. 目录结构总览

```
cloudfourm-rebuild/
├── worker/                        # Cloudflare Worker 后端（核心业务）
│   ├── src/
│   │   ├── index.ts               # Worker 入口 + 定时任务
│   │   ├── routes.ts              # 路由注册 + 限流 + 全局中间件
│   │   ├── handlers/              # 30 个业务处理器
│   │   ├── middleware/            # 鉴权 / CORS / 限流
│   │   ├── db/queries.ts          # SQL 查询封装
│   │   ├── utils/                 # 工具函数
│   │   └── types/index.ts         # TypeScript 类型
│   └── migrations/                # 73 个 SQL 迁移 + Schema 文档
├── frontend/                      # React 前端
│   ├── src/
│   │   ├── main.tsx               # 入口
│   │   ├── App.tsx                # 路由定义
│   │   ├── components/            # 15 个通用组件
│   │   ├── pages/                 # 25 个页面
│   │   ├── services/api.ts        # API 客户端
│   │   ├── contexts/              # Auth / Toast 上下文
│   │   ├── utils/                 # 日期/等级/成就等工具
│   │   └── types/                 # 类型定义
│   ├── public/                    # 静态资源 + Pages 路由配置
│   └── 构建配置                    # vite / tailwind / tsconfig
├── docs/                          # 设计文档与状态文档
├── .github/workflows/             # CI/CD（deploy-v2.yml）
├── wrangler.jsonc                 # Worker 配置（D1 绑定、Cron、环境变量）
├── deploy.sh                      # 一键部署脚本
├── package.json                   # 根工作空间脚本
├── README.md                      # 项目主文档（部分过时）
└── ui-ux-preview.html             # UI 设计预览页
```

---

## 3. 根目录文件

| 文件 | 职责 |
|------|------|
| `README.md` | 项目主文档：功能特性、架构、技术栈、API 总览、部署指南、数据库表清单。**注意：已落后于代码现状**（见第 9 节） |
| `package.json` | 根工作空间脚本：`dev:worker` / `dev:frontend` / `deploy:worker` / `deploy:frontend` / `db:migrate` |
| `wrangler.jsonc` | Cloudflare Worker 配置：D1 绑定 `DB`（forum-db-v3）、`vars`（ENVIRONMENT / TELEGRAPH_IMAGE_URL / FRONTEND_URL CORS 白名单）、每日 00:00 UTC Cron 定时任务 |
| `deploy.sh` | 交互式一键部署脚本（详见第 6.1 节） |
| `.dev.vars` | 仅本地开发（`wrangler dev`）的环境变量文件，存放 JWT_SECRET 等本地凭据，**不进 git、不用于生产** |
| `.github/workflows/deploy-v2.yml` | CI/CD 自动部署流水线（详见第 6.2 节） |
| `ui-ux-preview.html` | 静态设计预览页，用于预览「评论 VIP 着色」等 UI 效果（与前端源码无关） |
| `.gitignore` | Git 忽略规则 |
| `.wrangler/` | wrangler 本地运行时状态（缓存/模拟数据/备份），可删除重建 |
| `.mimocode/` / `.mimosa/` / `.reasonix/` | AI 工具配置与工作记录目录，与业务无关 |

---

## 4. 后端 worker/

### 4.1 入口与路由

| 文件 | 职责 |
|------|------|
| `src/index.ts` | Worker 入口。装配 Hono 应用、404/500 错误处理；导出 `scheduled` 定时任务：每日清理注销用户、打回超时帖、软删帖硬删、安全日志清理、限流清理、已读通知清理、交易流水收敛、浏览记录清理、排行榜重算 |
| `src/routes.ts` | `setupRoutes` 统一挂载全部路由 + 各端点限流配置 + 全局 CORS / 鉴权中间件 |

### 4.2 中间件 `src/middleware/`

| 文件 | 职责 |
|------|------|
| `auth.ts` | JWT 鉴权族：`requireAuth`（校验 token_version + 封禁检查 + 注销懒清理）、`optionalAuth`、`requireAdmin`、`requireAdminRole`、`checkNotBanned`；另导出 `cleanupUser`（注销时全量清理用户数据） |
| `cors.ts` | CORS 白名单（FRONTEND_URL）+ 安全响应头 + OPTIONS 预检处理 |
| `rateLimit.ts` | 基于 D1 原子 UPSERT 的计数限流，支持 failClosed / fail-open 两种模式 |
| `error.ts` | 空文件（错误处理实际由 index.ts 的 `app.onError` 承担） |

### 4.3 业务处理器 `src/handlers/`（30 个）

| 文件 | 职责 |
|------|------|
| `auth.ts`（883 行） | 认证全流程：注册（邀请码 / 初始积分 / 首个用户自动管理员 / 邮箱验证码 / 新手礼包）、登录（账号锁定 + 失败计数）、改密 / 改邮箱两步验证、refresh token 轮换 + 重放检测、登出、注销冷静期、邀请码生成、忘记密码 |
| `posts.ts` | 帖子列表 / 详情 / 发布 / 编辑 / 删除 / 置顶、付费解锁（3 次访问扣减）、红包帖、推荐位、抢红包榜单 |
| `comments.ts` | 树形评论分页 / 发表（含抢红包二倍均值算法）/ 编辑 / 删除，回复通知与奖励钩子 |
| `categories.ts` | 分类公开列表 + 管理端 CRUD |
| `likes.ts` | 点赞 / 取消，被赞作者奖励（积分 / 经验 / 成就） |
| `upload.ts` | 图片 / 视频上传（Telegraph 图床代理，magic bytes 校验，20MB 上限） |
| `users.ts` | 个人资料 / 头像 / 背景图 / 自定义头衔 / 昵称主题色 / 通知设置 / 用户搜索 |
| `admin.ts`（1255 行） | 管理后台：用户 / 角色 / 封禁 / 删号、设置白名单、安全日志、VIP、帖子评论管理、举报多人复核 + 直接下架、解封审核、抽奖配置 / 奖品管理、邀请码、站点统计 |
| `stats.ts` | 浏览记录 / 浏览量查询 |
| `coins.ts` | 积分余额 / 转账（VIP 费率 + 手续费销毁）/ 今日收入 / 交易记录；导出 `addCoins`、`canEarnToday`、`cleanupTransactions` 供他处复用 |
| `check-in.ts` | 签到（7 天阶梯奖励 + VIP 加成 + 每日 50 分上限） |
| `vip.ts` | VIP 状态 / 购买 / 升级（补差价）/ 价格配置展示 |
| `reports.ts` | 提交举报（帖子 / 评论，防重复） |
| `appeals.ts` | 已下架帖复审：作者申诉提交、达标巡查员单人判定（恢复 / 维持下架） |
| `moderation.ts` | 巡查体系 v2：待巡查 / 待复核双队列、多人投票双计数、打回重提 + 轮次隔离、巡查战绩统计 |
| `review.ts` | AI 内容审核代理（转发至外部审核服务，5 秒超时 fail-open） |
| `follows.ts` | 关注切换 / 关注列表 / 粉丝列表 / 计数 |
| `notifications.ts` | 通知列表 / 单条已读 / 全部已读 / 清理已送达 / 未读数 |
| `bookmarks.ts` | 收藏列表 / 添加 / 取消 |
| `shop.ts` | 商城（`shop_items` 与 `shop_extras` 双表，extra 表 id 以 +10000 偏移）、购买、改名卡使用、我的物品 |
| `tips.ts` | 打赏（5/10/50 分，每日 15 次 / 200 分原子限额） |
| `decorations.ts` | 帖子装饰（卡片 / 鎏金标题）应用与移除 |
| `lottery-coins.ts` | 积分抽奖（SSR 软 / 硬保底、十连保底 SR+、权重轮盘、全服公告、成就钩子） |
| `leaderboard.ts` | 积分排行榜（物化缓存表读取 + 每日重算函数） |
| `unban.ts` | 封禁自赎申请（500 分保证金，原子扣款 + 申请，3 天驳回冷却） |
| `items.ts`（1084 行） | 道具系统：单件 / 批量回收、推荐卡 / 置顶 / 背景 / 高亮 / 运势 / 彩虹标题 / 大喇叭 / 自定义称号等 19 个使用端点、装饰佩戴、红包记录 |
| `push.ts` | 推送 token 订阅 / 退订（Web Push） |
| `tasks.ts` | 每日任务（实时计数判定 + 原子领取 + 全勤宝箱） |
| `achievements.ts` | 成就墙 / 成就殿堂（校园 + 巡查合并，惰性补解锁） |
| `thanks.ts` | 感谢功能（板块开关 + 每日 5 次 + 作者经验） |

### 4.4 数据库层 `src/db/`

| 文件 | 职责 |
|------|------|
| `queries.ts`（937 行） | SQL 查询封装，分组：用户查询（CRUD / 角色 / 公开资料）、帖子查询（`listPosts` 含 FTS5 搜索 + 深页保护 + 置顶拆分、`getPostById`、`hardDeletePost` 含红包退款）、评论查询（递归 CTE 树、级联硬删）、分类、点赞、验证码（防爆破）、系统设置、浏览统计（去重 + 物化计数）、通知 |

### 4.5 工具 `src/utils/`

| 文件 | 职责 |
|------|------|
| `jwt.ts` | JWT 签发 / 验证（jose）、refresh token 生成与 SHA-256 哈希 |
| `password.ts` | PBKDF2 密码哈希 / 校验，兼容旧 bcrypt（登录时自动升级） |
| `mailer.ts` | 邮件服务代理（MAILER_URL / TOKEN，SSRF 防护） |
| `validation.ts` | 用户名 / 邮箱（仅 QQ 邮箱）/ 密码 / 标题 / 内容校验 + parseId |
| `game.ts` | 经济 v3 核心：UTC+8 日期窗、经验等级（30 级）、`addExp`（升级礼包）、每日任务标记、成就注册表 + 发奖 + 解锁 |
| `patrol.ts` | 巡查等级 / 经验 / 11 个巡查成就 / 战绩结算 |
| `achievement-check.ts` | 单条合并 SQL 惰性补解锁全部 30 个成就 |
| `decoration.ts` | 称号 / 头像框拥有集计算 |

### 4.6 类型 `src/types/index.ts`

User / Post / Comment / Category 等实体类型、请求响应类型、JWTPayload（仅 id + username + ver）、Env Bindings 声明。

### 4.7 数据库迁移 `migrations/`（73 个 .sql + 1 个 .md）

按功能分组（编号即文件名前缀）：

| 分组 | 迁移 | 功能 |
|------|------|------|
| 基础 | `000_rebuild` | 危险操作：DROP 全部旧表重建 |
| 基础 | `001_init` ~ `002_fix` | 初始 8 表 + 兼容补表 |
| 内容 | `003`（封禁 + 软删）、`004`（通知）、`005_bookmarks`（收藏）、`005_hard_delete_soft_deleted`（软删硬清，一次性）、`006_follows`（关注）、`006_scheduled_deletion`（注销冷静期）、`070`（评论 updated_at） | 内容体系扩展 |
| 经济 | `007`（VIP + 签到 + 积分三表）、`010`（抽奖）、`012`（商城 / 打赏 / 抽奖 / 自赎五表）、`013`（抽奖概率调整）、`014/029/036`（商城调价）、`022`（抽奖重构：稀有度 + 保底）、`025`（VIP 体验券）、`026`（抽奖道具表）、`027/028`（头像框 / 运势有效期）、`030`（积分个税）、`031`（rarity 回填）、`035/037`（称号 / 头衔有效期）、`050`（经济 v3：经验 / 任务 / 成就 / 感谢）、`052`（v3 补丁 + 红包领取）、`056`（积分账户回填） | 积分经济体系 |
| 商城道具 | `015/016`（装饰体系）、`023`（修道具类型）、`051`（商城重设计 shop_extras）、`053`（is_active 列）、`057`（效果管理标记）、`058`（提升卡 → 推荐卡）、`059/060`（道具详情 data） | 商城与道具 |
| 私信 | `017`（私信三表）、`020/021`（私信软删 / 已读） | 私信系统（前端已移除，表仍保留） |
| 搜索/限流 | `018`（FTS5 全文索引 + 限流表）、`034`（FTS 重建）、`039`（限流索引） | 搜索与限流 |
| 认证安全 | `019`（refresh_tokens）、`041`（邀请码）、`049`（封禁原因）、`054`（登录安全：token_version / 锁定 / 审计日志）、`055`（邮箱验证重建 verifications）、`067`（验证码防爆破） | 认证与安全 |
| 帖子增强 | `032`（推荐位 bumped_until）、`033`（清理公告）、`042`（付费帖）、`043`（查看次数）、`044`（校园论坛：匿名 + 板块开关）、`045/046`（补缺失列）、`047`（板块付费开关）、`061`（板块感谢开关） | 帖子/板块增强 |
| 巡查举报 | `008`（举报）、`009`（举报支持评论）、`062`（巡查体系）、`063`（巡查战绩表）、`064`（成就修复 + 战绩回填）、`066`（举报多人复核表）、`068`（巡查 v2：打回 + 轮次）、`069`（申诉表） | 巡查与举报 |
| 其他 | `038`（push_tokens）、`048`（抽奖配置化）、`071/072`（索引补全）、`073`（排行榜物化表） | 杂项 |

> 注：迁移编号不连续（缺 `024`、`040`），`005`、`006` 各有两个文件，为历史演进遗留。
> `SCHEMA_SNAPSHOT.md`：Schema 汇总文档（表 → 创建迁移 → 字段清单），但**已过时**（自称"12 个迁移叠加"，实际已有 73 个）。

### 4.8 worker 配置文件

- `package.json`：依赖 `hono`、`jose`；devDeps `@cloudflare/workers-types`、`typescript`、`wrangler`；脚本 `dev`（wrangler dev --remote）、`deploy`、`migrate`
- `tsconfig.json`：ES2021 target / ES2022 module / strict / noEmit / types=workers-types

---

## 5. 前端 frontend/

### 5.1 入口与路由

| 文件 | 职责 |
|------|------|
| `src/main.tsx` | 入口。挂载前注册「部署后 chunk 加载失败 → 刷新横幅」逻辑；包裹 HelmetProvider + BrowserRouter + AuthProvider + ToastProvider |
| `src/App.tsx` | 24 条懒加载路由 + 404，统一由 Layout 包裹 |
| `src/index.css` | 全局样式，含整套 `.dark` 暗色模式下 Tailwind 类覆盖 |
| `index.html` | 含 CSP meta（放行 Google Fonts + YouTube/Bili iframe）、三字体预加载 |

### 5.2 API 客户端 `src/services/api.ts`（878 行）

统一 fetch 封装（`request` 函数、401 并发刷新 token 仅一次、`auth:expired` 全局事件），按命名空间组织 33 组接口：
auth / invites / posts / comments / categories / likes / upload / users / admin / checkIn / coins / vip / reports / stats / site / follows / bookmarks / shop / decorations / tips / lotteryCoins / leaderboard / unban / notifications / tasks / achievements / thanks / moderation / items / appeals 等。

### 5.3 Contexts `src/contexts/`

| 文件 | 职责 |
|------|------|
| `AuthContext.tsx` | 用户态管理、401 自动跳登录并带 `from` 参数回跳 |
| `ToastContext.tsx` | Toast 通知（2.5s 自动消失） |

### 5.4 组件 `src/components/`（15 个）

| 文件 | 职责 |
|------|------|
| `Layout.tsx` | 公共布局：导航栏 + 底部导航 + 回到顶部 |
| `Avatar.tsx` | 头像 + 头像框渲染 |
| `MarkdownEditor.tsx` | Markdown 编辑器（工具栏 + 视频识别 + 图片上传） |
| `VIPBadge.tsx` | VIP 徽章 + 昵称主题色 |
| `NotificationBell.tsx` | 通知铃铛 |
| `Skeleton.tsx` | 5 种骨架屏 |
| `EmptyState.tsx` | 空状态占位 |
| `ErrorBoundary.tsx` | 错误边界（chunk 加载错误处理） |
| `ConfirmModal.tsx` | 确认弹窗 |
| `CropModal.tsx` | 头像裁切 |
| `BackButton.tsx` | 返回按钮 |
| `MoreMenu.tsx` | 下拉菜单 |
| `HomeSidebar.tsx` | 首页侧边栏（公告 / 推荐位 / 余额） |
| `ItemDetailModal.tsx` | 道具详情弹窗 |
| `PostEffectModal.tsx` | 帖子装饰 / 背景 / 红包配置弹窗 |

### 5.5 页面 `src/pages/`（25 个，含 404）

| 页面 | 职责 |
|------|------|
| `Home.tsx` | 首页（分类 / 分页 / 搜索 / 排序 / Feed 流 / 防抖搜索） |
| `Boards.tsx` | 板块页 |
| `Login.tsx` | 登录 |
| `Register.tsx` | 注册（含邮箱验证提示、用户协议弹窗） |
| `ForgotPassword.tsx` | 忘记密码 |
| `InviteRedirect.tsx` | 邀请码跳转 |
| `CreatePost.tsx` | 发布 / 编辑帖子（Markdown 编辑器 + AI 审核） |
| `PostDetail.tsx` | 帖子详情 + 扁平评论 + 图片预览 + 收藏 / 举报 / 付费解锁 |
| `Profile.tsx` | 个人资料（邮箱验证弹窗、三级注销确认、头像/背景预览） |
| `Admin.tsx` | 管理后台：16 个子面板（概览 / 巡查台 / 帖子 / 评论 / 置顶 / 举报 / 板块 / 用户 / 解封 / 积分 / VIP / 抽奖 / 公告 / 设置 / 邀请码 / 安全日志） |
| `Moderator.tsx` | 巡查员工作台（举报多人复核 + 帖子预览队列） |
| `Terms.tsx` | 用户协议 |
| `CheckIn.tsx` | 签到（月度日历 / 连续天数 / 抽奖） |
| `Tasks.tsx` | 每日任务 |
| `VIP.tsx` | VIP 购买 / 升级 |
| `Coins.tsx` | 积分余额 / 今日收入 / 转账 |
| `Transactions.tsx` | 交易记录（原 TaxPage 拆分而来） |
| `Shop.tsx` | 商城 |
| `Warehouse.tsx` | 道具仓库（使用 / 回收） |
| `LotteryCoins.tsx` | 积分抽奖（单抽 / 十连 / 保底） |
| `Leaderboard.tsx` | 排行榜 |
| `Achievements.tsx` | 成就殿堂 |
| `ActiveEffects.tsx` | 称号 / 头像框 / 昵称主题佩戴管理 |
| `RedPackets.tsx` | 红包 |
| `Appeal.tsx` | 帖子申诉 |

### 5.6 工具与类型

| 文件 | 职责 |
|------|------|
| `utils/date.ts` | UTC 解析 + 上海时区相对时间 |
| `utils/level.ts` | 经验等级曲线 |
| `utils/achievements.ts` | 成就稀有度元数据 |
| `utils/markdownSanitize.ts` | Markdown 渲染安全（iframe/video 白名单） |
| `utils/postBg.ts` | 帖子渐变背景表 |
| `types/index.ts` | User / PublicUser / Post / Comment / Category / 成就 / 任务 / 装饰等接口 |
| `types/declarations.d.ts` | 第三方库（react-loading-skeleton、react-easy-crop）手写类型声明 |

### 5.7 构建配置

| 文件 | 要点 |
|------|------|
| `package.json` | React 18.3 + Vite 5 + TS 5.9；脚本 `dev` / `build`（tsc + vite build）/ `preview`；依赖 react-router-dom v6、react-markdown + remark-gfm/rehype、react-easy-crop、react-helmet-async、react-loading-skeleton、yet-another-react-lightbox、@fortawesome 图标 |
| `vite.config.ts` | 仅 react 插件；`/api` 开发代理 → localhost:8787；构建 manualChunks 拆分 vendor / markdown |
| `tsconfig.json` | ES2020 / strict / bundler resolution / noEmit / jsx: react-jsx |
| `tailwind.config.js` | darkMode: class；content 扫描 src |
| `public/_routes.json` | Cloudflare Pages 路由配置：`/api/*` 交给 Worker 处理 |
| `public/favicon.svg` | 站点图标 |
| `src/assets/frames/README.md` | 头像框扩展规范文档（无图片素材） |

---

## 6. 部署与 CI/CD

### 6.1 deploy.sh（一键部署脚本）

主流程 6 步：

1. **前置检查**：Node / npm / wrangler / Cloudflare 登录 / Account ID
2. **安装依赖**：worker 与 frontend 各 `npm ci`
3. **数据库**：创建或复用 D1 `forum-db`，将 database_id 写回 `wrangler.jsonc`，执行远程迁移
4. **配置 Secrets**：交互式配置 JWT_SECRET / TELEGRAPH_IMAGE_URL / FRONTEND_URL 三个 Secret
5. **部署 Worker**：`wrangler deploy`（forum-worker）
6. **部署前端**：构建后选择自动 / 手动 / 跳过方式部署到 Cloudflare Pages（forum-frontend），最后打印后续配置指引

支持跳过参数：`--skip-d1` / `--skip-secret` / `--skip-worker` / `--skip-front` / `--skip-account`。

### 6.2 GitHub Actions（.github/workflows/deploy-v2.yml）

push 到 main 或手动触发，流程：缓存并安装依赖 → 前端 TS 类型检查 → 构建前端（VITE_API_BASE 走 Secret）→ 解析 / 创建 D1 database_id 并写回 wrangler.jsonc → 应用 D1 远程迁移 → wrangler-action 部署 Worker → 确保 Pages 项目存在 → 部署 frontend/dist 到 Pages → 输出步骤摘要。

### 6.3 域名路由约定

- **Pages**：`forum.域名.com` → `forum-frontend`
- **Worker 路由**：`forum.域名.com/api/*` → `forum-worker`
- 前端环境变量：`VITE_API_BASE`（API 地址）、`VITE_JUDGE_API_URL`（AI 审核地址）

### 6.4 本地开发

```bash
# 终端 1：Worker（端口 8787，连接远程 D1）
npm --prefix worker run dev

# 终端 2：前端（Vite 自动代理 /api/* → localhost:8787）
npm --prefix frontend run dev
```

---

## 7. 设计文档 docs/

| 文档 | 主题 |
|------|------|
| `PROJECT_STATUS.md` | 项目状态与交接文档：技术栈、本地运行方式、已完成功能与待办 |
| `auth-security-plan.md` | 登录系统安全修复方案：11 项高危问题（存储型 XSS、会话失效、暴力破解等）及修复设计 |
| `email-verification-plan.md` | 邮箱验证全链路计划：改邮箱 / 改密码 / 注册的验证码流程设计 |
| `economy-v3-plan.md` | 经济系统 v3 计划书：积分 / 经验双轨 + 等级 / 任务 / 成就 / 感谢四引擎，含通胀模拟论证 |
| `ui-layout-plan.md` | UI 布局优化方案：内容宽度跳变、信息架构、页面结构重构（不动视觉细节） |
| `ui-polish-plan.md` | 首页布局与视觉质感升级：双栏利用留白、消除廉价感 |
| `superpowers/specs/2026-08-14-review-system-v2-design.md` | 巡查体系 v2 设计：举报审核 + 帖子巡查的状态机、打回编辑、票数阈值等增量方案 |

---

## 8. 核心业务模块速览（当前代码现状）

| 模块 | 后端 | 前端 | 说明 |
|------|------|------|------|
| 用户认证 | `auth.ts` + middleware/auth.ts | Login / Register / ForgotPassword / Profile | 邀请码注册、两步验证、refresh token 轮换、账号锁定、注销冷静期 |
| 帖子评论 | `posts.ts` / `comments.ts` | Home / Boards / CreatePost / PostDetail | 付费解锁、红包帖、推荐位、树形评论 |
| 积分经济 | `coins.ts` / `check-in.ts` / `vip.ts` / `tax` | Coins / CheckIn / VIP / Transactions | 签到、VIP 加成、手续费销毁、积分个税 |
| 抽奖商城道具 | `lottery-coins.ts` / `shop.ts` / `items.ts` | LotteryCoins / Shop / Warehouse / ActiveEffects | SSR 保底、双表商城、19 种道具效果 |
| 成就任务 | `achievements.ts` / `tasks.ts` + utils/game.ts | Achievements / Tasks | 30 个成就、每日任务、全勤宝箱 |
| 巡查审核 | `moderation.ts` / `appeals.ts` / `reports.ts` / `review.ts` | Moderator / Appeal / Admin | 多人投票复核、打回重提、申诉、AI 审核 |
| 社交 | `follows.ts` / `bookmarks.ts` / `notifications.ts` / `thanks.ts` | HomeSidebar / NotificationBell | 关注、收藏、通知、感谢 |
| 运营管理 | `admin.ts` | Admin（16 面板） | 用户 / 封禁 / 积分 / VIP / 抽奖 / 举报 / 安全日志 |

---

## 9. 与 README.md 的差异（README 已过时）

| 差异 | 说明 |
|------|------|
| 新增页面 9 个 | Boards、ForgotPassword、InviteRedirect、Moderator、Tasks、Transactions、Achievements、RedPackets、Appeal（README 未列） |
| 移除组件 | ImagePreview.tsx / MessagesPanel.tsx 已删除（图片预览内联进 PostDetail；私信功能前端已移除，api.ts 标注 "messages removed"） |
| TaxPage 更名 | README 的 TaxPage.tsx 实际已拆为 Transactions.tsx |
| 新增组件 4 个 | BackButton、HomeSidebar、ItemDetailModal、PostEffectModal |
| 新增 utils 4 个 | achievements / level / markdownSanitize / postBg（README 仅提 date.ts） |
| 邮箱验证落地 | 注册提示 → Profile 两步验证（`/auth/email/verify-register` + 改邮箱 / 改密码 request/verify 两步） |
| 巡查体系 v2 | 举报 / 巡查走多人复核票数制（`report_violation_limit` 默认 3），管理员一票权，打回重提 + 轮次隔离 |
| 新功能未覆盖 | 邀请码拉新、安全日志、帖子付费解锁、红包、成就殿堂、自赎解封、每日任务、感谢、推送订阅 |
| 迁移数量 | README 写 012~037，实际已有 73 个迁移文件 |
| SCHEMA_SNAPSHOT.md | 自称"12 个迁移叠加"，已过时 |

---

## 10. 常见开发注意点

- **移动端底部导航**：修改全屏弹窗 / 面板 / 遮罩 UI 时，底部加 `pb-16 md:pb-0`（`h-16` 是移动端底部导航栏高度）
- **z-index 冲突**：导航栏 `z-50`，全屏弹窗必须用 `z-[60]` 以上
- **vh 单位**：避免 `100vh`，改用 `100dvh` 适配 iOS Safari 地址栏
- **迁移纪律**：数据库变更一律新增迁移文件（编号递增），不要修改已应用的迁移
- **并发安全**：积分扣款用 `WHERE coins >= ?` 原子条件，防超花
- **密码存储**：PBKDF2 为主，旧 bcrypt 哈希登录时自动升级
- **限流**：登录 / 注册 / 密码等敏感端点均配置了 D1 原子限流，新增敏感端点应同样处理
