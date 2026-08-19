import { Hono } from 'hono'

const app = new Hono()

interface JudgeRequest {
  title: string
  content: string
}

interface JudgeResponse {
  status: string
  verdict: "pass" | "flag"
  confidence: number
  reasons: string[]
  summary: string
}

app.post('/api/judge', async (c) => {
  try {
    const body: JudgeRequest = await c.req.json()
    
    // 基础验证
    if (!body.title || !body.content) {
      return c.json({ error: "title and content are required" }, 400)
    }

    // AI 审核逻辑（这里是模拟实现）
    // 实际使用时替换为真实的 Workers AI Llama 3.1 调用
    const verdict = await performAiReview(body.title, body.content)
    
    return c.json(verdict)
  } catch (error) {
    console.error("AI审核错误:", error)
    return c.json({ error: "内部服务器错误" }, 500)
  }
})

/**
 * AI 审核核心逻辑
 * 实际实现应使用 Workers AI + Llama 3.1
 */
async function performAiReview(title: string, content: string): Promise<JudgeResponse> {
  // 这里是模拟实现，实际项目中应该：
  // 1. 使用 @cloudflare/ai 包
  // 2. 调用 Llama 3.1 模型
  // 3. 实现具体的审核规则
  
  // 简单的示例审核逻辑
  const sensitiveWords = [
    "垃圾", "废物", "滚蛋", "死", "杀", "暴力", "色情", 
    "广告", "推广", "免费", "赚钱", "兼职"
  ]
  
  const titleLower = title.toLowerCase()
  const contentLower = content.toLowerCase()
  
  const foundViolations: string[] = []
  
  sensitiveWords.forEach(word => {
    if (titleLower.includes(word) || contentLower.includes(word)) {
      foundViolations.push(`包含敏感词: ${word}`)
    }
  })
  
  if (foundViolations.length > 0) {
    return {
      status: "success",
      verdict: "flag",
      confidence: 0.85,
      reasons: foundViolations,
      summary: "内容包含敏感词汇，可能违反社区规范"
    }
  }
  
  return {
    status: "success",
    verdict: "pass",
    confidence: 0.95,
    reasons: [],
    summary: "内容审核通过"
  }
}

// 健康检查接口
app.get('/health', (c) => {
  return c.json({ 
    status: "ok", 
    service: "cloudforum-ai-review",
    version: "1.0.0"
  })
})

export default app