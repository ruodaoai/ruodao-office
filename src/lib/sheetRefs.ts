export interface CellPos {
  row: number
  col: number
}

export function colToName(col: number): string {
  let n = col + 1
  let name = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

export function nameToCol(name: string): number {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`
}

export function keysToRef(key: string): string {
  const [r, c] = key.split(':').map(Number)
  return `${colToName(c)}${r + 1}`
}

export function refToPos(ref: string): CellPos | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim())
  if (!m) return null
  const col = nameToCol(m[1])
  const row = Number(m[2]) - 1
  if (row < 0 || col < 0) return null
  return { row, col }
}

export function formatRange(start: CellPos, end: CellPos): string {
  const r1 = Math.min(start.row, end.row)
  const r2 = Math.max(start.row, end.row)
  const c1 = Math.min(start.col, end.col)
  const c2 = Math.max(start.col, end.col)
  if (r1 === r2 && c1 === c2) return `${colToName(c1)}${r1 + 1}`
  return `${colToName(c1)}${r1 + 1}:${colToName(c2)}${r2 + 1}`
}
