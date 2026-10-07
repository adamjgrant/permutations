import { newId } from './ids';
import { parseBranch } from './longform';
import {
  AnyOrderNode,
  Def,
  GroupNode,
  Guard,
  Module,
  Node,
  Option,
  PermError,
  Piece,
  RefNode,
  RepeatNode,
  SeqNode,
  Tag,
  TextNode,
  TransformNode,
} from './types';

const isWs = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);
const isIdentStart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);
const isIdentChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && /[0-9]/.test(c);

const SETTING_RE = /^[ \t]*delimiter[ \t]*=[ \t]*"((?:[^"\\]|\\.)*)"[ \t]*$/;
const USE_RE = /^[ \t]*use[ \t]+(\S+)[ \t]*$/;
const FROM_RE = /^[ \t]*from[ \t]+(\S+)[ \t]+use[ \t]+(.+?)[ \t]*$/;
const DEF_RE = /^[ \t]*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*=/;

// Sticky regexes, matched at a given offset.
const GUARD_RE = /@(?:(else)|(!)?([A-Za-z_]\w*)(?:=([^\s:|\]&;]+))?):/y;
const TAG_RE = /@([A-Za-z_]\w*)(?:=([^\s|\]&;]+))?(?=[\s|\];]|$)/y;
const GROUP_SETTINGS_RE = /;\s*delimiter\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?=\])/y;
const REPEAT_RE = /\{(\d+)(?:\.\.(\d+))?\s*(?:;\s*delimiter\s*=\s*"((?:[^"\\]|\\.)*)"\s*)?\}/y;

export interface ImportRequest {
  spec: string;
  /** Present for `from x use a, b`. Absent for `use x`. */
  names?: string[];
  offset: number;
}

export function lineCol(src: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') {
      line++;
      col = 1;
    } else col++;
  }
  return { line, col };
}

export function fail(src: string, message: string, offset: number): never {
  const { line, col } = lineCol(src, offset);
  throw new PermError(`${message} (line ${line}, column ${col})`, offset, line, col);
}

export function unescapeString(s: string): string {
  return s.replace(/\\(.)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

function bracketDelta(line: string): number {
  let d = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++;
    else if (c === '[') d++;
    else if (c === ']') d--;
  }
  return d;
}

interface Statement {
  start: number;
  end: number;
}

export const BRANCH_RE = /^([ \t]*)branch[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*$/;

export function indentWidth(ws: string): number {
  let w = 0;
  for (const c of ws) w += c === '\t' ? 2 : 1;
  return w;
}

function splitStatements(src: string): Statement[] {
  const lines: Statement[] = [];
  let pos = 0;
  for (;;) {
    let eol = src.indexOf('\n', pos);
    if (eol === -1) eol = src.length;
    lines.push({ start: pos, end: eol });
    if (eol >= src.length) break;
    pos = eol + 1;
  }
  const text = (i: number): string => src.slice((lines[i] as Statement).start, (lines[i] as Statement).end);

  const out: Statement[] = [];
  let i = 0;
  while (i < lines.length) {
    const L = lines[i] as Statement;
    const t = text(i);
    if (t.trim() === '') {
      i++;
      continue;
    }
    const bm = BRANCH_RE.exec(t);
    if (bm) {
      const headerIndent = indentWidth(bm[1] as string);
      let last = i;
      for (let j = i + 1; j < lines.length; j++) {
        const lt = text(j);
        if (lt.trim() === '') continue;
        const lead = /^[ \t]*/.exec(lt) as RegExpExecArray;
        if (indentWidth(lead[0]) > headerIndent) last = j;
        else break;
      }
      out.push({ start: L.start, end: (lines[last] as Statement).end });
      i = last + 1;
      continue;
    }
    if (SETTING_RE.test(t) || USE_RE.test(t) || FROM_RE.test(t)) {
      out.push({ start: L.start, end: L.end });
      i++;
      continue;
    }
    let depth = bracketDelta(t);
    let j = i;
    while (depth > 0 && j + 1 < lines.length) {
      j++;
      depth += bracketDelta(text(j));
    }
    if (depth > 0) fail(src, 'Unclosed [', L.start);
    out.push({ start: L.start, end: (lines[j] as Statement).end });
    i = j + 1;
  }
  return out;
}

export class Parser {
  pos: number;
  constructor(
    private src: string,
    start: number,
    private end: number,
    private module: Module,
  ) {
    this.pos = start;
  }

  private err(message: string, offset = this.pos): never {
    return fail(this.src, message, offset);
  }

  private skipWs(): void {
    while (this.pos < this.end && isWs(this.src[this.pos])) this.pos++;
  }

  private matchAt(re: RegExp, at: number): RegExpExecArray | null {
    re.lastIndex = at;
    const m = re.exec(this.src);
    if (m && m.index + m[0].length <= this.end) return m;
    return null;
  }

  /** Parse one line of a long-form block as a short-form option (text, tags and guard). */
  parseLineOption(): Option {
    return this.parseOption(false, false).opt;
  }

  /** Parse a whole statement body. Definition bodies allow top-level `|`. */
  parseTop(allowPipe: boolean): Node {
    const start = this.pos;
    const options: Option[] = [];
    for (;;) {
      const { opt, term } = this.parseOption(false, allowPipe);
      options.push(opt);
      if (term === '|') {
        this.pos++;
        continue;
      }
      break;
    }
    this.skipWs();
    if (this.pos < this.end) this.err('Unmatched ]');
    const only = options[0];
    if (options.length === 1 && only && only.tags.length === 0 && !only.guard) return only.seq;
    const group: GroupNode = {
      kind: 'group',
      id: newId(),
      options,
      delimiter: undefined,
      bare: true,
      range: [start, this.end],
    };
    return group;
  }

  private parseOption(inGroup: boolean, allowPipe: boolean): { opt: Option; term: string } {
    const start = this.pos;
    this.skipWs();
    let guard: Guard | undefined;
    const gm = this.matchAt(GUARD_RE, this.pos);
    if (gm) {
      if (gm[1]) guard = { kind: 'else' };
      else guard = { kind: 'tag', name: gm[3] as string, negate: !!gm[2], value: gm[4] };
      this.pos += gm[0].length;
      this.module.hasTags = true;
    }
    const pieces: Piece[] = [];
    const tags: Tag[] = [];
    let pending = false;
    let term = 'end';
    for (;;) {
      this.skipWsTracking(() => {
        pending = true;
      });
      if (this.pos >= this.end) break;
      const c = this.src[this.pos] as string;
      const next = this.src[this.pos + 1];
      if (c === '|' && allowPipe) {
        term = '|';
        break;
      }
      if (c === ']') {
        if (inGroup) {
          term = ']';
          break;
        }
        this.err('Unmatched ]');
      }
      if (inGroup && c === '&' && pending && isWs(next)) {
        term = '&';
        break;
      }
      if (inGroup && c === ';' && this.matchAt(GROUP_SETTINGS_RE, this.pos)) {
        term = ';';
        break;
      }

      let node: Node | undefined;
      if (c === '[') {
        node = this.parseGroup();
      } else if (
        (c === '$' && isIdentStart(next)) ||
        (c === '*' && next === '$' && isIdentStart(this.src[this.pos + 2]))
      ) {
        node = this.parseRef();
      } else if (c === '@' && (pending || pieces.length === 0)) {
        const tm = this.matchAt(TAG_RE, this.pos);
        if (tm) {
          tags.push({ name: tm[1] as string, value: tm[2] });
          this.module.hasTags = true;
          this.pos += tm[0].length;
          continue;
        }
      }
      if (!node) node = this.parseText(inGroup, allowPipe);
      if (node.kind !== 'text') node = this.parsePostfix(node);
      pieces.push({ node, join: pieces.length > 0 && pending });
      pending = false;
    }
    const seq: SeqNode = { kind: 'seq', id: newId(), pieces, range: [start, this.pos] };
    return { opt: { seq, tags, guard, range: [start, this.pos] }, term };
  }

  private skipWsTracking(onSkip: () => void): void {
    const before = this.pos;
    this.skipWs();
    if (this.pos > before) onSkip();
  }

  private parseText(inGroup: boolean, allowPipe: boolean): TextNode {
    const src = this.src;
    const start = this.pos;
    let out = '';
    let keep = 0;
    let contentEnd = this.pos;
    let i = this.pos;
    while (i < this.end) {
      const c = src[i] as string;
      const next = src[i + 1];
      if (c === '\\' && i + 1 < this.end) {
        out += next;
        i += 2;
        keep = out.length;
        contentEnd = i;
        continue;
      }
      if (c === '[' || c === ']') break;
      if (c === '|' && allowPipe) break;
      if (c === '$' && isIdentStart(next)) break;
      if (c === '*' && next === '$' && isIdentStart(src[i + 2])) break;
      if (isWs(c)) {
        let j = i;
        while (j < this.end && isWs(src[j])) j++;
        if (j >= this.end) break;
        const d = src[j];
        if (inGroup && d === '&' && isWs(src[j + 1])) break;
        if (d === '@' && this.matchAt(TAG_RE, j)) break;
        if (inGroup && d === ';' && this.matchAt(GROUP_SETTINGS_RE, j)) break;
        const ws = src.slice(i, j);
        out += ws.includes('\n') ? ' ' : ws;
        i = j;
        continue;
      }
      if (c === ';' && inGroup && this.matchAt(GROUP_SETTINGS_RE, i)) break;
      out += c;
      i++;
      keep = out.length;
      contentEnd = i;
    }
    this.pos = contentEnd;
    if (contentEnd === start) this.err(`Unexpected character '${src[start]}'`, start);
    return { kind: 'text', id: newId(), value: out.slice(0, keep), range: [start, contentEnd] };
  }

  private parseRef(): RefNode {
    const start = this.pos;
    const splat = this.src[this.pos] === '*';
    this.pos += splat ? 2 : 1;
    const nameStart = this.pos;
    for (;;) {
      while (isIdentChar(this.src[this.pos])) this.pos++;
      if (this.src[this.pos] === '.' && isIdentStart(this.src[this.pos + 1])) this.pos++;
      else break;
    }
    return {
      kind: 'ref',
      id: newId(),
      path: this.src.slice(nameStart, this.pos),
      splat,
      range: [start, this.pos],
    };
  }

  private parseGroup(): Node {
    const start = this.pos;
    this.pos++; // [
    const options: Option[] = [];
    let sep: '|' | '&' | undefined;
    let delimiter: string | undefined;
    for (;;) {
      const { opt, term } = this.parseOption(true, true);
      options.push(opt);
      if (term === '|' || term === '&') {
        if (sep && sep !== term) this.err("Cannot mix '|' and '&' in one group");
        sep = term;
        this.pos++;
        continue;
      }
      if (term === ';') {
        const m = this.matchAt(GROUP_SETTINGS_RE, this.pos) as RegExpExecArray;
        delimiter = unescapeString(m[1] as string);
        this.pos += m[0].length;
        this.skipWs();
        break;
      }
      if (term === ']') break;
      this.err('Unclosed [', start);
    }
    if (this.src[this.pos] !== ']') this.err('Unclosed [', start);
    this.pos++;
    const range: [number, number] = [start, this.pos];

    if (sep === '&') {
      for (const o of options) {
        if (o.tags.length || o.guard) this.err('Tags and guards are not allowed in any-order items', o.range[0]);
      }
      const node: AnyOrderNode = {
        kind: 'anyorder',
        id: newId(),
        items: options.map((o) => o.seq),
        delimiter,
        range,
      };
      return node;
    }
    const group: GroupNode = {
      kind: 'group',
      id: newId(),
      options: expandRanges(options),
      delimiter,
      bare: false,
      range,
    };
    return group;
  }

  private parsePostfix(node: Node): Node {
    const start = node.range[0];
    for (;;) {
      const c = this.src[this.pos];
      if (c === '{' && isDigit(this.src[this.pos + 1])) {
        const m = this.matchAt(REPEAT_RE, this.pos);
        if (!m) break;
        const min = parseInt(m[1] as string, 10);
        const max = m[2] !== undefined ? parseInt(m[2], 10) : min;
        if (max < min) this.err(`Repeat range {${min}..${max}} is backwards`);
        if (max > 1000) this.err('Repeat count is too large (max 1000)');
        const delimiter = m[3] !== undefined ? unescapeString(m[3]) : undefined;
        this.pos += m[0].length;
        node = buildRepeat(node, min, max, delimiter, [start, this.pos]);
      } else if (c === ':' && (isIdentStart(this.src[this.pos + 1]) || this.src[this.pos + 1] === '[')) {
        this.pos++;
        let fns: string[];
        if (this.src[this.pos] === '[') {
          const close = this.src.indexOf(']', this.pos);
          if (close === -1 || close > this.end) this.err('Unclosed [ in transform list');
          fns = this.src
            .slice(this.pos + 1, close)
            .split('|')
            .map((f) => f.trim());
          if (fns.some((f) => !/^[A-Za-z_]\w*$/.test(f))) this.err('Transform list must contain only names');
          this.pos = close + 1;
        } else {
          const s = this.pos;
          while (isIdentChar(this.src[this.pos])) this.pos++;
          fns = [this.src.slice(s, this.pos)];
        }
        const t: TransformNode = { kind: 'transform', id: newId(), inner: node, fns, range: [start, this.pos] };
        node = t;
      } else break;
    }
    return node;
  }
}

export function buildRepeat(inner: Node, min: number, max: number, delimiter: string | undefined, range: [number, number]): RepeatNode {
  const expanded: SeqNode[] = [];
  for (let n = min; n <= max; n++) {
    const pieces: Piece[] = [];
    for (let i = 0; i < n; i++) pieces.push({ node: inner, join: delimiter !== undefined && i > 0 });
    expanded.push({ kind: 'seq', id: newId(), pieces, joinDelim: delimiter, range });
  }
  return { kind: 'repeat', id: newId(), inner, min, max, delimiter, expanded, range };
}

function textOption(value: string, range: [number, number]): Option {
  const text: TextNode = { kind: 'text', id: newId(), value, range };
  return { seq: { kind: 'seq', id: newId(), pieces: [{ node: text, join: false }], range }, tags: [], guard: undefined, range };
}

/** `[1..6]` and `[A..F]` expand into one option per value. */
function expandRanges(options: Option[]): Option[] {
  const out: Option[] = [];
  for (const o of options) {
    const only = o.seq.pieces.length === 1 ? o.seq.pieces[0] : undefined;
    const text = only && only.node.kind === 'text' ? only.node.value : undefined;
    if (text !== undefined && !o.tags.length && !o.guard) {
      const num = /^(\d+)\.\.(\d+)$/.exec(text);
      if (num) {
        const a = parseInt(num[1] as string, 10);
        const b = parseInt(num[2] as string, 10);
        if (b - a > 10000) fail('', 'Range is too large (max 10000 values)', o.range[0]);
        const step = a <= b ? 1 : -1;
        for (let v = a; step > 0 ? v <= b : v >= b; v += step) out.push(textOption(String(v), o.range));
        continue;
      }
      const chars = [...text];
      const ch = /^(.)\.\.(.)$/u.exec(text);
      if (ch && chars.length === 4) {
        const a = (ch[1] as string).codePointAt(0) as number;
        const b = (ch[2] as string).codePointAt(0) as number;
        const step = a <= b ? 1 : -1;
        for (let v = a; step > 0 ? v <= b : v >= b; v += step) out.push(textOption(String.fromCodePoint(v), o.range));
        continue;
      }
    }
    out.push(o);
  }
  return out;
}

export function parseModule(source: string, path: string): { module: Module; imports: ImportRequest[] } {
  // Blank out comment lines but keep offsets stable.
  const src = source.replace(/^[ \t]*#.*$/gm, (m) => ' '.repeat(m.length));
  const module: Module = {
    path,
    source,
    defs: new Map(),
    namespaces: new Map(),
    named: new Map(),
    delimiter: undefined,
    anonymous: undefined,
    hasTags: false,
  };
  const imports: ImportRequest[] = [];

  for (const st of splitStatements(src)) {
    const text = src.slice(st.start, st.end);
    let m: RegExpExecArray | null;
    if ((m = BRANCH_RE.exec(text.split('\n')[0] as string))) {
      const name = m[2] as string;
      if (module.defs.has(name)) fail(src, `Duplicate definition '${name}'`, st.start);
      module.defs.set(name, parseBranch(src, st, name, module));
    } else if ((m = SETTING_RE.exec(text))) {
      module.delimiter = unescapeString(m[1] as string);
    } else if ((m = USE_RE.exec(text))) {
      imports.push({ spec: m[1] as string, offset: st.start });
    } else if ((m = FROM_RE.exec(text))) {
      const names = (m[2] as string).split(',').map((n) => n.trim()).filter(Boolean);
      imports.push({ spec: m[1] as string, names, offset: st.start });
    } else if ((m = DEF_RE.exec(text))) {
      const name = m[1] as string;
      if (module.defs.has(name)) fail(src, `Duplicate definition '${name}'`, st.start);
      const bodyStart = st.start + m[0].length;
      const body = new Parser(src, bodyStart, st.end, module).parseTop(true);
      module.defs.set(name, { name, body, module, range: [st.start, st.end], form: 'short' });
    } else {
      if (module.anonymous) fail(src, 'Only one unnamed expression is allowed per file', st.start);
      const body = new Parser(src, st.start, st.end, module).parseTop(false);
      module.anonymous = { name: '<main>', body, module, range: [st.start, st.end], form: 'short' };
    }
  }
  return { module, imports };
}
