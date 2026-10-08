import { newId } from './ids';
import { builtinTransforms, TransformFn } from './transforms';
import {
  AnyOrderNode,
  Def,
  GroupNode,
  Module,
  Node,
  Output,
  PermError,
  SeqNode,
} from './types';

/** How one result was made: every choice taken and every node the walk went through. */
export interface Trace {
  /** Each choice made, as the group and the index of the option taken in `group.options`. */
  picks: { group: GroupNode; option: number }[];
  /** Text, references, any-order groups, repeats and transforms on the path, in walk order. */
  nodes: Node[];
}

type Table = Map<string, bigint>;

// A straight ' is closing (no delimiter before it) for a suffix such as 's or 're, or on its
// own; before a word it opens a quotation: She said 'loudly'.
const CLOSING = /^(?:[.,;:!?)\]’”%…]|'(?:(?:s|re|ll|d|ve|m|t)(?!\p{L})|(?!\p{L})))/u;
const OPENING = /[(\[“‘¿¡]$/;
export const MAX_TAGGED_ANYORDER = 8;

// --- tag state -------------------------------------------------------------
// State is a canonical string: sorted "name" or "name=value" entries joined by newlines.

const decodeCache = new Map<string, Map<string, string>>();

function decode(s: string): Map<string, string> {
  let m = decodeCache.get(s);
  if (m) return m;
  m = new Map();
  if (s) {
    for (const entry of s.split('\n')) {
      const i = entry.indexOf('=');
      if (i === -1) m.set(entry, '');
      else m.set(entry.slice(0, i), entry.slice(i + 1));
    }
  }
  decodeCache.set(s, m);
  return m;
}

function encode(m: Map<string, string>): string {
  return [...m.keys()]
    .sort()
    .map((k) => (m.get(k) === '' ? k : `${k}=${m.get(k)}`))
    .join('\n');
}

function applyTags(s: string, tags: { name: string; value?: string | undefined }[]): string {
  if (!tags.length) return s;
  const m = new Map(decode(s));
  for (const t of tags) m.set(t.name, t.value ?? '');
  return encode(m);
}

export function tagsOf(s: string): Output['tags'] {
  const out: Output['tags'] = {};
  // A bare tag is true, true and false are booleans, and a number is a number unless writing it as
  // one would change it (05 stays the text "05").
  for (const [k, v] of decode(s)) out[k] = v === '' || v === 'true' ? true : v === 'false' ? false : /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) && String(Number(v)) === v ? Number(v) : v;
  return out;
}

// --- helpers ---------------------------------------------------------------

function single(s: string): Table {
  return new Map([[s, 1n]]);
}

function add(t: Table, s: string, c: bigint): void {
  t.set(s, (t.get(s) ?? 0n) + c);
}

function factorial(n: number): bigint {
  let r = 1n;
  for (let i = 2n; i <= BigInt(n); i++) r *= i;
  return r;
}

/** The index-th permutation of 0..n-1 in lexicographic order. */
function unrankPermutation(n: number, index: bigint): number[] {
  const pool = Array.from({ length: n }, (_v, i) => i);
  const out: number[] = [];
  let idx = index;
  for (let i = n; i >= 1; i--) {
    const f = factorial(i - 1);
    const q = Number(idx / f);
    idx %= f;
    out.push(pool.splice(q, 1)[0] as number);
  }
  return out;
}

function allPermutations(n: number): number[][] {
  const out: number[][] = [];
  const total = Number(factorial(n));
  for (let i = 0; i < total; i++) out.push(unrankPermutation(n, BigInt(i)));
  return out;
}

/**
 * Weighted rendezvous: each candidate draws a number keyed by its id, and the one whose draw is
 * highest once scaled by its weight wins (ln(u) / w, the exponential race). A candidate wins
 * with probability w / total, and adding or removing a candidate only changes the picks it wins
 * or loses.
 */
function pickRendezvous(cands: { id: string; w: bigint }[], draw: (id: string) => number): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i] as { id: string; w: bigint };
    if (c.w <= 0n) continue;
    const score = Math.log(Math.max(draw(c.id), 1e-300)) / Number(c.w);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * What an alternative or any-order item says at its own level: its words and references, not
 * the choices inside it. Steady picks key on it, so editing a choice nested inside an
 * alternative, or adding alternatives around it, does not change which one it is.
 */
function labelOf(node: Node): string {
  switch (node.kind) {
    case 'text':
      return node.value;
    case 'ref':
      return '$' + node.path;
    case 'seq':
      return node.pieces.map((p) => labelOf(p.node)).filter((x) => x !== '').join(' ');
    default:
      return '';
  }
}

function optionLabel(o: GroupNode['options'][number]): string {
  const g = o.guard;
  const guard = !g ? '' : g.kind === 'else' ? 'else' : `${g.negate ? '!' : ''}${g.name}=${g.value ?? ''}`;
  return `${guard}:${labelOf(o.seq)}:${o.tags.map((t) => `${t.name}=${t.value ?? ''}`).join(',')}`;
}

/** Keys for the pieces of a sequence: references by name, other pieces by kind and their place among that kind. */
function pieceKeys(pieces: SeqNode['pieces']): string[] {
  return contentKeys(pieces.map((p) => (p.node.kind === 'ref' ? 'r' + p.node.path : p.node.kind)));
}

/** Keys for a list of content names: equal ones are told apart by their place among equals. */
function contentKeys(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    return k === 0 ? n : `${n}~${k}`;
  });
}

/** A number in [0, 1) from a string: the same string always gives the same number. */
export function hashUnit(text: string): number {
  // Two FNV-1a hashes with different offsets, mixed, give 52 well-spread bits.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  const mix = (x: number): number => {
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  };
  return (mix(a) * 2 ** 20 + (mix(b) >>> 12)) / 2 ** 52;
}

export function randBelow(n: bigint, rng: () => number): bigint {
  if (n <= 1n) return 0n;
  const bits = n.toString(2).length;
  for (;;) {
    let r = 0n;
    let remaining = bits;
    while (remaining > 0) {
      const take = Math.min(remaining, 30);
      r = (r << BigInt(take)) | BigInt(Math.floor(rng() * 2 ** take));
      remaining -= take;
    }
    if (r < n) return r;
  }
}

function joinOutputs(outs: string[], joins: boolean[], delim: string, last?: string): string {
  let res = '';
  let pending = false;
  // `last` joins the final non-empty piece instead of the delimiter: a, b and c.
  let lastIndex = -1;
  if (last !== undefined) for (let i = outs.length - 1; i >= 0; i--) if (outs[i] !== '') { lastIndex = i; break; }
  for (let i = 0; i < outs.length; i++) {
    const out = outs[i] as string;
    if (i > 0 && joins[i]) pending = true;
    if (out === '') continue;
    // No delimiter before closing punctuation, after opening punctuation, or next to a line break.
    // What follows is judged with the pieces glued to it, so it reads the same however it is split.
    let ahead = out;
    for (let j = i + 1; j < outs.length && !joins[j] && ahead.length < 4; j++) ahead += outs[j] as string;
    if (res !== '' && pending && !CLOSING.test(ahead) && !OPENING.test(res) && !res.endsWith('\n') && !out.startsWith('\n')) {
      res += i === lastIndex ? (last as string) : delim;
    }
    res += out;
    pending = false;
  }
  return res;
}

/** The options of a choice that can be taken when the walk arrives in tag state `s`. */
export function eligibleOptions(group: GroupNode, s: string): GroupNode['options'] {
  const st = decode(s);
  const out: GroupNode['options'] = [];
  let matched = false;
  for (const o of group.options) {
    const g = o.guard;
    if (!g) {
      out.push(o);
    } else if (g.kind === 'else') {
      if (!matched) out.push(o);
    } else {
      const has = st.has(g.name);
      let ok = g.value !== undefined ? has && st.get(g.name) === g.value : has;
      if (g.negate) ok = !ok;
      if (ok) {
        matched = true;
        out.push(o);
      }
    }
  }
  return out;
}

// --- evaluator -------------------------------------------------------------

export class Evaluator {
  private memo = new Map<string, Table>();
  private seqMemo = new Map<string, Table>();

  constructor(
    private hasTags: boolean,
    private fns: Record<string, TransformFn>,
  ) {}

  table(node: Node, s: string): Table {
    const key = `${node.id}|${s}`;
    let t = this.memo.get(key);
    if (!t) {
      t = this.compute(node, s);
      this.memo.set(key, t);
    }
    return t;
  }

  private seqFrom(seq: SeqNode, i: number, s: string): Table {
    if (i >= seq.pieces.length) return single(s);
    const key = `${seq.id}:${i}|${s}`;
    let t = this.seqMemo.get(key);
    if (t) return t;
    t = new Map();
    const piece = seq.pieces[i] as SeqNode['pieces'][number];
    for (const [s1, c1] of this.table(piece.node, s)) {
      for (const [s2, c2] of this.seqFrom(seq, i + 1, s1)) add(t, s2, c1 * c2);
    }
    this.seqMemo.set(key, t);
    return t;
  }

  private eligible(group: GroupNode, s: string) {
    return eligibleOptions(group, s);
  }

  /** During one steady walk: choices (by group id) that must take the given option, where they can. */
  forced: Map<number, number> | undefined;

  /** Run a transform. One from the host that throws, or gives back something other than text, is reported as such. */
  private applyFn(name: string, text: string): string {
    const fn = this.fns[name];
    if (!fn) throw new PermError(`Unknown transform '${name}'`);
    let out: unknown;
    try {
      out = fn(text);
    } catch (e) {
      throw new PermError(`The transform ${name} failed on ${JSON.stringify(text)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (typeof out !== 'string') throw new PermError(`The transform ${name} must give back text, but gave ${out === null ? 'null' : typeof out} for ${JSON.stringify(text)}`);
    return out;
  }

  /** The tag states each node has been entered with so far: after counting, every reachable one. */
  entryStates(): Map<number, string[]> {
    const out = new Map<number, string[]>();
    for (const key of this.memo.keys()) {
      const bar = key.indexOf('|');
      const id = Number(key.slice(0, bar));
      const state = key.slice(bar + 1);
      const list = out.get(id);
      if (list) list.push(state);
      else out.set(id, [state]);
    }
    return out;
  }

  private orderings(node: AnyOrderNode): SeqNode[] {
    if (!node.orderings) {
      if (node.items.length > MAX_TAGGED_ANYORDER) {
        throw new PermError(
          `This any-order group has ${node.items.length} items, but in programs that use tags any-order groups can have at most ${MAX_TAGGED_ANYORDER}`,
          node.range[0],
        );
      }
      node.orderings = allPermutations(node.items.length).map((perm) => ({
        kind: 'seq' as const,
        id: newId(),
        pieces: perm.map((idx, j) => ({ node: node.items[idx] as SeqNode, join: j > 0 })),
        // The group's delimiter goes between its items; inside an item, the one around the group.
        joinDelim: node.delimiter,
        lastDelim: node.last,
        range: node.range,
      }));
    }
    return node.orderings;
  }

  private compute(node: Node, s: string): Table {
    switch (node.kind) {
      case 'text':
        return single(s);
      case 'ref': {
        const target = node.target;
        if (!target) throw new PermError(`Unresolved reference $${node.path}`);
        return target.kind === 'def' ? this.table(target.def.body, s) : single(s);
      }
      case 'seq':
        return this.seqFrom(node, 0, s);
      case 'group': {
        const t: Table = new Map();
        for (const o of this.eligible(node, s)) {
          for (const [sMid, c] of this.seqFrom(o.seq, 0, s)) add(t, applyTags(sMid, o.tags), c);
        }
        return t;
      }
      case 'anyorder': {
        if (!this.hasTags) {
          let prod = factorial(node.items.length);
          for (const it of node.items) prod *= this.table(it, s).get(s) ?? 0n;
          return prod > 0n ? new Map([[s, prod]]) : new Map();
        }
        const t: Table = new Map();
        for (const seq of this.orderings(node)) for (const [s2, c] of this.table(seq, s)) add(t, s2, c);
        return t;
      }
      case 'repeat': {
        const t: Table = new Map();
        for (const seq of node.expanded) for (const [s2, c] of this.table(seq, s)) add(t, s2, c);
        return t;
      }
      case 'transform': {
        const n = BigInt(node.fns.length);
        const t: Table = new Map();
        for (const [s2, c] of this.table(node.inner, s)) t.set(s2, c * n);
        return t;
      }
    }
  }

  /** Text of the k-th path through `node` that starts in state sIn and ends in state sOut. */
  walk(node: Node, sIn: string, sOut: string, k: bigint, delim: string, tr?: Trace): string {
    if (tr && node.kind !== 'seq' && node.kind !== 'group') tr.nodes.push(node);
    switch (node.kind) {
      case 'text':
        return node.value;
      case 'ref': {
        const target = node.target;
        if (!target) throw new PermError(`Unresolved reference $${node.path}`);
        return target.kind === 'def' ? this.walk(target.def.body, sIn, sOut, k, node.delimiter ?? delim, tr) : target.value;
      }
      case 'seq': {
        const outs: string[] = [];
        this.walkSeq(node, 0, sIn, sOut, k, node.scopeDelim ?? delim, outs, tr);
        return joinOutputs(outs, node.pieces.map((p) => p.join), node.joinDelim ?? delim, node.lastDelim);
      }
      case 'group': {
        const d = node.delimiter ?? delim;
        for (const o of this.eligible(node, sIn)) {
          for (const [sMid, c] of this.seqFrom(o.seq, 0, sIn)) {
            if (applyTags(sMid, o.tags) !== sOut) continue;
            if (k < c) {
              tr?.picks.push({ group: node, option: node.options.indexOf(o) });
              return this.walk(o.seq, sIn, sMid, k, d, tr);
            }
            k -= c;
          }
        }
        break;
      }
      case 'anyorder': {
        const d = node.delimiter ?? delim;
        if (!this.hasTags) {
          const n = node.items.length;
          const cs = node.items.map((it) => this.table(it, sIn).get(sIn) ?? 0n);
          const prod = cs.reduce((a, b) => a * b, 1n);
          const perm = unrankPermutation(n, k / prod);
          let rest = k % prod;
          const ks = cs.map((c) => {
            const ki = rest % c;
            rest /= c;
            return ki;
          });
          const outs = perm.map((i) => this.walk(node.items[i] as SeqNode, sIn, sOut, ks[i] as bigint, delim, tr));
          return joinOutputs(outs, outs.map(() => true), d, node.last);
        }
        for (const seq of this.orderings(node)) {
          const c = this.table(seq, sIn).get(sOut) ?? 0n;
          if (k < c) return this.walk(seq, sIn, sOut, k, delim, tr);
          k -= c;
        }
        break;
      }
      case 'repeat': {
        for (const seq of node.expanded) {
          const c = this.table(seq, sIn).get(sOut) ?? 0n;
          if (k < c) return this.walk(seq, sIn, sOut, k, delim, tr);
          k -= c;
        }
        break;
      }
      case 'transform': {
        const n = BigInt(node.fns.length);
        const text = this.walk(node.inner, sIn, sOut, k / n, delim, tr);
        const name = node.fns[Number(k % n)] as string;
        return this.applyFn(name, text);
      }
    }
    throw new PermError('Internal error: index out of range while walking');
  }

  /**
   * Like `walk`, but each decision draws its own numbers from `draw(key)`, where the key names
   * the decision by what the program says there rather than by position: the definition, the
   * content of the pieces and alternatives on the way, and how many times that definition was
   * entered. Each choice then picks by weighted rendezvous: every candidate draws a number keyed
   * by its own content, and the highest, scaled by how many complete paths follow it, wins. So an
   * edit in one place leaves the picks everywhere else alone, adding an alternative changes only
   * the picks it wins, and the results stay uniform over complete paths.
   */
  walkKeyed(node: Node, sIn: string, sOut: string, delim: string, key: string, draw: (key: string) => number, visits: Map<string, number>, tr?: Trace): string {
    if (tr && node.kind !== 'seq' && node.kind !== 'group') tr.nodes.push(node);
    switch (node.kind) {
      case 'text':
        return node.value;
      case 'ref': {
        const target = node.target;
        if (!target) throw new PermError(`Unresolved reference $${node.path}`);
        if (target.kind !== 'def') return target.value;
        const base = `def:${target.def.name}`;
        const n = visits.get(base) ?? 0;
        visits.set(base, n + 1);
        return this.walkKeyed(target.def.body, sIn, sOut, node.delimiter ?? delim, `${base}#${n}`, draw, visits, tr);
      }
      case 'seq': {
        const outs: string[] = [];
        const scope = node.scopeDelim ?? delim;
        const keys = pieceKeys(node.pieces);
        let s = sIn;
        for (let i = 0; i < node.pieces.length; i++) {
          const piece = node.pieces[i] as SeqNode['pieces'][number];
          const at = `${key}/${keys[i]}`;
          const cands: { id: string; s: string; w: bigint }[] = [];
          for (const [sMid, c1] of this.table(piece.node, s)) {
            const r = this.seqFrom(node, i + 1, sMid).get(sOut) ?? 0n;
            if (r > 0n) cands.push({ id: sMid, s: sMid, w: c1 * r });
          }
          const pick = cands.length === 1 ? cands[0] : cands[pickRendezvous(cands, (id) => draw(`${at}/s/${id}`))];
          if (!pick) throw new PermError('Internal error: no way through a sequence');
          outs[i] = this.walkKeyed(piece.node, s, pick.s, scope, at, draw, visits, tr);
          s = pick.s;
        }
        return joinOutputs(outs, node.pieces.map((p) => p.join), node.joinDelim ?? delim, node.lastDelim);
      }
      case 'group': {
        const d = node.delimiter ?? delim;
        const keys = contentKeys(node.options.map(optionLabel));
        const cands: { o: (typeof node.options)[number]; k: string; id: string; s: string; w: bigint }[] = [];
        for (const o of this.eligible(node, sIn)) {
          const k = keys[node.options.indexOf(o)] as string;
          for (const [sMid, c] of this.seqFrom(o.seq, 0, sIn)) if (applyTags(sMid, o.tags) === sOut) cands.push({ o, k, id: `${k}|${sMid}`, s: sMid, w: c });
        }
        const want = this.forced?.get(node.id);
        const pool = want === undefined ? cands : cands.filter((c) => node.options.indexOf(c.o) === want);
        const from = pool.length ? pool : cands;
        const pick = from[pickRendezvous(from, (id) => draw(`${key}/g/${id}`))];
        if (!pick) throw new PermError('Internal error: no way through a choice');
        const index = node.options.indexOf(pick.o);
        tr?.picks.push({ group: node, option: index });
        return this.walkKeyed(pick.o.seq, sIn, pick.s, d, `${key}/${pick.k}`, draw, visits, tr);
      }
      case 'anyorder': {
        const d = node.delimiter ?? delim;
        const keys = contentKeys(node.items.map(labelOf));
        if (!this.hasTags) {
          // Each item draws a number keyed by its content and the items go in that order: a
          // uniform ordering, and a new item slots in without reshuffling the others.
          const order = node.items.map((_, i) => ({ i, u: draw(`${key}/p/${keys[i]}`) })).sort((a, b) => a.u - b.u);
          const outs = order.map(({ i }) => this.walkKeyed(node.items[i] as SeqNode, sIn, sOut, delim, `${key}/${keys[i]}`, draw, visits, tr));
          return joinOutputs(outs, outs.map(() => true), d, node.last);
        }
        const seqs = this.orderings(node);
        const cands = seqs
          .map((seq, i) => ({ i, id: seq.pieces.map((p) => keys[node.items.indexOf(p.node as SeqNode)]).join(','), w: this.table(seq, sIn).get(sOut) ?? 0n }))
          .filter((c) => c.w > 0n);
        const pick = cands[pickRendezvous(cands, (id) => draw(`${key}/o/${id}`))];
        if (!pick) throw new PermError('Internal error: no ordering fits');
        return this.walkKeyed(seqs[pick.i] as SeqNode, sIn, sOut, delim, `${key}/o`, draw, visits, tr);
      }
      case 'repeat': {
        const cands = node.expanded.map((seq, i) => ({ i, id: String(node.min + i), w: this.table(seq, sIn).get(sOut) ?? 0n })).filter((c) => c.w > 0n);
        const pick = cands[pickRendezvous(cands, (id) => draw(`${key}/r/${id}`))];
        if (!pick) throw new PermError('Internal error: no repeat count fits');
        // The copies are pieces of the expanded sequence, keyed by their place among equal pieces,
        // so the first copies keep their picks when the count changes.
        return this.walkKeyed(node.expanded[pick.i] as SeqNode, sIn, sOut, delim, `${key}/r`, draw, visits, tr);
      }
      case 'transform': {
        const text = this.walkKeyed(node.inner, sIn, sOut, delim, `${key}/i`, draw, visits, tr);
        const fnCands = node.fns.map((name) => ({ id: name, w: 1n }));
        const name = node.fns[Math.max(0, pickRendezvous(fnCands, (id) => draw(`${key}/t/${id}`)))] as string;
        return this.applyFn(name, text);
      }
    }
  }

  private walkSeq(seq: SeqNode, i: number, sIn: string, sOut: string, k: bigint, delim: string, outs: string[], tr?: Trace): void {
    if (i >= seq.pieces.length) return;
    const piece = seq.pieces[i] as SeqNode['pieces'][number];
    for (const [sMid, c1] of this.table(piece.node, sIn)) {
      const r = this.seqFrom(seq, i + 1, sMid).get(sOut) ?? 0n;
      if (r === 0n) continue;
      const block = c1 * r;
      if (k < block) {
        outs[i] = this.walk(piece.node, sIn, sMid, k / r, delim, tr);
        this.walkSeq(seq, i + 1, sMid, sOut, k % r, delim, outs, tr);
        return;
      }
      k -= block;
    }
    throw new PermError('Internal error: index out of range while walking a sequence');
  }
}

// --- program ---------------------------------------------------------------

export interface ProgramOptions {
  delimiter: string;
  fns: Record<string, TransformFn>;
  rng?: (() => number) | undefined;
}

export class Program {
  /** Code that parses but probably does not do what it looks like (see warnings.ts). */
  warnings: import('./warnings').Warning[] = [];
  private ev: Evaluator;
  private total?: bigint;
  private rng: () => number;

  constructor(
    readonly entry: Def,
    private modules: Module[],
    private opts: ProgramOptions,
  ) {
    this.ev = new Evaluator(
      modules.some((m) => m.hasTags),
      { ...builtinTransforms, ...opts.fns },
    );
    this.rng = opts.rng ?? Math.random;
  }

  /** The syntax tree the chart draws. */
  get ast(): Node {
    return this.entry.body;
  }

  /** Every definition in the program's own file, in source order (imports excluded). */
  get definitions(): Def[] {
    const root = this.entry.module;
    return [...root.defs.values()].sort((a, b) => a.range[0] - b.range[0]);
  }

  /** Every module that was loaded, the entry module first. */
  get loadedModules(): Module[] {
    return this.modules;
  }

  get delimiter(): string {
    return this.opts.delimiter;
  }

  /** For each node the walk reaches (by id), the tag states it is reached in. Counts first. */
  reachStates(): Map<number, string[]> {
    void this.count;
    return this.ev.entryStates();
  }

  /**
   * The tags that can be set when the walk reaches `node` (a choice, say): every name in any of
   * the states it is reached in. Undefined when the walk never reaches it.
   */
  tagsBefore(node: Node): Set<string> | undefined {
    const states = this.reachStates().get(node.id);
    if (!states) return undefined;
    const out = new Set<string>();
    for (const s of states) for (const k of decode(s).keys()) out.add(k);
    return out;
  }

  /** Number of paths (permutations). Two paths can print the same text. */
  get count(): bigint {
    if (this.total === undefined) {
      let n = 0n;
      for (const c of this.ev.table(this.entry.body, '').values()) n += c;
      this.total = n;
    }
    return this.total;
  }

  /** The permutation at a given index, 0 <= index < count. */
  at(index: bigint): Output {
    return this.walkAt(index);
  }

  /** How the permutation at `index` was made: the choices taken and the nodes on its path. */
  trace(index: bigint): Trace & Output {
    const tr: Trace = { picks: [], nodes: [] };
    const out = this.walkAt(index, tr);
    return { ...out, ...tr };
  }

  private walkAt(index: bigint, tr?: Trace): Output {
    if (index < 0n || index >= this.count) throw new RangeError('Permutation index out of range');
    let k = index;
    for (const [sOut, c] of this.ev.table(this.entry.body, '')) {
      if (k < c) {
        const text = this.ev.walk(this.entry.body, '', sOut, k, this.opts.delimiter, tr);
        return { text, tags: tagsOf(sOut) };
      }
      k -= c;
    }
    throw new PermError('Internal error: index out of range');
  }

  private requireAny(): void {
    if (this.count === 0n) throw new PermError('This program has no permutations (every path hits a guard dead end)');
  }

  /** One uniformly random permutation. Never enumerates. */
  one(): Output {
    this.requireAny();
    return this.at(randBelow(this.count, this.rng));
  }

  /** Up to n distinct random permutations (distinct by text). Everything, shuffled, if n covers them all. */
  sample(n: number, rng?: () => number): Output[] {
    return this.sampleIndices(n, rng).map((i) => this.at(i));
  }

  /**
   * Indexes of up to n random permutations with distinct text, for `at` or `trace`. Pass a
   * seeded `rng` to get the same picks again (the web app keeps examples steady while you edit).
   */
  sampleIndices(n: number, rng: () => number = this.rng): bigint[] {
    this.requireAny();
    const seenText = new Set<string>();
    const out: bigint[] = [];
    const count = this.count;
    if (count <= 5000n) {
      const idx = Array.from({ length: Number(count) }, (_v, i) => BigInt(i));
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [idx[i], idx[j]] = [idx[j] as bigint, idx[i] as bigint];
      }
      for (const i of idx) {
        if (out.length >= n) break;
        const text = this.at(i).text;
        if (seenText.has(text)) continue;
        seenText.add(text);
        out.push(i);
      }
      return out;
    }
    const seenIdx = new Set<bigint>();
    let misses = 0;
    while (out.length < n && misses < 1000) {
      const i = randBelow(count, rng);
      if (seenIdx.has(i)) continue;
      seenIdx.add(i);
      const text = this.at(i).text;
      if (seenText.has(text)) {
        misses++;
        continue;
      }
      seenText.add(text);
      out.push(i);
    }
    return out;
  }

  /**
   * Up to n examples with distinct text that stay put while the program is edited: each
   * choice draws its own number from the seed and its place in the program, so an edit in one
   * place leaves the picks everywhere else alone. Each comes with its trace.
   */
  sampleSteady(n: number, seed: number, opts: { show?: { group: GroupNode; option: number } } = {}): (Output & Trace)[] {
    const rows = this.steadyRows(n, seed);
    // With `show`, one row (the last) goes through that alternative, so a new one can be seen.
    const show = opts.show;
    if (!show || rows.some((r) => r.picks.some((p) => p.group === show.group && p.option === show.option))) return rows;
    const route = this.routeTo(show.group, show.option);
    if (!route) return rows;
    const seen = new Set(rows.slice(0, -1).map((r) => r.text));
    const entries = [...this.ev.table(this.entry.body, '')].map(([s, w]) => ({ id: s, s, w }));
    this.ev.forced = route;
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        const draw = (key: string): number => hashUnit(`${seed}|show|${attempt}|${key}`);
        const end = entries[pickRendezvous(entries, (id) => draw(`end/${id}`))] as { s: string };
        const tr: Trace = { picks: [], nodes: [] };
        const text = this.ev.walkKeyed(this.entry.body, '', end.s, this.opts.delimiter, 'main', draw, new Map(), tr);
        if (seen.has(text) || !tr.picks.some((p) => p.group === show.group && p.option === show.option)) continue;
        const row = { text, tags: tagsOf(end.s), ...tr };
        return rows.length < n ? [...rows, row] : [...rows.slice(0, -1), row];
      }
    } finally {
      this.ev.forced = undefined;
    }
    return rows;
  }

  /** The choices a walk must make to reach one alternative of a choice: group id to option. */
  private routeTo(target: GroupNode, option: number): Map<number, number> | undefined {
    const route = new Map<number, number>();
    const entered = new Set<Def>();
    const find = (node: Node): boolean => {
      if (node === target) {
        route.set(node.id, option);
        return true;
      }
      switch (node.kind) {
        case 'text':
          return false;
        case 'ref': {
          const t = node.target;
          if (t?.kind !== 'def' || entered.has(t.def)) return false;
          entered.add(t.def);
          const found = find(t.def.body);
          entered.delete(t.def);
          return found;
        }
        case 'seq':
          return node.pieces.some((p) => find(p.node));
        case 'group':
          for (let i = 0; i < node.options.length; i++) {
            if (find((node.options[i] as GroupNode['options'][number]).seq)) {
              route.set(node.id, i);
              return true;
            }
          }
          return false;
        case 'anyorder':
          return node.items.some(find);
        case 'repeat':
        case 'transform':
          return find(node.inner);
      }
    };
    return find(this.entry.body) ? route : undefined;
  }

  private steadyRows(n: number, seed: number): (Output & Trace)[] {
    this.requireAny();
    const out: (Output & Trace)[] = [];
    const seen = new Set<string>();
    if (this.count <= BigInt(n)) {
      for (let i = 0n; i < this.count; i++) {
        const t = this.trace(i);
        if (!seen.has(t.text)) {
          seen.add(t.text);
          out.push(t);
        }
      }
      return out;
    }
    const entries = [...this.ev.table(this.entry.body, '')].map(([s, w]) => ({ id: s, s, w }));
    // Each row draws on its own. When it repeats an earlier row's text, only that row draws
    // again, so one duplicate never moves the rows after it.
    for (let row = 0; row < n; row++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const draw = (key: string): number => hashUnit(`${seed}|${row}|${attempt}|${key}`);
        const end = entries[pickRendezvous(entries, (id) => draw(`end/${id}`))] as { s: string };
        const tr: Trace = { picks: [], nodes: [] };
        const text = this.ev.walkKeyed(this.entry.body, '', end.s, this.opts.delimiter, 'main', draw, new Map(), tr);
        if (seen.has(text)) continue;
        seen.add(text);
        out.push({ text, tags: tagsOf(end.s), ...tr });
        break;
      }
    }
    return out;
  }

  /** Every permutation, lazily. */
  *all(opts: { limit?: number; distinct?: boolean } = {}): Generator<Output> {
    const seen = opts.distinct ? new Set<string>() : undefined;
    let emitted = 0;
    const count = this.count;
    for (let i = 0n; i < count; i++) {
      if (opts.limit !== undefined && emitted >= opts.limit) return;
      const o = this.at(i);
      if (seen) {
        if (seen.has(o.text)) continue;
        seen.add(o.text);
      }
      emitted++;
      yield o;
    }
  }
}
