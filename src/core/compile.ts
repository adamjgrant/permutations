import { MAX_TAGGED_ANYORDER, Program } from './engine';
import { findWarnings } from './warnings';
import { fail, ImportRequest, lineCol, parseModule } from './parser';
import { builtinTransforms, TransformFn } from './transforms';
import { Def, Module, Node, PermError, RefNode } from './types';

export interface LoadedSource {
  /** Canonical path, used to detect circular imports and resolve nested imports. */
  path: string;
  source: string;
}

export interface CompileOptions {
  /** Path of the program being compiled, for error messages and relative imports. */
  path?: string;
  /** Resolve an import. Return undefined if it cannot be found. */
  load?: (spec: string, fromPath: string) => LoadedSource | undefined;
  /** Overrides the file's `delimiter` setting. */
  delimiter?: string;
  /** Host values, available as `$name`. */
  values?: Record<string, string>;
  /** Custom transforms, in addition to the built-ins. */
  fns?: Record<string, TransformFn>;
  /** Entry definition, `main` by default. */
  entry?: string;
  /** Random source, for tests. */
  rng?: () => number;
}

/** Visit a node and everything below it. */
export function visit(node: Node, fn: (n: Node) => void): void {
  fn(node);
  switch (node.kind) {
    case 'seq':
      for (const p of node.pieces) visit(p.node, fn);
      break;
    case 'group':
      for (const o of node.options) visit(o.seq, fn);
      break;
    case 'anyorder':
      for (const it of node.items) visit(it, fn);
      break;
    case 'repeat':
      visit(node.inner, fn);
      break;
    case 'transform':
      visit(node.inner, fn);
      break;
    default:
      break;
  }
}

export function compile(source: string, opts: CompileOptions = {}): Program {
  const rootPath = opts.path ?? '<program>';
  const cache = new Map<string, Module>();
  const all: Module[] = [];

  const load = (src: string, path: string, stack: string[]): Module => {
    const { module, imports } = parseModule(src, path);
    all.push(module);
    cache.set(path, module);
    for (const imp of imports) resolveImport(module, imp, [...stack, path]);
    return module;
  };

  const resolveImport = (module: Module, imp: ImportRequest, stack: string[]): void => {
    const loaded = opts.load?.(imp.spec, module.path);
    if (!loaded) fail(module.source, `Cannot find module '${imp.spec}'`, imp.offset);
    if (stack.includes(loaded.path)) {
      fail(module.source, `Circular import: ${[...stack, loaded.path].join(' -> ')}`, imp.offset);
    }
    const target = cache.get(loaded.path) ?? load(loaded.source, loaded.path, stack);
    if (imp.names) {
      for (const name of imp.names) {
        if (!target.defs.has(name)) fail(module.source, `'${name}' is not defined in '${imp.spec}'`, imp.offset);
        module.named.set(name, { module: target, name });
      }
    } else {
      const alias = (imp.spec.split('/').pop() as string).replace(/\.perm$/, '');
      module.namespaces.set(alias, target);
    }
  };

  const root = load(source, rootPath, []);
  const fns: Record<string, TransformFn> = { ...builtinTransforms, ...(opts.fns ?? {}) };

  // Link references and check transform names.
  const usedValues = new Set<string>();
  for (const module of all) {
    const bodies: Def[] = [...module.defs.values()];
    if (module.anonymous) bodies.push(module.anonymous);
    for (const def of bodies) {
      visit(def.body, (n) => {
        if (n.kind === 'ref') {
          linkRef(module, n, opts.values ?? {}, module === root);
          if (n.target?.kind === 'value') usedValues.add(n.path);
        }
        if (n.kind === 'transform') {
          for (const f of n.fns) {
            if (!fns[f]) {
              const { line, col } = lineCol(module.source, n.range[0]);
              throw new PermError(
                `Unknown transform '${f}' (line ${line}, column ${col}). Transforms: ${Object.keys(fns).join(', ')}. To write a colon as text, use \\:`,
                n.range[0],
                line,
                col,
              );
            }
          }
        }
      });
    }
  }

  checkCycles(all);

  // With a main, an unnamed line is never used: almost always a slip (a missing `name =`, or a
  // line meant to continue main). Say so instead of dropping it silently.
  if (root.anonymous && root.defs.has('main')) {
    const { line, col } = lineCol(root.source, root.anonymous.range[0]);
    throw new PermError(
      `Line ${line} is not part of any branch, so it is never used. Put a name and = in front of it, or move it into main (line ${line}, column ${col})`,
      root.anonymous.range[0],
      line,
      col,
    );
  }

  const entryName = opts.entry ?? 'main';
  const entry = root.defs.get(entryName) ?? (opts.entry === undefined ? root.anonymous : undefined);
  if (!entry) {
    const names = [...root.defs.keys()];
    const list = names.length ? ` Its branches: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', ...' : ''}.` : '';
    throw new PermError(
      opts.entry === undefined
        ? `No entry point: define main, or write a single unnamed expression, or start from another branch with --entry NAME.${list}`
        : `Entry point '${opts.entry}' is not defined.${list}`,
    );
  }

  const program = new Program(entry, all, {
    delimiter: opts.delimiter ?? root.delimiter ?? ' ',
    fns: opts.fns ?? {},
    rng: opts.rng,
  });
  // With tags, an any-order group's orderings are listed one by one, so they are capped. Say so here,
  // with a position, rather than when the counts are first needed.
  if (all.some((m) => m.hasTags)) {
    for (const module of all) {
      const bodies: Def[] = [...module.defs.values()];
      if (module.anonymous) bodies.push(module.anonymous);
      for (const def of bodies) {
        visit(def.body, (n) => {
          if (n.kind === 'anyorder' && n.items.length > MAX_TAGGED_ANYORDER) {
            fail(module.source, `This any-order group has ${n.items.length} items, but in a program that uses tags an any-order group can have at most ${MAX_TAGGED_ANYORDER}. Split it into smaller groups`, n.range[0]);
          }
        });
      }
    }
  }
  // With tags, which guards can hold depends on what came before, so the walk's own reach is used.
  let reach: Map<number, string[]> | undefined;
  if (all.some((m) => m.hasTags)) {
    try {
      reach = program.reachStates();
    } catch {
      reach = undefined;
    }
  }
  program.warnings = findWarnings(all, root, reach);
  for (const key of Object.keys(opts.values ?? {})) {
    if (!usedValues.has(key)) program.warnings.push({ message: `The host value ${key} is not used: nothing in the program refers to $${key}`, offset: -1, line: 0, col: 0 });
  }
  return program;
}

function linkRef(module: Module, ref: RefNode, values: Record<string, string>, isRoot: boolean): void {
  const path = ref.path;
  const hasValue = Object.prototype.hasOwnProperty.call(values, path);
  // In the file you run, a host value replaces a branch of the same name: the branch is the default.
  if (hasValue && isRoot) {
    ref.target = { kind: 'value', value: values[path] as string };
    return;
  }
  const own = module.defs.get(path);
  if (own) {
    ref.target = { kind: 'def', def: own };
    return;
  }
  // A branch from another file keeps that file's delimiter setting, if it has one.
  const named = module.named.get(path);
  if (named) {
    ref.target = { kind: 'def', def: named.module.defs.get(named.name) as Def };
    ref.delimiter = named.module.delimiter;
    return;
  }
  const dot = path.indexOf('.');
  if (dot !== -1) {
    const ns = module.namespaces.get(path.slice(0, dot));
    const def = ns?.defs.get(path.slice(dot + 1));
    if (def) {
      ref.target = { kind: 'def', def };
      ref.delimiter = ns?.delimiter;
      return;
    }
  }
  if (hasValue) {
    ref.target = { kind: 'value', value: values[path] as string };
    return;
  }
  const { line, col } = lineCol(module.source, ref.range[0]);
  const where = `Unknown reference $${path} (line ${line}, column ${col}).`;
  const names = [...module.defs.keys(), ...module.named.keys()];
  // A namespace on its own: list its members.
  const members = names.filter((n) => n.startsWith(path + '.'));
  if (members.length) throw new PermError(`${where} ${path} is a group of branches, so pick one: ${members.map((m) => '$' + m).slice(0, 6).join(', ')}`, ref.range[0], line, col);
  // Letters run on after a real name: $names when there is a branch called name.
  const prefix = names.filter((n) => path.startsWith(n) && /^[A-Za-z0-9_]+$/.test(path.slice(n.length))).sort((a, b) => b.length - a.length)[0];
  if (prefix) throw new PermError(`${where} To put letters right after $${prefix}, use brackets: [$${prefix}]${path.slice(prefix.length)}`, ref.range[0], line, col);
  const near = names.find((n) => editDistance(n, path) <= 2);
  if (near) throw new PermError(`${where} Did you mean $${near}?`, ref.range[0], line, col);
  if (path.includes('.')) fail(module.source, `Unknown reference $${path}`, ref.range[0]);
  throw new PermError(
    `${where} If it is a host value, pass --set ${path}=... on the command line, or the 'values' option when compiling`,
    ref.range[0],
    line,
    col,
  );
}

function checkCycles(modules: Module[]): void {
  const state = new Map<Def, 'visiting' | 'done'>();
  const stack: Def[] = [];

  const dfs = (def: Def): void => {
    const s = state.get(def);
    if (s === 'done') return;
    if (s === 'visiting') {
      const chain = [...stack.slice(stack.indexOf(def)), def].map((d) => '$' + d.name).join(' -> ');
      fail(def.module.source, `A branch cannot use itself, even through others: ${chain}`, def.range[0]);
    }
    state.set(def, 'visiting');
    stack.push(def);
    visit(def.body, (n) => {
      if (n.kind === 'ref' && n.target?.kind === 'def') dfs(n.target.def);
    });
    stack.pop();
    state.set(def, 'done');
  };

  for (const m of modules) {
    for (const def of m.defs.values()) dfs(def);
    if (m.anonymous) dfs(m.anonymous);
  }
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_v, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      (d[i] as number[])[j] = Math.min((d[i - 1] as number[])[j]! + 1, (d[i] as number[])[j - 1]! + 1, (d[i - 1] as number[])[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return (d[a.length] as number[])[b.length]!;
}
