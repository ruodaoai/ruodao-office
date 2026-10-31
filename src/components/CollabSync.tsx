import { useEffect } from 'react'
import { activeCollabClient } from '../store/collab'
import { useCollab } from '../store/collab'
import { useLibrary } from '../store/library'

export function CollabSync() {
  const session = useCollab((s) => s.session)
  const status = useCollab((s) => s.status)

  useEffect(() => {
    if (!session) return
    const push = () => {
      if (useCollab.getState().status !== 'online') return
      const client = activeCollabClient()
      if (!client) return
      const library = useLibrary.getState()
      if (session.kind === 'note') {
        const note = library.notes.find((item) => item.id === session.recordId)
        if (!note) return
        client.setBody(note.content)
        if (session.role === 'host' || client.hasTitle()) client.setTitle(note.title)
      } else {
        const doc = library.docs.find((item) => item.id === session.recordId)
        if (!doc) return
        client.setBody(doc.html)
        if (session.role === 'host' || client.hasTitle()) client.setTitle(doc.title)
      }
    }
    push()
    const unsubscribe = useLibrary.subscribe(push)
    return unsubscribe
  }, [session, status])

  return null
}
