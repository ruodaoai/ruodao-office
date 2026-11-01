import { common } from './common'
import { shell } from './shell'
import { home } from './home'
import { settings } from './settings'
import { docs } from './docs'
import { sheets } from './sheets'
import { pdf } from './pdf'
import { notes } from './notes'
import { convert } from './convert'
import { ai } from './ai'
import { account } from './account'
import { glossary } from './glossary'
import { lib } from './lib'

/**
 * 英文词典：以中文原文为 key。
 * 同名 key 后合并的命名空间优先，保持各模块文件可独立维护。
 */
export const en: Record<string, string> = {
  ...common,
  ...lib,
  ...shell,
  ...home,
  ...settings,
  ...docs,
  ...sheets,
  ...pdf,
  ...notes,
  ...convert,
  ...ai,
  ...account,
  ...glossary,
}
