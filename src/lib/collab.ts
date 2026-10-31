import * as Y from 'yjs'

export type CollabKind = 'note' | 'doc'
export type CollabRole = 'host' | 'guest'
export type CollabStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

export interface CollabCursor {
  line: number
  column: number
}

export interface CollabPeer {
  id: string
  name: string
  color: string
  kind: CollabKind
  cursor?: CollabCursor
  at: number
}

export interface CollabHandlers {
  onBody: (body: string) => void
  onTitle: (title: string) => void
  onPeers: (peers: CollabPeer[]) => void
  onStatus: (status: CollabStatus, error: string | null) => void
}

export interface CollabOptions {
  roomId: string
  wsUrl: string
  kind: CollabKind
  role: CollabRole
  title: string
  body: string
  me: { name: string }
}

const PEER_COLORS = ['#c8442b', '#35587a', '#2f7457', '#a9772d', '#7b4b7a', '#2f6f74', '#9b4f2f']
const HEARTBEAT_MS = 20_000

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return Math.random().toString(36).slice(2, 14)
}

export function createRoomId(kind: CollabKind): string {
  return `${kind === 'note' ? 'n' : 'd'}-${randomId().slice(0, 10)}`
}

export function roomKind(roomId: string): CollabKind | null {
  if (/^n-[a-z0-9]{6,20}$/i.test(roomId)) return 'note'
  if (/^d-[a-z0-9]{6,20}$/i.test(roomId)) return 'doc'
  return null
}

export function isValidRoomId(roomId: string): boolean {
  return /^[A-Za-z0-9_-]{6,40}$/.test(roomId)
}

export function defaultCollabUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname || '127.0.0.1'}:1234`
}

export function rememberedCollabUrl(): string {
  try {
    return window.localStorage.getItem('ruodao.collab.url') || defaultCollabUrl()
  } catch {
    return defaultCollabUrl()
  }
}

export function rememberCollabUrl(url: string): void {
  try {
    window.localStorage.setItem('ruodao.collab.url', url)
  } catch {
    /* ignore */
  }
}

export function colorForPeer(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PEER_COLORS[hash % PEER_COLORS.length]
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function textDiff(previous: string, next: string) {
  let start = 0
  const max = Math.min(previous.length, next.length)
  while (start < max && previous.charCodeAt(start) === next.charCodeAt(start)) start += 1
  let oldEnd = previous.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && previous.charCodeAt(oldEnd - 1) === next.charCodeAt(newEnd - 1)) {
    oldEnd -= 1
    newEnd -= 1
  }
  return { start, oldEnd, newEnd }
}

export class CollabClient {
  readonly me: CollabPeer
  private readonly options: CollabOptions
  private readonly handlers: CollabHandlers
  private readonly doc = new Y.Doc()
  private readonly text = this.doc.getText('body')
  private readonly meta = this.doc.getMap<string>('meta')
  private socket: WebSocket | null = null
  private closed = false
  private welcomed = false
  private retry = 0
  private reconnectTimer: number | undefined
  private heartbeatTimer: number | undefined
  private presenceTimer: number | undefined
  private lastCursor = ''
  private peers = new Map<string, CollabPeer>()

  constructor(options: CollabOptions, handlers: CollabHandlers) {
    this.options = options
    this.handlers = handlers
    const id = randomId()
    this.me = {
      id,
      name: options.me.name.trim().slice(0, 40) || '协作者',
      color: colorForPeer(id),
      kind: options.kind,
      at: Date.now(),
    }
    this.text.observe(() => this.handlers.onBody(this.text.toString()))
    this.meta.observe(() => {
      const title = String(this.meta.get('title') ?? '')
      if (title) this.handlers.onTitle(title)
    })
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return
      this.send({ t: 'update', update: toBase64(update) })
    })
  }

  connect(): void {
    if (this.closed) return
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return
    this.handlers.onStatus(this.welcomed ? 'reconnecting' : 'connecting', null)
    let socket: WebSocket
    try {
      const url = new URL(this.options.wsUrl)
      url.searchParams.set('room', this.options.roomId)
      socket = new WebSocket(url.toString())
    } catch {
      this.handlers.onStatus('offline', '协作服务地址格式不正确')
      return
    }
    this.socket = socket
    socket.onopen = () => {
      this.retry = 0
    }
    socket.onmessage = (event) => {
      let message: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(String(event.data))
        if (!parsed || typeof parsed !== 'object') return
        message = parsed as Record<string, unknown>
      } catch {
        return
      }
      this.handleMessage(message)
    }
    socket.onerror = () => {
      if (socket.readyState !== WebSocket.CLOSED) socket.close()
    }
    socket.onclose = () => {
      this.socket = null
      this.clearHeartbeat()
      if (this.closed) {
        this.handlers.onStatus('offline', null)
        return
      }
      this.handlers.onStatus(this.welcomed ? 'reconnecting' : 'connecting', '正在重新连接协作服务…')
      const delay = Math.min(15_000, 800 * 2 ** Math.min(this.retry, 5))
      this.retry += 1
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
    }
  }

  private handleMessage(message: Record<string, unknown>) {
    if (message.t === 'welcome' && typeof message.update === 'string') {
      try {
        Y.applyUpdate(this.doc, fromBase64(message.update), 'remote')
      } catch {
        /* malformed state from the relay */
      }
      const peers = Array.isArray(message.peers) ? (message.peers as CollabPeer[]) : []
      this.replacePeers(peers)
      this.welcomed = true
      this.retry = 0
      this.handlers.onStatus('online', null)
      if (this.text.length === 0 && this.meta.size === 0 && this.options.role === 'host') {
        this.doc.transact(() => {
          if (this.options.body) this.text.insert(0, this.options.body)
          if (this.options.title) this.meta.set('title', this.options.title)
        }, 'local')
      }
      this.send({ t: 'sync', update: toBase64(Y.encodeStateAsUpdate(this.doc)) })
      this.sendPresence()
      this.startHeartbeat()
      return
    }
    if (message.t === 'update' && typeof message.update === 'string') {
      try {
        Y.applyUpdate(this.doc, fromBase64(message.update), 'remote')
      } catch {
        /* ignore an incomplete update */
      }
      if (this.welcomed) this.handlers.onStatus('online', null)
      return
    }
    if (message.t === 'peers' && Array.isArray(message.peers)) {
      this.replacePeers(message.peers as CollabPeer[])
      return
    }
    if (message.t === 'presence' && message.peer && typeof message.peer === 'object') {
      const peer = message.peer as CollabPeer
      if (!peer.id || peer.id === this.me.id) return
      this.peers.set(peer.id, peer)
      this.emitPeers()
    }
  }

  private replacePeers(peers: CollabPeer[]) {
    this.peers = new Map(
      peers
        .filter((peer) => peer && peer.id && peer.id !== this.me.id)
        .map((peer) => [peer.id, peer]),
    )
    this.emitPeers()
  }

  private emitPeers() {
    this.handlers.onPeers([...this.peers.values()])
  }

  private send(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(payload))
  }

  private sendPresence() {
    this.send({
      t: 'presence',
      peer: { ...this.me, at: Date.now() },
    })
  }

  private startHeartbeat() {
    this.clearHeartbeat()
    this.heartbeatTimer = window.setInterval(() => this.sendPresence(), HEARTBEAT_MS)
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  hasTitle(): boolean {
    return Boolean(String(this.meta.get('title') ?? '').trim())
  }

  setBody(next: string) {
    if (this.text.toString() === next) return
    const diff = textDiff(this.text.toString(), next)
    this.doc.transact(() => {
      if (diff.oldEnd > diff.start) this.text.delete(diff.start, diff.oldEnd - diff.start)
      const insert = next.slice(diff.start, diff.newEnd)
      if (insert) this.text.insert(diff.start, insert)
    }, 'local')
  }

  setTitle(next: string) {
    const title = next.trim()
    if (!title) return
    if (String(this.meta.get('title') ?? '') === title) return
    this.doc.transact(() => this.meta.set('title', title), 'local')
  }

  updateCursor(cursor: CollabCursor) {
    const key = `${cursor.line}:${cursor.column}`
    if (this.lastCursor === key) return
    this.lastCursor = key
    this.me.cursor = cursor
    if (this.presenceTimer) window.clearTimeout(this.presenceTimer)
    this.presenceTimer = window.setTimeout(() => this.sendPresence(), 220)
  }

  close() {
    this.closed = true
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    if (this.presenceTimer) window.clearTimeout(this.presenceTimer)
    this.clearHeartbeat()
    if (this.socket) {
      try {
        this.socket.close(1000, 'leave')
      } catch {
        /* already closed */
      }
    }
    this.socket = null
    this.peers.clear()
    this.emitPeers()
    this.doc.destroy()
  }
}
