import { useEffect, useState } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import { Modal } from '../../components/ui'
import { useT } from '../../i18n'

interface CommentDialogProps {
  open: boolean
  address: string
  value: string
  canEdit: boolean
  onClose: () => void
  onSave: (text: string) => void
  onDelete: () => void
}

export function CommentDialog({ open, address, value, canEdit, onClose, onSave, onDelete }: CommentDialogProps) {
  const t = useT()
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (!open) return
    setDraft(value)
  }, [open, value, address])

  const trimmed = draft.trim()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('单元格批注')}
      description={t('为 {address} 添加说明，鼠标悬停时会在单元格角标上显示。', { address })}
      width={460}
      className="comment-dialog"
      footer={
        <>
          {value && canEdit && (
            <button type="button" className="btn btn-ghost comment-delete-btn" onClick={onDelete}>
              <Trash2 size={13} />
              {t('删除批注')}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {canEdit ? t('取消') : t('关闭')}
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!trimmed}
              onClick={() => onSave(trimmed)}
            >
              <MessageSquare size={14} />
              {t('保存批注')}
            </button>
          )}
        </>
      }
    >
      {canEdit ? (
        <label className="comment-field">
          <span>{t('批注内容')}</span>
          <textarea
            className="input comment-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('例如：这列金额按含税价填写，月底复核。')}
            spellCheck={false}
            autoFocus
          />
        </label>
      ) : (
        <div className="comment-readonly">
          <p>{value || t('这个单元格还没有批注。')}</p>
          <span>{t('工作表已保护，取消保护后才能修改批注。')}</span>
        </div>
      )}
    </Modal>
  )
}
