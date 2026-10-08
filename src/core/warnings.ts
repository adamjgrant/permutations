// Warnings: code that parses but probably does not do what it looks like. They never stop a
// program; the CLI prints them and the web app shows them as hints.

import { lineCol } from './parser';
import { Def, GroupNode, Module, Node } from './types';

export interface Warning {
  message: string;
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
    re: /([\p{L}\p{N}]+):(lower|upper|capitalize|title|trim)\b/u,
    message: (m) => `"${m[0]}" is printed as written: a transform needs brackets or a reference before it, as in [${m[1]}]:${m[2]}`,
  },
  {
    re: /\$\{/,
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

function groupWarnings(g: GroupNode, add: (message: string, offset: number) => void): void {
  const guards = g.options.map((o) => o.guard);
  const elseAt = guards.findIndex((x) => x?.kind === 'else');
  if (elseAt !== -1 && guards.slice(elseAt + 1).some((x) => x?.kind === 'tag')) {
    add('@else: (otherwise, in long form) only looks at the guards before it, so the ones after it still compete with it. Put it last', g.options[elseAt]?.range[0] ?? g.range[0]);
  }
  if (g.options.length > 0 && g.options.every((o) => o.guard?.kind === 'tag')) {
    add('When none of these guards holds, this choice has nothing to pick and the result is dropped. Add an @else: alternative (otherwise, in long form)', g.range[0]);
  }
  for (const o of g.options) {
    for (const t of o.tags) {
      if (!t.range) continue;
      const after = o.seq.pieces.some((p) => p.node.range[0] >= (t.range as [number, number])[1] && !(p.node.kind === 'text' && p.node.value === ''));
      // A tag in the middle of text (or on a whole branch with no choice) is easy to mistake for text.
      if (after || (g.bare && g.options.length === 1)) {
        const name = `@${t.name}${t.value !== undefined && t.value !== '' ? '=' + t.value : ''}`;
        add(`"${name}" is a tag, not text, so it is left out of the result. To print it, write \\${name}`, t.range[0]);
      }
    }
  }
}

export function findWarnings(modules: Module[], root: Module): Warning[] {
  const out: Warning[] = [];
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
          for (const trap of TEXT_TRAPS) {
            const m = trap.re.exec(n.value);
            if (m) {
              add(trap.message(m), n.range[0]);
              break;
            }
          }
        } else if (n.kind === 'group') groupWarnings(n, add);
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
