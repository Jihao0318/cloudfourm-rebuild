import { Hono } from 'hono'

const app = new Hono()

interface SendPayload {
  to: string | string[]
  subject: string
  text?: string
  html?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  fromName?: string
}

interface Env {
  SMTP_USER: string
  SMTP_PASSWORD: string
  SMTP_HOST: string
  SMTP_PORT: number
  MAILER_API_TOKEN: string
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function authOk(header: string | null, token: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false
  const given = header.slice(7).trim()
  return timingSafeEqual(given, token)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

// 邮件发送处理
app.post('/api/send', async (c) => {
  const env = c.env as Env

  // API 密钥认证
  const authHeader = c.req.header("Authorization")
  if (!authOk(authHeader, env.MAILER_API_TOKEN)) {
    return json({ error: "unauthorized" }, 401)
  }

  let payload: SendPayload
  try {
    payload = await c.req.json()
  } catch {
    return json({ error: "invalid json body" }, 400)
  }

  // 基础验证
  if (!payload.to || !payload.subject) {
    return json({ error: "to and subject are required" }, 400)
  }

  try {
    // 构建邮件数据
    const emailData: Record<string, unknown> = {
      from: {
        email: env.SMTP_USER,
        name: payload.fromName || "CloudForum"
      },
      to: payload.to,
      subject: payload.subject
    }

    if (payload.text) emailData.text = payload.text
    if (payload.html) emailData.html = payload.html
    if (payload.cc) emailData.cc = payload.cc
    if (payload.bcc) emailData.bcc = payload.bcc
    if (payload.replyTo) emailData.replyTo = payload.replyTo

    // 这里应该使用实际的 SMTP 客户端
    // 实际实现可以使用 nodemailer 或其他 SMTP 库
    const result = await sendEmailViaSMTP(emailData, env)

    return json({ 
      success: true, 
      message: "邮件发送成功",
      messageId: result.messageId 
    })
  } catch (error) {
    console.error("邮件发送错误:", error)
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "邮件发送失败" 
    }, 500)
  }
})

// 健康检查接口
app.get('/health', (c) => {
  return c.json({ 
    status: "ok", 
    service: "cloudforum-mailer-worker",
    version: "1.0.0"
  })
})

// 模拟 SMTP 发送（实际项目需要替换为真实的 SMTP 实现）
async function sendEmailViaSMTP(emailData: Record<string, unknown>, env: Env) {
  // 这里应该是实际的 SMTP 发送逻辑
  // 例如使用 nodemailer 或其他 SMTP 库
  return {
    success: true,
    messageId: Math.random().toString(36).substr(2, 9)
  }
}

export default app