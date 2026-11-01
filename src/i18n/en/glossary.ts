/**
 * 术语表：最后合并，专门钉住各模块共用的通用词，
 * 避免不同命名空间对同一个中文词给出不一致的译文。
 */
export const glossary: Record<string, string> = {
  // 模块与文件类型（用于左侧导轨、命令面板、文件列表）
  文档: 'Documents',
  表格: 'Spreadsheets',
  笔记: 'Notes',
  PDF: 'PDF',
  转换: 'Convert',
  动作: 'Actions',
  导航: 'Go to',
  文件: 'Files',

  // 跨模块动作（PDF 工具页签与转换动作共用）
  压缩: 'Compress',
  '写入 PDF': 'Write into PDF',
  合并: 'Merge',
  拆分: 'Split',
  水印: 'Watermark',
  页码: 'Page numbers',
  签章: 'Signature',
  '提取文本': 'Extract text',
  导出图片: 'Export images',
}
