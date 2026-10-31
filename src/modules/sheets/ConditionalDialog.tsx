import { useEffect, useState } from 'react'
import { Paintbrush, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { ConditionalKind, ConditionalRule, ConditionalTone, SheetTab } from '../../types'
import { Modal } from '../../components/ui'
import { formatRange } from '../../lib/sheetRefs'
import { cn, uid } from '../../lib/utils'

interface Rect {
  r1: number
  r2: number
  c1: number
  c2: number
}

interface ConditionalDialogProps {
  open: boolean
  tab: SheetTab
  scope: Rect | null
  initialKind: ConditionalKind
  onClose: () => void
  onAdd: (rule: ConditionalRule) => void
  onRemove: (id: string) => void
}

const KINDS: Array<{ value: ConditionalKind; label: string; hint: string }> = [
  { value: 'dataBar', label: '数据条', hint: '用长度比较数值大小' },
  { value: 'colorScale', label: '色阶', hint: '用深浅表示高低' },
  { value: 'greater', label: '大于', hint: '高于阈值时高亮' },
  { value: 'less', label: '小于', hint: '低于阈值时高亮' },
  { value: 'between', label: '介于', hint: '落在区间内时高亮' },
  { value: 'equal', label: '等于', hint: '命中指定值时高亮' },
  { value: 'duplicate', label: '重复值', hint: '标记重复出现的内容' },
]

const TONES: Array<{ value: ConditionalTone; label: string; color: string; soft: string }> = [
  { value: 'accent', label: '朱砂', color: '#c8442b', soft: '#fbe9e3' },
  { value: 'green', label: '松绿', color: '#2f7457', soft: '#e9f2ec' },
  { value: 'amber', label: '琥珀', color: '#a9772d', soft: '#fdf3dd' },
  { value: 'blue', label: '黛蓝', color: '#35587a', soft: '#eaf0f5' },
]

function ruleText(rule: ConditionalRule): string {
  if (rule.kind === 'dataBar') return '数据条'
  if (rule.kind === 'colorScale') return '色阶'
  if (rule.kind === 'duplicate') return '重复值'
  if (rule.kind === 'greater') return `大于 ${rule.value ?? 0}`
  if (rule.kind === 'less') return `小于 ${rule.value ?? 0}`
  if (rule.kind === 'equal') return `等于 ${rule.value ?? 0}`
  return `介于 ${rule.value ?? 0} 与 ${rule.value2 ?? 0}`
}

function needsValue(kind: ConditionalKind): boolean {
  return kind === 'greater' || kind === 'less' || kind === 'equal' || kind === 'between'
}

export function ConditionalDialog({ open, tab, scope, initialKind, onClose, onAdd, onRemove }: ConditionalDialogProps) {
  const [kind, setKind] = useState<ConditionalKind>(initialKind)
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [tone, setTone] = useState<ConditionalTone>('accent')

  useEffect(() => {
    if (!open) return
    setKind(initialKind)
    setValue('')
    setValue2('')
    setTone('accent')
  }, [initialKind, open])

  if (!scope) return null

  const address = formatRange({ row: scope.r1, col: scope.c1 }, { row: scope.r2, col: scope.c2 })
  const rules = tab.conditional ?? []
  const numeric = Number(value)
  const numeric2 = Number(value2)
  const valid =
    !needsValue(kind) ||
    (value.trim() !== '' && Number.isFinite(numeric) && (kind !== 'between' || (value2.trim() !== '' && Number.isFinite(numeric2))))

  const add = () => {
    if (!valid) return
    onAdd({
      id: uid(),
      kind,
      r1: scope.r1,
      r2: scope.r2,
      c1: scope.c1,
      c2: scope.c2,
      tone,
      ...(needsValue(kind) ? { value: numeric } : {}),
      ...(kind === 'between' ? { value2: numeric2 } : {}),
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="条件格式"
      description={`规则会实时套用到 ${address}，并随数值变化重新计算。`}
      width={600}
      className="conditional-dialog"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={add} disabled={!valid}>
            <Plus size={14} />
            添加规则
          </button>
        </>
      }
    >
      <div className="conditional-layout">
        <div className="conditional-builder">
          <div className="conditional-kind-grid">
            {KINDS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={cn('conditional-kind', kind === item.value && 'active')}
                onClick={() => setKind(item.value)}
              >
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>

          {needsValue(kind) && (
            <div className="conditional-values">
              <label>
                <span>{kind === 'between' ? '下限' : '数值'}</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="例如 100"
                />
              </label>
              {kind === 'between' && (
                <label>
                  <span>上限</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={value2}
                    onChange={(event) => setValue2(event.target.value)}
                    placeholder="例如 500"
                  />
                </label>
              )}
            </div>
          )}

          <div className="conditional-tones">
            <span className="conditional-tone-label">标记颜色</span>
            <div className="conditional-tone-row">
              {TONES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={cn('conditional-tone', tone === item.value && 'active')}
                  onClick={() => setTone(item.value)}
                  title={item.label}
                  aria-label={item.label}
                >
                  <i style={{ background: item.color }} />
                  <span style={{ background: item.soft }}>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="conditional-preview">
            <Paintbrush size={15} />
            <p>
              {kind === 'dataBar' && '在单元格内绘制比例条，数字越大条越长。'}
              {kind === 'colorScale' && '按数值大小在底色上渐变，适合快速扫读。'}
              {kind === 'duplicate' && '相同内容第二次及以后出现时会被标记。'}
              {needsValue(kind) && `符合「${ruleText({ id: '', kind, r1: 0, r2: 0, c1: 0, c2: 0, value: numeric, value2: numeric2 })}」的单元格会使用所选底色与字色。`}
            </p>
          </div>
        </div>

        <aside className="conditional-existing">
          <div className="conditional-existing-head">
            <h3>已有规则</h3>
            <span>{rules.length}</span>
          </div>
          {rules.length > 0 ? (
            <div className="conditional-rule-list">
              {rules.map((rule) => (
                <div key={rule.id} className="conditional-rule">
                  <span className={cn('conditional-rule-dot', `tone-${rule.tone ?? 'accent'}`)} />
                  <div>
                    <strong>{ruleText(rule)}</strong>
                    <em>{formatRange({ row: rule.r1, col: rule.c1 }, { row: rule.r2, col: rule.c2 })}</em>
                  </div>
                  <button type="button" className="icon-btn" title="删除规则" onClick={() => onRemove(rule.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="conditional-empty">
              <Sparkles size={16} />
              <p>还没有规则。选好类型后添加第一条。</p>
            </div>
          )}
          <p className="conditional-note">规则只在若道内生效；导出 Excel 时会保留底色，但不会写入可编辑的条件格式。</p>
        </aside>
      </div>
    </Modal>
  )
}
