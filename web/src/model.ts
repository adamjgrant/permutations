// Compile the source for the browser and collect every definition the chart needs.

import { compile, PermError, Program, visit } from '../../src/index';
import type { LDef } from './layout';

export interface Analysis {
  source: string;
  program: Program;
  main: LDef;
  others: LDef[];
  /** Names of every tag that some option sets. */
  knownTags: Set<string>;
  /** The delimiter the program joins with by default. */
  delimiter: string;
}

export function analyze(source: string): Analysis {
  // Imports cannot work in the browser.
  const program = compile(source, { load: () => undefined });
  const entry = program.entry;
  // `entry.module` is the root module, so its `defs` hold every named definition.
  const others: LDef[] = [];
  for (const def of entry.module.defs.values()) {
    if (def === entry) continue;
    others.push({ name: def.name, body: def.body, range: def.range, form: def.form });
  }
  const main: LDef = { name: entry.name, body: entry.body, range: entry.range, form: entry.form };
  const knownTags = new Set<string>();
  for (const d of [main, ...others]) {
    visit(d.body, (n) => {
      if (n.kind === 'group') for (const o of n.options) for (const t of o.tags) knownTags.add(t.name);
    });
  }
  return { source, program, main, others, knownTags, delimiter: program.delimiter };
}

export function describeError(e: unknown): { message: string; offset?: number } {
  if (e instanceof PermError) {
    return e.offset === undefined ? { message: e.message } : { message: e.message, offset: e.offset };
  }
  if (e instanceof Error) return { message: `${e.name}: ${e.message}` };
  return { message: String(e) };
}

export function formatCount(n: bigint): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function tagLabel(name: string, value: string | number | true): string {
  return value === true ? name : `${name}=${value}`;
}

// --- sharing ---------------------------------------------------------------

export function encodeShare(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(s: string): string | undefined {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

export const DEFAULT_PROGRAM = `main = [Hello|Oh, Hi] $greeting
greeting = [How [are you|'s [it|everything]]|What [is new|is going on]]
`;
