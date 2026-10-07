import { newId } from './ids';
import { buildRepeat, fail, indentWidth, Parser, unescapeString } from './parser';
import {
  AnyOrderNode,
  Def,
  GroupNode,
  Guard,
  Module,
  Node,
  Option,
  Piece,
  RefNode,
  SeqNode,
  Tag,
  TextNode,
  TransformNode,
} from './types';

// Long form is indentation based. Every line is either a keyword construct or a short-form
// expression. A line that is exactly a keyword construct is reserved: quote it to get text.

const NAME = '[A-Za-z_]\\w*';
const PATH = `${NAME}(?:\\.${NAME})*`;

const RE = {
  oneOf: /^one of$/,
  sequence: /^sequence$/,
  tight: /^tight$/,
  anyOrder: /^any order$/,
  nothing: /^nothing$/,
  ref: new RegExp(`^ref[ \\t]+(${PATH})$`),
  members: new RegExp(`^members of[ \\t]+(${PATH})$`),
  repeat: /^repeat[ \t]+(\d+)(?:\.\.(\d+))?$/,
  transform: new RegExp(`^transform[ \\t]+(${NAME}(?:[ \\t]*\\|[ \\t]*${NAME})*)$`),
  tag: new RegExp(`^tag[ \\t]+(${NAME})(?:[ \\t]*=[ \\t]*(\\S+))?$`),
  when: new RegExp(`^when[ \\t]+(not[ \\t]+)?(${NAME})(?:[ \\t]*=[ \\t]*(\\S+))?$`),
  otherwise: /^otherwise$/,
  delimiter: /^delimiter[ \t]+"((?:[^"\\]|\\.)*)"$/,
  quoted: /^"((?:[^"\\]|\\.)*)"$/,
  branch: new RegExp(`^branch[ \\t]+${PATH}$`),
};

/** True when a whole trimmed line would be read as a keyword construct (so text must be quoted). */
export function isReservedLine(text: string): boolean {
  return Object.values(RE).some((re) => re.test(text));
}

interface Line {
  indent: number;
  start: number;
  end: number;
  text: string;
}

type Item =
  | { t: 'node'; node: Node; tags: Tag[]; guard?: Guard | undefined; line: Line }
  | { t: 'when'; guard: Guard; seq: SeqNode; tags: Tag[]; line: Line }
  | { t: 'empty'; line: Line }
  | { t: 'tag'; tag: Tag; line: Line }
  | { t: 'delim'; value: string; line: Line };

class LongParser {
  constructor(
    private src: string,
    private lines: Line[],
    private module: Module,
  ) {}

  private err(message: string, line: Line): never {
    return fail(this.src, message, line.start);
  }

  /** Parse the children of the line at index `parent`: all following deeper-indented lines. */
  children(parent: number): { items: Item[]; next: number } {
    const parentLine = this.lines[parent] as Line;
    const items: Item[] = [];
    let i = parent + 1;
    let blockIndent = -1;
    while (i < this.lines.length) {
      const line = this.lines[i] as Line;
      if (line.indent <= parentLine.indent) break;
      if (blockIndent === -1) blockIndent = line.indent;
      if (line.indent !== blockIndent) this.err('Inconsistent indentation', line);
      const { item, next } = this.item(i);
      items.push(item);
      i = next;
    }
    return { items, next: i };
  }

  private noChildren(index: number, what: string): number {
    const { items, next } = this.children(index);
    if (items.length) this.err(`'${what}' cannot have indented lines under it`, this.lines[index] as Line);
    return next;
  }

  private needChildren(index: number, what: string): { items: Item[]; next: number } {
    const r = this.children(index);
    if (!r.items.length) this.err(`'${what}' needs indented lines under it`, this.lines[index] as Line);
    return r;
  }

  private rangeOf(index: number, next: number): [number, number] {
    const first = this.lines[index] as Line;
    const last = this.lines[next - 1] as Line;
    return [first.start, last.end];
  }

  split(items: Item[]): { content: Item[]; tags: Tag[]; delim: string | undefined } {
    const content: Item[] = [];
    const tags: Tag[] = [];
    let delim: string | undefined;
    for (const it of items) {
      if (it.t === 'tag') tags.push(it.tag);
      else if (it.t === 'delim') {
        if (delim !== undefined) this.err('Only one delimiter per block', it.line);
        delim = it.value;
      } else content.push(it);
    }
    return { content, tags, delim };
  }

  private emptyText(range: [number, number]): TextNode {
    return { kind: 'text', id: newId(), value: '', range };
  }

  private asPiece(it: Item, join: boolean): Piece {
    if (it.t === 'empty') return { node: this.emptyText([it.line.start, it.line.end]), join };
    if (it.t === 'when') this.err("'when' and 'otherwise' belong directly under 'one of'", it.line);
    if (it.t === 'node') return { node: it.node, join };
    return this.err('Unexpected line', it.line);
  }

  seqOf(content: Item[], join: boolean, delim: string | undefined, range: [number, number]): { seq: SeqNode; tags: Tag[] } {
    const tags: Tag[] = [];
    const pieces: Piece[] = content.map((c, i) => {
      if (c.t === 'node') tags.push(...c.tags);
      return this.asPiece(c, i > 0 && join);
    });
    const seq: SeqNode = { kind: 'seq', id: newId(), pieces, joinDelim: delim, scopeDelim: delim, range };
    return { seq, tags };
  }

  private toOption(it: Item): Option {
    const range: [number, number] = [it.line.start, it.line.end];
    if (it.t === 'empty') {
      return { seq: { kind: 'seq', id: newId(), pieces: [], range }, tags: [], guard: undefined, range };
    }
    if (it.t === 'when') return { seq: it.seq, tags: it.tags, guard: it.guard, range: it.seq.range };
    if (it.t === 'node') {
      if (it.node.kind === 'seq') return { seq: it.node, tags: it.tags, guard: it.guard, range: it.node.range };
      if (it.tags.length || it.guard) this.err('Tags and guards go on lines inside a sequence', it.line);
      const seq: SeqNode = { kind: 'seq', id: newId(), pieces: [{ node: it.node, join: false }], range: it.node.range };
      return { seq, tags: [], guard: undefined, range: it.node.range };
    }
    return this.err('Unexpected line', it.line);
  }

  private single(content: Item[], line: Line, what: string): Node {
    if (!content.length) this.err(`'${what}' needs something under it`, line);
    const only = content[0] as Item;
    if (content.length === 1 && only.t === 'node' && !only.tags.length) return only.node;
    const { seq, tags } = this.seqOf(content, true, undefined, [line.start, (content[content.length - 1] as Item).line.end]);
    if (tags.length) this.err(`Tags are not allowed directly inside '${what}'`, line);
    return seq;
  }

  item(index: number): { item: Item; next: number } {
    const line = this.lines[index] as Line;
    const text = line.text;
    let m: RegExpExecArray | null;
    const here = (node: Node, next: number): { item: Item; next: number } => ({
      item: { t: 'node', node, tags: [], line },
      next,
    });

    if (RE.oneOf.test(text)) {
      const { items, next } = this.needChildren(index, 'one of');
      const { content, tags, delim } = this.split(items);
      if (tags.length) this.err("A 'tag' line belongs inside an option (use 'sequence'), not directly under 'one of'", line);
      if (!content.length) this.err("'one of' needs options", line);
      const node: GroupNode = {
        kind: 'group',
        id: newId(),
        options: content.map((c) => this.toOption(c)),
        delimiter: delim,
        bare: false,
        range: this.rangeOf(index, next),
      };
      return here(node, next);
    }
    if (RE.anyOrder.test(text)) {
      const { items, next } = this.needChildren(index, 'any order');
      const { content, tags, delim } = this.split(items);
      if (tags.length) this.err('Tags are not allowed in any-order items', line);
      const node: AnyOrderNode = {
        kind: 'anyorder',
        id: newId(),
        items: content.map((c) => {
          const o = this.toOption(c);
          if (o.tags.length || o.guard) this.err('Tags and guards are not allowed in any-order items', c.line);
          return o.seq;
        }),
        delimiter: delim,
        range: this.rangeOf(index, next),
      };
      return here(node, next);
    }
    if (RE.sequence.test(text) || RE.tight.test(text)) {
      const { items, next } = this.needChildren(index, text);
      const { content, tags, delim } = this.split(items);
      const { seq, tags: inner } = this.seqOf(content, text === 'sequence', delim, this.rangeOf(index, next));
      return { item: { t: 'node', node: seq, tags: [...tags, ...inner], line }, next };
    }
    if (RE.nothing.test(text)) return { item: { t: 'empty', line }, next: this.noChildren(index, text) };
    if ((m = RE.ref.exec(text))) {
      const node: RefNode = { kind: 'ref', id: newId(), path: m[1] as string, splat: false, range: [line.start, line.end] };
      return here(node, this.noChildren(index, text));
    }
    if ((m = RE.members.exec(text))) {
      const node: RefNode = { kind: 'ref', id: newId(), path: m[1] as string, splat: true, range: [line.start, line.end] };
      return here(node, this.noChildren(index, text));
    }
    if ((m = RE.repeat.exec(text))) {
      const min = parseInt(m[1] as string, 10);
      const max = m[2] !== undefined ? parseInt(m[2], 10) : min;
      if (max < min) this.err(`Repeat range ${min}..${max} is backwards`, line);
      if (max > 1000) this.err('Repeat count is too large (max 1000)', line);
      const { items, next } = this.needChildren(index, 'repeat');
      const { content, tags, delim } = this.split(items);
      if (tags.length) this.err("Tags are not allowed directly inside 'repeat'", line);
      const inner = this.single(content, line, 'repeat');
      return here(buildRepeat(inner, min, max, delim, this.rangeOf(index, next)), next);
    }
    if ((m = RE.transform.exec(text))) {
      const fns = (m[1] as string).split('|').map((f) => f.trim());
      const { items, next } = this.needChildren(index, 'transform');
      const { content, tags } = this.split(items);
      if (tags.length) this.err("Tags are not allowed directly inside 'transform'", line);
      const inner = this.single(content, line, 'transform');
      const node: TransformNode = { kind: 'transform', id: newId(), inner, fns, range: this.rangeOf(index, next) };
      return here(node, next);
    }
    if ((m = RE.tag.exec(text))) {
      this.module.hasTags = true;
      return { item: { t: 'tag', tag: { name: m[1] as string, value: m[2] }, line }, next: this.noChildren(index, 'tag') };
    }
    if ((m = RE.delimiter.exec(text))) {
      return { item: { t: 'delim', value: unescapeString(m[1] as string), line }, next: this.noChildren(index, 'delimiter') };
    }
    if (RE.otherwise.test(text) || (m = RE.when.exec(text))) {
      this.module.hasTags = true;
      const guard: Guard = RE.otherwise.test(text)
        ? { kind: 'else' }
        : { kind: 'tag', name: (m as RegExpExecArray)[2] as string, negate: !!(m as RegExpExecArray)[1], value: (m as RegExpExecArray)[3] };
      const { items, next } = this.needChildren(index, text);
      const { content, tags, delim } = this.split(items);
      const { seq, tags: inner } = this.seqOf(content, true, delim, this.rangeOf(index, next));
      return { item: { t: 'when', guard, seq, tags: [...tags, ...inner], line }, next };
    }
    if ((m = RE.quoted.exec(text))) {
      const node: TextNode = { kind: 'text', id: newId(), value: unescapeString(m[1] as string), range: [line.start, line.end] };
      return here(node, this.noChildren(index, 'text'));
    }

    // A plain line is a short-form expression.
    const opt = new Parser(this.src, line.start, line.end, this.module).parseLineOption();
    const next = this.noChildren(index, 'a text line');
    return { item: { t: 'node', node: opt.seq, tags: opt.tags, guard: opt.guard, line }, next };
  }
}

/** Parse a `branch NAME` block statement. */
export function parseBranch(src: string, st: { start: number; end: number }, name: string, module: Module): Def {
  const lines: Line[] = [];
  let pos = st.start;
  while (pos <= st.end) {
    let eol = src.indexOf('\n', pos);
    if (eol === -1 || eol > st.end) eol = st.end;
    const raw = src.slice(pos, eol);
    if (raw.trim() !== '') {
      const lead = /^[ \t]*/.exec(raw) as RegExpExecArray;
      const trimmedEnd = pos + raw.replace(/\s+$/, '').length;
      lines.push({ indent: indentWidth(lead[0]), start: pos + lead[0].length, end: trimmedEnd, text: src.slice(pos + lead[0].length, trimmedEnd) });
    }
    pos = eol + 1;
  }
  const p = new LongParser(src, lines, module);
  const { items } = p.children(0);
  const header = lines[0] as Line;
  const range: [number, number] = [st.start, st.end];
  const { content, tags, delim } = p.split(items);
  const seqOf = p.seqOf(content, true, delim, range);
  const allTags = [...tags, ...seqOf.tags];
  let body: Node = seqOf.seq;
  if (allTags.length) {
    const opt: Option = { seq: seqOf.seq, tags: allTags, guard: undefined, range };
    const group: GroupNode = { kind: 'group', id: newId(), options: [opt], delimiter: undefined, bare: true, range };
    body = group;
  }
  if (!items.length) fail(src, `'branch ${name}' needs indented lines under it`, header.start);
  return { name, body, module, range, form: 'long' };
}
