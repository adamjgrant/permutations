// Edits that work on whole definitions: rename, create, delete, extract to a new branch,
// retarget a reference, and Expand / Collapse through the core formatter.
// All pure: they take the source text and return patches (or an error message to show).

import { formatSource } from '../../src/index';
import type { FormatMode } from '../../src/index';
import { visit } from '../../src/core/compile';
import { isReservedLine } from '../../src/core/longform';
import { parseModule } from '../../src/core/parser';
import type { Def, Node, RefNode } from '../../src/core/types';
import {
  alternatives,
  ChoiceNode,
  choiceForm,
  diffPatch,
  EditResult,
  formAt,
  isStructurallyEditable,
  isRangeText,
  longLine,
  Patch,
  removeAlternatives,
} from './patch';
import { indentOf, indentUnit, isAtLineEnd, isAtLineStart, lineEnd, lineStart, Range, trimRange } from './ranges';

export type Failure = { error: string };
export type EditOrError = EditResult | Failure;
export const failed = (r: EditOrError | undefined): r is Failure => r !== undefined && 'error' in r;

const NAME = '[A-Za-z_]\\w*';
const NAME_RE = new RegExp(`^${NAME}(?:\\.${NAME})*$`);
/** Words the file format already gives meaning to at the start of a line. */
export const RESERVED_NAMES: readonly string[] = ['delimiter', 'use', 'from', 'branch'];

interface Parsed {
  defs: Def[];
  anonymous: Def | undefined;
}

function parse(src: string): Parsed {
  const { module } = parseModule(src, '<defs>');
  return { defs: [...module.defs.values()].sort((a, b) => a.range[0] - b.range[0]), anonymous: module.anonymous };
}

/** Why `name` cannot be used for a definition, or undefined when it can. `ignore` is the name being renamed. */
export function nameProblem(src: string, name: string, ignore?: string): string | undefined {
  if (!NAME_RE.test(name)) {
    return `"${name}" is not a valid name. A name starts with a letter or underscore and uses letters, digits and underscores (a dot separates a namespace).`;
  }
  if (RESERVED_NAMES.includes(name.split('.')[0] as string)) {
    return `"${name}" is reserved: ${name.split('.')[0]} already has a meaning at the start of a line. Pick another name.`;
  }
  const { defs } = parse(src);
  if (name !== ignore && defs.some((d) => d.name === name)) return `A branch named "${name}" already exists.`;
  return undefined;
}

/** A name nobody uses yet: `base`, `base2`, `base3`... */
export function uniqueName(src: string, base = 'branch'): string {
  const taken = new Set(parse(src).defs.map((d) => d.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(base + i)) return base + i;
}

// --- references --------------------------------------------------------------

export interface RefHit {
  /** Name of the definition the reference sits in (`main` for an unnamed program). */
  from: string;
  node: RefNode;
}

/** How a reference path relates to a definition name: it is the name, or a dotted path starting with it. */
function refKind(path: string, name: string, known: Set<string>): 'exact' | 'prefix' | undefined {
  if (path === name) return 'exact';
  if (path.startsWith(name + '.') && !known.has(path)) return 'prefix';
  return undefined;
}

export function referencesTo(src: string, name: string): RefHit[] {
  const { defs, anonymous } = parse(src);
  const known = new Set(defs.map((d) => d.name));
  const out: RefHit[] = [];
  const bodies: [string, Node][] = defs.map((d) => [d.name, d.body]);
  if (anonymous) bodies.push(['main', anonymous.body]);
  for (const [from, body] of bodies) {
    const seen = new Set<number>();
    visit(body, (n) => {
      if (n.kind !== 'ref' || seen.has(n.range[0])) return;
      seen.add(n.range[0]);
      if (refKind(n.path, name, known)) out.push({ from, node: n });
    });
  }
  return out;
}

/** Offset where the name starts inside a reference (`$name` or `ref name`). */
function refPathStart(src: string, node: RefNode): number {
  if (src[node.range[0]] === '$') return node.range[0] + 1;
  const m = /^ref[ \t]+/.exec(src.slice(node.range[0], node.range[1]));
  return node.range[0] + (m ? m[0].length : 0);
}

function defNameRange(src: string, def: Def): Range | undefined {
  const head = src.slice(def.range[0], lineEnd(src, def.range[0]));
  const m = def.form === 'long' ? /^([ \t]*branch[ \t]+)(\S+)/.exec(head) : /^([ \t]*)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/.exec(head);
  if (!m) return undefined;
  const s = def.range[0] + (m[1] as string).length;
  return [s, s + (m[2] as string).length];
}

// --- rename --------------------------------------------------------------------

export function renameDefinition(src: string, oldName: string, newName: string): EditOrError {
  const { defs } = parse(src);
  const def = defs.find((d) => d.name === oldName);
  if (!def) return { error: `There is no branch named "${oldName}".` };
  if (newName === oldName) return { patches: [] };
  if (oldName === 'main') return { error: '"main" is the entry point, so it keeps its name.' };
  const problem = nameProblem(src, newName, oldName);
  if (problem) return { error: problem };
  const nameRange = defNameRange(src, def);
  if (!nameRange) return { error: `Could not find where "${oldName}" is defined.` };
  const patches: Patch[] = [{ from: nameRange[0], to: nameRange[1], insert: newName }];
  for (const hit of referencesTo(src, oldName)) {
    const s = refPathStart(src, hit.node);
    patches.push({ from: s, to: s + oldName.length, insert: newName });
  }
  return { patches, select: [nameRange[0], nameRange[0] + newName.length] };
}

// --- appending definitions -----------------------------------------------------------

/** Patches that add `text` (one definition) at the end of the file, merged with `others` when they touch the end. */
function appendDefinition(src: string, text: string, long: boolean, others: Patch[] = []): { patches: Patch[]; select: Range } {
  const endsWithNewline = src.endsWith('\n');
  const needsBlank = long || /\n[ \t]+\S[^\n]*\n?$/.test(src);
  const lead = (src === '' ? '' : endsWithNewline ? '' : '\n') + (needsBlank && src !== '' && !/\n\n$/.test(src) ? '\n' : '');
  const insert = lead + text + '\n';
  const at = src.length;
  const delta = others.reduce((n, p) => n + p.insert.length - (p.to - p.from), 0);
  const select: Range = [at + delta + lead.length, at + delta + lead.length + text.length];
  const touching = others.find((p) => p.to === at);
  if (touching) return { patches: others.map((p) => (p === touching ? { ...p, insert: p.insert + insert } : p)), select };
  return { patches: [...others, { from: at, to: at, insert }], select };
}

/** The form new definitions should use: whatever the last definition in the file uses. */
export function surroundingForm(src: string, offset?: number): 'short' | 'long' {
  if (offset !== undefined) return formAt(src, offset);
  const { defs } = parse(src);
  return defs.length ? (defs[defs.length - 1] as Def).form : 'short';
}

function newDefText(name: string, body: string[], long: boolean, step: string): string {
  if (long) return `branch ${name}\n` + body.map((l) => (l.trim() === '' ? l : step + l)).join('\n');
  return `${name} = ${body.join('\n')}`;
}

export function createDefinition(src: string, name: string, form?: 'short' | 'long', text = 'text'): EditOrError {
  const problem = nameProblem(src, name);
  if (problem) return { error: problem };
  const long = (form ?? surroundingForm(src)) === 'long';
  const body = long ? longLine(text) : text;
  const def = newDefText(name, [body], long, indentUnit(src));
  return appendDefinition(src, def, long);
}

// --- delete --------------------------------------------------------------------------

export function deleteDefinition(src: string, name: string): EditOrError {
  const { defs } = parse(src);
  const def = defs.find((d) => d.name === name);
  if (!def) return { error: `There is no branch named "${name}".` };
  if (name === 'main') return { error: '"main" is the entry point and cannot be deleted.' };
  const refs = referencesTo(src, name);
  if (refs.length) {
    const who = [...new Set(refs.map((r) => r.from))];
    return { error: `Cannot delete "${name}" because ${who.join(', ')} ${who.length === 1 ? 'refers' : 'refer'} to it. Change those references first.` };
  }
  let from = lineStart(src, def.range[0]);
  let to = lineEnd(src, def.range[1]);
  if (to < src.length) to++;
  // Swallow blank lines that followed it, or the ones before it when it was last.
  while (to < src.length && src.slice(to, lineEnd(src, to)).trim() === '') to = Math.min(src.length, lineEnd(src, to) + 1);
  if (to >= src.length) {
    while (from > 1 && src.slice(lineStart(src, from - 1), from - 1).trim() === '' && src[from - 1] === '\n' && src[from - 2] === '\n') from--;
  }
  return { patches: [{ from, to, insert: '' }] };
}

// --- retarget ------------------------------------------------------------------------

export function retargetReference(src: string, node: RefNode, newName: string): EditOrError {
  const name = newName.trim().replace(/^\$/, '');
  if (!NAME_RE.test(name)) return { error: `"${name}" is not a valid name.` };
  const { defs } = parse(src);
  if (!defs.some((d) => d.name === name)) return { error: `There is no branch named "${name}". Create it first, or pick one of: ${defs.map((d) => d.name).join(', ') || '(none)'}.` };
  const s = refPathStart(src, node);
  return { patches: [{ from: s, to: node.range[1], insert: name }], select: [s, s + name.length] };
}

// --- extract to branch ---------------------------------------------------------------

export type ExtractSelection = { kind: 'alts'; node: ChoiceNode; indices: number[] } | { kind: 'node'; node: Node };

/** Dedent a block of lines by `base` and re-indent it by `step`, as body lines of a new branch. */
function dedentLines(block: string, base: string): string[] {
  return block.split('\n').map((l) => (l.startsWith(base) ? l.slice(base.length) : l.trimStart()));
}

export function extractToBranch(src: string, sel: ExtractSelection, newName: string): EditOrError {
  const problem = nameProblem(src, newName);
  if (problem) return { error: problem };
  const step = indentUnit(src);

  if (sel.kind === 'alts') {
    const node = sel.node;
    if (node.kind !== 'group') return { error: 'Items of an any-order group are not alternatives. Select the whole group instead.' };
    if (!isStructurallyEditable(node, src)) return { error: 'This choice cannot be edited from the chart.' };
    const alts = alternatives(node);
    const idx = [...new Set(sel.indices)].filter((i) => i >= 0 && i < alts.length).sort((a, b) => a - b);
    if (idx.length === 0) return { error: 'Select one or more alternatives first.' };
    if (idx.length === alts.length) return extractToBranch(src, { kind: 'node', node }, newName);
    const form = choiceForm(src, node);
    const slot = idx[0] as number;
    const rest = idx.slice(1);
    const long = form === 'long';
    const replacement = long ? `ref ${newName}` : `$${newName}`;
    let body: string[];
    const slotAlt = alts[slot] as { range: Range; option?: { guard?: unknown } | undefined };
    if (long) {
      const base = indentOf(src, slotAlt.range[0]);
      const blocks = idx.map((i) => dedentLines(src.slice(lineStart(src, (alts[i] as { range: Range }).range[0]), (alts[i] as { range: Range }).range[1]), base));
      const guarded = idx.some((i) => (alts[i] as { option?: { guard?: unknown } }).option?.guard);
      if (idx.length === 1 && !guarded) body = blocks[0] as string[];
      else body = ['one of', ...blocks.flat().map((l) => step + l)];
    } else {
      const texts = idx.map((i) => {
        const r = trimRange(src, (alts[i] as { range: Range }).range);
        const t = src.slice(r[0], r[1]);
        // `0..9` only expands inside brackets, so keep it in a group when it moves into a definition.
        return isRangeText(t) ? `[${t}]` : t;
      });
      body = [texts.join(' | ')];
      if (formAt(src, node.range[0]) === 'long') {
        if (texts.some((t) => isReservedLine(t))) return { error: 'One of the alternatives would read as a keyword on its own line. Edit it first.' };
        body = idx.length === 1 ? [texts[0] as string] : ['one of', ...texts.map((t) => step + t)];
      }
    }
    const patches: Patch[] = [];
    if (long) patches.push({ from: slotAlt.range[0], to: slotAlt.range[1], insert: replacement });
    else {
      const t = trimRange(src, slotAlt.range);
      patches.push({ from: t[0], to: t[1], insert: replacement });
    }
    if (rest.length) {
      const removal = removeAlternatives(src, node, rest);
      if (!removal) return { error: 'These alternatives cannot be removed from the chart.' };
      patches.push(...removal);
    }
    const defLong = formAt(src, node.range[0]) === 'long';
    const def = newDefText(newName, body, defLong, step);
    return appendDefinition(src, def, defLong, patches);
  }

  // A whole node: text, reference, choice, repeat or transform.
  const node = sel.node;
  if (node.kind === 'seq') return { error: 'Select a single box, or one or more alternatives.' };
  if (node.kind === 'group' && node.bare) return { error: 'This is the choice a definition is written as. Select its alternatives instead.' };
  const from = node.range[0];
  const long = formAt(src, from) === 'long';
  const to = node.range[1];
  const lineLevel = long && isAtLineStart(src, from) && isAtLineEnd(src, to);
  const raw = src.slice(from, to);
  let body: string[];
  if (lineLevel && raw.includes('\n')) body = dedentLines(src.slice(lineStart(src, from), to), indentOf(src, from));
  else if (lineLevel && node.kind === 'text' && !/^".*"$/.test(raw) && isReservedLine(raw)) body = [raw];
  else body = raw.split('\n');
  if (lineLevel && node.kind === 'group' && node.options.length === 0) return { error: 'Nothing to extract.' };
  const replacement = lineLevel ? `ref ${newName}` : `$${newName}`;
  const patch: Patch = { from, to, insert: replacement };
  const def = newDefText(newName, body, long, step);
  return appendDefinition(src, def, long, [patch]);
}

// --- Expand and Collapse -------------------------------------------------------------

export interface ConvertResult {
  patches: Patch[];
  changed: string[];
  skipped: { name: string; reason: string }[];
  output: string;
}

/**
 * Convert definitions between short and long form with the core formatter, as ONE patch
 * (so a single undo reverts it). Pass `names` to convert only those definitions.
 */
export function convertForms(src: string, mode: FormatMode, names?: string[]): ConvertResult {
  const r = formatSource(src, mode, names);
  const p = diffPatch(src, r.output);
  return { patches: p ? [p] : [], changed: r.changed, skipped: r.skipped, output: r.output };
}

/** A sentence describing definitions the formatter left alone. */
export function skippedNotice(skipped: { name: string; reason: string }[]): string {
  if (!skipped.length) return '';
  const parts = skipped.map((s) => `${s.name} (${s.reason})`);
  return `Skipped ${skipped.length} ${skipped.length === 1 ? 'definition' : 'definitions'}: ${parts.join('; ')}.`;
}
