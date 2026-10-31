import { useCallback, useEffect, useRef, useState } from 'react'
import { AccountDialog } from './components/AccountDialog'
import { CollabDialog } from './components/CollabDialog'
import { CollabSync } from './components/CollabSync'
import { CommandPalette } from './components/CommandPalette'
import { NavRail } from './components/NavRail'
import { SettingsDialog } from './components/SettingsDialog'
import { TopBar } from './components/TopBar'
import { Logo, Toasts } from './components/ui'
import { saveLibrary } from './lib/db'
import { openDesktopFiles, openFiles } from './lib/openFiles'
import { ConvertModule } from './modules/convert/ConvertModule'
import { DocsModule } from './modules/docs/DocsModule'
import { Home } from './modules/home/Home'
import { NotesModule } from './modules/notes/NotesModule'
import { PdfModule } from './modules/pdf/PdfModule'
import { SheetsModule } from './modules/sheets/SheetsModule'
import { AiDrawer } from './modules/ai/AiDrawer'
import { AiTaskDialog } from './modules/ai/AiTaskDialog'
import { useAuth } from './store/auth'
import { useLibrary } from './store/library'
import { useUI } from './store/ui'
import type { ModuleId } from './types'

const MODULES: Array<{ id: ModuleId; render: () => JSX.Element }> = [
  { id: 'home', render: () => <Home /> },
  { id: 'docs', render: () => <DocsModule /> },
  { id: 'sheets', render: () => <SheetsModule /> },
  { id: 'pdf', render: () => <PdfModule /> },
  { id: 'notes', render: () => <NotesModule /> },
  { id: 'convert', render: () => <ConvertModule /> },
]

export default function App() {
  const hydrated = useLibrary((s) => s.hydrated)
  const hydrate = useLibrary((s) => s.hydrate)
  const hydrateAuth = useAuth((s) => s.hydrate)
  const docs = useLibrary((s) => s.docs)
  const sheets = useLibrary((s) => s.sheets)
  const notes = useLibrary((s) => s.notes)
  const activeDocId = useLibrary((s) => s.activeDocId)
  const activeSheetId = useLibrary((s) => s.activeSheetId)
  const activeNoteId = useLibrary((s) => s.activeNoteId)
  const module = useUI((s) => s.module)
  const toast = useUI((s) => s.toast)
  const [saveState, setSaveState] = useState<'saving' | 'saved'>('saved')
  const [dropActive, setDropActive] = useState(false)
  const skipFirstSave = useRef(true)
  const dropDepth = useRef(0)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    void hydrateAuth()
  }, [hydrateAuth])

  const flushLibrary = useCallback(async () => {
    window.dispatchEvent(new Event('ruodao:flush'))
    setSaveState('saving')
    try {
      await saveLibrary(useLibrary.getState().snapshot())
    } catch {
      /* the last autosave already holds the previous state */
    }
    setSaveState('saved')
  }, [])

  useEffect(() => {
    const onPageHide = () => void flushLibrary()
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushLibrary()
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flushLibrary])

  useEffect(() => {
    if (!hydrated) return
    const bridge = window.ruodaoDesktop
    if (!bridge) return
    const dispose = bridge.onOpenFiles((files) => {
      void openDesktopFiles(files)
    })
    bridge.ready()
    return dispose
  }, [hydrated])

  useEffect(() => {
    if (!hydrated) return
    const bridge = window.ruodaoDesktop
    if (!bridge?.onFlush) return
    return bridge.onFlush(() => {
      void flushLibrary().finally(() => bridge.flushDone?.())
    })
  }, [hydrated, flushLibrary])

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const isLocal = (event: DragEvent) => {
      const target = event.target as Element | null
      return Boolean(target?.closest?.('[data-file-drop="local"]'))
    }
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dropDepth.current += 1
      if (isLocal(event)) {
        setDropActive(false)
        return
      }
      setDropActive(true)
    }
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      if (isLocal(event)) {
        if (dropDepth.current > 0) dropDepth.current = 0
        setDropActive(false)
        return
      }
      if (dropDepth.current === 0) dropDepth.current = 1
      setDropActive(true)
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dropDepth.current = Math.max(0, dropDepth.current - 1)
      if (dropDepth.current === 0 || event.relatedTarget === null) setDropActive(false)
    }
    const onDrop = (event: DragEvent) => {
      dropDepth.current = 0
      setDropActive(false)
      if (!hasFiles(event)) return
      if (event.defaultPrevented) return
      event.preventDefault()
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) void openFiles(files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (skipFirstSave.current) {
      skipFirstSave.current = false
      return
    }
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      saveLibrary(useLibrary.getState().snapshot())
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('saved'))
    }, 550)
    return () => window.clearTimeout(timer)
  }, [hydrated, docs, sheets, notes, activeDocId, activeSheetId, activeNoteId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        useUI.getState().setPaletteOpen(true)
      }
      if (key === 's') {
        event.preventDefault()
        void flushLibrary().then(() => {
          toast('已保存到本机', 'success')
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flushLibrary, toast])

  if (!hydrated) {
    return (
      <div className="app">
        <div className="boot" style={{ flex: 1 }}>
          <span className="boot-mark">
            <Logo size={50} />
          </span>
          <span className="boot-text">正在打开本地工作区…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <NavRail />
      <div className="workspace">
        <TopBar saveState={saveState} />
        <main className="content">
          {MODULES.map((item) => (
            <div key={item.id} className="module-view" hidden={module !== item.id} aria-hidden={module !== item.id}>
              {item.render()}
            </div>
          ))}
        </main>
      </div>

      <AiDrawer />
      <AiTaskDialog />
      <CollabSync />
      <CommandPalette />
      <SettingsDialog />
      <AccountDialog />
      <CollabDialog />
      <Toasts />

      {dropActive && (
        <div className="drop-veil" aria-hidden="true">
          <div className="drop-veil-card">
            <span className="drop-veil-mark">
              <Logo size={34} />
            </span>
            <strong>松手，用若道办公打开</strong>
            <span>Word · Excel · PDF · 图片 · Markdown · ZIP，全部在本机处理</span>
          </div>
        </div>
      )}
    </div>
  )
}
