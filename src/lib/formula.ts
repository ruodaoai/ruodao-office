import type { SheetTab } from '../types'
import { cellKey, refToPos } from './sheetRefs'

export type FormulaErrorCode =
  | '#DIV/0!'
  | '#VALUE!'
  | '#NAME?'
  | '#REF!'
  | '#CYCLE!'
  | '#NUM!'
  | '#N/A'

export class FormulaError {
  readonly code: FormulaErrorCode

  constructor(code: FormulaErrorCode) {
    this.code = code
  }

  toString(): string {
    return this.code
  }
}

export type CellValue = number | string | boolean | FormulaError

export function isFormulaError(value: unknown): value is FormulaError {
  return value instanceof FormulaError
}

type TokenType = 'num' | 'str' | 'ident' | 'op' | 'eof'

interface Token {
  type: TokenType
  value: string
}

type ExprNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'ref'; ref: string }
  | { kind: 'range'; start: string; end: string }
  | { kind: 'unary'; op: '+' | '-'; expr: ExprNode }
  | { kind: 'percent'; expr: ExprNode }
  | { kind: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[] }

type ArgValue = CellValue | CellValue[]

const COMPARISON_OPS = new Set(['=', '<>', '<', '>', '<=', '>='])
const MAX_RANGE_CELLS = 20000

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < source.length) {
    const ch = source[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }

    if (ch === '"') {
      let value = ''
      let closed = false
      i += 1
      while (i < source.length) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            value += '"'
            i += 2
            continue
          }
          closed = true
          i += 1
          break
        }
        value += source[i]
        i += 1
      }
      if (!closed) throw new FormulaError('#VALUE!')
      tokens.push({ type: 'str', value })
      continue
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i))
      if (!match) throw new FormulaError('#VALUE!')
      tokens.push({ type: 'num', value: match[0] })
      i += match[0].length
      continue
    }

    if (/[A-Za-z_$\u4e00-\u9fff]/.test(ch)) {
      let end = i + 1
      while (end < source.length && /[A-Za-z0-9_.$\u4e00-\u9fff]/.test(source[end])) end += 1
      tokens.push({ type: 'ident', value: source.slice(i, end) })
      i = end
      continue
    }

    const pair = source.slice(i, i + 2)
    if (pair === '<=' || pair === '>=' || pair === '<>') {
      tokens.push({ type: 'op', value: pair })
      i += 2
      continue
    }

    if ('+-*/^&%=<>(),:'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }

    throw new FormulaError('#VALUE!')
  }

  tokens.push({ type: 'eof', value: '' })
  return tokens
}

class Parser {
  private pos = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    const node = this.comparison()
    if (this.peek().type !== 'eof') throw new FormulaError('#VALUE!')
    return node
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private next(): Token {
    const token = this.tokens[this.pos]
    if (this.pos < this.tokens.length - 1) this.pos += 1
    return token
  }

  private matchOp(op: string): boolean {
    const token = this.peek()
    if (token.type === 'op' && token.value === op) {
      this.pos += 1
      return true
    }
    return false
  }

  private expectOp(op: string): void {
    if (!this.matchOp(op)) throw new FormulaError('#VALUE!')
  }

  private comparison(): ExprNode {
    let left = this.concat()
    while (this.peek().type === 'op' && COMPARISON_OPS.has(this.peek().value)) {
      const op = this.next().value
      left = { kind: 'binary', op, left, right: this.concat() }
    }
    return left
  }

  private concat(): ExprNode {
    let left = this.additive()
    while (this.matchOp('&')) {
      left = { kind: 'binary', op: '&', left, right: this.additive() }
    }
    return left
  }

  private additive(): ExprNode {
    let left = this.multiplicative()
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value
      left = { kind: 'binary', op, left, right: this.multiplicative() }
    }
    return left
  }

  private multiplicative(): ExprNode {
    let left = this.power()
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value
      left = { kind: 'binary', op, left, right: this.power() }
    }
    return left
  }

  private power(): ExprNode {
    const left = this.unary()
    if (this.matchOp('^')) return { kind: 'binary', op: '^', left, right: this.power() }
    return left
  }

  private unary(): ExprNode {
    const token = this.peek()
    if (token.type === 'op' && (token.value === '+' || token.value === '-')) {
      this.next()
      return { kind: 'unary', op: token.value as '+' | '-', expr: this.unary() }
    }
    return this.postfix()
  }

  private postfix(): ExprNode {
    let expr = this.primary()
    while (this.matchOp('%')) expr = { kind: 'percent', expr }
    return expr
  }

  private primary(): ExprNode {
    const token = this.peek()

    if (token.type === 'num') {
      this.next()
      return { kind: 'num', value: Number(token.value) }
    }

    if (token.type === 'str') {
      this.next()
      return { kind: 'str', value: token.value }
    }

    if (token.type === 'op' && token.value === '(') {
      this.next()
      const expr = this.comparison()
      this.expectOp(')')
      return expr
    }

    if (token.type === 'ident') {
      this.next()
      if (this.matchOp('(')) {
        const args: ExprNode[] = []
        if (!this.matchOp(')')) {
          args.push(this.comparison())
          while (this.matchOp(',')) args.push(this.comparison())
          this.expectOp(')')
        }
        return { kind: 'call', name: token.value.toUpperCase(), args }
      }

      const upper = token.value.toUpperCase()
      if (upper === 'TRUE') return { kind: 'bool', value: true }
      if (upper === 'FALSE') return { kind: 'bool', value: false }

      if (refToPos(token.value)) {
        if (this.matchOp(':')) {
          const end = this.next()
          if (end.type !== 'ident' || !refToPos(end.value)) throw new FormulaError('#REF!')
          return { kind: 'range', start: token.value, end: end.value }
        }
        return { kind: 'ref', ref: token.value }
      }

      throw new FormulaError('#NAME?')
    }

    throw new FormulaError('#VALUE!')
  }
}

function parseFormula(source: string): ExprNode {
  return new Parser(tokenize(source)).parse()
}

function literalValue(raw: string): CellValue {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const value = Number(trimmed)
    if (Number.isFinite(value)) return value
  }
  if (/^true$/i.test(trimmed)) return true
  if (/^false$/i.test(trimmed)) return false
  return raw
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateLabel(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function timeLabel(now: Date): string {
  return `${dateLabel(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function numberText(value: number): string {
  if (Number.isInteger(value)) return String(value)
  if (!Number.isFinite(value)) return '#NUM!'
  const precise = Number(value.toPrecision(15))
  return String(precise)
}

export class SheetEvaluator {
  private readonly cache = new Map<string, CellValue>()
  private readonly visiting = new Set<string>()
  private readonly now: Date

  constructor(
    private readonly tab: SheetTab,
    now = new Date(),
  ) {
    this.now = now
  }

  valueAt(row: number, col: number): CellValue {
    if (row < 0 || col < 0 || row >= this.tab.rows || col >= this.tab.cols) {
      return new FormulaError('#REF!')
    }
    const key = cellKey(row, col)
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached

    const cell = this.tab.cells[key]
    const raw = cell?.raw ?? ''
    if (raw.trim() === '') {
      this.cache.set(key, '')
      return ''
    }

    if (!raw.startsWith('=')) {
      const value = literalValue(raw)
      this.cache.set(key, value)
      return value
    }

    if (this.visiting.has(key)) return new FormulaError('#CYCLE!')

    this.visiting.add(key)
    let result: CellValue
    try {
      const expression = parseFormula(raw.slice(1).trim())
      result = this.evaluate(expression)
    } catch (error) {
      result = error instanceof FormulaError ? error : new FormulaError('#VALUE!')
    } finally {
      this.visiting.delete(key)
    }
    this.cache.set(key, result)
    return result
  }

  private evaluate(node: ExprNode): CellValue {
    switch (node.kind) {
      case 'num':
        return node.value
      case 'str':
        return node.value
      case 'bool':
        return node.value
      case 'ref': {
        const pos = refToPos(node.ref)
        return pos ? this.valueAt(pos.row, pos.col) : new FormulaError('#REF!')
      }
      case 'range':
        return new FormulaError('#VALUE!')
      case 'unary': {
        const value = this.toNumber(this.evaluate(node.expr))
        if (isFormulaError(value)) return value
        return node.op === '-' ? -value : value
      }
      case 'percent': {
        const value = this.toNumber(this.evaluate(node.expr))
        if (isFormulaError(value)) return value
        return value / 100
      }
      case 'binary': {
        const left = this.evaluate(node.left)
        if (isFormulaError(left)) return left
        const right = this.evaluate(node.right)
        if (isFormulaError(right)) return right
        return this.applyBinary(node.op, left, right)
      }
      case 'call':
        return this.callFunction(node.name, node.args)
      default:
        return new FormulaError('#VALUE!')
    }
  }

  private applyBinary(op: string, left: CellValue, right: CellValue): CellValue {
    if (COMPARISON_OPS.has(op)) return this.compare(op, left, right)
    if (op === '&') {
      const l = this.toText(left)
      if (isFormulaError(l)) return l
      const r = this.toText(right)
      if (isFormulaError(r)) return r
      return l + r
    }

    const a = this.toNumber(left)
    if (isFormulaError(a)) return a
    const b = this.toNumber(right)
    if (isFormulaError(b)) return b

    let result: number
    switch (op) {
      case '+':
        result = a + b
        break
      case '-':
        result = a - b
        break
      case '*':
        result = a * b
        break
      case '/':
        if (b === 0) return new FormulaError('#DIV/0!')
        result = a / b
        break
      case '^':
        result = Math.pow(a, b)
        break
      default:
        return new FormulaError('#VALUE!')
    }
    return Number.isFinite(result) ? result : new FormulaError('#NUM!')
  }

  private compare(op: string, left: CellValue, right: CellValue): CellValue {
    if (op === '=' || op === '<>') {
      const equal = this.looseEquals(left, right)
      return op === '=' ? equal : !equal
    }

    let a: number | string
    let b: number | string
    if (typeof left === 'number' && typeof right === 'number') {
      a = left
      b = right
    } else if (left === '' && typeof right === 'number') {
      a = 0
      b = right
    } else if (right === '' && typeof left === 'number') {
      a = left
      b = 0
    } else if (typeof left === 'boolean' && typeof right === 'boolean') {
      a = left ? 1 : 0
      b = right ? 1 : 0
    } else {
      const l = this.toText(left)
      if (isFormulaError(l)) return l
      const r = this.toText(right)
      if (isFormulaError(r)) return r
      a = l.toLowerCase()
      b = r.toLowerCase()
    }

    switch (op) {
      case '<':
        return a < b
      case '>':
        return a > b
      case '<=':
        return a <= b
      case '>=':
        return a >= b
      default:
        return new FormulaError('#VALUE!')
    }
  }

  private looseEquals(left: CellValue, right: CellValue): boolean {
    if (left === '' && right === '') return true
    if (left === '' && typeof right === 'number') return right === 0
    if (right === '' && typeof left === 'number') return left === 0
    if (typeof left === 'number' && typeof right === 'number') return left === right
    if (typeof left === 'boolean' && typeof right === 'boolean') return left === right
    if (typeof left === 'string' && typeof right === 'string') {
      return left.toLowerCase() === right.toLowerCase()
    }
    return false
  }

  private toNumber(value: CellValue): number | FormulaError {
    if (isFormulaError(value)) return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : new FormulaError('#NUM!')
    if (typeof value === 'boolean') return value ? 1 : 0
    const text = value.trim()
    if (text === '') return 0
    const number = Number(text)
    return Number.isFinite(number) ? number : new FormulaError('#VALUE!')
  }

  private toText(value: CellValue): string | FormulaError {
    if (isFormulaError(value)) return value
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value === 'number') return numberText(value)
    return value
  }

  private truthy(value: CellValue): boolean | FormulaError {
    if (isFormulaError(value)) return value
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    const text = value.trim()
    if (text === '') return false
    if (/^true$/i.test(text)) return true
    if (/^false$/i.test(text)) return false
    const number = Number(text)
    if (Number.isFinite(number)) return number !== 0
    return new FormulaError('#VALUE!')
  }

  private rangeValues(node: Extract<ExprNode, { kind: 'range' }>): CellValue[] {
    const start = refToPos(node.start)
    const end = refToPos(node.end)
    if (!start || !end) return [new FormulaError('#REF!')]
    const r1 = Math.min(start.row, end.row)
    const r2 = Math.max(start.row, end.row)
    const c1 = Math.min(start.col, end.col)
    const c2 = Math.max(start.col, end.col)
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_RANGE_CELLS) return [new FormulaError('#REF!')]

    const values: CellValue[] = []
    for (let row = r1; row <= r2; row += 1) {
      for (let col = c1; col <= c2; col += 1) {
        if (row >= this.tab.rows || col >= this.tab.cols) values.push('')
        else values.push(this.valueAt(row, col))
      }
    }
    return values
  }

  private flat(values: ArgValue[]): CellValue[] {
    const output: CellValue[] = []
    values.forEach((value) => {
      if (Array.isArray(value)) output.push(...value)
      else output.push(value)
    })
    return output
  }

  private callFunction(name: string, nodes: ExprNode[]): CellValue {
    if (name === 'IF') {
      if (nodes.length < 2 || nodes.length > 3) return new FormulaError('#VALUE!')
      const condition = this.truthy(this.evaluate(nodes[0]))
      if (isFormulaError(condition)) return condition
      if (condition) return this.evaluate(nodes[1])
      return nodes.length === 3 ? this.evaluate(nodes[2]) : false
    }

    if (name === 'IFERROR') {
      if (nodes.length !== 2) return new FormulaError('#VALUE!')
      const value = this.evaluate(nodes[0])
      return isFormulaError(value) ? this.evaluate(nodes[1]) : value
    }

    if (name === 'TODAY' || name === 'NOW') {
      if (nodes.length !== 0) return new FormulaError('#VALUE!')
      return name === 'TODAY' ? dateLabel(this.now) : timeLabel(this.now)
    }

    const values = nodes.map((node) => (node.kind === 'range' ? this.rangeValues(node) : this.evaluate(node)))
    const flat = this.flat(values)

    switch (name) {
      case 'SUM': {
        const error = flat.find(isFormulaError)
        if (error) return error
        return flat.reduce<number>((sum, value) => (typeof value === 'number' ? sum + value : sum), 0)
      }
      case 'AVERAGE': {
        const error = flat.find(isFormulaError)
        if (error) return error
        const numbers = flat.filter((value): value is number => typeof value === 'number')
        if (!numbers.length) return new FormulaError('#DIV/0!')
        return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
      }
      case 'MIN': {
        const error = flat.find(isFormulaError)
        if (error) return error
        const numbers = flat.filter((value): value is number => typeof value === 'number')
        return numbers.length ? Math.min(...numbers) : 0
      }
      case 'MAX': {
        const error = flat.find(isFormulaError)
        if (error) return error
        const numbers = flat.filter((value): value is number => typeof value === 'number')
        return numbers.length ? Math.max(...numbers) : 0
      }
      case 'MEDIAN': {
        const error = flat.find(isFormulaError)
        if (error) return error
        const numbers = flat
          .filter((value): value is number => typeof value === 'number')
          .sort((a, b) => a - b)
        if (!numbers.length) return new FormulaError('#NUM!')
        const mid = Math.floor(numbers.length / 2)
        return numbers.length % 2 === 0 ? (numbers[mid - 1] + numbers[mid]) / 2 : numbers[mid]
      }
      case 'COUNT': {
        return flat.filter((value) => typeof value === 'number').length
      }
      case 'COUNTA': {
        return flat.filter((value) => value !== '').length
      }
      case 'ABS': {
        if (flat.length !== 1) return new FormulaError('#VALUE!')
        const value = this.toNumber(flat[0])
        if (isFormulaError(value)) return value
        return Math.abs(value)
      }
      case 'SQRT': {
        if (flat.length !== 1) return new FormulaError('#VALUE!')
        const value = this.toNumber(flat[0])
        if (isFormulaError(value)) return value
        if (value < 0) return new FormulaError('#NUM!')
        return Math.sqrt(value)
      }
      case 'POWER': {
        if (flat.length !== 2) return new FormulaError('#VALUE!')
        const base = this.toNumber(flat[0])
        if (isFormulaError(base)) return base
        const exponent = this.toNumber(flat[1])
        if (isFormulaError(exponent)) return exponent
        const result = Math.pow(base, exponent)
        return Number.isFinite(result) ? result : new FormulaError('#NUM!')
      }
      case 'MOD': {
        if (flat.length !== 2) return new FormulaError('#VALUE!')
        const value = this.toNumber(flat[0])
        if (isFormulaError(value)) return value
        const divisor = this.toNumber(flat[1])
        if (isFormulaError(divisor)) return divisor
        if (divisor === 0) return new FormulaError('#DIV/0!')
        return value - divisor * Math.floor(value / divisor)
      }
      case 'ROUND': {
        if (flat.length < 1 || flat.length > 2) return new FormulaError('#VALUE!')
        const value = this.toNumber(flat[0])
        if (isFormulaError(value)) return value
        const digits = flat.length === 2 ? this.toNumber(flat[1]) : 0
        if (isFormulaError(digits)) return digits
        const factor = Math.pow(10, Math.trunc(digits))
        if (!Number.isFinite(factor) || factor === 0) return new FormulaError('#NUM!')
        const scaled = value * factor
        if (!Number.isFinite(scaled)) return new FormulaError('#NUM!')
        const rounded =
          scaled >= 0 ? Math.round(scaled + Number.EPSILON) : -Math.round(-scaled + Number.EPSILON)
        return rounded / factor
      }
      case 'LEN': {
        if (flat.length !== 1) return new FormulaError('#VALUE!')
        const text = this.toText(flat[0])
        if (isFormulaError(text)) return text
        return text.length
      }
      case 'LEFT':
      case 'RIGHT': {
        if (flat.length < 1 || flat.length > 2) return new FormulaError('#VALUE!')
        const text = this.toText(flat[0])
        if (isFormulaError(text)) return text
        let count = 1
        if (flat.length === 2) {
          const parsed = this.toNumber(flat[1])
          if (isFormulaError(parsed)) return parsed
          count = Math.trunc(parsed)
        }
        if (count < 0) return new FormulaError('#VALUE!')
        if (count === 0) return ''
        return name === 'LEFT' ? text.slice(0, count) : text.slice(-count)
      }
      case 'MID': {
        if (flat.length < 2 || flat.length > 3) return new FormulaError('#VALUE!')
        const text = this.toText(flat[0])
        if (isFormulaError(text)) return text
        const start = this.toNumber(flat[1])
        if (isFormulaError(start)) return start
        const begin = Math.trunc(start)
        if (begin < 1) return new FormulaError('#VALUE!')
        let count: number | undefined
        if (flat.length === 3) {
          const parsed = this.toNumber(flat[2])
          if (isFormulaError(parsed)) return parsed
          count = Math.max(0, Math.trunc(parsed))
        }
        return count === undefined ? text.slice(begin - 1) : text.slice(begin - 1, begin - 1 + count)
      }
      case 'UPPER':
      case 'LOWER':
      case 'TRIM': {
        if (flat.length !== 1) return new FormulaError('#VALUE!')
        const text = this.toText(flat[0])
        if (isFormulaError(text)) return text
        if (name === 'UPPER') return text.toUpperCase()
        if (name === 'LOWER') return text.toLowerCase()
        return text.replace(/\s+/g, ' ').trim()
      }
      case 'CONCAT':
      case 'CONCATENATE': {
        let output = ''
        for (const value of flat) {
          const text = this.toText(value)
          if (isFormulaError(text)) return text
          output += text
        }
        return output
      }
      case 'AND':
      case 'OR': {
        if (!flat.length) return new FormulaError('#VALUE!')
        const booleans: boolean[] = []
        for (const value of flat) {
          const result = this.truthy(value)
          if (isFormulaError(result)) return result
          booleans.push(result)
        }
        return name === 'AND' ? booleans.every(Boolean) : booleans.some(Boolean)
      }
      case 'NOT': {
        if (flat.length !== 1) return new FormulaError('#VALUE!')
        const result = this.truthy(flat[0])
        if (isFormulaError(result)) return result
        return !result
      }
      default:
        return new FormulaError('#NAME?')
    }
  }
}

export function evaluateCell(tab: SheetTab, row: number, col: number): CellValue {
  return new SheetEvaluator(tab).valueAt(row, col)
}
