import { create } from 'zustand'
import { CollabClient, type CollabKind, type CollabPeer, type CollabRole, type CollabStatus } from '../lib/collab'
import { sanitizeDocHtml } from '../lib/markdown'
import { useLibrary } from './library'

export interface CollabSession {
  roomId: string
  kind: CollabKind
  recordId: string
  role: CollabRole
  wsUrl: string
  meName: string
}

type RoomStatus = CollabStatus | 'idle'

interface CollabState {
  session: CollabSession | null
  status: RoomStatus
  peers: CollabPeer[]
  error: string | null
  connect: (input: {
    roomId: string
    kind: CollabKind
    recordId: string
    role: CollabRole
    wsUrl: string
    meName: string
    title: string
    body: string
  }) => void
  leave: () => void
}

let active: CollabClient | null = null

export function activeCollabClient(): CollabClient | null {
  return active
}

export function publishCollabCursor(recordId: string, line: number, column: number) {
  const session = useCollab.getState().session
  if (!session || session.kind !== 'note' || session.recordId !== recordId) return
  active?.updateCursor({ line, column })
}

export const useCollab = create<CollabState>((set, get) => ({
  session: null,
  status: 'idle',
  peers: [],
  error: null,

  connect: (input) => {
    if (active) {
      active.close()
      active = null
    }
    const session: CollabSession = {
      roomId: input.roomId,
      kind: input.kind,
      recordId: input.recordId,
      role: input.role,
      wsUrl: input.wsUrl,
      meName: input.meName,
    }
    set({ session, status: 'connecting', peers: [], error: null })

    const client = new CollabClient(
      {
        roomId: input.roomId,
        wsUrl: input.wsUrl,
        kind: input.kind,
        role: input.role,
        title: input.title,
        body: input.body,
        me: { name: input.meName },
      },
      {
        onBody: (body) => {
          const current = get().session
          if (!current) return
          const library = useLibrary.getState()
          if (current.kind === 'note') {
            const note = library.notes.find((item) => item.id === current.recordId)
            if (note && note.content !== body) library.updateNote(note.id, { content: body })
          } else {
            const doc = library.docs.find((item) => item.id === current.recordId)
            if (!doc) return
            const html = sanitizeDocHtml(body)
            if (doc.html !== html) library.updateDoc(doc.id, { html })
          }
        },
        onTitle: (title) => {
          const current = get().session
          if (!current) return
          const clean = title.trim().slice(0, 160)
          if (!clean) return
          const library = useLibrary.getState()
          if (current.kind === 'note') {
            const note = library.notes.find((item) => item.id === current.recordId)
            if (note && note.title !== clean) library.updateNote(note.id, { title: clean })
          } else {
            const doc = library.docs.find((item) => item.id === current.recordId)
            if (doc && doc.title !== clean) library.updateDoc(doc.id, { title: clean })
          }
        },
        onPeers: (peers) => set({ peers }),
        onStatus: (status, error) => set({ status, error }),
      },
    )
    active = client
    client.connect()
  },

  leave: () => {
    if (active) {
      active.close()
      active = null
    }
    set({ session: null, status: 'idle', peers: [], error: null })
  },
}))
