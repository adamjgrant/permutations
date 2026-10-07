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

type Table = Map<string, bigint>;

const CLOSING = /^[.,;:!?)\]'’%…]/;
const OPENING = /[(\[“‘¿¡]$/;
const MAX_TAGGED_ANYORDER = 8;

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
  for (const [k, v] of decode(s)) out[k] = v === '' ? true : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
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

function joinOutputs(outs: string[], joins: boolean[], delim: string): string {
  let res = '';
  let pending = false;
  for (let i = 0; i < outs.length; i++) {
    const out = outs[i] as string;
    if (i > 0 && joins[i]) pending = true;
    if (out === '') continue;
    if (res !== '' && pending && !CLOSING.test(out) && !OPENING.test(res)) res += delim;
    res += out;
    pending = false;
  }
  return res;
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
    const st = decode(s);
    const out = [];
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

  private orderings(node: AnyOrderNode): SeqNode[] {
    if (!node.orderings) {
      if (node.items.length > MAX_TAGGED_ANYORDER) {
        throw new PermError(`Any-order groups in programs that use tags support up to ${MAX_TAGGED_ANYORDER} items`);
      }
      node.orderings = allPermutations(node.items.length).map((perm) => ({
        kind: 'seq' as const,
        id: newId(),
        pieces: perm.map((idx, j) => ({ node: node.items[idx] as SeqNode, join: j > 0 })),
        joinDelim: node.delimiter,
        scopeDelim: node.delimiter,
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
  walk(node: Node, sIn: string, sOut: string, k: bigint, delim: string): string {
    switch (node.kind) {
      case 'text':
        return node.value;
      case 'ref': {
        const target = node.target;
        if (!target) throw new PermError(`Unresolved reference $${node.path}`);
        return target.kind === 'def' ? this.walk(target.def.body, sIn, sOut, k, delim) : target.value;
      }
      case 'seq': {
        const outs: string[] = [];
        this.walkSeq(node, 0, sIn, sOut, k, node.scopeDelim ?? delim, outs);
        return joinOutputs(outs, node.pieces.map((p) => p.join), node.joinDelim ?? delim);
      }
      case 'group': {
        const d = node.delimiter ?? delim;
        for (const o of this.eligible(node, sIn)) {
          for (const [sMid, c] of this.seqFrom(o.seq, 0, sIn)) {
            if (applyTags(sMid, o.tags) !== sOut) continue;
            if (k < c) return this.walk(o.seq, sIn, sMid, k, d);
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
          const outs = perm.map((i) => this.walk(node.items[i] as SeqNode, sIn, sOut, ks[i] as bigint, d));
          return joinOutputs(outs, outs.map(() => true), d);
        }
        for (const seq of this.orderings(node)) {
          const c = this.table(seq, sIn).get(sOut) ?? 0n;
          if (k < c) return this.walk(seq, sIn, sOut, k, delim);
          k -= c;
        }
        break;
      }
      case 'repeat': {
        for (const seq of node.expanded) {
          const c = this.table(seq, sIn).get(sOut) ?? 0n;
          if (k < c) return this.walk(seq, sIn, sOut, k, delim);
          k -= c;
        }
        break;
      }
      case 'transform': {
        const n = BigInt(node.fns.length);
        const text = this.walk(node.inner, sIn, sOut, k / n, delim);
        const name = node.fns[Number(k % n)] as string;
        const fn = this.fns[name];
        if (!fn) throw new PermError(`Unknown transform '${name}'`);
        return fn(text);
      }
    }
    throw new PermError('Internal error: index out of range while walking');
  }

  private walkSeq(seq: SeqNode, i: number, sIn: string, sOut: string, k: bigint, delim: string, outs: string[]): void {
    if (i >= seq.pieces.length) return;
    const piece = seq.pieces[i] as SeqNode['pieces'][number];
    for (const [sMid, c1] of this.table(piece.node, sIn)) {
      const r = this.seqFrom(seq, i + 1, sMid).get(sOut) ?? 0n;
      if (r === 0n) continue;
      const block = c1 * r;
      if (k < block) {
        outs[i] = this.walk(piece.node, sIn, sMid, k / r, delim);
        this.walkSeq(seq, i + 1, sMid, sOut, k % r, delim, outs);
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
    if (index < 0n || index >= this.count) throw new RangeError('Permutation index out of range');
    let k = index;
    for (const [sOut, c] of this.ev.table(this.entry.body, '')) {
      if (k < c) {
        const text = this.ev.walk(this.entry.body, '', sOut, k, this.opts.delimiter);
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
  sample(n: number): Output[] {
    this.requireAny();
    const seenText = new Set<string>();
    const out: Output[] = [];
    const count = this.count;
    if (count <= 5000n) {
      const idx = Array.from({ length: Number(count) }, (_v, i) => BigInt(i));
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [idx[i], idx[j]] = [idx[j] as bigint, idx[i] as bigint];
      }
      for (const i of idx) {
        if (out.length >= n) break;
        const o = this.at(i);
        if (seenText.has(o.text)) continue;
        seenText.add(o.text);
        out.push(o);
      }
      return out;
    }
    const seenIdx = new Set<bigint>();
    let misses = 0;
    while (out.length < n && misses < 1000) {
      const i = randBelow(count, this.rng);
      if (seenIdx.has(i)) continue;
      seenIdx.add(i);
      const o = this.at(i);
      if (seenText.has(o.text)) {
        misses++;
        continue;
      }
      seenText.add(o.text);
      out.push(o);
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
