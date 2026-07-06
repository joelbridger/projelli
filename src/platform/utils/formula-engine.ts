// Formula Engine
// ---------------------------------------------------------------------------
// Lightweight Excel-formula engine for the Advisor Prep Hero spreadsheet viewer.
//
// Why in-house: the obvious off-the-shelf option, HyperFormula, is dual-
// licensed GPL-3 / proprietary. GPL-3 would force Advisor Prep Hero's entire JS
// bundle open under GPL, which conflicts with the commercial launch plan
// (~/keepance/LANTERN_BUSINESS_PLAN.md). Rather than pay for a proprietary
// seat up front, we implement a small engine that covers the common cases:
//
//   - Arithmetic: +, -, *, /, %, ^ with standard precedence
//   - Comparisons: =, <, >, <=, >=, <>
//   - String concat: &
//   - Cell refs: A1, $A$1, A1:C5 (ranges pass as arrays to functions)
//   - Cross-sheet refs: Sheet2!A1 parsed but not evaluated — returns #REF!
//   - Literals: numbers, strings "...", booleans TRUE/FALSE
//   - Functions: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ABS, ROUND,
//                SQRT, POWER, PRODUCT, CONCATENATE, LEN, UPPER, LOWER,
//                TRIM, AND, OR, NOT
//
// Anything else evaluates to "#NAME?" (unknown function) or "#ERROR!"
// (parser/eval failure). The UI falls back to displaying the value that
// SheetJS cached on load, so files still open cleanly.
//
// Scope: single-sheet recomputation. The vast majority of everyday
// spreadsheets stay on one sheet; we can extend to multi-sheet by swapping
// the `(row, col) -> value` lookup for a `(sheet, row, col) -> value` one.

export type FormulaValue = number | string | boolean | null;

/** The evaluator resolves cell references via this callback. */
export type CellLookup = (row: number, col: number) => FormulaValue;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENT'         // function name or TRUE/FALSE
  | 'CELL_REF'      // A1, $A$1
  | 'RANGE_REF'     // A1:B5
  | 'OP'            // + - * / ^ & % = < > <= >= <>
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  const isDigit = (c: string) => c >= '0' && c <= '9';
  const isAlpha = (c: string) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
  const isAlphaNum = (c: string) => isAlpha(c) || isDigit(c);

  while (i < len) {
    const c = input[i]!;

    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    // Numbers (integer or decimal; no leading sign — unary handled by parser)
    if (isDigit(c) || (c === '.' && i + 1 < len && isDigit(input[i + 1]!))) {
      let j = i;
      while (j < len && (isDigit(input[j]!) || input[j] === '.')) j++;
      tokens.push({ type: 'NUMBER', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Strings, double-quoted. Excel escapes " by doubling: "" -> ".
    if (c === '"') {
      let j = i + 1;
      let out = '';
      while (j < len) {
        if (input[j] === '"' && input[j + 1] === '"') {
          out += '"';
          j += 2;
          continue;
        }
        if (input[j] === '"') break;
        out += input[j];
        j++;
      }
      if (j >= len) throw new Error('Unterminated string');
      tokens.push({ type: 'STRING', value: out });
      i = j + 1;
      continue;
    }

    // Identifiers / cell refs. Allow $ for absolute refs and letters+digits.
    if (isAlpha(c) || c === '$') {
      let j = i;
      // Consume letters + $ for the "column" part of a potential cell ref,
      // then any digits + $ for the row. If we end up with letters only,
      // treat as an identifier (function name or TRUE/FALSE).
      while (j < len && (isAlpha(input[j]!) || input[j] === '$')) j++;
      const afterLetters = j;
      while (j < len && (isDigit(input[j]!) || input[j] === '$')) j++;
      // Was there a digit section? If so, we have a cell ref... UNLESS the
      // next char is `!`, which means we misread a sheet name like
      // "Sheet2" as a cell. Cross-sheet refs need to own the whole token.
      if (j > afterLetters && afterLetters > i && input[j] !== '!') {
        const refStr = input.slice(i, j).replace(/\$/g, '');
        // Check for range (A1:B5)
        if (input[j] === ':') {
          // Parse the second half
          let k = j + 1;
          while (k < len && (isAlpha(input[k]!) || input[k] === '$')) k++;
          const kAfter = k;
          while (k < len && (isDigit(input[k]!) || input[k] === '$')) k++;
          if (k > kAfter && kAfter > j + 1) {
            const endStr = input.slice(j + 1, k).replace(/\$/g, '');
            tokens.push({ type: 'RANGE_REF', value: `${refStr}:${endStr}` });
            i = k;
            continue;
          }
        }
        tokens.push({ type: 'CELL_REF', value: refStr });
        i = j;
        continue;
      }

      // Could be function name, bool literal, or a cross-sheet ref like
      // Sheet2!A1. If the next non-word character is `!`, treat the whole
      // span (possibly with trailing digits) as a cross-sheet reference.
      let end = afterLetters;
      // Consume additional word chars for things like SheetName2
      while (end < len && isAlphaNum(input[end]!)) end++;
      // Or the scan above already consumed the digits as a failed cell ref
      // (Sheet2 case) — `j` sits at `!` in that path. Use max of end / j.
      if (j > end) end = j;
      if (input[end] === '!') {
        // Cross-sheet ref — skip the sheet name and read the rest as a cell
        // ref. We don't support cross-sheet eval; tokenize as IDENT with a
        // marker so the parser can emit an error.
        let m = end + 1;
        while (m < len && (isAlpha(input[m]!) || input[m] === '$')) m++;
        while (m < len && (isDigit(input[m]!) || input[m] === '$')) m++;
        tokens.push({ type: 'IDENT', value: `__XSHEET__${input.slice(i, m)}` });
        i = m;
        continue;
      }
      tokens.push({ type: 'IDENT', value: input.slice(i, end).toUpperCase() });
      i = end;
      continue;
    }

    // Operators (multi-char first)
    if (c === '<' && input[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '<=' });
      i += 2;
      continue;
    }
    if (c === '>' && input[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '>=' });
      i += 2;
      continue;
    }
    if (c === '<' && input[i + 1] === '>') {
      tokens.push({ type: 'OP', value: '<>' });
      i += 2;
      continue;
    }

    if (c === '(') {
      tokens.push({ type: 'LPAREN', value: c });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'RPAREN', value: c });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'COMMA', value: c });
      i++;
      continue;
    }

    if ('+-*/^%&=<>'.includes(c)) {
      tokens.push({ type: 'OP', value: c });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${c}' at ${i}`);
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent) to AST
// ---------------------------------------------------------------------------

type Node =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'cell'; row: number; col: number; text: string }
  | { type: 'range'; startRow: number; startCol: number; endRow: number; endCol: number }
  | { type: 'neg'; operand: Node }
  | { type: 'percent'; operand: Node }
  | { type: 'binop'; op: string; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'xsheet' };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: 'EOF', value: '' };
  }

  private consume(): Token {
    const t = this.tokens[this.pos] ?? { type: 'EOF' as const, value: '' };
    this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.consume();
    if (t.type !== type) {
      throw new Error(`Expected ${type}, got ${t.type} ("${t.value}")`);
    }
    return t;
  }

  parse(): Node {
    const node = this.parseExpr();
    if (this.peek().type !== 'EOF') {
      throw new Error(`Trailing token: ${this.peek().value}`);
    }
    return node;
  }

  // Precedence (low to high): comparisons, & concat, +/-, */, ^, unary, primary
  private parseExpr(): Node {
    return this.parseComparison();
  }

  private parseComparison(): Node {
    let left = this.parseConcat();
    while (this.peek().type === 'OP' && ['=', '<', '>', '<=', '>=', '<>'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseConcat();
      left = { type: 'binop', op, left, right };
    }
    return left;
  }

  private parseConcat(): Node {
    let left = this.parseAddSub();
    while (this.peek().type === 'OP' && this.peek().value === '&') {
      this.consume();
      const right = this.parseAddSub();
      left = { type: 'binop', op: '&', left, right };
    }
    return left;
  }

  private parseAddSub(): Node {
    let left = this.parseMulDiv();
    while (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.consume().value;
      const right = this.parseMulDiv();
      left = { type: 'binop', op, left, right };
    }
    return left;
  }

  private parseMulDiv(): Node {
    let left = this.parsePower();
    while (this.peek().type === 'OP' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.consume().value;
      const right = this.parsePower();
      left = { type: 'binop', op, left, right };
    }
    return left;
  }

  private parsePower(): Node {
    const left = this.parseUnary();
    if (this.peek().type === 'OP' && this.peek().value === '^') {
      this.consume();
      // Right-associative
      const right = this.parsePower();
      return { type: 'binop', op: '^', left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.peek().type === 'OP' && this.peek().value === '-') {
      this.consume();
      return { type: 'neg', operand: this.parseUnary() };
    }
    if (this.peek().type === 'OP' && this.peek().value === '+') {
      this.consume();
      return this.parseUnary();
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    // Postfix %
    while (this.peek().type === 'OP' && this.peek().value === '%') {
      this.consume();
      node = { type: 'percent', operand: node };
    }
    return node;
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t.type === 'NUMBER') {
      this.consume();
      return { type: 'num', value: Number(t.value) };
    }
    if (t.type === 'STRING') {
      this.consume();
      return { type: 'str', value: t.value };
    }
    if (t.type === 'CELL_REF') {
      this.consume();
      const { row, col } = parseCellRef(t.value);
      return { type: 'cell', row, col, text: t.value };
    }
    if (t.type === 'RANGE_REF') {
      this.consume();
      const [a, b] = t.value.split(':');
      const start = parseCellRef(a!);
      const end = parseCellRef(b!);
      return {
        type: 'range',
        startRow: Math.min(start.row, end.row),
        startCol: Math.min(start.col, end.col),
        endRow: Math.max(start.row, end.row),
        endCol: Math.max(start.col, end.col),
      };
    }
    if (t.type === 'IDENT') {
      this.consume();
      if (t.value.startsWith('__XSHEET__')) {
        return { type: 'xsheet' };
      }
      if (t.value === 'TRUE') return { type: 'bool', value: true };
      if (t.value === 'FALSE') return { type: 'bool', value: false };
      // Function call: IDENT LPAREN args RPAREN
      if (this.peek().type === 'LPAREN') {
        this.consume();
        const args: Node[] = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseExpr());
          while (this.peek().type === 'COMMA') {
            this.consume();
            args.push(this.parseExpr());
          }
        }
        this.expect('RPAREN');
        return { type: 'call', name: t.value, args };
      }
      throw new Error(`Unexpected identifier: ${t.value}`);
    }
    if (t.type === 'LPAREN') {
      this.consume();
      const node = this.parseExpr();
      this.expect('RPAREN');
      return node;
    }
    throw new Error(`Unexpected token: ${t.type} ("${t.value}")`);
  }
}

/** Parse an A1-style reference (already stripped of `$`) into 0-based row/col. */
function parseCellRef(ref: string): { row: number; col: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell ref: ${ref}`);
  const letters = m[1]!.toUpperCase();
  const rowStr = m[2]!;
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  col -= 1; // 1-indexed to 0-indexed
  const row = parseInt(rowStr, 10) - 1;
  return { row, col };
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function toNumber(v: FormulaValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error('#VALUE!');
  return n;
}

function toBool(v: FormulaValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null || v === '') return false;
  const s = String(v).toUpperCase();
  return s === 'TRUE' || s === '1';
}

function toStr(v: FormulaValue): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function flattenRange(
  node: Node,
  lookup: CellLookup
): FormulaValue[] {
  if (node.type === 'range') {
    const out: FormulaValue[] = [];
    for (let r = node.startRow; r <= node.endRow; r++) {
      for (let c = node.startCol; c <= node.endCol; c++) {
        out.push(lookup(r, c));
      }
    }
    return out;
  }
  // Single value
  const v = evalNode(node, lookup);
  return Array.isArray(v) ? v : [v];
}

/**
 * Evaluate a parsed AST. Cell lookups go through the callback so the
 * caller controls dependency/cycle tracking. Returns a JS value (number,
 * string, boolean, or null).
 */
function evalNode(node: Node, lookup: CellLookup): FormulaValue {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'str':
      return node.value;
    case 'bool':
      return node.value;
    case 'cell':
      return lookup(node.row, node.col);
    case 'range':
      // Lone range outside a function context collapses to the first value
      // in Excel; follow that.
      return lookup(node.startRow, node.startCol);
    case 'neg':
      return -toNumber(evalNode(node.operand, lookup));
    case 'percent':
      return toNumber(evalNode(node.operand, lookup)) / 100;
    case 'xsheet':
      throw new Error('#REF!');
    case 'binop': {
      const op = node.op;
      if (op === '&') {
        return toStr(evalNode(node.left, lookup)) + toStr(evalNode(node.right, lookup));
      }
      if (['=', '<', '>', '<=', '>=', '<>'].includes(op)) {
        const l = evalNode(node.left, lookup);
        const r = evalNode(node.right, lookup);
        // Compare numbers numerically, strings lexicographically, booleans as 0/1
        const lNum = typeof l === 'number' || typeof l === 'boolean';
        const rNum = typeof r === 'number' || typeof r === 'boolean';
        const bothNum = lNum && rNum;
        const a = bothNum ? toNumber(l) : toStr(l);
        const b = bothNum ? toNumber(r) : toStr(r);
        switch (op) {
          case '=': return a === b;
          case '<>': return a !== b;
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          case '>=': return a >= b;
        }
      }
      const a = toNumber(evalNode(node.left, lookup));
      const b = toNumber(evalNode(node.right, lookup));
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new Error('#DIV/0!');
          return a / b;
        case '^': return Math.pow(a, b);
      }
      throw new Error(`Unknown op: ${op}`);
    }
    case 'call':
      return callFunction(node.name, node.args, lookup);
  }
}

function callFunction(name: string, args: Node[], lookup: CellLookup): FormulaValue {
  switch (name) {
    case 'SUM': {
      const flat = args.flatMap((a) => flattenRange(a, lookup));
      return flat.reduce<number>((sum, v) => {
        if (v === null || v === '') return sum;
        if (typeof v === 'string') {
          const n = Number(v);
          return Number.isNaN(n) ? sum : sum + n;
        }
        return sum + toNumber(v);
      }, 0);
    }
    case 'AVERAGE': {
      const flat = args.flatMap((a) => flattenRange(a, lookup));
      let sum = 0;
      let count = 0;
      for (const v of flat) {
        if (v === null || v === '') continue;
        if (typeof v === 'string') {
          const n = Number(v);
          if (!Number.isNaN(n)) { sum += n; count++; }
          continue;
        }
        sum += toNumber(v);
        count++;
      }
      if (count === 0) throw new Error('#DIV/0!');
      return sum / count;
    }
    case 'MIN':
    case 'MAX': {
      const flat = args.flatMap((a) => flattenRange(a, lookup));
      let best: number | null = null;
      for (const v of flat) {
        if (v === null || v === '') continue;
        const n = typeof v === 'string' ? Number(v) : toNumber(v);
        if (Number.isNaN(n)) continue;
        if (best === null) best = n;
        else if (name === 'MIN') best = Math.min(best, n);
        else best = Math.max(best, n);
      }
      return best ?? 0;
    }
    case 'COUNT': {
      // COUNT = number of numeric cells
      const flat = args.flatMap((a) => flattenRange(a, lookup));
      return flat.reduce<number>((count, v) => {
        if (v === null || v === '') return count;
        if (typeof v === 'number') return count + 1;
        if (typeof v === 'string') {
          const n = Number(v);
          return Number.isNaN(n) ? count : count + 1;
        }
        return count;
      }, 0);
    }
    case 'COUNTA': {
      // COUNTA = number of non-empty cells
      const flat = args.flatMap((a) => flattenRange(a, lookup));
      return flat.reduce<number>((count, v) => (v === null || v === '' ? count : count + 1), 0);
    }
    case 'IF': {
      const [condNode, thenNode, elseNode] = args;
      if (!condNode) throw new Error('#VALUE!');
      const cond = toBool(evalNode(condNode, lookup));
      if (cond) return thenNode ? evalNode(thenNode, lookup) : true;
      return elseNode ? evalNode(elseNode, lookup) : false;
    }
    case 'AND': {
      return args.every((a) => toBool(evalNode(a, lookup)));
    }
    case 'OR': {
      return args.some((a) => toBool(evalNode(a, lookup)));
    }
    case 'NOT': {
      const [n] = args;
      if (!n) throw new Error('#VALUE!');
      return !toBool(evalNode(n, lookup));
    }
    case 'ABS': {
      const [n] = args;
      if (!n) throw new Error('#VALUE!');
      return Math.abs(toNumber(evalNode(n, lookup)));
    }
    case 'ROUND': {
      const [valNode, placesNode] = args;
      if (!valNode) throw new Error('#VALUE!');
      const val = toNumber(evalNode(valNode, lookup));
      const places = placesNode ? toNumber(evalNode(placesNode, lookup)) : 0;
      const factor = Math.pow(10, places);
      return Math.round(val * factor) / factor;
    }
    case 'SQRT': {
      const [n] = args;
      if (!n) throw new Error('#VALUE!');
      const v = toNumber(evalNode(n, lookup));
      if (v < 0) throw new Error('#NUM!');
      return Math.sqrt(v);
    }
    case 'POWER': {
      const [baseNode, expNode] = args;
      if (!baseNode || !expNode) throw new Error('#VALUE!');
      return Math.pow(toNumber(evalNode(baseNode, lookup)), toNumber(evalNode(expNode, lookup)));
    }
    case 'PRODUCT': {
      const flat = args.flatMap((a) => flattenRange(a, lookup));
      let p = 1;
      let seen = false;
      for (const v of flat) {
        if (v === null || v === '') continue;
        const n = typeof v === 'string' ? Number(v) : toNumber(v);
        if (Number.isNaN(n)) continue;
        p *= n;
        seen = true;
      }
      return seen ? p : 0;
    }
    case 'CONCATENATE':
    case 'CONCAT': {
      const flat = args.flatMap((a) => flattenRange(a, lookup));
      return flat.map(toStr).join('');
    }
    case 'LEN': {
      const [n] = args;
      if (!n) throw new Error('#VALUE!');
      return toStr(evalNode(n, lookup)).length;
    }
    case 'UPPER': {
      const [n] = args;
      if (!n) throw new Error('#VALUE!');
      return toStr(evalNode(n, lookup)).toUpperCase();
    }
    case 'LOWER': {
      const [n] = args;
      if (!n) throw new Error('#VALUE!');
      return toStr(evalNode(n, lookup)).toLowerCase();
    }
    case 'TRIM': {
      const [n] = args;
      if (!n) throw new Error('#VALUE!');
      return toStr(evalNode(n, lookup)).trim().replace(/\s+/g, ' ');
    }
    default:
      throw new Error('#NAME?');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse and evaluate a single formula string (without the leading `=`).
 *
 * @param formula The formula body (e.g. "B3*1.1")
 * @param lookup  Callback that resolves a 0-based (row, col) cell reference
 *                to a value. Return `null` for empty cells.
 * @returns The computed value, or an error string like "#REF!" / "#VALUE!".
 */
export function evaluateFormulaString(
  formula: string,
  lookup: CellLookup
): FormulaValue {
  try {
    const tokens = tokenize(formula);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return evalNode(ast, lookup);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '#ERROR!';
    if (msg.startsWith('#')) return msg;
    return '#ERROR!';
  }
}

/**
 * Walk an AST and collect every cell reference it touches (individual cells
 * AND ranges expanded into their cells). Used to build a dependency graph.
 */
export function extractDependencies(formula: string): Array<{ row: number; col: number }> {
  const deps: Array<{ row: number; col: number }> = [];
  try {
    const tokens = tokenize(formula);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    walk(ast);
  } catch {
    // Parse failure: no deps surface; the cell will render #ERROR! when
    // evaluated anyway.
  }
  return deps;

  function walk(n: Node) {
    switch (n.type) {
      case 'cell':
        deps.push({ row: n.row, col: n.col });
        break;
      case 'range':
        for (let r = n.startRow; r <= n.endRow; r++) {
          for (let c = n.startCol; c <= n.endCol; c++) {
            deps.push({ row: r, col: c });
          }
        }
        break;
      case 'neg':
      case 'percent':
        walk(n.operand);
        break;
      case 'binop':
        walk(n.left);
        walk(n.right);
        break;
      case 'call':
        n.args.forEach(walk);
        break;
    }
  }
}

/**
 * Render a FormulaValue into the string displayed in the grid.
 * Numbers: strip trailing .0, use standard JS formatting.
 * Booleans: "TRUE" / "FALSE" (matches Excel).
 * Strings that start with `#` are error codes; keep as-is.
 */
export function formulaValueToDisplay(v: FormulaValue): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '#NUM!';
    // Avoid "0.1 + 0.2 === 0.30000000000000004" style drift in display.
    // 12 significant digits is what Excel uses for most defaults.
    const rounded = Number.parseFloat(v.toPrecision(12));
    return String(rounded);
  }
  return v;
}
