import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Copy,
  CornerDownLeft,
  Languages,
  ListTree,
  Lock,
  PenLine,
  ScanText,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import type { AiContext, AiMessage } from '../../types'
import { contextBlock, localAnalyze, localSummaryMarkdown, presetOf, streamChat } from '../../lib/ai'
import { getAiContext, insertAiText } from '../../lib/aiContext'
import { renderMarkdown } from '../../lib/markdown'
import { isAiReady, useSettings } from '../../lib/settings'
import { cn } from '../../lib/utils'
import { useUI } from '../../store/ui'
import { useAuth } from '../../store/auth'

const KIND_LABEL = {
  doc: '文档',
  sheet: '表格',
  note: '笔记',
  pdf: 'PDF',
} as const

const PROMPTS = [
  {
    icon: ListTree,
    title: '总结当前内容',
    hint: '结论 + 要点',
    prompt: '请总结当前内容的要点：先给一句结论，再列出 3–5 个关键要点。',
  },
  {
    icon: PenLine,
    title: '润色表达',
    hint: '保持原意',
    prompt: '请润色当前内容：保持原意与语气，修正表达与逻辑，直接给出润色后的文本。',
  },
  {
    icon: ArrowUp,
    title: '继续写下去',
    hint: '延续当前风格',
    prompt: '请基于当前内容继续写下去，保持同样的语气与结构，直接给出续写内容。',
  },
  {
    icon: Languages,
    title: '翻译成英文',
    hint: '专业书面语',
    prompt: '请把当前内容翻译成自然、专业的英文，保留原有结构，直接给出译文。',
  },
]

const QUICK = [
  { label: '总结', prompt: '请总结当前内容的要点，先给结论再列要点。' },
  { label: '润色', prompt: '请润色当前内容，保持原意与语气，直接给出润色后的文本。' },
  { label: '续写', prompt: '请基于当前内容继续写下去，保持风格一致，直接给出续写内容。' },
  { label: '提纲', prompt: '请为当前主题生成一份结构清晰的文档大纲。' },
]

export function AiDrawer() {
  const aiOpen = useUI((s) => s.aiOpen)
  const setAiOpen = useUI((s) => s.setAiOpen)
  const openAiTask = useUI((s) => s.openAiTask)
  const module = useUI((s) => s.module)
  const aiSeed = useUI((s) => s.aiSeed)
  const consumeAiSeed = useUI((s) => s.consumeAiSeed)
  const openSettings = useUI((s) => s.openSettings)
  const toast = useUI((s) => s.toast)
  const settings = useSettings((s) => s.ai)
  const signedIn = useAuth((s) => Boolean(s.session))
  const configured = isAiReady(settings, signedIn)
  const provider = presetOf(settings.provider)

  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [includeContext, setIncludeContext] = useState(true)
  const [ctxInfo, setCtxInfo] = useState<AiContext | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastSeedRef = useRef<string | null>(null)
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => {})

  useEffect(() => {
    if (aiOpen) setCtxInfo(getAiContext(module))
  }, [aiOpen, module])

  useEffect(() => {
    if (!aiOpen) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading, aiOpen])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(140, el.scrollHeight)}px`
  }, [input, aiOpen])

  const copyText = async (text: string, index?: number) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制到剪贴板', 'success')
      if (typeof index === 'number') {
        setCopiedIndex(index)
        window.setTimeout(() => setCopiedIndex(null), 1500)
      }
    } catch {
      toast('复制失败，请手动选择文本', 'error')
    }
  }

  const insert = async (text: string) => {
    if (module !== 'docs' && module !== 'notes') {
      await copyText(text)
      return
    }
    const ok = insertAiText(module, text)
    if (ok) {
      toast('已插入到当前内容', 'success')
    } else {
      await copyText(text)
      toast('当前没有可插入的位置，内容已复制', 'info')
    }
  }

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim()
      if (!text || loading) return
      if (!configured) {
        toast('请先在设置中接入模型，或使用离线分析', 'error')
        return
      }
      const controller = new AbortController()
      abortRef.current = controller
      const userMessage: AiMessage = { role: 'user', content: text }
      const history = [...messages, userMessage]
      setMessages([...history, { role: 'assistant', content: '' }])
      setInput('')
      setLoading(true)

      const context = includeContext ? getAiContext(module) : null
      setCtxInfo(context)
      const block = contextBlock(context)
      const outgoing = history.map((message, index) =>
        index === history.length - 1 && block
          ? { ...message, content: `${block}\n\n---\n\n${message.content}` }
          : message,
      )

      let full = ''
      try {
        await streamChat({
          config: settings,
          messages: outgoing,
          signal: controller.signal,
          onDelta: (delta) => {
            full += delta
            setMessages((previous) => {
              const copy = [...previous]
              copy[copy.length - 1] = { role: 'assistant', content: full }
              return copy
            })
          },
        })
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          setMessages((previous) => {
            const copy = [...previous]
            const last = copy[copy.length - 1]
            if (last && !last.content) return copy.slice(0, -1)
            return copy
          })
          toast('已停止生成')
        } else {
          const message = (error as Error).message || '生成失败，请稍后重试'
          setMessages((previous) => {
            const copy = [...previous]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant' && !last.content) {
              copy[copy.length - 1] = { role: 'assistant', content: message, error: true }
            } else {
              copy.push({ role: 'assistant', content: message, error: true })
            }
            return copy
          })
        }
      } finally {
        setLoading(false)
        abortRef.current = null
      }
    },
    [configured, includeContext, input, loading, messages, module, settings, toast],
  )

  useEffect(() => {
    sendRef.current = send
  }, [send])

  useEffect(() => {
    if (!aiSeed || lastSeedRef.current === aiSeed.id) return
    lastSeedRef.current = aiSeed.id
    consumeAiSeed(aiSeed.id)
    const timer = window.setTimeout(() => {
      void sendRef.current(aiSeed.text)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [aiSeed, consumeAiSeed])

  const runLocal = (mode: 'summary' | 'keywords') => {
    const context = getAiContext(module)
    if (!context || !context.text.trim()) {
      toast('当前没有可分析的文本', 'error')
      return
    }
    setCtxInfo(context)
    const insight = localAnalyze(context.text)
    const content =
      mode === 'summary'
        ? localSummaryMarkdown(insight)
        : `**关键词 · 本地计算**（未使用模型）\n\n${insight.keywords.join('、') || '没有提取到明显关键词。'}`
    setMessages((previous) => [
      ...previous,
      { role: 'user', content: mode === 'summary' ? '离线摘要当前内容' : '提取当前内容的关键词' },
      { role: 'assistant', content, local: true },
    ])
  }

  const quickRun = (prompt: string) => {
    if (!configured) {
      openSettings('ai')
      return
    }
    if (!ctxInfo && includeContext && module !== 'home' && getAiContext(module)) {
      setCtxInfo(getAiContext(module))
    }
    void send(prompt)
  }

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i
    return -1
  })()

  return (
    <aside className={cn('ai-panel', aiOpen && 'open')} aria-hidden={!aiOpen} aria-label="AI 助手">
      <header className="ai-head">
        <div className="ai-head-brand">
          <span className="ai-mark">AI</span>
          <div className="ai-head-text">
            <strong>若道 AI</strong>
            <span>{configured ? `${provider?.name ?? '自定义'} · ${settings.model}` : settings.provider === 'ruodao' ? '若道云端 · 等待登录' : '未配置模型 · 离线分析可用'}</span>
          </div>
        </div>
        <div className="ai-head-actions">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title="AI 任务窗口"
            onClick={() => {
              openAiTask()
              setAiOpen(false)
            }}
          >
            <Wand2 size={14} />
          </button>
          {messages.length > 0 && (
            <button type="button" className="icon-btn icon-btn-sm" title="清空对话" onClick={() => setMessages([])}>
              <Trash2 size={14} />
            </button>
          )}
          <button type="button" className="icon-btn icon-btn-sm" title="模型设置" onClick={() => openSettings('ai')}>
            <Settings2 size={14} />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" title="关闭" onClick={() => setAiOpen(false)}>
            <X size={15} />
          </button>
        </div>
      </header>

      {!configured && (
        <div className="ai-config-banner">
          <ScanText size={13} />
          <span>{settings.provider === 'ruodao' && !signedIn ? '登录若道账户即可调用云端模型；离线摘要始终可用。' : '未接入模型。离线摘要可直接使用，对话与润色需先配置服务。'}</span>
          <button type="button" onClick={() => openSettings('ai')}>
            配置
          </button>
        </div>
      )}

      <div className="ai-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="ai-welcome">
            <div className="ai-eyebrow">
              <span className="dot" />
              LOCAL-FIRST AI
            </div>
            <h2>让 AI 帮你处理这份内容。</h2>
            <p>
              读取当前文档、选中的表格区域或笔记，生成摘要、润色与续写。内容只会发送到你选择的模型服务。
            </p>

            <div className="ai-prompt-grid">
              {PROMPTS.map((item) => {
                const Icon = item.icon
                return (
                  <button key={item.title} type="button" className="ai-prompt-card" onClick={() => quickRun(item.prompt)}>
                    <span className="ai-prompt-icon">
                      <Icon size={14} />
                    </span>
                    <span className="ai-prompt-title">{item.title}</span>
                    <span className="ai-prompt-hint">{item.hint}</span>
                  </button>
                )
              })}
            </div>

            <div className="ai-offline">
              <div className="ai-offline-head">
                <Lock size={12} />
                本机离线能力
                <span className="badge">不用模型</span>
              </div>
              <p>在设备上直接计算，不上传任何字符。</p>
              <div className="ai-offline-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => runLocal('summary')}>
                  离线摘要
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => runLocal('keywords')}>
                  提取关键词
                </button>
              </div>
            </div>

            <div className="ai-welcome-foot">
              <span className={cn('dot', ctxInfo ? 'dot-green' : 'dot-muted')} />
              {ctxInfo
                ? `已连接：${KIND_LABEL[ctxInfo.kind]}《${ctxInfo.title}》`
                : '打开一份文档或笔记，即可让 AI 读取当前内容'}
            </div>
          </div>
        ) : (
          <div className="ai-messages">
            {messages.map((message, index) => (
              <div key={index} className={cn('ai-msg', message.role)}>
                {message.role === 'assistant' && <span className="ai-msg-avatar">若</span>}
                <div className="ai-msg-body">
                  {message.role === 'user' ? (
                    <div className="ai-user-text">{message.content}</div>
                  ) : message.error ? (
                    <div className="ai-error">{message.content}</div>
                  ) : message.content ? (
                    <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                  ) : (
                    <div className="ai-typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}

                  {message.role === 'assistant' && message.content && !message.error && (
                    <div className="ai-msg-actions">
                      <button type="button" onClick={() => copyText(message.content, index)}>
                        <Copy size={11} />
                        {copiedIndex === index ? '已复制' : '复制'}
                      </button>
                      {(module === 'docs' || module === 'notes' || module === 'sheets') && (
                        <button type="button" onClick={() => void insert(message.content)}>
                          <CornerDownLeft size={11} />
                          {module === 'sheets' ? '填入表格' : '插入'}
                        </button>
                      )}
                      {message.local && <span className="ai-local-label">本机计算</span>}
                      {index === lastAssistantIndex && !loading && (
                        <button type="button" onClick={() => void send(messages[lastAssistantIndex - 1]?.content ?? '请继续')}>
                          <ArrowUp size={11} />
                          重试
                        </button>
                      )}
                    </div>
                  )}
                  {message.role === 'assistant' && message.local && !message.content && (
                    <div className="ai-local-label">本机计算</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ai-composer-wrap">
        {messages.length > 0 && (
          <div className="ai-quick-row">
            {QUICK.map((item) => (
              <button key={item.label} type="button" className="ai-quick-chip" onClick={() => quickRun(item.prompt)}>
                {item.label}
              </button>
            ))}
            <span className="spacer" />
            <button type="button" className="ai-quick-chip muted" onClick={() => runLocal('summary')} title="本机计算，不调用模型">
              离线摘要
            </button>
          </div>
        )}

        <div className="ai-context-row">
          <label className="ai-context-check">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(event) => {
                setIncludeContext(event.target.checked)
                if (event.target.checked) setCtxInfo(getAiContext(module))
              }}
            />
            引用当前内容
          </label>
          <span className="ai-context-name">
            {includeContext ? (ctxInfo ? `${KIND_LABEL[ctxInfo.kind]} · ${ctxInfo.title}` : '当前无内容') : '不附带上下文'}
          </span>
          <button
            type="button"
            className="ai-refresh-context"
            onClick={() => {
              const next = getAiContext(module)
              setCtxInfo(next)
              if (!next) toast('当前模块没有可读取的内容', 'info')
            }}
            title="重新读取当前内容"
          >
            刷新
          </button>
        </div>

        <div className="ai-composer">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            placeholder={configured ? '问点什么，或让 AI 处理当前内容…' : settings.provider === 'ruodao' && !signedIn ? '登录若道账户后开始对话；也可以使用离线摘要' : '配置模型后开始对话；也可以使用离线摘要'}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send()
              }
            }}
          />
          {loading ? (
            <button type="button" className="ai-send-btn stop" onClick={() => abortRef.current?.abort()} title="停止生成">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button type="button" className="ai-send-btn" onClick={() => void send()} disabled={!input.trim()} title="发送">
              <ArrowUp size={15} />
            </button>
          )}
        </div>
        <div className="ai-footnote">
          <Lock size={9} />
          {settings.provider === 'ruodao' ? '内容经若道云端模型处理' : '内容只发送到你配置的模型服务'}
          <span className="spacer" />
          <span>Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>
    </aside>
  )
}
