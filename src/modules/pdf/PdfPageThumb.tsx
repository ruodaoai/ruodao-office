import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { RenderTask } from 'pdfjs-dist'
import { Check } from 'lucide-react'

interface PdfPageThumbProps {
  doc: PDFDocumentProxy
  pageNumber: number
  selected: boolean
  onToggle: (page: number, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void
  rootRef: RefObject<HTMLDivElement>
}

export function PdfPageThumb({ doc, pageNumber, selected, onToggle, rootRef }: PdfPageThumbProps) {
  const hostRef = useRef<HTMLButtonElement>(null)
  const [aspect, setAspect] = useState(1 / 1.414)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let task: RenderTask | null = null

    const render = async () => {
      if (startedRef.current) return
      startedRef.current = true
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        setAspect(base.width / base.height)
        const scale = 320 / base.width
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width))
        canvas.height = Math.max(1, Math.floor(viewport.height))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        task = page.render({ canvasContext: ctx, viewport })
        await task.promise
        page.cleanup()
        if (cancelled) return
        const webp = canvas.toDataURL('image/webp', 0.86)
        setSrc(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'))
      } catch (error) {
        if (cancelled) return
        if (error instanceof Error && error.name === 'RenderingCancelledException') return
        setFailed(true)
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          void render()
        }
      },
      { root: rootRef.current ?? null, rootMargin: '480px 0px' },
    )
    observer.observe(host)
    return () => {
      cancelled = true
      observer.disconnect()
      task?.cancel()
    }
  }, [doc, pageNumber, rootRef])

  return (
    <button
      ref={hostRef}
      type="button"
      className={`pdf-page${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      aria-label={`第 ${pageNumber} 页${selected ? '，已选择' : ''}`}
      onClick={(event) =>
        onToggle(pageNumber, {
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        })
      }
    >
      <span className="pdf-page-sheet" style={{ aspectRatio: `${aspect}` }}>
        {src ? <img src={src} alt="" draggable={false} /> : <span className="pdf-page-skeleton" aria-hidden />}
        {failed ? <span className="pdf-page-failed">无法预览</span> : null}
        <span className="pdf-page-num">{pageNumber}</span>
        {selected ? (
          <span className="pdf-page-check" aria-hidden>
            <Check size={12} strokeWidth={3} />
          </span>
        ) : null}
      </span>
    </button>
  )
}
