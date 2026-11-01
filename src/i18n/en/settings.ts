/** 设置对话框（含通用 / AI 助手 / 数据与隐私 / 关于与开源）。 */
export const settings: Record<string, string> = {
  // 页签
  通用: 'General',
  'AI 助手': 'AI assistant',
  数据与隐私: 'Data & privacy',
  关于与开源: 'About & open source',

  // 外壳
  '所有配置与数据只保存在当前设备。': 'All settings and data stay on this device.',

  // 通用 · 界面语言
  '切换语言后立即生效，已保存的内容不受影响。':
    'The change applies immediately and does not affect your saved content.',
  跟随系统语言: 'Follow system language',

  // AI 助手 · 模型服务
  模型服务: 'Model service',
  '选择预设，或填写任意 OpenAI 兼容端点。也可以把 Ollama 跑在本机，完全离线。':
    'Pick a preset, or point to any OpenAI-compatible endpoint. You can also run Ollama locally and stay fully offline.',
  尚未登录若道: 'Not signed in to Ruodao',
  '登录后自动读取账户可用的云端模型，无需填写 API Key。':
    'Sign in to load the cloud models available to your account — no API key needed.',
  账户: 'Account',
  登录: 'Sign in',
  云端模型: 'Cloud model',
  请选择模型: 'Select a model',
  登录后选择: 'Sign in to choose',
  '{model}（当前不可用）': '{model} (currently unavailable)',
  '{label}（{name}）': '{label} ({name})',
  刷新云端模型: 'Refresh cloud models',
  '模型的可用性与计费由若道账户控制。':
    'Model availability and billing are managed by your Ruodao account.',
  鉴权与计费: 'Auth & billing',
  '登录令牌鉴权 · 按若道账户额度计费':
    'Token-based sign-in · billed against your Ruodao account quota',
  'API 地址': 'API base URL',
  模型: 'Model',
  '本地 Ollama 通常无需 Key': 'Local Ollama usually needs no key',
  隐藏密钥: 'Hide key',
  显示密钥: 'Show key',
  '密钥保存在本机浏览器存储中。若更在意安全，可只把 Ollama 暴露在本机。':
    'The key is saved in this device’s browser storage. If you would rather not, keep Ollama local-only.',
  保存配置: 'Save settings',
  测试连接: 'Test connection',
  '连接成功，可以开始对话': 'Connected — you can start chatting',
  '请先登录若道账户': 'Sign in to your Ruodao account first',
  '请选择一个云端模型': 'Select a cloud model',
  '已切换到若道云端模型': 'Switched to a Ruodao cloud model',
  '请填写 API 地址与模型名称': 'Enter the API address and model name',
  'AI 配置已保存': 'AI settings saved',

  // AI 助手 · 说明
  本地离线能力: 'Local offline features',
  '即使没有配置任何模型，你仍然可以对当前文档、选区或笔记使用「离线摘要」和「关键词提取」：全部在本机计算，不发送任何内容。配置模型后，才启用对话、润色与续写。':
    'Even with no model configured, you can run Offline summary and Keyword extraction on the current document, selection or note: everything is computed on this device and nothing is sent. Chat, rewriting and continuation unlock once a model is configured.',
  隐私边界: 'Privacy boundary',
  '对话内容只会发送到你填写的 API 地址；若使用 Ollama，数据留在本机。若服务商不允许浏览器直连（CORS），可改用本机 Ollama，或在桌面壳中通过本地代理访问。':
    'Conversations are only sent to the API address you enter; with Ollama, data stays on this machine. If your provider blocks direct browser access (CORS), use local Ollama or reach it through the local proxy in the desktop shell.',

  // 数据与隐私
  本地存储概览: 'Local storage overview',
  文档: 'Documents',
  表格: 'Sheets',
  笔记: 'Notes',
  'IndexedDB 已连接 · 约 {size} · 最后更新 {time}':
    'IndexedDB connected · about {size} · last updated {time}',
  备份与迁移: 'Backup & migration',
  '导出的 JSON 包含全部文档、表格与笔记，不包含 AI 密钥。换设备时导入即可恢复。':
    'The exported JSON contains every document, sheet and note, but no AI keys. Import it on another device to restore.',
  导出完整备份: 'Export full backup',
  导入备份: 'Import backup',
  备份已导出到下载目录: 'Backup exported to your downloads folder',
  '若道办公-备份-{date}.json': 'Ruodao-Office-backup-{date}.json',
  危险操作: 'Danger zone',
  清空本地数据: 'Erase local data',
  '删除此设备上的全部文档、表格与笔记。该操作不可撤销，建议先导出备份。':
    'Delete every document, sheet and note on this device. This cannot be undone — export a backup first.',
  本地数据已清空: 'Local data erased',

  // 导入 / 清空
  '导入并覆盖当前数据？': 'Import and overwrite current data?',
  '当前设备上的文档、表格与笔记会被备份文件中的内容替换。建议先导出当前数据。':
    'Documents, sheets and notes on this device will be replaced by the contents of the backup file. Export your current data first.',
  '覆盖并导入': 'Overwrite and import',
  备份已导入: 'Backup imported',
  '不是有效的若道办公备份': 'Not a valid Ruodao Office backup',
  备份文件解析失败: 'Could not read the backup file',
  '清空全部本地数据？': 'Erase all local data?',
  '此操作会永久删除当前设备上的所有文档、表格与笔记，且无法恢复。':
    'This permanently deletes every document, sheet and note on this device, and cannot be undone.',
  确认清空: 'Erase everything',

  // 关于与开源
  若道办公: 'Ruodao Office',
  'RUODAO OFFICE · v0.1 · 本地优先版': 'RUODAO OFFICE · v0.1 · Local-first',
  '开源免费 · 全部功能开放': 'Free and open source · everything unlocked',
  '若道办公以开源方式发布，不收取任何费用。没有订阅、授权码或按次导出收费，全部本地功能默认可用。':
    'Ruodao Office is released as open source at no charge. No subscriptions, license codes or per-export fees — every local feature works out of the box.',
  永久免费: 'Free forever',
  无订阅: 'No subscription',
  '无广告 / 无水印': 'No ads, no watermarks',
  '离线 PDF / OCR': 'Offline PDF / OCR',
  '自带 AI 模型': 'Bring your own model',
  整包备份: 'Full backup',
  这一版包含: 'In this release',
  '富文本文档与 DOCX 导入导出 · 带图表与 BI 看板的表格和 XLSX 互操作 · 离线 PDF 合并 / 拆分 / 水印 / 页码 / 签章 / 批注 / 压缩 / 转 Word / OCR · 图片 / PDF / 文档 / 表格 / ZIP 的本地批量转换 · 支持反向链接的 Markdown 笔记 · 可接入 OpenAI 兼容服务或本地 Ollama 的 AI 助手。':
    'Rich-text documents with DOCX import and export · spreadsheets with charts and BI dashboards plus XLSX interop · offline PDF merge / split / watermark / page numbers / stamps / comments / compress / to Word / OCR · batch local conversion of images, PDFs, documents, sheets and ZIP files · Markdown notes with backlinks · an AI assistant that connects to OpenAI-compatible services or local Ollama.',
  技术说明: 'Technical notes',
  '前端使用 React + TypeScript 构建；数据保存在 IndexedDB；PDF 处理使用 pdf-lib 与 PDF.js；OCR 使用 Tesseract.js。桌面安装壳使用 Electron，多设备实时协作通过自建服务完成。':
    'The front end is built with React and TypeScript; data lives in IndexedDB; PDF work uses pdf-lib and PDF.js; OCR uses Tesseract.js. The desktop build runs on Electron, and multi-device collaboration goes through a self-hosted service.',
}
