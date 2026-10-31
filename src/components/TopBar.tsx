import { CheckCircle2, LogIn, Search, Sparkles, Users } from 'lucide-react'
import type { ModuleId } from '../types'
import { cn, shortcut } from '../lib/utils'
import { useLibrary } from '../store/library'
import { useCollab } from '../store/collab'
import { useUI } from '../store/ui'
import { Kbd } from './ui'
import { useAuth, displayNameOf, initialsOf } from '../store/auth'

const MODULE_LABEL: Record<ModuleId, string> = {
  home: '工作台',
  docs: '文档',
  sheets: '表格',
  pdf: 'PDF 工具箱',
  notes: '双链笔记',
  convert: '格式转换',
}

interface TopBarProps {
  saveState: 'saving' | 'saved'
}

export function TopBar({ saveState }: TopBarProps) {
  const module = useUI((s) => s.module)
  const setPaletteOpen = useUI((s) => s.setPaletteOpen)
  const setAccountOpen = useUI((s) => s.setAccountOpen)
  const setCollabOpen = useUI((s) => s.setCollabOpen)
  const aiOpen = useUI((s) => s.aiOpen)
  const setAiOpen = useUI((s) => s.setAiOpen)
  const docs = useLibrary((s) => s.docs)
  const sheets = useLibrary((s) => s.sheets)
  const notes = useLibrary((s) => s.notes)
  const activeDocId = useLibrary((s) => s.activeDocId)
  const activeSheetId = useLibrary((s) => s.activeSheetId)
  const activeNoteId = useLibrary((s) => s.activeNoteId)
  const session = useAuth((s) => s.session)
  const collabSession = useCollab((s) => s.session)
  const collabPeers = useCollab((s) => s.peers)

  let context = ''
  if (module === 'docs') context = docs.find((d) => d.id === activeDocId)?.title ?? ''
  if (module === 'sheets') context = sheets.find((d) => d.id === activeSheetId)?.title ?? ''
  if (module === 'notes') context = notes.find((d) => d.id === activeNoteId)?.title ?? ''
  if (module === 'pdf') context = '本地处理 · 文件不上传'
  if (module === 'convert') context = '批量转换 · 文件不上传'
  if (module === 'home') context = '开源免费 · 本地优先'

  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="topbar-module">{MODULE_LABEL[module]}</span>
        {context && (
          <>
            <span className="faint topbar-sep" style={{ fontSize: 12 }}>
              /
            </span>
            <span className="topbar-context">{context}</span>
          </>
        )}
      </div>

      <div className="topbar-actions">
        <span className="save-state" title="内容保存在此设备的 IndexedDB">
          {saveState === 'saved' ? (
            <>
              <CheckCircle2 size={13} />
              本地已保存
            </>
          ) : (
            <>
              <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
              保存中…
            </>
          )}
        </span>
        <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
          <Search size={14} />
          <span>搜索或运行命令</span>
          <Kbd>{shortcut} K</Kbd>
        </button>
        <button
          type="button"
          className={cn('collab-trigger', Boolean(collabSession) && 'active')}
          onClick={() => setCollabOpen(true)}
          title={collabSession ? `协作中 · ${collabPeers.length + 1} 人在线` : '实时协作'}
        >
          <Users size={14} />
          <span className="collab-trigger-label">{collabSession ? '协作中' : '协作'}</span>
          {collabSession && <span className="collab-trigger-count">{collabPeers.length + 1}</span>}
        </button>
        <button type="button" className={cn('ai-trigger', aiOpen && 'active')} onClick={() => setAiOpen(!aiOpen)}>
          <Sparkles size={14} />
          AI 助手
        </button>
        <button
          type="button"
          className={cn('account-trigger', Boolean(session) && 'signed-in')}
          onClick={() => setAccountOpen(true)}
          title={session ? `若道账户 · ${displayNameOf(session.user)}` : '登录若道账户'}
        >
          {session ? (
            session.user.avatarUrl ? (
              <img className="account-trigger-avatar" src={session.user.avatarUrl} alt="" />
            ) : (
              <span className="account-trigger-avatar letter">{initialsOf(session.user)}</span>
            )
          ) : (
            <LogIn size={14} />
          )}
          <span className="account-trigger-label">{session ? displayNameOf(session.user) : '登录'}</span>
        </button>
      </div>
    </header>
  )
}
