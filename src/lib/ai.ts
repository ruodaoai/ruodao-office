import type { AiConfig, AiMessage, AiProviderId } from '../types'
import { t } from '../i18n'
import { useAuth } from '../store/auth'

export interface ProviderPreset {
  id: AiProviderId
  name: string
  baseUrl: string
  model: string
  hint: string
  needsKey: boolean
  cloud?: boolean
}

export const AI_PRESETS: ProviderPreset[] = [
  {
    id: 'ruodao',
    name: '若道云端',
    baseUrl: '',
    model: '',
    hint: '用若道账户登录，直接调用云端模型并计入账户额度',
    needsKey: false,
    cloud: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '性价比高，中文写作稳定',
    needsKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '通用能力强，支持流式输出',
    needsKey: true,
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: '长文本中文理解',
    needsKey: true,
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    hint: '国内访问稳定',
    needsKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama 本地',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    hint: '模型跑在本机，完全离线',
    needsKey: false,
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    model: '',
    hint: '任意 OpenAI 兼容端点',
    needsKey: true,
  },
]

export function presetOf(id: AiProviderId): ProviderPreset | undefined {
  return AI_PRESETS.find((p) => p.id === id)
}

export const AI_SYSTEM_PROMPT = `你是「若道办公」内置的文档助手。默认使用简体中文，直接、准确、可执行，不寒暄、不复述问题。
- 涉及文档内容时，只依据用户提供的上下文，不编造事实。
- 输出适合直接粘贴进文档的 Markdown，除非用户另有要求。
- 改写、续写时保持原文语气与术语一致；总结时先给结论，再给要点。`

export function contextBlock(context: { title: string; text: string } | null, limit = 7000): string | null {
  if (!context || !context.text.trim()) return null
  const text = context.text.length > limit ? `${context.text.slice(0, limit)}\n\n[内容过长，已截断]` : context.text
  return `以下是用户当前打开的内容《${context.title}》，请在需要时参考：\n\n<<<CONTENT\n${text}\nCONTENT>>>`
}

function endpointOf(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '')
  if (!clean) throw new Error(t('请先填写 API 地址'))
  if (clean.endsWith('/chat/completions')) return clean
  return `${clean}/chat/completions`
}

export interface StreamOptions {
  config: AiConfig
  messages: AiMessage[]
  system?: string
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

export async function streamChat({ config, messages, system = AI_SYSTEM_PROMPT, signal, onDelta }: StreamOptions): Promise<string> {
  if (!config.model.trim()) {
    throw new Error(
      config.provider === 'ruodao' ? t('请先在设置中选择一个云端模型') : t('请先填写模型名称'),
    )
  }
  const cloud = config.provider === 'ruodao'
  const payload = JSON.stringify({
    model: config.model.trim(),
    stream: true,
    temperature: 0.6,
    messages: [
      { role: 'system', content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  })

  let response: Response
  try {
    if (cloud) {
      response = await useAuth.getState().authorizedFetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: payload,
      })
    } else {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`
      response = await fetch(endpointOf(config.baseUrl), { method: 'POST', headers, signal, body: payload })
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    const message = (err as Error).message || ''
    if (cloud && (message.includes('若道') || message.includes('登录'))) throw new Error(message)
    throw new Error(
      cloud
        ? t('无法连接若道云端，请检查网络或若道服务地址。')
        : t('无法连接到 {target}，请检查地址与网络。', {
            target: config.provider === 'ollama' ? t('本地 Ollama') : t('模型服务'),
          }),
    )
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.error?.message ?? body?.message ?? ''
    } catch {
      /* ignore */
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(cloud ? t('若道登录已过期，请重新登录。') : t('鉴权失败，请检查 API Key。'))
    }
    if (response.status === 402) {
      throw new Error(t('若道账户余额不足，请先在若道充值，或切换到本地 / 自有 Key 模型。'))
    }
    if (response.status === 404) {
      throw new Error(t('接口或模型不存在（{model}），请检查配置。', { model: config.model }))
    }
    if (response.status === 429) throw new Error(t('请求过于频繁，请稍后再试。'))
    throw new Error(
      detail
        ? t('模型返回错误：{detail}', { detail })
        : t('模型服务返回 {status}', { status: response.status }),
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!response.body || contentType.includes('application/json')) {
    const data = await response.json()
    const text: string = data?.choices?.[0]?.message?.content ?? ''
    if (text) onDelta?.(text)
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const delta: string =
          json?.choices?.[0]?.delta?.content ??
          json?.choices?.[0]?.message?.content ??
          json?.message?.content ??
          ''
        if (delta) {
          full += delta
          onDelta?.(delta)
        }
      } catch {
        /* partial json – ignored until next chunk */
      }
    }
  }
  if (!full.trim()) throw new Error(t('模型没有返回内容，请检查模型名或稍后重试。'))
  return full
}

export async function testConnection(config: AiConfig): Promise<string> {
  if (config.provider === 'ruodao') {
    if (!useAuth.getState().session) throw new Error(t('请先登录若道账户'))
    const models = await useAuth.getState().loadModels()
    if (!models.length) throw new Error(t('当前账户没有可用的云端模型'))
    return t('云端已连接 · {count} 个模型可用', { count: models.length })
  }
  const endpoint = endpointOf(config.baseUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      stream: false,
      max_tokens: 8,
      messages: [{ role: 'user', content: '回复"ok"两个字符即可。' }],
    }),
  })
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? t('API Key 无效')
        : t('连接失败（{status}）', { status: response.status }),
    )
  }
  return t('连接成功')
}

const STOPWORDS = new Set([
  '的', '了', '和', '是', '在', '我', '有', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '我们', '可以', '但是', '因为', '所以', '如果', '而且', '以及', '对于', '关于', '通过', '进行', '已经', '还是', '这个', '那个', '什么', '以及', '并且', '或者', '然后', '同时', '其中', '之后', '之前',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were', 'it', 'this', 'that', 'as', 'at', 'by', 'be', 'from',
])

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10)
}

function termsOf(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? []
  const cjkRuns = text.match(/[\u3400-\u9fff]{2,}/g) ?? []
  const grams: string[] = []
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) grams.push(run.slice(i, i + 2))
  }
  return [...latin, ...grams].filter((t) => !STOPWORDS.has(t))
}

export interface LocalInsight {
  summary: string
  keywords: string[]
}

export function localAnalyze(text: string): LocalInsight {
  const clean = text.replace(/[#>*`\-[\]()!_]/g, ' ').replace(/\s+/g, ' ').trim()
  const sentences = splitSentences(clean)
  const freq = new Map<string, number>()
  for (const term of termsOf(clean)) freq.set(term, (freq.get(term) ?? 0) + 1)

  const scored = sentences.map((sentence, index) => {
    const terms = termsOf(sentence)
    const score = terms.reduce((sum, term) => sum + Math.log(1 + (freq.get(term) ?? 0)), 0) / Math.sqrt(terms.length + 4)
    return { sentence, index, score }
  })

  const take = Math.min(Math.max(2, Math.round(sentences.length * 0.25)), 6)
  const chosen = [...scored].sort((a, b) => b.score - a.score).slice(0, take).sort((a, b) => a.index - b.index)

  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term)

  const summary = chosen.length
    ? chosen.map((c) => `- ${c.sentence}`).join('\n')
    : t('- 内容较短，暂时无法提取摘要。')

  return { summary, keywords }
}

export function localSummaryMarkdown({ summary, keywords }: LocalInsight): string {
  return t('**离线摘要 · 本地计算**（未使用模型）\n\n{summary}\n\n**关键词**：{keywords}', {
    summary,
    keywords: keywords.join('、') || '—',
  })
}
