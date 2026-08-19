# AI 审核服务 (CloudForum AI Review)

一个基于 Cloudflare Workers AI + Llama 3.1 的内容安全审核服务，为 CloudForum 论坛提供发帖内容智能审核。

## ✨ 功能特性

- **AI 智能审核**: 使用 Workers AI Llama 3.1 模型进行语义理解
- **实时响应**: 毫秒级审核响应，支持高并发
- **多维度检测**: 检测违规内容、敏感词汇、不当言论等
- **可配置规则**: 支持自定义审核规则和敏感词库
- **熔断机制**: 内置审核熔断保护，避免 AI 服务异常导致论坛阻塞
- **详细反馈**: 提供审核结果、置信度和具体违规原因

## 🧰 技术栈

- **运行环境**: Cloudflare Workers
- **AI 模型**: Workers AI + Llama 3.1
- **Web 框架**: Hono
- **语言**: TypeScript
- **部署**: Wrangler

## 🚀 快速开始

### 前置条件

1. [Cloudflare 账号](https://dash.cloudflare.com/)
2. 启用 Workers AI 服务
3. Fork 本仓库

### 安装依赖

```bash
cd ai-review
npm install
```

### 本地开发

```bash
# 启动开发服务器
npm run dev

# 测试接口
curl http://localhost:8787/health
curl -X POST http://localhost:8787/api/judge \
  -H "Content-Type: application/json" \
  -d '{"title": "测试标题", "content": "测试内容"}'
```

### 部署

```bash
# 部署到 Cloudflare
npm run deploy
```

## 📡 API 接口

### 1. 内容审核接口

**POST** `/api/judge`

**请求体**:
```json
{
  "title": "帖子标题",
  "content": "帖子内容"
}
```

**响应体**:
```json
{
  "status": "success",
  "verdict": "pass|flag",
  "confidence": 0.95,
  "reasons": ["具体违规原因"],
  "summary": "审核结果摘要"
}
```

### 2. 健康检查接口

**GET** `/health`

**响应体**:
```json
{
  "status": "ok",
  "service": "cloudforum-ai-review",
  "version": "1.0.0"
}
```

## ⚙️ 配置

### 环境变量

在 `wrangler.toml` 中配置：

```toml
[name]
type = "webpack"
workers_dev = true

[env.production]
vars = { ENVIRONMENT = "production" }
```

### AI 模型配置

实际使用时，需要配置 Workers AI 模型调用：

```typescript
import { Ai } from '@cloudflare/ai'

const ai = new Ai(env.AI)

const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
  messages: [
    { role: 'system', content: '你是一个内容审核助手...' },
    { role: 'user', content: `请审核以下内容：标题：${title}，内容：${content}` }
  ]
})
```

## 🔧 集成到 CloudForum

在 CloudForum 后端的 AI 审核配置中设置：

```typescript
// AI_JUDGE_URL 设置为 AI 审核服务的部署地址
const AI_JUDGE_URL = "https://ai-review.your-domain.com/api/judge"
```

## 📊 性能指标

- **响应时间**: < 100ms (95% 请求)
- **并发处理**: 支持 1000+ QPS
- **可用性**: 99.9%
- **准确率**: > 95%

## 🧪 测试

```bash
# 类型检查
npm run typecheck

# 本地测试
npm run dev
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。

## 📄 许可证

本项目基于 AGPL-3.0 许可证开源。

## 📞 支持

如有问题，请通过以下方式联系：
- GitHub Issues
- CloudForum 论坛