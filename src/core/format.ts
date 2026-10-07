import { isReservedLine } from './longform';
import { parseModule } from './parser';
import { Def, GroupNode, Guard, Node, Option, Piece, SeqNode, Tag } from './types';

export type FormatMode = 'short' | 'long' | 'auto';

class Unprintable extends Error {}

const isIdentStart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);
const isIdentChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

// --- short form ------------------------------------------------------------

function quote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

function escapeText(v: string): string {
  if (v.includes('\n')) throw new Unprintable('contains a line break in text');
  let out = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i] as string;
    const n = v[i + 1];
    if ('\\[]|$@&'.includes(c)) out += '\\' + c;
    else if (c === '{' && n !== undefined && /[0-9]/.test(n)) out += '\\{';
    else if (c === ':' && i === 0 && (isIdentStart(n) || n === '[')) out += '\\:';
    else if (c === ';' && /^;\s*delimiter/.test(v.slice(i))) out += '\\;';
    else if (/\s/.test(c) && (i === 0 || i === v.length - 1)) out += '\\' + c;
    else out += c;
  }
  return out;
}

function guardPrefix(g: Guard): string {
  if (g.kind === 'else') return '@else:';
  return `@${g.negate ? '!' : ''}${g.name}${g.value !== undefined ? '=' + g.value : ''}:`;
}

function tagText(t: Tag): string {
  return `@${t.name}${t.value !== undefined && t.value !== '' ? '=' + t.value : ''}`;
}

function delimiterClause(d: string): string {
  return `; delimiter=${quote(d)}`;
}

interface Flat {
  node: Node;
  join: boolean;
}

/** Inline nested sequences so `[a b]` pieces print without extra brackets. */
function flatten(pieces: Piece[]): Flat[] {
  const out: Flat[] = [];
  for (const p of pieces) {
    const n = p.node;
    if (n.kind === 'seq' && n.joinDelim === undefined && n.scopeDelim === undefined) {
      const inner = flatten(n.pieces);
      inner.forEach((q, i) => out.push({ node: q.node, join: i === 0 ? p.join : q.join }));
      continue;
    }
    out.push({ node: n, join: p.join });
  }
  return out;
}

function shortSeq(seq: SeqNode): string {
  let out = '';
  let pendingJoin = false;
  let prev: Node | undefined;
  for (const p of flatten(seq.pieces)) {
    const n = p.node;
    if (n.kind === 'text' && n.value === '') {
      pendingJoin ||= p.join;
      continue;
    }
    const join = pendingJoin || p.join;
    pendingJoin = false;
    const s = shortNode(n);
    if (out !== '') {
      if (join) out += ' ';
      else if (prev && prev.kind !== 'text' && prev.kind !== 'group' && prev.kind !== 'anyorder' && /^[A-Za-z0-9_.:{]/.test(s)) {
        // A reference or suffix would swallow the text that follows, so bracket the earlier piece.
        out = wrapLast(out);
      }
    }
    out += s;
    prev = n;
  }
  return out;
}

/** Wrap the final piece of already-printed text in `[...]`. Used only after a ref/transform/repeat. */
function wrapLast(out: string): string {
  const m = /(\$[A-Za-z_][\w.]*(?::[A-Za-z_]\w*|:\[[^\]]*\]|\{[^}]*\})*)$/.exec(out);
  if (!m) return out;
  return out.slice(0, m.index) + '[' + m[1] + ']';
}

function shortOption(o: Option): string {
  let s = shortSeq(o.seq);
  const tags = o.tags.map(tagText).join(' ');
  if (tags) s = s ? `${s} ${tags}` : tags;
  if (o.guard) s = s ? `${guardPrefix(o.guard)} ${s}` : guardPrefix(o.guard);
  return s;
}

function checkRangeLike(o: Option): void {
  const only = o.seq.pieces.length === 1 ? o.seq.pieces[0] : undefined;
  if (only && only.node.kind === 'text' && /^(\d+\.\.\d+|.\.\..)$/u.test(only.node.value)) {
    throw new Unprintable('contains text that looks like a range');
  }
}

function shortGroup(g: GroupNode, brackets: boolean): string {
  for (const o of g.options) checkRangeLike(o);
  const parts = g.options.map(shortOption);
  if (!brackets) {
    if (g.delimiter !== undefined) throw new Unprintable('a bracket-free choice cannot carry a delimiter');
    return parts.join(' | ');
  }
  return '[' + parts.join('|') + (g.delimiter !== undefined ? delimiterClause(g.delimiter) : '') + ']';
}

function asSuffixTarget(n: Node): string {
  if (n.kind === 'group' || n.kind === 'ref' || n.kind === 'anyorder' || n.kind === 'transform' || n.kind === 'repeat') {
    return shortNode(n);
  }
  if (n.kind === 'text') return '[' + shortNode(n) + ']';
  return '[' + shortSeq(n) + ']';
}

function shortNode(n: Node): string {
  switch (n.kind) {
    case 'text':
      return escapeText(n.value);
    case 'ref':
      return '$' + n.path;
    case 'seq':
      if (n.joinDelim !== undefined || n.scopeDelim !== undefined) {
        const d = (n.scopeDelim ?? n.joinDelim) as string;
        return '[' + shortSeq({ ...n, joinDelim: undefined, scopeDelim: undefined }) + delimiterClause(d) + ']';
      }
      return shortSeq(n);
    case 'group':
      return shortGroup(n, true);
    case 'anyorder':
      return '[' + n.items.map(shortSeq).join(' & ') + (n.delimiter !== undefined ? delimiterClause(n.delimiter) : '') + ']';
    case 'repeat': {
      const count = n.min === n.max ? `${n.min}` : `${n.min}..${n.max}`;
      const clause = n.delimiter !== undefined ? delimiterClause(n.delimiter) : '';
      return `${asSuffixTarget(n.inner)}{${count}${clause}}`;
    }
    case 'transform': {
      const f = n.fns.length === 1 ? ':' + n.fns[0] : ':[' + n.fns.join('|') + ']';
      return asSuffixTarget(n.inner) + f;
    }
  }
}

export function printShortDef(def: Def): string {
  const body = def.body;
  let text: string;
  const soleGroup = (b: Node): GroupNode | undefined => {
    if (b.kind === 'group' && b.bare) return b;
    if (b.kind === 'seq' && b.pieces.length === 1 && b.joinDelim === undefined && b.scopeDelim === undefined) {
      const p = (b.pieces[0] as Piece).node;
      if (p.kind === 'group' && p.delimiter === undefined) return p;
    }
    return undefined;
  };
  const g = soleGroup(body);
  if (g) text = shortGroup(g, false);
  else text = shortNode(body);
  return text === '' ? `${def.name} =` : `${def.name} = ${text}`;
}

// --- long form -------------------------------------------------------------

const INDENT = '  ';
const indent = (lines: string[]): string[] => lines.map((l) => INDENT + l);

function longText(v: string): string {
  if (v === '') return 'nothing';
  const bare =
    v === v.trim() &&
    !/[\\\[\]$@\n\t]/.test(v) &&
    !/^["#]/.test(v) &&
    !/ {2}/.test(v) &&
    !isReservedLine(v);
  return bare ? v : quote(v);
}

function delimLeaf(d: string | undefined): string[] {
  return d === undefined ? [] : [`delimiter ${quote(d)}`];
}

function tagLeaf(t: Tag): string {
  return `tag ${t.name}${t.value !== undefined && t.value !== '' ? ' = ' + t.value : ''}`;
}

function whenHeader(g: Guard): string {
  if (g.kind === 'else') return 'otherwise';
  return `when ${g.negate ? 'not ' : ''}${g.name}${g.value !== undefined ? ' = ' + g.value : ''}`;
}

/** Child lines for the pieces of a sequence. Runs of glued pieces become `tight` blocks. */
function longPieces(pieces: Piece[]): string[] {
  const chunks: Piece[][] = [];
  for (const p of pieces) {
    if (chunks.length && !p.join) (chunks[chunks.length - 1] as Piece[]).push(p);
    else chunks.push([p]);
  }
  const out: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length === 1) out.push(...longNode((chunk[0] as Piece).node));
    else out.push('tight', ...indent(chunk.flatMap((p) => longNode(p.node))));
  }
  return out;
}

function longSeqAsItem(seq: SeqNode): string[] {
  if (seq.pieces.length === 0) return ['nothing'];
  if (seq.pieces.length === 1 && seq.joinDelim === undefined && seq.scopeDelim === undefined) {
    return longNode((seq.pieces[0] as Piece).node);
  }
  const d = seq.scopeDelim ?? seq.joinDelim;
  return ['sequence', ...indent([...delimLeaf(d), ...longPieces(seq.pieces)])];
}

function longOption(o: Option): string[] {
  const tags = o.tags.map(tagLeaf);
  const d = o.seq.scopeDelim ?? o.seq.joinDelim;
  if (o.guard) return [whenHeader(o.guard), ...indent([...delimLeaf(d), ...longPieces(o.seq.pieces), ...tags])];
  if (tags.length) return ['sequence', ...indent([...delimLeaf(d), ...longPieces(o.seq.pieces), ...tags])];
  return longSeqAsItem(o.seq);
}

function longNode(n: Node): string[] {
  switch (n.kind) {
    case 'text':
      return [longText(n.value)];
    case 'ref':
      return [`ref ${n.path}`];
    case 'seq':
      return longSeqAsItem(n);
    case 'group':
      return ['one of', ...indent([...delimLeaf(n.delimiter), ...n.options.flatMap(longOption)])];
    case 'anyorder':
      return ['any order', ...indent([...delimLeaf(n.delimiter), ...n.items.flatMap(longSeqAsItem)])];
    case 'repeat': {
      const count = n.min === n.max ? `${n.min}` : `${n.min}..${n.max}`;
      return [`repeat ${count}`, ...indent([...delimLeaf(n.delimiter), ...longNode(n.inner)])];
    }
    case 'transform':
      return [`transform ${n.fns.join(' | ')}`, ...indent(longNode(n.inner))];
  }
}

export function printLongDef(def: Def): string {
  const body = def.body;
  let lines: string[];
  if (body.kind === 'seq') {
    lines = [...delimLeaf(body.scopeDelim ?? body.joinDelim), ...longPieces(body.pieces)];
  } else {
    lines = longNode(body);
  }
  if (!lines.length) lines = ['nothing'];
  return [`branch ${def.name}`, ...indent(lines)].join('\n');
}

// --- formatter -------------------------------------------------------------

function groupDepth(n: Node): number {
  switch (n.kind) {
    case 'seq':
      return Math.max(0, ...n.pieces.map((p) => groupDepth(p.node)));
    case 'group':
      return 1 + Math.max(0, ...n.options.map((o) => groupDepth(o.seq)));
    case 'anyorder':
      return 1 + Math.max(0, ...n.items.map(groupDepth));
    case 'repeat':
    case 'transform':
      return groupDepth(n.inner);
    default:
      return 0;
  }
}

export interface FormatResult {
  output: string;
  changed: string[];
  skipped: { name: string; reason: string }[];
}

export function formatSource(source: string, mode: FormatMode): FormatResult {
  const { module } = parseModule(source, '<format>');
  const defs = [...module.defs.values()].sort((a, b) => a.range[0] - b.range[0]);
  const edits: { start: number; end: number; text: string }[] = [];
  const changed: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const def of defs) {
    const shortOrUndefined = (): { text?: string; reason?: string } => {
      try {
        return { text: printShortDef(def) };
      } catch (e) {
        if (e instanceof Unprintable) return { reason: e.message };
        throw e;
      }
    };
    const short = shortOrUndefined();
    let target: 'short' | 'long';
    if (mode === 'auto') {
      const fits = short.text !== undefined && short.text.length <= 90 && groupDepth(def.body) <= 2;
      target = fits ? 'short' : 'long';
    } else target = mode;

    if (def.form === target) continue;

    const original = source.slice(def.range[0], def.range[1]);
    if (/^[ \t]*#/m.test(original)) {
      skipped.push({ name: def.name, reason: 'contains a comment, left unchanged' });
      continue;
    }
    let text: string;
    if (target === 'short') {
      if (short.text === undefined) {
        skipped.push({ name: def.name, reason: `cannot be written in short form (${short.reason})` });
        continue;
      }
      text = short.text;
    } else text = printLongDef(def);
    edits.push({ start: def.range[0], end: def.range[1], text });
    changed.push(def.name);
  }

  let output = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, e.start) + e.text + output.slice(e.end);
  }
  return { output, changed, skipped };
}
