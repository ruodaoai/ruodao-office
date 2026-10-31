import type { CellData, DocRecord, LibrarySnapshot, NoteRecord, SheetRecord, SheetTab } from './types'
import { uid } from './lib/utils'
import { nameToCol } from './lib/sheetRefs'

const WELCOME_DOC = `
<h1>把文件，留在自己手里</h1>
<p>若道办公是一套<strong>本地优先</strong>的办公套件。文档、表格、PDF 与双链笔记在同一个工作台里完成，文件默认只保存在这台设备上。</p>
<h2>这一版可以做什么</h2>
<ul>
  <li><strong>文档</strong>——富文本编辑、自动保存、导入 Word，导出 DOCX / HTML / PDF。</li>
  <li><strong>表格</strong>——常用公式、数字格式、多工作表，兼容 XLSX / CSV。</li>
  <li><strong>PDF 工具箱</strong>——合并、拆分、水印、页码、OCR 与格式转换，全程离线。</li>
  <li><strong>双链笔记</strong>——用 <code>[[链接]]</code> 串起资料，反向链接自动生成。</li>
  <li><strong>AI 助手</strong>——可接入 OpenAI 兼容服务或本机 Ollama；没有模型时也能离线摘要。</li>
</ul>
<blockquote>没有账号体系，也没有上传队列。你的内容会写入浏览器本地的 IndexedDB，随时可以打包备份。</blockquote>
<h2>试试看</h2>
<p>按 <code>Ctrl / ⌘ + K</code> 打开命令面板，或从左侧切换到示例表格与笔记。这份文档可以直接编辑，所有修改都会自动保存。</p>
<table>
  <thead><tr><th>原则</th><th>落地方式</th></tr></thead>
  <tbody>
    <tr><td>文件属于你</td><td>本地数据库、JSON 备份、无云端依赖</td></tr>
    <tr><td>开源免费</td><td>全部功能开放，不收订阅费或授权费</td></tr>
    <tr><td>AI 可控</td><td>自带 Key 或本地模型，内容只发往你指定的服务</td></tr>
  </tbody>
</table>
<p>祝工作顺利。</p>
`.trim()

function makeTab(name: string): SheetTab {
  return {
    id: uid(),
    name,
    cells: {},
    rows: 80,
    cols: 18,
    colWidths: {},
  }
}

function keyOf(ref: string): string {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) throw new Error(`Bad ref ${ref}`)
  return `${Number(m[2]) - 1}:${nameToCol(m[1])}`
}

const BUDGET_TEXT: Array<[string, string, string, string, string, string]> = [
  ['A1', '项目', 'B1', 'Q1', 'C1', 'Q2'],
]
void BUDGET_TEXT

function buildBudgetSheet(): SheetRecord {
  const tab = makeTab('年度预算')
  tab.colWidths = { 0: 138, 1: 104, 2: 104, 3: 104, 4: 104, 5: 112 }
  const cells = tab.cells
  const put = (ref: string, raw: string, style?: CellData['style']) => {
    cells[keyOf(ref)] = { raw, ...(style ? { style } : {}) }
  }
  const header = { bold: true, bg: '#F2ECE1', color: '#443D33' }
  const totalRow = { bold: true, bg: '#FAF5EC' }
  const pct = { fmt: 'percent' as const }

  const columns = ['B', 'C', 'D', 'E', 'F']
  const labels = ['Q1', 'Q2', 'Q3', 'Q4', '全年']
  const headers = ['项目', ...labels]
  headers.forEach((text, i) => put(`${String.fromCharCode(65 + i)}1`, text, header))

  const rows: Array<{ label: string; values: Array<string> }> = [
    { label: '人力成本', values: ['320000', '336000', '344000', '362000'] },
    { label: '市场投放', values: ['128000', '132000', '146000', '158000'] },
    { label: '云与工具', values: ['36000', '36000', '39000', '42000'] },
  ]

  rows.forEach((row, idx) => {
    const r = idx + 2
    put(`A${r}`, row.label)
    row.values.forEach((v, i) => put(`${columns[i]}${r}`, v))
    put(`F${r}`, `=SUM(B${r}:E${r})`)
  })

  put('A5', '成本合计', totalRow)
  ;['B', 'C', 'D', 'E'].forEach((col) => put(`${col}5`, `=SUM(${col}2:${col}4)`, totalRow))
  put('F5', '=SUM(F2:F4)', totalRow)

  put('A7', '预计收入', { bold: true })
  ;['618000', '642000', '668000', '696000'].forEach((v, i) => put(`${columns[i]}7`, v))
  put('F7', '=SUM(B7:E7)', { bold: true })

  put('A8', '利润率', { bold: true })
  ;['B', 'C', 'D', 'E', 'F'].forEach((col) => put(`${col}8`, `=(${col}7-${col}5)/${col}7`, pct))

  put('A10', '备注：示例数据，可直接修改公式与数字。')
  cells[keyOf('A10')]!.style = { color: '#8A8175', italic: true }

  tab.freeze = { rows: 1, cols: 1 }
  tab.conditional = [
    { id: uid(), kind: 'dataBar', r1: 1, r2: 4, c1: 5, c2: 5, tone: 'accent' },
    { id: uid(), kind: 'colorScale', r1: 1, r2: 3, c1: 1, c2: 4, tone: 'amber' },
  ]
  tab.charts = [
    {
      id: uid(),
      kind: 'column',
      title: '季度成本构成',
      r1: 0,
      r2: 3,
      c1: 0,
      c2: 4,
      headerRow: true,
      headerCol: true,
    },
  ]

  return {
    id: uid(),
    kind: 'sheet',
    title: '年度运营预算（示例）',
    tabs: [tab],
    activeTab: 0,
    createdAt: Date.now() - 1000 * 60 * 46,
    updatedAt: Date.now() - 1000 * 60 * 11,
  }
}

const NOTE_PRINCIPLES = `# 产品原则

若道只做三件事：把文件留在本机、把工具做得足够快、让 AI 听你的。

## 一、本地优先
文档、表格、笔记自动保存在当前设备。PDF 的合并、拆分、水印与 OCR 全部在浏览器里完成，没有上传队列，也没有水印广告。

## 二、开源免费
若道办公以开源方式发布，全部功能免费使用。没有订阅、授权码，也不会为了导出 PDF 再收一次费。

## 三、AI 是工具，不是房东
你可以接自己的 OpenAI 兼容服务，或把 Ollama 跑在本机。没有账号也能用离线摘要。

---

延伸阅读：[[本地优先清单]]、[[上手清单]]
`

const NOTE_CHECKLIST = `# 本地优先清单

- [x] 文档自动保存，无需登录
- [x] PDF 离线处理，不上传文件
- [x] 数据可一键导出为 JSON 备份
- [ ] 端到端加密的多设备同步（规划中）

> 设计取舍与理由写在 [[产品原则]] 里。

## 下周要验证
1. 50 页扫描件 OCR 的耗时
2. Word 导入后的表格样式还原度
3. 本地 7B 模型在 16GB 内存机器上的可用性

参见 [[上手清单]]。
`

const NOTE_START = `# 上手清单

## 键盘优先
- \`Ctrl / ⌘ + K\` 命令面板
- \`Ctrl / ⌘ + S\` 立即保存
- 表格内 \`Enter\` 下移、\`Tab\` 右移、\`F2\` 编辑

## 建议路径
1. 新建一份文档，试一次导入 DOCX
2. 在表格里改一个数字，看合计如何联动
3. 把合同拖进 PDF 工具箱，加一行水印
4. 用 [[产品原则]] 里的方式接入自己的 AI Key

> 所有功能都不需要注册账号。
`

export function createSeedSnapshot(): LibrarySnapshot {
  const doc: DocRecord = {
    id: uid(),
    kind: 'doc',
    title: '欢迎使用若道办公',
    html: WELCOME_DOC,
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
    updatedAt: Date.now() - 1000 * 60 * 3,
  }
  const sheet = buildBudgetSheet()
  const notes: NoteRecord[] = [
    {
      id: uid(),
      kind: 'note',
      title: '产品原则',
      content: NOTE_PRINCIPLES,
      createdAt: Date.now() - 1000 * 60 * 60 * 30,
      updatedAt: Date.now() - 1000 * 60 * 60 * 5,
    },
    {
      id: uid(),
      kind: 'note',
      title: '本地优先清单',
      content: NOTE_CHECKLIST,
      createdAt: Date.now() - 1000 * 60 * 60 * 26,
      updatedAt: Date.now() - 1000 * 60 * 60 * 2,
    },
    {
      id: uid(),
      kind: 'note',
      title: '上手清单',
      content: NOTE_START,
      createdAt: Date.now() - 1000 * 60 * 60 * 12,
      updatedAt: Date.now() - 1000 * 60 * 42,
    },
  ]

  return {
    docs: [doc],
    sheets: [sheet],
    notes,
    activeDocId: doc.id,
    activeSheetId: sheet.id,
    activeNoteId: notes[0].id,
  }
}
