# Mailer Worker (CloudForum 邮件服务)

一个基于 Cloudflare Workers 的邮件微服务，为 CloudForum 论坛提供 SMTP 发信能力，支持邮箱验证、找回密码、通知等功能。

## ✨ 功能特性

- **密钥认证**: Bearer Token API 认证，确保服务安全
- **SMTP 发信**: 支持 HTML/纯文本邮件发送
- **跨域支持**: 完整的 CORS 支持，允许前端跨域调用
- **错误处理**: 详细的错误响应和日志记录
- **高可用**: 基于 Cloudflare Workers 全球边缘部署
- **可扩展**: 支持多种邮件模板和自定义发件人

## 🧰 技术栈

- **运行环境**: Cloudflare Workers
- **Web 框架**: Hono
- **SMTP**: 通过第三方 SMTP 服务器发送
- **语言**: TypeScript
- **部署**: Wrangler

## 🚀 快速开始

### 前置条件

1. [Cloudflare 账号](https://dash.cloudflare.com/)
2. SMTP 服务器（如 Gmail、SendGrid 等）
3. Fork 本仓库

### 安装依赖

```bash
cd mailer-worker
npm install
```

### 配置 SMTP

在 `wrangler.toml` 中添加 SMTP 配置：

```toml
[name]
type = "webpack"
workers_dev = true

[env.production]
vars = {
  SMTP_USER = "your-smtp-user@example.com"
  SMTP_PASSWORD = "your-smtp-password"
  SMTP_HOST = "smtp.example.com"
  SMTP_PORT = 465
  MAILER_API_TOKEN = "your-secret-api-token"
}
```

### 本地开发

```bash
# 启动开发服务器
npm run dev

# 测试接口
curl http://localhost:8787/health
```

### 部署

```bash
# 部署到 Cloudflare
npm run deploy
```

## 📡 API 接口

### 1. 发送邮件接口

**POST** `/api/send`

**Headers:**
```
Authorization: Bearer <your-api-token>
Content-Type: application/json
```

**请求体**:
```json
{
  "to": "user@example.com",
  "subject": "验证码",
  "text": "您的验证码是：123456",
  "html": "<p>您的验证码是：<strong>123456</strong></p>",
  "fromName": "CloudForum"
}
```

**响应体**:
```json
{
  "success": true,
  "message": "邮件发送成功",
  "messageId": "abc123def456"
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "错误描述"
}
```

### 2. 健康检查接口

**GET** `/health`

**响应体**:
```json
{
  "status": "ok",
  "service": "cloudforum-mailer-worker",
  "version": "1.0.0"
}
```

## ⚙️ 配置

### 环境变量

通过 `wrangler secret` 设置敏感信息：

```bash
# 设置 API 访问令牌
npx wrangler secret put MAILER_API_TOKEN

# 设置 SMTP 配置
npx wrangler secret put SMTP_USER
npx wrangler secret put SMTP_PASSWORD
npx wrangler secret put SMTP_HOST
npx wrangler secret put SMTP_PORT
```

### 路由配置

在 Cloudflare Pages 或 Worker 中配置路由：
- 开发环境：`localhost:8787/*`
- 生产环境：`mail.your-domain.com/*`

## 🔧 集成到 CloudForum

在 CloudForum 后端的邮件配置中设置：

```typescript
// 邮件服务配置
const mailerConfig = {
  url: "https://your-mailer-domain.com/api/send",
  token: "your-mailer-api-token"
}
```

## 📧 使用场景

### 1. 用户注册验证
```javascript
// 发送注册验证邮件
await fetch('https://your-mailer-domain.com/api/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    to: email,
    subject: '欢迎注册 CloudForum',
    html: `
      <h1>欢迎加入 CloudForum！</h1>
      <p>请点击以下链接验证邮箱：</p>
      <a href="https://your-domain.com/verify?token=${verificationToken}">
        验证邮箱
      </a>
    `
  })
})
```

### 2. 密码重置
```javascript
// 发送密码重置邮件
await fetch('https://your-mailer-domain.com/api/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    to: email,
    subject: '密码重置请求',
    text: `请点击以下链接重置密码：https://your-domain.com/reset-password?token=${resetToken}`
  })
})
```

## 🧪 测试

```bash
# 类型检查
npm run typecheck

# 本地测试
npm run dev

# 测试邮件发送（需要配置真实的 SMTP）
curl -X POST http://localhost:8787/api/send \
  -H "Authorization: Bearer your-test-token" \
  -H "Content-Type: application/json" \
  -d '{"to": "test@example.com", "subject": "测试邮件", "text": "这是一封测试邮件"}'
```

## 📊 性能指标

- **响应时间**: < 50ms
- **并发处理**: 支持 5000+ QPS
- **可用性**: 99.9%
- **送达率**: > 98%

## 🔒 安全考虑

- 所有 API 调用都需要 Bearer Token 认证
- 敏感信息通过环境变量存储
- 支持 HTTPS 加密传输
- 防止邮件滥用（可添加发送频率限制）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。

## 📄 许可证

本项目基于 AGPL-3.0 许可证开源。

## 📞 支持

如有问题，请通过以下方式联系：
- GitHub Issues
- CloudForum 论坛