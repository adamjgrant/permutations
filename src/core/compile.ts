import { Program } from './engine';
import { fail, ImportRequest, parseModule } from './parser';
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
  for (const module of all) {
    const bodies: Def[] = [...module.defs.values()];
    if (module.anonymous) bodies.push(module.anonymous);
    for (const def of bodies) {
      visit(def.body, (n) => {
        if (n.kind === 'ref') linkRef(module, n, opts.values ?? {});
        if (n.kind === 'transform') {
          for (const f of n.fns) {
            if (!fns[f]) fail(module.source, `Unknown transform '${f}'`, n.range[0]);
          }
        }
      });
    }
  }

  checkCycles(all);

  const entryName = opts.entry ?? 'main';
  const entry = root.defs.get(entryName) ?? (opts.entry === undefined ? root.anonymous : undefined);
  if (!entry) {
    throw new PermError(
      opts.entry === undefined
        ? "No entry point: define 'main' or write a single unnamed expression"
        : `Entry point '${opts.entry}' is not defined`,
    );
  }

  return new Program(entry, all, {
    delimiter: opts.delimiter ?? root.delimiter ?? ' ',
    fns: opts.fns ?? {},
    rng: opts.rng,
  });
}

function linkRef(module: Module, ref: RefNode, values: Record<string, string>): void {
  const path = ref.path;
  const own = module.defs.get(path);
  if (own) {
    ref.target = { kind: 'def', def: own };
    return;
  }
  const named = module.named.get(path);
  if (named) {
    ref.target = { kind: 'def', def: named.module.defs.get(named.name) as Def };
    return;
  }
  const dot = path.indexOf('.');
  if (dot !== -1) {
    const ns = module.namespaces.get(path.slice(0, dot));
    const def = ns?.defs.get(path.slice(dot + 1));
    if (def) {
      ref.target = { kind: 'def', def };
      return;
    }
  }
  if (Object.prototype.hasOwnProperty.call(values, path)) {
    ref.target = { kind: 'value', value: values[path] as string };
    return;
  }
  fail(module.source, `Unknown reference $${path}`, ref.range[0]);
}

function checkCycles(modules: Module[]): void {
  const state = new Map<Def, 'visiting' | 'done'>();
  const stack: Def[] = [];

  const dfs = (def: Def): void => {
    const s = state.get(def);
    if (s === 'done') return;
    if (s === 'visiting') {
      const chain = [...stack.slice(stack.indexOf(def)), def].map((d) => '$' + d.name).join(' -> ');
      fail(def.module.source, `Definitions refer to themselves: ${chain}`, def.range[0]);
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
