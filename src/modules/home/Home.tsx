import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileDown,
  FileStack,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Lock,
  Network,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Table2,
  WifiOff,
} from 'lucide-react'
import { hasAiKey, useSettings } from '../../lib/settings'
import { presetOf } from '../../lib/ai'
import { cn, timeAgo, todayLabel } from '../../lib/utils'
import { useLibrary } from '../../store/library'
import { useUI } from '../../store/ui'
import { SectionHeading } from '../../components/ui'

const KIND_LABEL = {
  doc: '文档',
  sheet: '表格',
  note: '笔记',
} as const

const KIND_ICON = {
  doc: FileText,
  sheet: FileSpreadsheet,
  note: Network,
} as const

export function Home() {
  const docs = useLibrary((s) => s.docs)
  const sheets = useLibrary((s) => s.sheets)
  const notes = useLibrary((s) => s.notes)
  const createDoc = useLibrary((s) => s.createDoc)
  const createSheet = useLibrary((s) => s.createSheet)
  const createNote = useLibrary((s) => s.createNote)
  const setActive = useLibrary((s) => s.setActive)
  const setModule = useUI((s) => s.setModule)
  const setAiOpen = useUI((s) => s.setAiOpen)
  const openSettings = useUI((s) => s.openSettings)
  const ai = useSettings((s) => s.ai)

  const configured = hasAiKey(ai)
  const provider = presetOf(ai.provider)

  const recent = [
    ...docs.map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt, kind: 'doc' as const })),
    ...sheets.map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt, kind: 'sheet' as const })),
    ...notes.map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt, kind: 'note' as const })),
  ]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)

  const openRecent = (kind: 'doc' | 'sheet' | 'note', id: string) => {
    setActive(kind, id)
    setModule(kind === 'doc' ? 'docs' : kind === 'sheet' ? 'sheets' : 'notes')
  }

  const newDoc = () => {
    createDoc()
    setModule('docs')
  }
  const newSheet = () => {
    createSheet()
    setModule('sheets')
  }
  const newNote = () => {
    createNote()
    setModule('notes')
  }

  return (
    <div className="home-scroll">
      <div className="home">
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-eyebrow">Ruodao Office · 本地优先</div>
            <h1 className="hero-title">
              把文件，
              <br />
              <em>留在</em>自己手里。
            </h1>
            <p className="hero-lede">
              文档、表格、PDF 与笔记，在一张安静的工作台里完成。开源免费，离线可跑，AI 可以接你选的模型。
            </p>
            <div className="hero-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={newDoc}>
                <PenLine size={16} />
                开始写作
              </button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setModule('pdf')}>
                <FileStack size={16} />
                打开 PDF 工具
              </button>
              <button type="button" className="hero-link" onClick={() => openSettings('about')}>
                了解开源说明
                <ArrowRight size={13} />
              </button>
            </div>
            <div className="hero-meta">
              <span className="hero-meta-item">
                <ShieldCheck size={13} />
                文件仅存本机
              </span>
              <span className="hero-meta-item">
                <WifiOff size={13} />
                核心功能离线可用
              </span>
              <span className="hero-meta-item">
                <Lock size={13} />
                无账号 · 无遥测
              </span>
            </div>
            <div className="tiny faint" style={{ marginTop: 16 }}>
              {todayLabel()} · 今天也把工作留在自己手里
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-halo" />
            <div className="hero-dots" />
            <div className="paper-back" />
            <div className="paper-front">
              <div className="paper-meta">
                <span>RUODAO / QUARTERLY</span>
                <span className="paper-seal">若道</span>
              </div>
              <h3>第三季度复盘</h3>
              <div className="paper-sub">内部资料 · 仅存于本机</div>
              <div className="paper-rule" />
              <div className="paper-line w95" />
              <div className="paper-line w88" />
              <div className="paper-line w70" />
              <div className="paper-mini-table">
                <div className="paper-mini-row">
                  <span>文档整理</span>
                  <b>128 页</b>
                </div>
                <div className="paper-mini-row">
                  <span>PDF 离线处理</span>
                  <b>无水印</b>
                </div>
                <div className="paper-mini-row">
                  <span>笔记关联</span>
                  <b>26 条</b>
                </div>
              </div>
              <div className="paper-line w52" style={{ marginTop: 16 }} />
              <div className="paper-ai-note">
                <Sparkles size={9} />
                本地 AI 已整理摘要，未上传任何内容
              </div>
              <div className="paper-foot">
                <span>CONFIDENTIAL / 03</span>
                <span>PAGE 01</span>
              </div>
            </div>
            <div className="float-card fc-top">
              <ShieldCheck size={13} />
              数据未离开本机
            </div>
            <div className="float-card fc-bottom">
              <FileDown size={13} />
              离线导出 · 无广告
            </div>
          </div>
        </section>

        <div className="home-grid">
          <div className="home-main">
            <div className="quick-row">
              <button type="button" className="quick-item" onClick={newDoc}>
                <span className="quick-icon">
                  <FileText size={16} />
                </span>
                <span>
                  <span className="quick-title">新建文档</span>
                  <span className="quick-desc">富文本编辑，兼容 Word 导入导出</span>
                </span>
              </button>
              <button type="button" className="quick-item" onClick={newSheet}>
                <span className="quick-icon">
                  <Table2 size={16} />
                </span>
                <span>
                  <span className="quick-title">新建表格</span>
                  <span className="quick-desc">公式、数字格式与 XLSX 互通</span>
                </span>
              </button>
              <button type="button" className="quick-item" onClick={newNote}>
                <span className="quick-icon">
                  <Network size={16} />
                </span>
                <span>
                  <span className="quick-title">新建笔记</span>
                  <span className="quick-desc">双向链接，资料自动关联</span>
                </span>
              </button>
              <button type="button" className="quick-item" onClick={() => setModule('pdf')}>
                <span className="quick-icon">
                  <FileStack size={16} />
                </span>
                <span>
                  <span className="quick-title">PDF 工具</span>
                  <span className="quick-desc">签章、压缩、转换，全程离线</span>
                </span>
              </button>
            </div>

            <SectionHeading aside={<span className="section-count">{recent.length} 个文件</span>}>
              最近文件
            </SectionHeading>

            {recent.length === 0 ? (
              <div className="empty-recent">还没有文件。从上方新建一份文档，开始今天的工作。</div>
            ) : (
              <div className="recent-list">
                {recent.map((file) => {
                  const Icon = KIND_ICON[file.kind]
                  return (
                    <button
                      key={`${file.kind}-${file.id}`}
                      type="button"
                      className="file-row"
                      onClick={() => openRecent(file.kind, file.id)}
                    >
                      <span className={cn('file-kind', `kind-${file.kind}`)}>
                        <Icon size={16} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="file-name">{file.title}</span>
                        <span className="file-sub">{KIND_LABEL[file.kind]} · 仅存本机</span>
                      </span>
                      <span className="file-time">{timeAgo(file.updatedAt)}</span>
                      <ArrowUpRight size={15} className="file-open" />
                    </button>
                  )
                })}
              </div>
            )}

            <div className="home-foot">
              <span>
                <ShieldCheck size={11} />
                IndexedDB 本地存储
              </span>
              <span>
                <WifiOff size={11} />
                PDF 工具离线运行
              </span>
              <span>
                <HardDrive size={11} />
                随时可整包备份
              </span>
              <span className="spacer" />
              <span>若道办公 v0.1</span>
            </div>
          </div>

          <aside className="home-aside">
            <div className="opensource-card">
              <span className="opensource-seal">开源</span>
              <div className="opensource-eyebrow">Open source · free forever</div>
              <div className="opensource-price">
                免费<small>全部功能</small>
              </div>
              <div className="opensource-sub">无需账号 · 无需授权 · 无订阅</div>
              <ul className="opensource-list">
                <li>
                  <Check size={12} />
                  文档、表格、PDF、笔记全部开放
                </li>
                <li>
                  <Check size={12} />
                  可接入自有 AI 模型或本机 Ollama
                </li>
                <li>
                  <Check size={12} />
                  数据完整导出，不被平台锁定
                </li>
              </ul>
              <button type="button" className="btn" onClick={() => openSettings('about')}>
                了解开源说明
              </button>
              <div className="opensource-foot">永远免费 · 不收费 · 无广告 · 无水印</div>
            </div>

            <div className="side-card">
              <div className="side-card-head">
                <Sparkles size={13} />
                AI 助手
                <span className={cn('badge', configured ? 'badge-green' : '')} style={{ marginLeft: 'auto' }}>
                  {configured ? '已配置' : '待配置'}
                </span>
              </div>
              <div className="side-model">
                <div className="side-model-name">
                  {configured ? ai.model || '未命名模型' : '尚未接入模型'}
                  <span>{configured ? provider?.name ?? '自定义服务' : '也可以直接使用离线摘要'}</span>
                </div>
                <span className={cn('dot', configured ? 'dot-green' : 'dot-muted')} />
              </div>
              <div className="side-card-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAiOpen(true)}>
                  打开助手
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSettings('ai')}>
                  配置
                </button>
              </div>
              <p className="hint" style={{ margin: '10px 0 0' }}>
                内容只会发送到你指定的模型服务，或留在这台设备上。
              </p>
            </div>

            <div className="side-card convert-side-card">
              <div className="side-card-head">
                <RefreshCw size={13} />
                格式转换
                <span className="badge" style={{ marginLeft: 'auto' }}>
                  本地
                </span>
              </div>
              <p className="hint" style={{ margin: '10px 0 8px' }}>
                图片、PDF、Word、表格与压缩包互转，文件不上传。
              </p>
              <div className="convert-side-chips" aria-hidden="true">
                <span>.png</span>
                <span>.pdf</span>
                <span>.xlsx</span>
                <span>.epub</span>
                <span className="more">+26</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => setModule('convert')}
              >
                打开转换台
                <ArrowRight size={12} />
              </button>
            </div>

            <div className="side-card">
              <div className="side-card-head">
                <HardDrive size={13} />
                本地数据
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="storage-row">
                  <span>文档</span>
                  <b>{docs.length}</b>
                </div>
                <div className="storage-row">
                  <span>表格</span>
                  <b>{sheets.length}</b>
                </div>
                <div className="storage-row">
                  <span>笔记</span>
                  <b>{notes.length}</b>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 10, paddingLeft: 0 }}
                onClick={() => openSettings('data')}
              >
                备份与恢复
                <ArrowRight size={12} />
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
