import { compile, formatSource, Node, Output } from '../src';

// An independent oracle: enumerate every path through the syntax tree directly, with no
// counting tables or unranking. The engine's all() must produce the same multiset.

type State = Map<string, string>;
interface Path {
  text: string;
  st: State;
}

const CLOSING = /^[.,;:!?)\]'’%…]/;
const OPENING = /[(\[“‘¿¡]$/;

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

function joinAll(outs: string[], joins: boolean[], delim: string): string {
  let res = '';
  let pending = false;
  outs.forEach((o, i) => {
    if (i > 0 && joins[i]) pending = true;
    if (o === '') return;
    if (res !== '' && pending && !CLOSING.test(o) && !OPENING.test(res)) res += delim;
    res += o;
    pending = false;
  });
  return res;
}

const FNS: Record<string, (s: string) => string> = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
};

function enumNode(n: Node, st: State, delim: string): Path[] {
  switch (n.kind) {
    case 'text':
      return [{ text: n.value, st }];
    case 'ref':
      if (n.target?.kind === 'def') return enumNode(n.target.def.body, st, delim);
      return [{ text: n.target?.kind === 'value' ? n.target.value : '', st }];
    case 'seq': {
      const d = n.scopeDelim ?? delim;
      const j = n.joinDelim ?? delim;
      let acc: { outs: string[]; st: State }[] = [{ outs: [], st }];
      for (const p of n.pieces) {
        const next: { outs: string[]; st: State }[] = [];
        for (const a of acc) for (const r of enumNode(p.node, a.st, d)) next.push({ outs: [...a.outs, r.text], st: r.st });
        acc = next;
      }
      return acc.map((a) => ({ text: joinAll(a.outs, n.pieces.map((p) => p.join), j), st: a.st }));
    }
    case 'group': {
      const d = n.delimiter ?? delim;
      const out: Path[] = [];
      let matched = false;
      for (const o of n.options) {
        const g = o.guard;
        if (g) {
          if (g.kind === 'else') {
            if (matched) continue;
          } else {
            const has = st.has(g.name);
            let ok = g.value !== undefined ? has && st.get(g.name) === g.value : has;
            if (g.negate) ok = !ok;
            if (!ok) continue;
            matched = true;
          }
        }
        for (const r of enumNode(o.seq, st, d)) {
          const st2 = new Map(r.st);
          for (const t of o.tags) st2.set(t.name, t.value ?? '');
          out.push({ text: r.text, st: st2 });
        }
      }
      return out;
    }
    case 'anyorder': {
      const d = n.delimiter ?? delim;
      const out: Path[] = [];
      for (const perm of permutations(n.items)) {
        let acc: { outs: string[]; st: State }[] = [{ outs: [], st }];
        for (const item of perm) {
          const next: { outs: string[]; st: State }[] = [];
          for (const a of acc) for (const r of enumNode(item, a.st, d)) next.push({ outs: [...a.outs, r.text], st: r.st });
          acc = next;
        }
        for (const a of acc) out.push({ text: joinAll(a.outs, a.outs.map(() => true), d), st: a.st });
      }
      return out;
    }
    case 'repeat':
      return n.expanded.flatMap((seq) => enumNode(seq, st, delim));
    case 'transform': {
      const out: Path[] = [];
      for (const r of enumNode(n.inner, st, delim)) for (const f of n.fns) out.push({ text: (FNS[f] as (s: string) => string)(r.text), st: r.st });
      return out;
    }
  }
}

function tagsOf(st: State): Output['tags'] {
  const out: Output['tags'] = {};
  for (const [k, v] of st) out[k] = v === '' ? true : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return out;
}

const key = (o: Output): string => JSON.stringify([o.text, Object.entries(o.tags).sort()]);

// --- random program generator ---------------------------------------------

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function generate(rand: () => number): string {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const words = ['a', 'b', 'cc', 'x y', 'Q', 'hi.'];
  const tags = ['t1', 't2'];
  const defNames: string[] = [];

  const text = (): string => pick(words);

  const group = (depth: number, allowTags: boolean): string => {
    const n = 1 + Math.floor(rand() * 3);
    const opts: string[] = [];
    for (let i = 0; i < n; i++) {
      let o = depth > 0 && rand() < 0.4 ? seq(depth - 1) : text();
      if (rand() < 0.1) o = '';
      // Ranges expand into one option per value, and printers must write them back as ranges.
      else if (rand() < 0.08) o = pick(['1..3', 'a..c', '7..9']);
      if (allowTags && rand() < 0.3) o = (o ? o + ' ' : '') + '@' + pick(tags);
      if (allowTags && rand() < 0.25 && i > 0) o = (rand() < 0.3 ? '@else: ' : '@' + (rand() < 0.3 ? '!' : '') + pick(tags) + ': ') + o;
      opts.push(o);
    }
    return '[' + opts.join('|') + ']';
  };

  const anyorder = (depth: number): string => {
    const n = 2 + Math.floor(rand() * 2);
    const items: string[] = [];
    for (let i = 0; i < n; i++) items.push(rand() < 0.3 ? group(Math.max(0, depth - 1), false) : text());
    const d = rand() < 0.3 ? `; delimiter="${pick(['', '+', ', '])}"` : '';
    return '[' + items.join(' & ') + d + ']';
  };

  const piece = (depth: number): string => {
    const r = rand();
    if (r < 0.35) return text();
    if (r < 0.65) return group(depth, true);
    if (r < 0.75) return anyorder(depth);
    if (r < 0.85 && defNames.length) return '$' + pick(defNames);
    if (r < 0.92) return group(depth, false) + ':' + pick(['upper', 'lower']);
    return group(depth, false) + pick(['{2}', '{1..2}']);
  };

  const seq = (depth: number): string => {
    const n = 1 + Math.floor(rand() * 3);
    let out = '';
    for (let i = 0; i < n; i++) {
      const p = piece(depth);
      if (i === 0) out = p;
      else {
        // Text pieces must be separated by a space or they would merge into one text run.
        const bothText = !out.endsWith(']') && !/[A-Za-z0-9_}]$/.test(out) ? false : true;
        out += (rand() < 0.75 || (bothText && !p.startsWith('[') && !p.startsWith('$')) ? ' ' : '') + p;
      }
    }
    return out;
  };

  const lines: string[] = [];
  const nd = Math.floor(rand() * 3);
  for (let i = 0; i < nd; i++) {
    const name = 'd' + i;
    lines.push(`${name} = ${seq(1)}`);
    defNames.push(name);
  }
  const delim = rand() < 0.2 ? `delimiter = "${pick(['-', ', '])}"\n` : '';
  lines.push(`main = ${seq(2)}`);
  return delim + lines.join('\n');
}

describe('engine versus an independent enumerator', () => {
  test('300 random programs agree on counts, texts, tags and indexing', () => {
    const rand = lcg(Number(process.env.FUZZ_SEED ?? 2026));
    let checked = 0;
    let withTags = 0;
    for (let i = 0; i < 300; i++) {
      const src = generate(rand);
      let prog;
      try {
        prog = compile(src);
      } catch (e) {
        // The generator can produce programs the parser rightly rejects; those must say why.
        expect((e as Error).message).toMatch(/line \d+, column \d+|No entry|Unknown|refer to/);
        continue;
      }
      const count = prog.count;
      if (count > 3000n) continue;
      const expected = enumNode(prog.entry.body, new Map(), prog.delimiter).map((p) => ({ text: p.text, tags: tagsOf(p.st) }));
      expect(BigInt(expected.length)).toBe(count);
      const got = Array.from({ length: Number(count) }, (_v, k) => prog.at(BigInt(k)));
      expect(got.map(key).sort()).toEqual(expected.map(key).sort());
      expect([...prog.all()].map(key).sort()).toEqual(expected.map(key).sort());
      // Tracing walks the same path: same text and tags, and every pick names a real option.
      for (let k = 0n; k < count && k < 40n; k++) {
        const tr = prog.trace(k);
        expect(key(tr)).toBe(key(prog.at(k)));
        for (const pk of tr.picks) expect(pk.option >= 0 && pk.option < pk.group.options.length).toBe(true);
      }
      // The steady sampler only ever gives real results, with distinct texts.
      const valid = new Set(expected.map(key));
      const steady = prog.sampleSteady(5, i);
      for (const o of steady) expect(valid.has(key(o))).toBe(true);
      expect(new Set(steady.map((o) => o.text)).size).toBe(steady.length);
      if (src.includes('@')) withTags++;
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
    expect(withTags).toBeGreaterThan(20);
  });
});

describe('formatter versus random programs', () => {
  test('long, short and auto conversions never change what a program means', () => {
    const rand = lcg(Number(process.env.FUZZ_SEED ?? 77) + 1);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const src = generate(rand);
      let prog;
      try {
        prog = compile(src);
      } catch {
        continue;
      }
      if (prog.count > 3000n) continue;
      const base = [...prog.all()].map(key).sort();
      for (const mode of ['long', 'short', 'auto'] as const) {
        const { output, skipped } = formatSource(src, mode);
        expect(skipped).toEqual([]);
        const again = compile(output);
        expect(again.count).toBe(prog.count);
        expect([...again.all()].map(key).sort()).toEqual(base);
        // Through the other form and back.
        const back = formatSource(formatSource(output, mode === 'long' ? 'short' : 'long').output, 'short').output;
        expect([...compile(back).all()].map(key).sort()).toEqual(base);
        // Idempotent.
        expect(formatSource(output, mode).output).toBe(output);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
});
