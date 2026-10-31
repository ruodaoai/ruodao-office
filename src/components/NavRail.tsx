import { ArrowLeftRight, FileStack, FileText, Home, Network, Settings, Sparkles, Table2 } from 'lucide-react'
import type { ModuleId } from '../types'
import { cn } from '../lib/utils'
import { useUI } from '../store/ui'
import { Logo } from './ui'

const NAV: Array<{ id: ModuleId; label: string; icon: typeof Home }> = [
  { id: 'home', label: '工作台', icon: Home },
  { id: 'docs', label: '文档', icon: FileText },
  { id: 'sheets', label: '表格', icon: Table2 },
  { id: 'pdf', label: 'PDF', icon: FileStack },
  { id: 'notes', label: '笔记', icon: Network },
  { id: 'convert', label: '转换', icon: ArrowLeftRight },
]

export function NavRail() {
  const module = useUI((s) => s.module)
  const setModule = useUI((s) => s.setModule)
  const aiOpen = useUI((s) => s.aiOpen)
  const setAiOpen = useUI((s) => s.setAiOpen)
  const openSettings = useUI((s) => s.openSettings)

  return (
    <aside className="rail">
      <button type="button" className="rail-brand" onClick={() => setModule('home')} title="若道办公 · 工作台">
        <Logo size={38} />
      </button>
      <div className="rail-word">若道</div>

      <nav className="rail-nav" aria-label="主导航">
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              className={cn('rail-btn', module === item.id && 'active')}
              onClick={() => setModule(item.id)}
              title={item.label}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          className={cn('rail-btn', 'rail-btn-ai', aiOpen && 'active')}
          onClick={() => setAiOpen(!aiOpen)}
          title="AI 助手"
        >
          <Sparkles size={18} strokeWidth={1.8} />
          <span>AI</span>
        </button>
      </nav>

      <div className="rail-bottom">
        <button type="button" className="rail-btn" onClick={() => openSettings('ai')} title="设置">
          <Settings size={18} strokeWidth={1.8} />
          <span>设置</span>
        </button>
        <div className="rail-local" title="数据仅保存在本机">
          <span className="dot" />
          本地
        </div>
      </div>
    </aside>
  )
}
