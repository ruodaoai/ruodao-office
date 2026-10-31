import http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'

const PORT = Number(process.env.COLLAB_PORT || 1234)
const HOST = process.env.COLLAB_HOST || '127.0.0.1'
const ROOM_IDLE_MS = 30 * 60 * 1000
const MAX_PAYLOAD = 4 * 1024 * 1024

const rooms = new Map()

function getRoom(id) {
  let room = rooms.get(id)
  if (room) return room
  room = { id, doc: new Y.Doc(), peers: new Map(), updatedAt: Date.now() }
  rooms.set(id, room)
  return room
}

function peerList(room) {
  return [...room.peers.values()].map((peer) => peer.info).filter(Boolean)
}

function broadcast(room, payload, except) {
  const data = JSON.stringify(payload)
  for (const socket of room.peers.keys()) {
    if (socket === except) continue
    if (socket.readyState === WebSocket.OPEN) socket.send(data)
  }
}

function broadcastPeers(room) {
  broadcast(room, { t: 'peers', peers: peerList(room) })
}

function cleanPeer(input) {
  if (!input || typeof input !== 'object') return null
  const id = String(input.id ?? '').slice(0, 64)
  const name = String(input.name ?? '').slice(0, 40)
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id) || !name) return null
  const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color ?? '')) ? String(input.color) : '#c8442b'
  const kind = input.kind === 'doc' ? 'doc' : 'note'
  const cursor = input.cursor && typeof input.cursor === 'object'
    ? {
        line: Math.max(1, Math.min(1_000_000, Number(input.cursor.line) || 1)),
        column: Math.max(1, Math.min(1_000_000, Number(input.cursor.column) || 1)),
      }
    : undefined
  return { id, name, color, kind, cursor, at: Date.now() }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: wss.clients.size }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('ruodao collab relay')
})

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD })

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
  const roomId = String(url.searchParams.get('room') ?? '').trim()
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(roomId)) {
    socket.close(1008, 'invalid room')
    return
  }
  const room = getRoom(roomId)
  room.updatedAt = Date.now()
  socket.isAlive = true
  socket.on('pong', () => {
    socket.isAlive = true
  })

  socket.send(JSON.stringify({
    t: 'welcome',
    update: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64'),
    peers: peerList(room),
  }))
  room.peers.set(socket, { info: null })

  socket.on('message', (raw) => {
    if (raw.length > MAX_PAYLOAD) return
    let message
    try {
      message = JSON.parse(raw.toString('utf8'))
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return
    room.updatedAt = Date.now()
    if (message.t === 'sync' || message.t === 'update') {
      const update = typeof message.update === 'string' ? message.update : ''
      if (!update || update.length > MAX_PAYLOAD * 2) return
      try {
        Y.applyUpdate(room.doc, Buffer.from(update, 'base64'))
      } catch {
        return
      }
      if (message.t === 'update') {
        broadcast(room, { t: 'update', update }, socket)
      } else {
        const full = Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64')
        broadcast(room, { t: 'update', update: full }, socket)
      }
      return
    }
    if (message.t === 'presence') {
      const peer = cleanPeer(message.peer)
      if (!peer) return
      room.peers.set(socket, { info: peer })
      broadcast(room, { t: 'presence', peer }, socket)
      broadcastPeers(room)
    }
  })

  socket.on('close', () => {
    room.peers.delete(socket)
    room.updatedAt = Date.now()
    broadcastPeers(room)
  })

  socket.on('error', () => {
    try {
      socket.terminate()
    } catch {
      /* already closed */
    }
  })
})

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate()
      continue
    }
    socket.isAlive = false
    socket.ping()
  }
}, 30_000)

const sweep = setInterval(() => {
  const now = Date.now()
  for (const [id, room] of rooms) {
    if (!room.peers.size && now - room.updatedAt > ROOM_IDLE_MS) {
      room.doc.destroy()
      rooms.delete(id)
    }
  }
}, 5 * 60_000)

server.listen(PORT, HOST, () => {
  console.log(`[collab] ws://${HOST}:${PORT} · health http://${HOST}:${PORT}/health`)
})

function shutdown() {
  clearInterval(heartbeat)
  clearInterval(sweep)
  for (const socket of wss.clients) socket.close(1001, 'server shutdown')
  for (const room of rooms.values()) room.doc.destroy()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
