// Warnings: code that parses but probably does not do what it looks like. They never stop a
// program; the CLI prints them and the web app shows them as hints.

import { eligibleOptions } from './engine';
import { lineCol } from './parser';
import { Def, GroupNode, Module, Node } from './types';

export interface Warning {
  message: string;
  /** -1, with line and col 0, when the warning is not about a place in the code (an unused host value). */
  offset: number;
  line: number;
  col: number;
  /** The file it is in, when it is not the program itself. */
  path?: string | undefined;
}

function each(node: Node, fn: (n: Node) => void): void {
  fn(node);
  switch (node.kind) {
    case 'seq':
      for (const p of node.pieces) each(p.node, fn);
      break;
    case 'group':
      for (const o of node.options) each(o.seq, fn);
      break;
    case 'anyorder':
      for (const it of node.items) each(it, fn);
      break;
    case 'repeat':
    case 'transform':
      each(node.inner, fn);
      break;
    default:
  }
}

const TEXT_TRAPS: { re: RegExp; message: (m: RegExpExecArray) => string }[] = [
  {
    re: /([\p{L}\p{N}]+)\{(\d+(?:\.\.\d+)?)(?:;[^}]*)?\}/u,
    message: (m) => `"${m[0]}" is printed as written: a repeat needs brackets or a reference before it, as in [${m[1]}]{${m[2]}}`,
  },
  {
    re: /(?:^|\s)(\{\d+(?:\.\.\d+)?(?:;[^}]*)?\})/,
    message: (m) => `"${m[1]}" is printed as written: a repeat goes right after the piece it repeats, with no space, as in [word]${m[1]}`,
  },
  {
    re: /([\p{L}\p{N}]+):(lower|upper|capitalize|title|trim)\b/u,
    message: (m) => `"${m[0]}" is printed as written: a transform needs brackets or a reference before it, as in [${m[1]}]:${m[2]}`,
  },
  {
    re: /(?<!\\)\$\{/,
    message: () => '"${" is printed as written: Permutations has no inline code. Use ranges, transforms, tags, or host values ($name with --set)',
  },
  {
    re: /(delimiter|last)\s*=\s*'/,
    message: (m) => `Settings need double quotes, as in ${m[1]}=", "`,
  },
  {
    re: /;\s*(delimiter|last)\s*=/,
    message: (m) => `This "; ${m[1]}=..." is printed as text: settings only work at the end of [ ... ] or { ... }`,
  },
];

const DEAD_END = 'When none of these guards holds, this choice has nothing to pick and the result is dropped. Add an @else: alternative (otherwise, in long form)';

/**
 * `states` are the tag states the walk reaches this choice in, when it reaches it at all (from
 * the entry point). With them the guard warnings are exact; without them (a branch nothing uses)
 * they fall back to what the code says on its own.
 */
function groupWarnings(g: GroupNode, add: (message: string, offset: number) => void, states: string[] | undefined, ctx: { source: string; tested: ReadonlySet<string> }): void {
  const guards = g.options.map((o) => o.guard);
  const elseAt = guards.findIndex((x) => x?.kind === 'else');
  if (elseAt !== -1 && guards.slice(elseAt + 1).some((x) => x?.kind === 'tag')) {
    add('@else: (otherwise, in long form) only looks at the guards before it, so the ones after it still compete with it. Put it last', g.options[elseAt]?.range[0] ?? g.range[0]);
  }
  if (states) {
    const open = states.map((s) => eligibleOptions(g, s));
    if (open.some((o) => o.length === 0)) add(DEAD_END, g.range[0]);
    for (const o of g.options) {
      const guard = o.guard;
      if (guard?.kind !== 'tag' || open.some((list) => list.includes(o))) continue;
      const label = `@${guard.negate ? '!' : ''}${guard.name}${guard.value !== undefined ? '=' + guard.value : ''}:`;
      add(`The guard ${label} never holds when this choice is reached, so this alternative is never picked. A guard only sees tags set before it (to its left)`, o.range[0]);
    }
  } else if (g.options.length > 0 && g.options.every((o) => o.guard?.kind === 'tag')) {
    add(DEAD_END, g.range[0]);
  }
  // An @word in the middle of text, or on a whole branch, may be meant as text (an email
  // handle, say). When no guard tests it, say what it does.
  if (g.inline || (g.bare && g.options.length === 1)) {
    for (const o of g.options) {
      for (const t of o.tags) {
        if (!t.range || ctx.source[t.range[0]] !== '@' || ctx.tested.has(t.name)) continue;
        const name = `@${t.name}${t.value !== undefined && t.value !== '' ? '=' + t.value : ''}`;
        add(`"${name}" is a tag: it is not printed, and no guard tests it, so it only labels the result. To print it as text, write \\${name}`, t.range[0]);
      }
    }
  }
}

export function findWarnings(modules: Module[], root: Module, reach?: Map<number, string[]>): Warning[] {
  const out: Warning[] = [];
  // Every tag name some guard tests, anywhere.
  const tested = new Set<string>();
  for (const module of modules) {
    const all: Def[] = [...module.defs.values()];
    if (module.anonymous) all.push(module.anonymous);
    for (const def of all) {
      each(def.body, (n) => {
        if (n.kind === 'group') for (const o of n.options) if (o.guard?.kind === 'tag') tested.add(o.guard.name);
      });
    }
  }
  for (const module of modules) {
    const add = (message: string, offset: number): void => {
      const { line, col } = lineCol(module.source, offset);
      out.push({ message, offset, line, col, ...(module === root ? {} : { path: module.path }) });
    };
    const defs: Def[] = [...module.defs.values()];
    if (module.anonymous) defs.push(module.anonymous);
    for (const def of defs) {
      each(def.body, (n) => {
        if (n.kind === 'text') {
          // Look at the text as written, so an escape such as \{ means the writer meant it. A
          // quoted long-form line is literal on purpose.
          const raw = module.source.slice(n.range[0], n.range[1]);
          if (raw.trimStart().startsWith('"')) return;
          // Every trap, every time it occurs, at the place it occurs.
          for (const trap of TEXT_TRAPS) {
            const re = new RegExp(trap.re.source, trap.re.flags.includes('g') ? trap.re.flags : trap.re.flags + 'g');
            for (const m of raw.matchAll(re)) add(trap.message(m), n.range[0] + (m.index ?? 0));
          }
        } else if (n.kind === 'group') groupWarnings(n, add, reach?.get(n.id), { source: module.source, tested });
        else if (n.kind === 'anyorder' && n.items.length > 7) {
          let f = 1n;
          for (let k = 2n; k <= BigInt(n.items.length); k++) f *= k;
          add(`This any-order group has ${n.items.length} items, so it gives ${f.toLocaleString('en-US')} orderings. Is every ordering wanted?`, n.range[0]);
        }
      });
    }
  }
  const seen = new Set<string>();
  return out
    .filter((w) => {
      const k = `${w.path ?? ''}:${w.offset}:${w.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.offset - b.offset);
}
