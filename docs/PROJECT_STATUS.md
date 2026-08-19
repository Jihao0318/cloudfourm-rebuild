# CloudForum 项目状态与交接文档

> 更新：2026-08-11 ｜ 目的：上下文压缩/新会话恢复用
> 项目：校园论坛（Cloudflare Workers + React），**已上线在即**（领导验收项目）

---

## 1. 项目概览

| 项 | 值 |
|---|---|
| 路径 | `/home/joyce/workspace/cloudfourm-rebuild`（git 根在上级 `/home/joyce/workspace`，本目录**整体 untracked**，从未提交过） |
| 后端 | Cloudflare Workers + Hono 4 + D1（SQLite） |
| 前端 | React 18 + Vite 5 + Tailwind 3 + react-router 6（无状态库，手写 useEffect + api 模块） |
| 数据库 | D1 `forum-db`，**56 个迁移**（worker/migrations/，最新 055_email_verify.sql） |
| 文档 | `docs/economy-v3-plan.md`（经济系统 v3 计划书，设计已确认待实施） |

## 2. 本地运行（demo）

| 服务 | 命令 | 地址 |
|---|---|---|
| worker | `cd /home/joyce/workspace/cloudfourm-rebuild && npx wrangler dev --local --port 8787` | :8787 |
| 前端 | `cd frontend && npx vite dev --port 5174` | :5174（5173 被用户另一项目占用） |
| 测试账号 | alice `7654321@qq.com` / `Ab123456`（admin）；bob `8888888@qq.com` / `Bc123456`（moderator） | |
| 关键文件 | `.dev.vars`（JWT_SECRET，仅本地）；5173 端口有用户旧项目 vite，勿动 | |

**部署**：`wrangler d1 migrations apply forum-db --remote` → `wrangler deploy` → 前端 `vite build` + pages deploy。

## 3. 已完成功能（近期全部改动）

### 3.1 校园论坛改造（14 任务计划落地到本项目）
- 8 个校园板块（categories 表）：站务公告/校园生活/学习交流/二手市场/失物招领/社团活动/表白墙(允许匿名)/水区杂谈；遗留 3 个通用分类 is_active=0
- 匿名发帖：表白墙可匿名，前台**一律显示「匿名同学」**（含管理员）；**管理后台帖子列表显示真实作者 + 🕶️匿名标签**（listPosts 的 rawAuthors 选项）
- 公告横幅：settings `announcement` 键，全站 header 下展示
- 权限矩阵：admin 全权限（删任意帖/评论）；moderator（巡查员）仅 posts/comments/reports 审核，无删除权
- 付费帖：板块开关 `allow_paid`（默认仅二手市场），匿名帖禁付费
- 巡查台 `/moderator`（独立页面）：举报审核/帖子巡查/评论巡查/概览
- 后台 `/admin` 侧边栏布局（14 面板：概览/帖子/评论/置顶/举报/板块/用户/解封/积分/VIP/税务已删/抽奖/设置/邀请码）

### 3.2 经济系统优化（审计+修复）
- ❌ **税务系统已删**（handler/结算/路由/前端全链路，表保留）
- ❌ **签到抽奖已取消**（lottery.ts 删，曾含 2% 终身 SVIP+ 漏洞；签到纯积分）
- 积分抽奖保留（lottery-coins.ts），**全部数值后台可配**（价格/概率/保底，admin PUT /admin/lottery + 奖品 CRUD）
- 初始积分可配（settings `default_user_coins`，兜底 100）
- 大喇叭限频：每日 1 次（coin_transactions `announce_use` 计数）
- **解封自赎链路打通**：requireAuth 豁免 `/api/auth/me`（被封禁用户保持登录态）；封禁带原因（`users.ban_reason`，迁移 049）；驳回后 **3 天冷却**（unban.ts 查最近 rejected 的 reviewed_at）
- 模拟器 `/tmp/econ_sim.py`：180 天经济模拟，参数可跑 v2/v2full/v3

### 3.3 已修复的存量 bug
- **Hono 父级 `app.use('/api/xxx*', middleware)` 对子应用失效**（admin 守卫、posts 列表 optionalAuth 均已改为路由内联）——新路由必须内联中间件
- 新库缺列：迁移 045/046 补 `users.custom_title/banner_url/nick_theme`（生产曾手工 ALTER）
- 匿名帖详情泄露 `owner_user_id`：已剥离
- 抽奖软保底校验：按最终值（软<硬）

## 4. 已实施：经济 v3 + 商店重设计（2026-08-12 全部完成并验证）

### 4.1 经济系统 v3（docs/economy-v3-plan.md 全量落地）
- **经验等级**：users.exp（迁移 050）+ utils/game.ts（levelFromExp 30 级校园称号、addExp 升级礼包每级+50、last_rewarded_level 防重复）；经验来源：发帖+5/评论+2/被赞+1/签到+10/被感谢+5
- **每日任务**：handlers/tasks.ts（GET /tasks/today、POST /tasks/claim、POST /tasks/claim-bonus）；3 任务（发帖+8分15exp/评论2条+4分10exp/被赞+4分10exp）+ 全勤宝箱+14；钩子幂等（daily_tasks UNIQUE）
- **成就**：handlers/achievements.ts + 6 成就（初来乍到50/人气王200/笔耕不辍300/全勤王300/热心肠200/欧皇100），一次性（achievements UNIQUE）
- **感谢**：handlers/thanks.ts（免费日限5、UNIQUE 防重复、被谢+1exp、thanks_count 列、成就钩子）
- **经济底座**：抽奖 40/360（settings 覆盖 048 旧值）、奖池全换（EV≈32 负期望，改名卡移除）、举报改"有效处理+10"（admin resolve）、点赞日限20、VIP签到加成 2/3/5、初始积分 200、转账手续费 100% 燃烧（删 admin 归集）
- **前端**：/tasks 任务面板（Tasks.tsx）、Profile 等级徽章+进度条+成就墙、Home/PostDetail 作者等级、PostDetail 感谢按钮、utils/level.ts 前端等级计算

### 4.2 商店 & 装饰体系重设计（全量落地，经验加成卡按约定未做）
- **在售 12 个**：shop_items 3（改名卡1000/边框500/鎏金1500）+ shop_extras 9（自定义称号800/头像框30天1200/炫彩标题7天300/提升卡50/高亮卡80/置顶卡24h500/红包卡300/匿名卡200/背景卡400）
- **下架 4 个**：炫彩昵称/彩色评论框/旧置顶卡/隐身卡（shop_extras is_active=0，软下架不删库存）
- **新增 4 卡**：红包卡（red_packets 表+评论原子抢+red_packet_claims 每人限一包+作者不能抢）、匿名卡（非匿名板块匿名发帖消耗）、置顶卡（use/pin-top 24h）、背景卡（posts.post_bg_id 1-6+use/post-bg+active-effects/cancel）
- **关键架构决策**：shop_items 的 CHECK 无法修改 → **所有新商品走 shop_extras**（购买→user_lottery_items，items.ts use 端点双表查询天然兼容）；shop.ts buy 把 duration_days 写入 item_meta
- **时长可配置**：avatar-frame/custom-title/rainbow-title 读卡面 duration_days（商城 30天/10天/7天，奖池按 value）；posts.title_effect_expires_at（迁移 052）供炫彩过期判断
- **前端**：Shop 已拥有判断改 items.myItems（type 匹配）、Warehouse 置顶/背景使用弹窗+红包/匿名卡提示、CreatePost 挂红包+背景选择+匿名卡提示、PostDetail 红包卡片+抢红包 toast+背景渲染、Home 卡片背景+炫彩过期、utils/postBg.ts 6 背景

### 4.3 验证结果（2026-08-12）
- 迁移 050-053 全部应用 ✅（注意 051 因 FK 改 shop_extras 方案；053 补 shop_items.is_active 列）
- 前端 tsc 0 错误 + vite build ✅
- 端到端冒烟测试 **25/25 通过**（/tmp/smoke_v3.py：任务/成就/感谢/商店/红包全链路/匿名卡/置顶/背景/转账全燃烧/抽奖价格奖池/等级）
- 经济模拟器 v3 对照 **与计划书一致**：人均 4,184、抽奖 -8.6万、商城 102万、0 刷分、0 admin 沉淀、改名卡 233/300
- 遗留说明：升级礼包对存量用户不补发（exp 列 050 才加，全部为 0，无历史积累）；lottery-coins 的 giveItem/ensureShopItem 死代码已删

## 4.4 登录安全修复（2026-08-12 已实施，方案见 docs/auth-security-plan.md）
- **迁移 054**：users.token_version、login_attempts（账号锁定）、security_logs（审计）
- **会话吊销**：JWT payload 精简为 {userId, username, ver}；requireAuth 校验 token_version——改密/改邮箱/重放检测即时踢掉全部旧会话；前端登出调后端 + 清 refresh_token
- **登录锁定**：连续 5 次失败锁 15 分钟、10 次锁 30 分钟（login_attempts）；限流 5/min/IP + Retry-After（原子 UPSERT 计数，认证端点 failClosed）
- **refresh 轮换 + 重放检测**：每次 refresh 删旧发新；旧 token 复用 → 吊销该用户全部会话（security_logs 审计兜底）
- **邀请码原子占码**（used_by=-1 占位防一码多用）+ **INITIAL_ADMIN_EMAIL**（env 匹配才提权 admin，上线前必须设置）
- **XSS 消毒**：帖/评论/预览统一 rehype-sanitize 白名单（iframe 仅 YouTube/Bilibili 官方域名，src 校验 https）；index.html 加 CSP
- **AI 审核密钥后移**：/api/review-content 代理（密钥 wrangler secret JUDGE_API_KEY，未配置 fail-open）
- **admin 新增**：重置密码（PUT /admin/users/:id/reset-password 返回一次性临时密码）+ 安全日志面板（GET /admin/security-logs）
- **CORS**：FRONTEND_URL 配置后白名单 403 + Vary（上线前把前端域名写入 wrangler.jsonc）
- 验证：迁移应用 ✓ esbuild ✓ 前端 tsc 0 错误 ✓ 认证冒烟 22/23（偶发失败为测试脚本与 5/min 限流时序竞争，关键链路均已独立复现 PASS）✓ v3 回归 25/25 ✓
- ⚠️ **上线注意事项**：部署后所有存量 JWT 无 ver 立即失效（全员需重新登录，正常现象）；必须设置 INITIAL_ADMIN_EMAIL 和 FRONTEND_URL；bob 密码测试后已恢复 Bc123456

### 4.5 邮件功能：密码重置 forgot/reset（2026-08-12 已实施）
- **邮件服务**：mail.your-domain.com（Cloudflare Worker mailer，SMTP smtp.qq.com:465，发件人固定 noreply@your-domain.com，额度约 100 封/天，勿发营销/批量）
- **鉴权**：每次请求带 `Authorization: Bearer <token>`（常数时间比较）；token 存 env `MAILER_TOKEN`（本地 .dev.vars，生产 wrangler secret put），源码不落明文
- **新端点**：POST /api/auth/forgot（6 位验证码邮件，10 分钟有效，**统一响应防枚举**——用户不存在也返回成功）；POST /api/auth/reset（验码改密 + token_version+1 踢全部会话 + security_log）；限流 forgot 5min/3、reset 5min/5
- **前端**：/forgot-password 页（两步：邮箱→验证码+新密码→成功），Login 页"忘记密码？"入口
- **工具**：worker/src/utils/mailer.ts（sendMail：env 读 URL/token、https+私网校验、15s 超时、失败仅记日志不暴露）
- 验证：forgot 真实发信 ✓ 防枚举 ✓ 错误码拒绝 ✓ 重置成功 ✓ 旧 token 失效 ✓ 新密码登录 ✓（测试后 alice 密码已恢复 Ab123456）
- ⚠️ 注意：mailer-worker 本地调试也用 8787 端口，与论坛 worker 冲突——**不要同时起**；论坛 worker 需要 8787 时先停 mailer dev（本次已处理）

### 4.6 邮箱验证全链路（2026-08-12 已实施，方案见 docs/email-verification-plan.md）
- **迁移 055**：verifications 重建（加 data 列暂存待改邮箱 + 新类型 password_change）
- **改邮箱两步验证**：POST /auth/email/request（旧密码+新邮箱→发码到新邮箱，data 暂存）→ POST /auth/email/verify（验码→改邮箱+踢会话+通知旧邮箱）；旧 PUT /auth/email 已删
- **改密码两步验证**：POST /auth/password/request（旧密码→发码到注册邮箱）→ POST /auth/password/verify（验码→改密+踢会话+删refresh+通知）；旧 PUT /auth/password 已删
- **注册邮箱验证（策略 A 宽松）**：注册不再自动 email_verified=1，注册后发 60 分钟验证码；POST /auth/email/verify-register（验码置1）+ POST /auth/email/resend（重发）；资料页显示未验证徽章（前端 Profile）
- **限流**：request/verify/resend 全部 300s/5（resend 3），failClosed；verify-register 与 verify 共享前缀桶（限流更严，无安全问题）
- **注意**：validateEmail 仅接受纯数字 QQ 号（5-11 位 @qq.com）——测试邮箱必须是真实格式
- 验证：迁移应用 ✓ esbuild ✓ 前端 tsc 0 错误 ✓ **冒烟 20/20**（改邮箱/改密码全链路含踢会话/通知/防枚举/限流；测试后 alice 邮箱与密码已恢复原值）
- ⚠️ 前端已验证：Profile 改邮箱/改密码两步表单 + 邮箱验证徽章 + Register 成功提示

## 5. 关键技术约定与坑（改代码必读）

1. **响应格式**：`{ success, data?, total?, page?, pageSize?, error?, message? }`；预期错误直接 `c.json` 返回，**绝不 throw**（throw 进 onError 变通用 500）
2. **中间件必须内联**在路由上（`posts.get('/', optionalAuth, ...)`）——父级 `app.use` 对本项目子应用无效
3. **权限**：`requireAuth`（c.get('user')=JWT、c.get('dbUser')=DB行）；`requireAdmin`=admin+moderator；`requireAdminRole`=仅 admin；admin 路径守卫在 admin.ts 顶部（mod 仅 posts/comments/reports）
4. **每日限制**：一律 UTC+8 业务日窗（照抄 coins.ts canEarnToday 的 startStr/endStr 计算）
5. **积分变动**：`UPDATE ... AND coins >= ?` + `meta.changes` 校验 + 单 `db.batch` 写余额与流水
6. **时间戳**：D1 存 'YYYY-MM-DD HH:MM:SS' UTC 字符串；比较用 `datetime('now')`
7. **迁移编号**：最新 049；SQLite 不能改 CHECK/列，需重建表（注意外键）
8. **worker tsc 有 ~240 个存量类型错误**（全项目 Hono Variables 未声明），**正常现象**，部署走 wrangler esbuild 不查类型；前端 tsc 必须零错误
9. **登录/注册限流**：login 5/min、register 3/h——测试脚本连发会 429，注意间隔
10. **d1 execute --local 会被 dev worker 锁住**卡死——需先停 dev 或用迁移文件查 seed
11. **删除文件后 vite dev 可能白屏**（HMR 状态损坏）——重启 vite 即可，代码无问题
12. **模拟器**：`/tmp/econ_sim.py 180 300 [v2|v2full|v3]`——经济平衡验证工具，改数值后用它对照

## 6. 文档索引

| 文档 | 内容 |
|---|---|
| `docs/economy-v3-plan.md` | 经济系统 v3 完整计划（四引擎+数值+实施阶段） |
| 本文件 | 项目状态与交接 |

## 7. 用户沟通要点（重要偏好）

- 用户是学生/校园论坛运营者，**喜欢先看方案再实施**（每次大改都先出方案确认）
- 敏感：改动幅度大时会被质疑（"廉价感"教训）——**小步、可逆、先方案**
- 领导验收项目，**要部署**：迁移+打包+行为测试是硬门槛
- 中文交流；对经济系统数值极度在意（多次要求模拟验证）
