import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  ChartColumn,
  ClipboardList,
  Copy,
  CornerDownLeft,
  FileText,
  ListTree,
  Loader2,
  Lock,
  PenLine,
  Play,
  RefreshCw,
  ScanText,
  Settings2,
  Sigma,
  Sparkles,
  Square,
  Table2,
  Wand2,
} from 'lucide-react'
import type { AiContext, ModuleId } from '../../types'
import { Modal } from '../../components/ui'
import { useT } from '../../i18n'
import {
  contextBlock,
  localAnalyze,
  localSummaryMarkdown,
  presetOf,
  streamChat,
} from '../../lib/ai'
import { getAiContext, insertAiText } from '../../lib/aiContext'
import { renderMarkdown } from '../../lib/markdown'
import { isAiReady, useSettings } from '../../lib/settings'
import { cn } from '../../lib/utils'
import { useAuth } from '../../store/auth'
import { useUI } from '../../store/ui'

interface TaskTemplate {
  id: string
  icon: typeof Sparkles
  title: string
  hint: string
  prompt: string
  local?: boolean
}

const KIND_LABEL = {
  doc: '文档',
  sheet: '表格',
  note: '笔记',
  pdf: 'PDF',
} as const

const SYSTEM_PROMPT = `你是「若道办公」的 AI 办公助理，正在任务窗口中帮用户完成一件具体的办公工作。
- 先读取用户提供的当前内容，再直接给出可用的成品；不寒暄，不复述问题。
- 用简体中文输出 Markdown。表格用 Markdown 表格；公式直接以 = 开头并说明放在哪一列。
- 涉及数字时给出计算口径；信息不足时按最合理的假设完成，并在末尾用「假设」列出。
- 不要输出与任务无关的解释。`

const TASKS: Record<ModuleId, TaskTemplate[]> = {
  home: [
    {
      id: 'draft',
      icon: PenLine,
      title: '起草一份文档',
      hint: '从零写一份成稿',
      prompt: '请帮我起草一份结构完整、可直接使用的办公文档。先给出标题层级，再写出正文。',
    },
    {
      id: 'outline',
      icon: ListTree,
      title: '生成大纲',
      hint: '先搭结构再写',
      prompt: '请为这个主题生成一份清晰的大纲：一级、二级标题，并标注每节要讲的重点。',
    },
    {
      id: 'table',
      icon: Table2,
      title: '整理成表格',
      hint: '输出 Markdown 表格',
      prompt: '请把当前内容整理成一张结构化的 Markdown 表格，保留关键字段与数字。',
      local: true,
    },
  ],
  docs: [
    {
      id: 'polish',
      icon: PenLine,
      title: '润色成稿',
      hint: '保持原意，改到可发布',
      prompt: '请润色当前文档：保持原意、语气和术语一致，修正表达、衔接和重复，直接给出润色后的完整文本。',
    },
    {
      id: 'summary',
      icon: ListTree,
      title: '提炼摘要',
      hint: '结论 + 要点',
      prompt: '请总结当前文档：先用一句话给出结论，再列出 3–5 个关键要点，最后指出需要补充的信息。',
      local: true,
    },
    {
      id: 'continue',
      icon: ArrowUp,
      title: '续写下一节',
      hint: '延续当前风格',
      prompt: '请基于当前文档继续写下一节，保持同样的语气、结构与术语，直接给出续写内容。',
    },
    {
      id: 'table',
      icon: Table2,
      title: '提取成表格',
      hint: '把要点变成清单',
      prompt: '请把当前文档中的关键信息提取成一张 Markdown 表格，列出事项、负责人、时间和状态（没有的写待定）。',
    },
  ],
  sheets: [
    {
      id: 'analyze',
      icon: ChartColumn,
      title: '分析这张表',
      hint: '趋势与异常',
      prompt:
        '请分析当前表格：先用 3 句话总结关键结论，再列出趋势、异常值、值得关注的数字，以及 2 条可执行建议。',
      local: true,
    },
    {
      id: 'formula',
      icon: Sigma,
      title: '写公式',
      hint: '给出可直接用的公式',
      prompt:
        '请根据当前表格的结构，给出 2–3 个实用公式（直接写 =...），说明放在哪一列、计算什么。只使用 SUM、AVERAGE、COUNTIF、SUMIF、IF、VLOOKUP、XLOOKUP、ROUND 等常用函数。',
    },
    {
      id: 'chart',
      icon: ChartColumn,
      title: '推荐图表',
      hint: '类型与系列',
      prompt:
        '请根据当前表格推荐 2 种最合适的图表类型（可选：簇状柱形、堆积柱形、百分比柱形、条形、折线、面积、堆积面积、饼图、圆环、散点、雷达、组合），分别说明横轴、系列和建议标题，并给出图表标题文案。',
    },
    {
      id: 'clean',
      icon: Wand2,
      title: '清洗与整理',
      hint: '空值、重复、格式',
      prompt:
        '请检查当前表格的数据质量：指出空值、重复、格式不一致和可能的录入错误，并逐列给出处理步骤（不会执行，只给清单）。',
    },
    {
      id: 'report',
      icon: FileText,
      title: '写进周报',
      hint: '一段可直接粘贴的话',
      prompt: '请根据当前表格写一段可直接放进周报的汇报文字，包含 3 个关键数字和一条结论，控制在 200 字以内。',
    },
  ],
  notes: [
    {
      id: 'structure',
      icon: ListTree,
      title: '整理成结构',
      hint: '补标题与脉络',
      prompt: '请把当前笔记整理成结构化笔记：补上标题层级，合并重复内容，保留全部事实与数字。',
      local: true,
    },
    {
      id: 'actions',
      icon: ClipboardList,
      title: '提取行动项',
      hint: '谁、做什么、何时',
      prompt: '请从当前笔记中提取所有行动项，输出一张 Markdown 表格：事项、负责人、截止时间、优先级。',
    },
    {
      id: 'summary',
      icon: ScanText,
      title: '一句话摘要',
      hint: '给笔记定主旨',
      prompt: '请用一句话概括当前笔记的主旨，再列出 3 条支撑要点。',
      local: true,
    },
  ],
  pdf: [
    {
      id: 'summary',
      icon: ScanText,
      title: '提炼 PDF 要点',
      hint: '结论与关键数字',
      prompt: '请总结这份 PDF：先给结论，再列出关键数字、日期、条款和待办事项。',
      local: true,
    },
    {
      id: 'questions',
      icon: ListTree,
      title: '生成阅读问题',
      hint: '检查有没有读漏',
      prompt: '请根据这份 PDF 生成 5 个关键问题，并各用一句话给出答案，帮我确认有没有读漏。',
    },
    {
      id: 'table',
      icon: Table2,
      title: '提取成表格',
      hint: '条款、金额、日期',
      prompt: '请把这份 PDF 中的关键信息提取成 Markdown 表格：条款、金额、日期、责任方。',
    },
  ],
  convert: [
    {
      id: 'summary',
      icon: ScanText,
      title: '总结当前内容',
      hint: '结论 + 要点',
      prompt: '请总结当前内容：先给一句话结论，再列出 3–5 个关键要点。',
      local: true,
    },
    {
      id: 'structure',
      icon: ListTree,
      title: '重排结构',
      hint: '让内容更好读',
      prompt: '请把当前内容重新组织成清晰的结构，给出可直接使用的 Markdown。',
    },
  ],
}

export function AiTaskDialog() {
  const open = useUI((s) => s.aiTaskOpen)
  const seed = useUI((s) => s.aiTaskSeed)
  const consumeSeed = useUI((s) => s.consumeAiTaskSeed)
  const close = useUI((s) => s.closeAiTask)
  const setAiOpen = useUI((s) => s.setAiOpen)
  const openSettings = useUI((s) => s.openSettings)
  const toast = useUI((s) => s.toast)
  const module = useUI((s) => s.module)
  const settings = useSettings((s) => s.ai)
  const signedIn = useAuth((s) => Boolean(s.session))
  const configured = isAiReady(settings, signedIn)
  const provider = presetOf(settings.provider)

  const [context, setContext] = useState<AiContext | null>(null)
  const [taskId, setTaskId] = useState('analyze')
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [localResult, setLocalResult] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const lastSeedRef = useRef<string | null>(null)
  const tasks = TASKS[module]
  const t = useT()

  useEffect(() => {
    if (!open) return
    setContext(getAiContext(module))
    setResult('')
    setError('')
    setLocalResult(false)
    setStatus('idle')
    const first = TASKS[module][0]
    setTaskId(first.id)
    setPrompt(first.prompt)
  }, [open, module])

  useEffect(() => {
    if (!open || !seed || lastSeedRef.current === seed.id) return
    lastSeedRef.current = seed.id
    const match = TASKS[module].find((item) => item.prompt === seed.text)
    setPrompt(seed.text)
    setTaskId(match?.id ?? 'custom')
    setResult('')
    setError('')
    setStatus('idle')
    consumeSeed(seed.id)
  }, [open, seed, consumeSeed, module])

  useEffect(() => {
    if (!open) return
    const el = resultRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [result, open, status])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const refreshContext = () => {
    const next = getAiContext(module)
    setContext(next)
    if (!next) toast(t('当前模块没有可读取的内容，可以直接描述任务'), 'info')
  }

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const runLocal = () => {
    if (!context?.text.trim()) {
      setError(t('当前没有可读取的内容。先打开一份文档、表格或笔记，再运行离线分析。'))
      setStatus('error')
      return
    }
    setError('')
    const markdown = localSummaryMarkdown(localAnalyze(context.text))
    setResult(
      `${markdown}\n\n> ${t('离线模式只在设备上做词频与摘要计算，不会生成公式或图表建议。配置模型后可执行完整任务。')}`,
    )
    setLocalResult(true)
    setStatus('done')
  }

  const run = async () => {
    if (status === 'running') {
      stop()
      return
    }
    const text = prompt.trim()
    if (!text) {
      toast(t('先写下要完成的任务'), 'info')
      return
    }
    const task = tasks.find((item) => item.id === taskId)
    const ctx = getAiContext(module)
    setContext(ctx)
    setError('')
    setResult('')
    setLocalResult(false)

    if (!configured) {
      if (task?.local) {
        runLocal()
        return
      }
      setError(
        t('这个任务需要接入模型。请先配置 AI 服务，或点下方的「离线分析」处理当前内容。'),
      )
      setStatus('error')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setStatus('running')
    const block = contextBlock(ctx)
    const content = block ? `${block}\n\n---\n\n任务：${text}` : `任务：${text}`
    let full = ''
    try {
      await streamChat({
        config: settings,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        signal: controller.signal,
        onDelta: (delta) => {
          full += delta
          setResult(full)
        },
      })
      setStatus('done')
    } catch (runError) {
      if ((runError as Error).name === 'AbortError') {
        if (!full) setStatus('idle')
        else setStatus('done')
        toast(t('已停止生成'))
      } else {
        setError((runError as Error).message || t('生成失败，请稍后重试'))
        setStatus('error')
      }
    } finally {
      abortRef.current = null
    }
  }

  const copyResult = async () => {
    if (!result.trim()) return
    try {
      await navigator.clipboard.writeText(result)
      toast(t('结果已复制'), 'success')
    } catch {
      toast(t('复制失败，请手动选择文本'), 'error')
    }
  }

  const insertResult = () => {
    if (!result.trim()) return
    const ok = insertAiText(module, result)
    if (ok) toast(module === 'sheets' ? t('已填入当前单元格区域') : t('已插入到当前内容'), 'success')
    else {
      void copyResult()
      toast(t('当前没有可插入的位置，结果已尝试复制'), 'info')
    }
  }

  const canInsert = module === 'docs' || module === 'notes' || module === 'sheets'
  const contextLabel = context
    ? t('{kind}《{title}》', { kind: t(KIND_LABEL[context.kind]), title: context.title })
    : t('未读取到当前内容')
  const busy = status === 'running'

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('AI 任务窗口')}
      description={t('AI 会读取当前打开的内容，完成一件完整的办公工作；结果可以一键写回。')}
      width={880}
      className="ai-task-dialog"
      footer={
        <>
          <span className="ai-task-foot-hint">
            {configured
              ? `${t(provider?.name ?? '自定义')} · ${settings.model}`
              : t('未接入模型 · 离线分析可用')}
          </span>
          {!configured && (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={runLocal}
                disabled={busy}
                title={t('在本机做词频摘要，不上传任何内容')}
              >
                <Lock size={12} />
                {t('离线分析')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSettings('ai')}>
                <Settings2 size={13} />
                {t('配置模型')}
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost" onClick={close}>
            {t('关闭')}
          </button>
          <button
            type="button"
            className={cn('btn', busy ? 'btn-secondary' : 'btn-primary', 'ai-task-run')}
            onClick={() => void run()}
          >
            {busy ? (
              <>
                <Square size={12} fill="currentColor" />
                {t('停止')}
              </>
            ) : (
              <>
                <Play size={13} />
                {t('运行任务')}
              </>
            )}
          </button>
        </>
      }
    >
      <div className="ai-task-body">
        <div className={cn('ai-task-context', context ? 'has-context' : 'is-empty')}>
          <span className="ai-task-context-mark">
            {context ? <Sparkles size={15} /> : <ScanText size={15} />}
          </span>
          <div className="ai-task-context-copy">
            <strong>{contextLabel}</strong>
            <span>
              {context
                ? t('{count} 字符已就绪 · 只会发送到你选择的模型服务', {
                    count: context.text.length.toLocaleString('zh-CN'),
                  })
                : t('可以直接描述任务；打开文档、表格或笔记后，AI 能读取其中的内容')}
            </span>
          </div>
          <button type="button" className="ai-task-refresh" onClick={refreshContext}>
            <RefreshCw size={12} />
            {t('刷新')}
          </button>
        </div>

        <div className="ai-task-tasks" role="list" aria-label={t('任务模板')}>
          {tasks.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                role="listitem"
                className={cn('ai-task-card', taskId === item.id && 'active')}
                onClick={() => {
                  setTaskId(item.id)
                  setPrompt(item.prompt)
                  setResult('')
                  setError('')
                  setLocalResult(false)
                  setStatus('idle')
                }}
              >
                <span className="ai-task-card-icon">
                  <Icon size={15} />
                </span>
                <span className="ai-task-card-copy">
                  <strong>{t(item.title)}</strong>
                  <em>{t(item.hint)}</em>
                </span>
                {item.local && <span className="ai-task-card-local">{t('离线')}</span>}
              </button>
            )
          })}
        </div>

        <label className="ai-task-prompt">
          <span className="ai-task-prompt-label">
            {t('任务描述')}
            <em>{t('Ctrl + Enter 运行')}</em>
          </span>
          <textarea
            rows={3}
            value={prompt}
            placeholder={t('例如：按月份汇总收入，指出增长最快的两个月，并生成一段汇报文字。')}
            onChange={(event) => {
              setPrompt(event.target.value)
              setTaskId('custom')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void run()
              }
            }}
          />
        </label>

        <div className="ai-task-result">
          <div className="ai-task-result-head">
            <span className="ai-task-result-title">
              {t('执行结果')}
              {localResult && <em className="ai-task-result-badge">{t('本机计算')}</em>}
              {busy && <Loader2 size={12} className="spin" />}
            </span>
            <div className="ai-task-result-actions">
              <button type="button" disabled={!result} onClick={() => void copyResult()}>
                <Copy size={11} />
                {t('复制')}
              </button>
              {canInsert && (
                <button type="button" disabled={!result} onClick={insertResult}>
                  <CornerDownLeft size={11} />
                  {module === 'sheets' ? t('填入表格') : t('插入内容')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  close()
                  setAiOpen(true)
                }}
              >
                <Sparkles size={11} />
                {t('继续对话')}
              </button>
            </div>
          </div>
          <div ref={resultRef} className="ai-task-result-body">
            {error ? (
              <div className="ai-task-error">
                <Lock size={14} />
                <span>{error}</span>
              </div>
            ) : result ? (
              <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }} />
            ) : busy ? (
              <div className="ai-task-typing">
                <span />
                <span />
                <span />
              </div>
            ) : (
              <div className="ai-task-empty">
                <Sparkles size={18} />
                <strong>{t('选一个任务，或直接写下你的要求。')}</strong>
                <span>{t('AI 会基于当前内容给出可用的成品，并支持一键写回。')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
