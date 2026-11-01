import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { useUI } from '../store/ui'
import { t } from '../i18n'

export function Logo({ size = 38 }: { size?: number }) {
  return <img src="/logo.svg" width={size} height={size} alt={t('若道办公')} draggable={false} />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
  hideClose?: boolean
}

const modalStack: symbol[] = []

export function Modal({ open, onClose, title, description, children, footer, width, className, hideClose }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const id = Symbol('modal')
    modalStack.push(id)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || modalStack[modalStack.length - 1] !== id) return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const index = modalStack.indexOf(id)
      if (index >= 0) modalStack.splice(index, 1)
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div
        className={cn('modal', className)}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        {(title || !hideClose) && (
          <header className="modal-head">
            <div className="modal-head-text">
              {title && <h2 className="modal-title">{title}</h2>}
              {description && <p className="modal-desc">{description}</p>}
            </div>
            {!hideClose && (
              <button type="button" className="icon-btn" onClick={onClose} aria-label={t('关闭')}>
                <X size={17} />
              </button>
            )}
          </header>
        )}
        {children && <div className="modal-body">{children}</div>}
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, description, confirmText = t('确认删除'), danger = true, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('取消')}
          </button>
          <button
            type="button"
            className={cn('btn', danger ? 'btn-danger' : 'btn-primary')}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      {description && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: 'var(--ink-2)' }}>{description}</p>}
    </Modal>
  )
}

interface DropdownProps {
  trigger: ReactNode
  children: (close: () => void) => ReactNode
  className?: string
  align?: 'left' | 'right'
  title?: string
  portal?: boolean
}

export function Dropdown({
  trigger,
  children,
  className = 'btn btn-secondary btn-sm',
  align = 'right',
  title,
  portal = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left?: number; right?: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    if (!portal) return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }

    const update = () => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      setPosition(
        align === 'left'
          ? { top: rect.bottom + 5, left: Math.min(rect.left, window.innerWidth - 220) }
          : { top: rect.bottom + 5, right: Math.max(8, window.innerWidth - rect.right) },
      )
    }
    update()
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [align, open, portal])

  const menu = open && (!portal || position) ? (
    <div
      ref={menuRef}
      className={cn('menu', align === 'left' && 'menu-left')}
      style={portal ? { position: 'fixed', top: position?.top ?? 0, left: position?.left, right: position?.right } : undefined}
    >
      {children(() => setOpen(false))}
    </div>
  ) : null

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={className} onClick={() => setOpen((v) => !v)} title={title}>
        {trigger}
      </button>
      {portal ? menu && createPortal(menu, document.body) : menu}
    </div>
  )
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  return createPortal(
    <div className="toast-viewport" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={cn('toast', `toast-${toast.kind}`)}>
          {toast.kind === 'success' && <CheckCircle2 size={15} />}
          {toast.kind === 'error' && <AlertCircle size={15} />}
          {toast.kind === 'info' && <Info size={15} />}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

export function SectionHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-head">
      <div className="section-title">{children}</div>
      {aside}
    </div>
  )
}
