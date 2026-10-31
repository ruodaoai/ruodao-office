import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus2, FileText, FileUp, Plus, Search, X } from 'lucide-react'
import { importDocFile } from '../../lib/openFiles'
import { cn, htmlToText, timeAgo } from '../../lib/utils'
import { useLibrary } from '../../store/library'
import { useUI } from '../../store/ui'
import { DocEditor } from './DocEditor'

export function DocsModule() {
  const docs = useLibrary((s) => s.docs)
  const activeDocId = useLibrary((s) => s.activeDocId)
  const setActive = useLibrary((s) => s.setActive)
  const createDoc = useLibrary((s) => s.createDoc)
  const toast = useUI((s) => s.toast)

  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const sorted = useMemo(() => [...docs].sort((a, b) => b.updatedAt - a.updatedAt), [docs])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return sorted
    return sorted.filter((doc) =>
      `${doc.title}\n${htmlToText(doc.html)}`.toLowerCase().includes(keyword),
    )
  }, [sorted, query])

  const activeDoc = docs.find((doc) => doc.id === activeDocId) ?? null

  useEffect(() => {
    if (!docs.some((doc) => doc.id === activeDocId)) setActive('doc', docs[0]?.id ?? null)
  }, [docs, activeDocId, setActive])

  const handleNew = () => {
    createDoc()
    setQuery('')
    toast('已新建空白文档', 'success')
  }

  const importFile = async (file: File) => {
    setImporting(true)
    try {
      const info = await importDocFile(file)
      if (info.reused) {
        toast(`《${info.title}》已有编辑版本，已为你打开`, 'info')
      } else if (info.hasSource) {
        toast(
          info.warnings
            ? `已打开原稿，${info.warnings} 处格式在编辑视图中会近似还原`
            : '已打开原稿，可切换编辑视图继续修改',
          'success',
        )
      } else {
        toast(file.name.toLowerCase().endsWith('.html') ? 'HTML 文档已导入' : '文本已导入', 'success')
      }
      setQuery('')
    } catch (error) {
      toast((error as Error).message || '导入失败，请检查文件', 'error')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <div className="docs-side-head">
          <div className="docs-side-title-wrap">
            <h1 className="docs-side-title">文档</h1>
            <span className="docs-side-count">{docs.length}</span>
          </div>
          <button type="button" className="icon-btn" onClick={handleNew} title="新建文档" aria-label="新建文档">
            <Plus size={16} />
          </button>
        </div>

        <div className="docs-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题或正文"
            aria-label="搜索文档"
          />
          {query && (
            <button type="button" className="docs-search-clear" onClick={() => setQuery('')} aria-label="清除搜索">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="docs-list" role="list">
          {filtered.map((doc) => {
            const excerpt = htmlToText(doc.html).replace(/\s+/g, ' ')
            return (
              <button
                key={doc.id}
                type="button"
                role="listitem"
                className={cn('doc-item', doc.id === activeDocId && 'active')}
                onClick={() => setActive('doc', doc.id)}
              >
                <span className="doc-item-title">{doc.title}</span>
                <span className="doc-item-time tabular">{timeAgo(doc.updatedAt)}</span>
                <span className="doc-item-sub">{excerpt || '空白文档，等待落笔。'}</span>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="docs-list-empty">
              <FileText size={18} />
              <p>{docs.length === 0 ? '还没有文档。' : `没有匹配「${query.trim()}」的文档。`}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleNew}>
                <FilePlus2 size={13} />
                新建文档
              </button>
            </div>
          )}
        </div>

        <div className="docs-side-foot">
          <button
            type="button"
            className="docs-import-btn"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <FileUp size={14} />}
            {importing ? '正在解析…' : '导入 Word / HTML'}
          </button>
          <p>文件只解析并保存在本机。</p>
        </div>
      </aside>

      <section className="docs-main">
        {activeDoc ? (
          <DocEditor key={activeDoc.id} doc={activeDoc} />
        ) : (
          <div className="docs-blank">
            <div className="docs-blank-paper">
              <span className="docs-blank-mark">文</span>
              <h2>从一页空白开始。</h2>
              <p>写作、排版、导出，都在本机完成。也可以直接导入已有的 Word 文档继续编辑。</p>
              <div className="docs-blank-actions">
                <button type="button" className="btn btn-primary" onClick={handleNew}>
                  <Plus size={14} />
                  新建文档
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
                  <FileUp size={14} />
                  导入 Word
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <input
        ref={fileRef}
        type="file"
        accept=".docx,.html,.htm,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,text/plain,text/markdown"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
        }}
      />
    </div>
  )
}
