# 项目结构说明

CloudForum 是一个完整的多项目开源社区，包含主论坛系统、AI 审核服务和邮件微服务三个核心组件。

## 📁 目录结构

```
cloudfourm-rebuild/
├── README.md                    # 主项目 README
├── LICENSE                      # AGPL-3.0 许可证
├── package.json                 # 主项目依赖
├── wrangler.jsonc               # Cloudflare 配置
├── deploy.sh                    # 部署脚本
├── .github/                     # GitHub 配置
│   └── workflows/               # CI/CD 工作流（已移除自动部署）
├── docs/                       # 项目文档
├── frontend/                   # React 前端应用
│   ├── src/
│   │   ├── components/          # React 组件
│   │   ├── pages/              # 页面组件
│   │   ├── contexts/           # React Context
│   │   ├── services/           # API 服务
│   │   └── utils/              # 工具函数
│   ├── public/                 # 静态资源
│   └── package.json
├── worker/                     # Cloudflare Workers 后端
│   ├── src/
│   │   ├── handlers/           # API 处理器
│   │   ├── middleware/         # 中间件
│   │   ├── utils/              # 工具函数
│   │   └── types/              # TypeScript 类型定义
│   ├── migrations/              # 数据库迁移文件
│   └── package.json
├── ai-review/                  # 🔍 AI 内容审核服务
│   ├── README.md               # AI 服务说明
│   ├── src/
│   │   └── index.ts            # AI 审核主程序
│   ├── package.json            # AI 服务依赖
│   ├── tsconfig.json          # TypeScript 配置
│   └── wrangler.toml          # Cloudflare 部署配置
└── mailer-worker/              # 📧 邮件微服务
    ├── README.md               # 邮件服务说明
    ├── src/
    │   └── index.ts            # 邮件发送主程序
    ├── package.json            # 邮件服务依赖
    ├── tsconfig.json          # TypeScript 配置
    └── wrangler.toml          # Cloudflare 部署配置
```

## 🎯 核心组件

### 1. CloudForum 主系统 (`./`)
完整的论坛应用，包含：
- React SPA 前端
- Hono 后端 API
- D1 数据库
- 积分经济系统
- 内容巡查体系
- 用户管理系统

**主要功能**:
- 帖子发布与管理（支持 Markdown）
- 多级评论系统
- 用户认证与权限管理
- 私信与通知
- 成就系统
- 商城与道具

### 2. AI 审核服务 (`./ai-review/`)

基于 Workers AI + Llama 3.1 的智能内容审核服务。

**主要功能**:
- 自动检测违规内容
- 智能语义理解
- 审核结果反馈
- 可配置审核规则

**API 接口**:
- `POST /api/judge` - 内容审核
- `GET /health` - 服务健康检查

### 3. 邮件微服务 (`./mailer-worker/`)

基于 Cloudflare Workers 的 SMTP 邮件发送服务。

**主要功能**:
- 邮箱验证码发送
- 密码重置邮件
- 系统通知邮件
- HTML/纯文本支持

**API 接口**:
- `POST /api/send` - 发送邮件
- `GET /health` - 服务健康检查

## 🔗 项目间依赖关系

```
CloudForum 主系统
    ├── 依赖 AI 审核服务进行内容审核
    ├── 依赖 邮件微服务发送通知
    ├── 依赖 Telegraph-Image 作为图床
    └── 依赖独立的 AI 审核后端（如部署）
```

## 🚀 部署架构

### 单仓库部署
所有三个服务都部署在同一个 GitHub 仓库中，便于统一管理和维护。

### 独立部署
每个服务也可以独立部署到不同的 Cloudflare 账号或域名：

```bash
# 部署主系统
npm run deploy

# 部署 AI 审核服务
cd ai-review && npm run deploy

# 部署邮件服务
cd mailer-worker && npm run deploy
```

### 路由配置
- 主系统：`forum.your-domain.com/*`
- AI 服务：`ai-review.your-domain.com/*`  
- 邮件服务：`mail.your-domain.com/*`

## 📚 快速导航

- **主项目说明**: [README.md](./README.md)
- **AI 审核服务**: [ai-review/README.md](./ai-review/README.md)
- **邮件服务**: [mailer-worker/README.md](./mailer-worker/README.md)
- **设计文档**: [docs/](./docs/)
- **API 文档**: [`worker/src/routes.ts`](./worker/src/routes.ts)

## 🔧 开发建议

1. **统一开发环境**: 所有服务都使用相同的 Node.js 版本（推荐 v20+）
2. **类型安全**: 所有服务都使用 TypeScript，确保类型安全
3. **测试覆盖**: 建议为每个服务编写单元测试和集成测试
4. **文档同步**: 保持各组件文档的一致性和更新

## 🤝 贡献指南

欢迎为任何组件提交 Issue 和 Pull Request。在提交前请确保：

1. 遵循项目的代码风格
2. 更新相关文档
3. 添加必要的测试
4. 通过所有类型检查

## 📄 许可证

所有组件都基于 AGPL-3.0 许可证开源。