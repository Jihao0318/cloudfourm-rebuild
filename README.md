<div align="center">
  <img src="frontend/public/favicon.svg" width="96" alt="CloudForum Logo" />
  <h1>CloudForum</h1>
  <p><strong>跑在 Cloudflare 边缘的全栈论坛系统</strong></p>
  <p>Workers · Pages · D1 ＋ React SPA，自带积分经济、内容巡查与成就体系，免费额度内可零成本部署。</p>
  <p>
    <a href="https://github.com/ShenJunhao-awa/cloudforum/actions/workflows/deploy-v2.yml"><img src="https://github.com/ShenJunhao-awa/cloudforum/actions/workflows/deploy-v2.yml/badge.svg" alt="Deploy" /></a>
    <img src="https://img.shields.io/badge/Cloudflare-Workers%20%7C%20Pages%20%7C%20D1-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare" />
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" />
  </p>
</div>

> CloudForum 是一个完整的论坛应用：前端是 React SPA，后端是跑在 Cloudflare Workers 上的 Hono 应用，数据存在 D1（SQLite）里。请求经 Cloudflare Pages 全球加速，`/api/*` 转发给 Worker，其余路径返回 SPA。开箱即用，在 Cloudflare 免费额度内即可跑起一个功能完备的社区。

---

## ✨ 特性

**论坛核心** — 帖子（Markdown 编辑器 / 匿名 / 付费 / 装饰 / 置顶排序 / 全文搜索）· 多级评论 · 板块（校园板块、付费与感谢开关）· 关注与 Feed 流 · 收藏 · 私信 · 通知 · 浏览统计

**账户与安全** — 用户名/邮箱登录 · JWT ＋ Refresh Token（SHA-256 哈希存储）· PBKDF2 密码哈希（旧 bcrypt 自动升级）· 邮箱验证注册 · 找回密码 · 邀请码 · 账户注销冷静期 · 安全审计日志 · 分级限流

**积分经济** — 签到 · 发帖/评论/被赞奖励 · 转账（手续费 50% 销毁）· VIP 三档（含升级补差价）· 签到抽奖与积分抽奖（软硬保底）· 商城 · 道具仓库 · 红包 · 付费帖 · 每日任务 · 排行榜 · 月度累进税务

**内容治理** — AI 发帖审核（Worker 代理，fail-open）· 巡查体系 v2（多人复核、打回重编辑、巡查等级）· 已下架申诉 · 举报 · 管理后台（用户/内容/财务/设置全量管理）

**基础设施** — 每日定时任务（软删回收、日志与限流清理、排行榜重算等）· 推送通知 token 订阅 · GitHub Actions 自动构建部署

## 🧰 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 · TypeScript · Vite · TailwindCSS · React Router v6 · react-markdown |
| 后端 | Hono（Cloudflare Workers）· jose（JWT）· Web Crypto（PBKDF2）|
| 数据 | Cloudflare D1（SQLite）· FTS5 全文搜索 |
| 外部服务 | [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image) 图床 · AI 审核服务 · [Mailer Worker](https://github.com/ShenJunhao-awa/mailer-worker) 邮件服务 |
| CI/CD | GitHub Actions（类型检查 → 构建 → D1 迁移 → Worker/Pages 部署）|

## 🏗️ 架构

```
            用户 → forum.你的域名.com
                     ↓
          Cloudflare Pages（全球加速）
                     ↓
        ┌── /api/* ──→ Cloudflare Worker（Hono）
        │                ├─ D1 数据库（SQLite）
        │                ├─ 限流 / JWT 鉴权
        │                └─ JSON 响应
        └── 其他路径 → index.html（React SPA）
                        React Router 接管前端路由

  Cron（每日 00:00 UTC）→ 软删回收 / 日志清理 / 排行榜重算 …
```

## 🚀 快速开始（本地开发）

```bash
git clone https://github.com/ShenJunhao-awa/cloudforum.git && cd cloudforum
npm --prefix worker ci && npm --prefix frontend ci

# 终端 1：Worker（端口 8787，连接远程 D1）
npm --prefix worker run dev
# 终端 2：前端（Vite 代理 /api → localhost:8787）
npm --prefix frontend run dev
```

打开 http://localhost:5173 ，首个注册用户自动成为管理员。

> Worker 本地开发使用 `--remote` 连接你 Cloudflare 账号下的 D1，需先 `npx wrangler login`。本地密钥放在仓库根 `.dev.vars`（已被 `.gitignore` 忽略，不会提交）。

## ☁️ 部署

### 前置条件

1. [Cloudflare 账号](https://dash.cloudflare.com/)
2. Fork 本仓库
3. 部署 [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image) 到一个独立 Pages 项目作为图床

### 配置

`wrangler.jsonc` 中替换为你自己的 D1：创建数据库 `npx wrangler d1 create forum-db-v3`，把返回的 `database_id` 填入。`TELEGRAPH_IMAGE_URL` 改成你的图床地址，`FRONTEND_URL` 填前端域名（CORS 白名单，留空仅用于本地）。

通过 `wrangler secret put` 配置密钥：

| Secret | 必填 | 说明 |
|--------|:---:|------|
| `JWT_SECRET` | ✅ | JWT 签名密钥，建议 32 字符以上 |
| `JUDGE_API_KEY` | | AI 内容审核密钥 |
| `JUDGE_API_URL` | | AI 审核服务地址（完整 /api/judge 端点，如 https://your-ai-review.example.com/api/judge） |
| `MAILER_URL` / `MAILER_TOKEN` | | 邮件服务地址与鉴权 token；启用邮箱验证/找回密码时需要 |

前端构建变量（`frontend/.env` 或 Pages 环境变量）：`VITE_API_BASE`（API 地址，本地开发可不配）。

### 方式一：GitHub Actions（推荐）

在 Fork 仓库配置 Secrets：`CLOUDFLARE_API_TOKEN`（需 Workers + Pages + D1 权限）、`CLOUDFLARE_ACCOUNT_ID`。推送到 `main` 即自动构建并部署 Worker 与 Pages，含 D1 迁移。

### 方式二：手动部署

```bash
npx wrangler d1 migrations apply forum-db-v3 --remote   # 执行数据库迁移
npm --prefix worker run deploy                          # 部署 Worker
npm --prefix frontend run build                         # 构建前端
npx wrangler pages deploy frontend/dist --project-name=forum-frontend
```

在 Cloudflare Dashboard 绑定域名：Pages → `forum.你的域名.com`，Worker 路由 → `forum.你的域名.com/api/*`。

## 📡 API

后端按模块拆分为 30 个 handler，统一挂在 `/api/*` 下。主要模块：

| 前缀 | 模块 | 前缀 | 模块 |
|------|------|------|------|
| `/api/auth` | 认证 / 邮箱验证 / 找回密码 / 邀请码 | `/api/posts` | 帖子 / 付费帖 / 红包 |
| `/api/users` | 用户资料 | `/api/comments` | 多级评论 |
| `/api/categories` | 板块 | `/api/likes` · `/api/thanks` | 点赞 / 感谢 |
| `/api/follows` · `/api/bookmarks` | 关注 / 收藏 | `/api/messages` · `/api/notifications` | 私信 / 通知 |
| `/api/coins` · `/api/tips` | 积分 / 打赏 | `/api/check-in` · `/api/tasks` | 签到 / 每日任务 |
| `/api/lottery-coins` | 积分抽奖 | `/api/vip` · `/api/shop` · `/api/items` | VIP / 商城 / 道具 |
| `/api/decorations` | 帖子装饰 | `/api/leaderboard` · `/api/achievements` | 排行榜 / 成就墙 |
| `/api/review-content` | AI 内容审核 | `/api/moderation` · `/api/appeals` | 巡查 / 申诉 |
| `/api/reports` · `/api/unban` | 举报 / 自赎 | `/api/admin` | 管理后台 |
| `/api/upload` · `/api/stats` · `/api/push` | 上传 / 浏览统计 / 推送 | | |

> 完整接口定义见 [`worker/src/routes.ts`](worker/src/routes.ts) 与各 handler；数据库表结构见 [`worker/migrations/SCHEMA_SNAPSHOT.md`](worker/migrations/SCHEMA_SNAPSHOT.md)。

## 🧩 泛生项目

| 项目 | 说明 |
|------|------|
| [AI 审核服务](./ai-review/) | 内容安全审核 Worker（Workers AI Llama 3.1），供论坛发帖审核使用 |
| [Mailer Worker](./mailer-worker/) | 邮件微服务（Cloudflare Worker），密钥认证 ＋ SMTP 发送，供邮箱验证与找回密码使用 |

## 📚 文档

设计文档与规划见 [`docs/`](docs/)：认证安全、经济系统 v3、巡查体系 v2、邮箱验证、UI 规划等。

## 🤝 贡献

欢迎 Issue 与 PR。提交前请确保 `npm --prefix frontend run build`（含 TypeScript 类型检查）通过。

## 📄 License

[AGPL-3.0](LICENSE) © CloudForum。衍生或网络服务化部署均须以同等协议开源。
