#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { compile, formatSource, FormatMode, LoadedSource, PermError, TransformFn } from './index';

const USAGE = `Usage: perm <file | program> [options]
       perm fmt --short|--long|--auto <file> [-w]

  (no option)          one random result
  -n N                 N distinct random results
  --all [--limit N]    every result
  --count              how many permutations there are
  --json               print results as JSON (text plus tags)
  --entry NAME         start from NAME instead of main
  --delimiter STR      global delimiter (default: a single space)
  --set key=value      host value, available as $key (repeatable)
  --fn FILE            JS module exporting custom transforms
  -h, --help           show this help

If the first argument is not an existing file, it is treated as a program.

fmt rewrites each definition in short form, long form, or whichever fits (--auto).
It prints the result, or overwrites the file with -w. Comments, settings, imports and
definitions that contain a comment are left alone.
`;

interface Args {
  target?: string;
  n?: number;
  all: boolean;
  limit?: number;
  count: boolean;
  json: boolean;
  entry?: string;
  delimiter?: string;
  values: Record<string, string>;
  fnFiles: string[];
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { all: false, count: false, json: false, values: {}, fnFiles: [], help: false };
  const need = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case '-h':
      case '--help':
        a.help = true;
        break;
      case '-n':
        a.n = parseInt(need(++i, '-n'), 10);
        if (!Number.isInteger(a.n) || a.n < 1) throw new Error('-n needs a positive integer');
        break;
      case '--all':
        a.all = true;
        break;
      case '--limit':
        a.limit = parseInt(need(++i, '--limit'), 10);
        if (!Number.isInteger(a.limit) || a.limit < 1) throw new Error('--limit needs a positive integer');
        break;
      case '--count':
        a.count = true;
        break;
      case '--json':
        a.json = true;
        break;
      case '--entry':
        a.entry = need(++i, '--entry');
        break;
      case '--delimiter':
        a.delimiter = need(++i, '--delimiter');
        break;
      case '--set': {
        const kv = need(++i, '--set');
        const eq = kv.indexOf('=');
        if (eq < 1) throw new Error('--set needs key=value');
        a.values[kv.slice(0, eq)] = kv.slice(eq + 1);
        break;
      }
      case '--fn':
        a.fnFiles.push(need(++i, '--fn'));
        break;
      default:
        if (arg.startsWith('-') && arg.length > 1 && !a.target) throw new Error(`Unknown option ${arg}`);
        if (a.target !== undefined) throw new Error(`Unexpected argument: ${arg}`);
        a.target = arg;
    }
  }
  return a;
}

function loader(spec: string, fromPath: string): LoadedSource | undefined {
  const base = fromPath.startsWith('<') ? process.cwd() : path.dirname(fromPath);
  const candidates = [path.resolve(base, spec), path.resolve(base, spec + '.perm')];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return { path: p, source: fs.readFileSync(p, 'utf-8') };
  }
  return undefined;
}

function fmt(argv: string[]): void {
  let mode: FormatMode | undefined;
  let write = false;
  let file: string | undefined;
  for (const a of argv) {
    if (a === '--short' || a === '--long' || a === '--auto') mode = a.slice(2) as FormatMode;
    else if (a === '-w' || a === '--write') write = true;
    else if (a.startsWith('-')) {
      console.error(`Unknown option ${a}`);
      process.exit(2);
    } else file = a;
  }
  if (!mode || !file) {
    console.error('Usage: perm fmt --short|--long|--auto <file> [-w]');
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }
  try {
    const { output, changed, skipped } = formatSource(fs.readFileSync(file, 'utf-8'), mode);
    for (const s of skipped) console.error(`skipped ${s.name}: ${s.reason}`);
    if (write) {
      fs.writeFileSync(file, output);
      console.error(changed.length ? `rewrote ${changed.join(', ')}` : 'nothing to change');
    } else process.stdout.write(output);
  } catch (e) {
    if (e instanceof PermError) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

function main(): void {
  if (process.argv[2] === 'fmt') return fmt(process.argv.slice(3));
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    console.error(USAGE);
    process.exit(2);
  }
  if (args.help || args.target === undefined) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 2);
  }

  const isFile = fs.existsSync(args.target) && fs.statSync(args.target).isFile();
  const source = isFile ? fs.readFileSync(args.target, 'utf-8') : args.target;
  const progPath = isFile ? path.resolve(args.target) : '<program>';

  const fns: Record<string, TransformFn> = {};
  for (const f of args.fnFiles) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Object.assign(fns, require(path.resolve(f)));
  }

  try {
    const prog = compile(source, {
      path: progPath,
      load: loader,
      values: args.values,
      fns,
      ...(args.entry !== undefined ? { entry: args.entry } : {}),
      ...(args.delimiter !== undefined ? { delimiter: args.delimiter } : {}),
    });

    if (args.count) {
      console.log(prog.count.toString());
      return;
    }

    const results = args.all
      ? prog.all(args.limit !== undefined ? { limit: args.limit } : {})
      : args.n !== undefined
        ? prog.sample(args.n)
        : [prog.one()];

    if (args.json) {
      console.log(JSON.stringify([...results], null, 2));
    } else {
      for (const r of results) console.log(r.text);
    }
  } catch (e) {
    if (e instanceof PermError) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

main();
