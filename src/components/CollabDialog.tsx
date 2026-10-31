import { useEffect, useState } from 'react'
import { Check, Copy, Link2, LogOut, Radio, Users } from 'lucide-react'
import {
  createRoomId,
  isValidRoomId,
  rememberedCollabUrl,
  rememberCollabUrl,
  roomKind,
  type CollabKind,
} from '../lib/collab'
import { displayNameOf } from '../store/auth'
import { useAuth } from '../store/auth'
import { useCollab } from '../store/collab'
import { useLibrary } from '../store/library'
import { useUI } from '../store/ui'
import { cn } from '../lib/utils'
import { Modal } from './ui'

type Tab = 'create' | 'join'

function roomFromInput(input: string): string {
  const raw = input.trim()
  try {
    const url = new URL(raw)
    const room = url.searchParams.get('room')
    if (room) return room.trim()
  } catch {
    /* not a URL */
  }
  const match = /^[^#?]*[?&]room=([A-Za-z0-9_-]+)/.exec(raw)
  return match ? match[1] : raw
}

export function CollabDialog() {
  const open = useUI((s) => s.collabOpen)
  const setOpen = useUI((s) => s.setCollabOpen)
  const module = useUI((s) => s.module)
  const setModule = useUI((s) => s.setModule)
  const toast = useUI((s) => s.toast)

  const session = useCollab((s) => s.session)
  const status = useCollab((s) => s.status)
  const peers = useCollab((s) => s.peers)
  const error = useCollab((s) => s.error)
  const connect = useCollab((s) => s.connect)
  const leave = useCollab((s) => s.leave)

  const authUser = useAuth((s) => s.session?.user)
  const docs = useLibrary((s) => s.docs)
  const notes = useLibrary((s) => s.notes)
  const activeDocId = useLibrary((s) => s.activeDocId)
  const activeNoteId = useLibrary((s) => s.activeNoteId)

  const [tab, setTab] = useState<Tab>('create')
  const [name, setName] = useState('')
  const [wsUrl, setWsUrl] = useState(rememberedCollabUrl())
  const [advanced, setAdvanced] = useState(false)
  const [joinRoom, setJoinRoom] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const contextKind: CollabKind | null = module === 'notes' ? 'note' : module === 'docs' ? 'doc' : null
  const context =
    contextKind === 'note'
      ? notes.find((item) => item.id === activeNoteId)
      : contextKind === 'doc'
        ? docs.find((item) => item.id === activeDocId)
        : null

  useEffect(() => {
    if (!open) return
    setFormError(null)
    setCopied(false)
    setWsUrl(rememberedCollabUrl())
    setName((current) => {
      if (current.trim()) return current
      let saved = ''
      try {
        saved = window.localStorage.getItem('ruodao.collab.name') || ''
      } catch {
        saved = ''
      }
      return saved || displayNameOf(authUser) || ''
    })
  }, [open, authUser])

  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get('room')
    if (!room) return
    setTab('join')
    setJoinRoom(room)
    setFormError(null)
    setOpen(true)
  }, [setOpen])

  useEffect(() => {
    if (!open) return
    const room = new URLSearchParams(window.location.search).get('room')
    if (room) {
      setTab('join')
      setJoinRoom(room)
      setFormError(null)
    }
  }, [open])

  useEffect(() => {
    if (!session) return
    const url = new URL(window.location.href)
    if (!url.searchParams.has('room')) return
    url.searchParams.delete('room')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [session])

  const rememberName = (value: string) => {
    try {
      window.localStorage.setItem('ruodao.collab.name', value.trim())
    } catch {
      /* ignore */
    }
  }

  const startHost = () => {
    if (!context || !contextKind) {
      setFormError('请先在「文档」或「笔记」中打开一份内容，再开始协作。')
      return
    }
    const displayName = name.trim() || '我'
    rememberName(displayName)
    rememberCollabUrl(wsUrl.trim())
    const roomId = createRoomId(contextKind)
    connect({
      roomId,
      kind: contextKind,
      recordId: context.id,
      role: 'host',
      wsUrl: wsUrl.trim(),
      meName: displayName,
      title: context.title,
      body: 'content' in context ? context.content : context.html,
    })
    setOpen(false)
    toast(`协作房间已创建：${roomId}`, 'success')
  }

  const join = () => {
    const roomId = roomFromInput(joinRoom)
    if (!isValidRoomId(roomId)) {
      setFormError('房间码无效，应形如 n-xxxxxxxx 或 d-xxxxxxxx。')
      return
    }
    const kind = roomKind(roomId)
    if (!kind) {
      setFormError('房间码需以 n-（笔记）或 d-（文档）开头。')
      return
    }
    const displayName = name.trim() || '我'
    rememberName(displayName)
    rememberCollabUrl(wsUrl.trim())
    const library = useLibrary.getState()
    const recordId =
      kind === 'note'
        ? library.createNote({ title: '协作笔记', content: '' })
        : library.createDoc({ title: '协作文档', html: '' })
    setModule(kind === 'note' ? 'notes' : 'docs')
    connect({
      roomId,
      kind,
      recordId,
      role: 'guest',
      wsUrl: wsUrl.trim(),
      meName: displayName,
      title: '',
      body: '',
    })
    setOpen(false)
    toast('正在加入协作房间…', 'info')
  }

  const copyRoom = async () => {
    if (!session) return
    const link = `${window.location.origin}${window.location.pathname}?room=${session.roomId}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
      toast('邀请链接已复制，发送给协作者即可加入', 'success')
    } catch {
      toast(`房间码：${session.roomId}`, 'info')
    }
  }

  const statusLabel =
    status === 'online'
      ? '实时同步中'
      : status === 'connecting'
        ? '连接中…'
        : status === 'reconnecting'
          ? '重新连接中…'
          : '未连接'

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={session ? '实时协作' : '开始协作'}
      description={
        session
          ? '内容通过你配置的协作服务实时同步，房间码即访问凭据。'
          : '创建房间邀请他人，或输入房间码加入。支持文档与笔记。'
      }
      width={520}
      className="collab-modal"
    >
      {session ? (
        <div className="collab-panel">
          <div className="collab-room-head">
            <div className="collab-room-code">
              <Radio size={14} />
              <code>{session.roomId}</code>
              <button type="button" className="collab-copy" onClick={() => void copyRoom()} title="复制邀请链接">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <span className={cn('collab-status', status)}>
              <span className="collab-status-dot" />
              {statusLabel}
            </span>
          </div>

          <div className="collab-room-meta">
            <span>{session.kind === 'note' ? '笔记' : '文档'}</span>
            <span>{session.role === 'host' ? '发起者' : '参与者'}</span>
            <span>{session.wsUrl}</span>
          </div>

          {error && <div className="collab-error">{error}</div>}

          <div className="collab-peers">
            <div className="collab-peers-head">
              <Users size={13} />
              在线成员
              <span>{peers.length + 1}</span>
            </div>
            <div className="collab-peer-list">
              <div className="collab-peer">
                <span className="collab-peer-avatar" style={{ background: '#201e1a' }}>
                  {(name.trim() || displayNameOf(authUser) || '我').charAt(0)}
                </span>
                <span className="collab-peer-name">{name.trim() || displayNameOf(authUser) || '我'}</span>
                <span className="collab-peer-tag">我</span>
              </div>
              {peers.map((peer) => (
                <div className="collab-peer" key={peer.id}>
                  <span className="collab-peer-avatar" style={{ background: peer.color }}>
                    {peer.name.charAt(0)}
                  </span>
                  <span className="collab-peer-name">{peer.name}</span>
                  {session.kind === 'note' && peer.cursor && (
                    <span className="collab-peer-tag">
                      第 {peer.cursor.line} 行
                    </span>
                  )}
                </div>
              ))}
            </div>
            {!peers.length && <p className="collab-empty">等待其他人加入。复制邀请链接发给对方即可。</p>}
          </div>

          <div className="collab-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                leave()
                toast('已退出协作房间', 'info')
              }}
            >
              <LogOut size={14} />
              退出协作
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void copyRoom()}>
              <Link2 size={14} />
              复制邀请链接
            </button>
          </div>

          <p className="collab-note">
            协作服务只负责转发变更，不会长期保存你的内容；本地副本仍保存在此设备的 IndexedDB。
          </p>
        </div>
      ) : (
        <div className="collab-panel">
          <div className="collab-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'create'}
              className={cn('collab-tab', tab === 'create' && 'active')}
              onClick={() => {
                setTab('create')
                setFormError(null)
              }}
            >
              创建房间
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'join'}
              className={cn('collab-tab', tab === 'join' && 'active')}
              onClick={() => {
                setTab('join')
                setFormError(null)
              }}
            >
              加入房间
            </button>
          </div>

          {tab === 'create' ? (
            <>
              <div className="collab-context">
                {context && contextKind ? (
                  <>
                    <span className="collab-context-mark">{contextKind === 'note' ? '记' : '文'}</span>
                    <div>
                      <strong>{context.title || '未命名内容'}</strong>
                      <span>{contextKind === 'note' ? '笔记' : '文档'} · 将以此内容开启协作</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="collab-context-mark muted">—</span>
                    <div>
                      <strong>当前模块不支持发起协作</strong>
                      <span>请先打开「文档」或「笔记」，再创建房间。</span>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <label className="field">
              <span className="field-label">房间码或邀请链接</span>
              <input
                className="input"
                value={joinRoom}
                onChange={(event) => setJoinRoom(event.target.value)}
                placeholder="n-xxxxxxxx 或粘贴邀请链接"
                autoFocus
              />
            </label>
          )}

          <label className="field">
            <span className="field-label">你的名字</span>
            <input
              className="input"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              placeholder={displayNameOf(authUser) || '协作者'}
            />
          </label>

          <button type="button" className="account-advanced-toggle" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? '收起协作服务地址' : '协作服务地址（自托管）'}
          </button>
          {advanced && (
            <label className="field">
              <span className="field-label">WebSocket 地址</span>
              <input
                className="input"
                value={wsUrl}
                onChange={(event) => setWsUrl(event.target.value)}
                placeholder="ws://127.0.0.1:1234"
              />
              <span className="hint">运行 npm run collab 可在本机启动中继；公网部署需使用 wss://。</span>
            </label>
          )}

          {formError && <div className="collab-error">{formError}</div>}

          <div className="collab-actions">
            <span className="collab-hint">
              房间码即访问凭据，请只分享给可信的人。
            </span>
            {tab === 'create' ? (
              <button type="button" className="btn btn-primary" onClick={startHost} disabled={!context}>
                <Radio size={14} />
                创建并开始
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={join} disabled={!joinRoom.trim()}>
                <Users size={14} />
                加入房间
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
