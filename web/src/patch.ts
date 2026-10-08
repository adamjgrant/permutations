// Chart edits expressed as text patches against the current source.
// Nothing here regenerates the document from the tree: every edit touches only the
// characters it needs to. Patch offsets all index into the same original source, so a
// list of patches is non-overlapping and can be handed straight to CodeMirror.
//
// Both syntaxes are handled. Short form edits work inside `[a|b]` and `a = x | y`; long form
// edits work on whole lines under `one of` and `any order`, copying the file's own indentation.
// Whole-file conversion (`replaceAll`, and `convertForms` in defs.ts) is one patch too.

import { isReservedLine } from '../../src/core/longform';
import { parseModule } from '../../src/core/parser';
import type { AnyOrderNode, GroupNode, Option, SeqNode, Tag, TextNode, Guard } from '../../src/core/types';
import { escapeText, indentOf, indentUnit, isAtLineEnd, isAtLineStart, lineEnd, lineStart, Range, trimRange } from './ranges';

export interface Patch {
  from: number;
  to: number;
  insert: string;
}

export interface EditResult {
  patches: Patch[];
  /** Range of newly inserted text to focus afterwards, in the coordinates of the NEW source. */
  select?: Range;
}

export type ChoiceNode = GroupNode | AnyOrderNode;

export function applyPatches(src: string, patches: Patch[]): string {
  const sorted = [...patches].sort((a, b) => b.from - a.from || b.to - a.to);
  let out = src;
  for (const p of sorted) out = out.slice(0, p.from) + p.insert + out.slice(p.to);
  return out;
}

/** Map an offset in the original source to the source after the patches. */
export function mapOffset(patches: Patch[], pos: number): number {
  let delta = 0;
  for (const p of patches) {
    if (p.to <= pos) delta += p.insert.length - (p.to - p.from);
  }
  return pos + delta;
}

/** Replace the whole document. */
export function replaceAll(src: string, next: string): EditResult {
  if (src === next) return { patches: [] };
  return { patches: [{ from: 0, to: src.length, insert: next }] };
}

/** One patch covering only the span that differs (common prefix and suffix are kept). */
export function diffPatch(src: string, next: string): Patch | undefined {
  if (src === next) return undefined;
  let a = 0;
  const max = Math.min(src.length, next.length);
  while (a < max && src[a] === next[a]) a++;
  let b = 0;
  while (b < max - a && src[src.length - 1 - b] === next[next.length - 1 - b]) b++;
  return { from: a, to: src.length - b, insert: next.slice(a, next.length - b) };
}

/** Merge deletions that touch or overlap so the list stays non-overlapping. */
function normalizeDeletes(patches: Patch[]): Patch[] {
  const sorted = [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Patch[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.insert === '' && last.insert === '' && p.from <= last.to) last.to = Math.max(last.to, p.to);
    else out.push({ ...p });
  }
  return out;
}

// --- which form is this written in ---------------------------------------------

let formCache: { src: string; defs: { range: Range; form: 'short' | 'long' }[] } | undefined;

/** The syntax (short or long) of the definition that holds `offset`. */
export function formAt(src: string, offset: number): 'short' | 'long' {
  if (formCache?.src !== src) {
    try {
      const { module } = parseModule(src, '<patch>');
      const defs = [...module.defs.values()].map((d) => ({ range: d.range, form: d.form }));
      if (module.anonymous) defs.push({ range: module.anonymous.range, form: 'short' });
      formCache = { src, defs };
    } catch {
      formCache = { src, defs: [] };
    }
  }
  const d = formCache.defs.find((x) => offset >= x.range[0] && offset <= x.range[1]);
  return d?.form ?? 'short';
}

export type ChoiceForm = 'short' | 'long' | 'opaque';

/**
 * `long` for `one of` / `any order` blocks, `short` for bracket groups and bare `a | b`,
 * `opaque` for the implicit choice a long definition gets when it carries tags.
 */
export function choiceForm(src: string, node: ChoiceNode): ChoiceForm {
  const s = node.range[0];
  if (formAt(src, s) === 'long' && isAtLineStart(src, s)) {
    const first = src.slice(s, lineEnd(src, s)).trim();
    if (node.kind === 'anyorder' && first === 'any order') return 'long';
    if (node.kind === 'group' && first === 'one of') return 'long';
    if (node.kind === 'group' && node.bare) return 'opaque';
  }
  return 'short';
}

// --- alternatives ----------------------------------------------------------------

/** One alternative of a choice. A range like `0..9` is a single alternative here. */
export interface Alt {
  range: Range;
  /** Number of options the core expanded this alternative into (1 unless it is a range). */
  count: number;
  seq: SeqNode;
  option?: Option | undefined;
  /** Every option behind this alternative (more than one for a range). */
  options: Option[];
}

export function alternatives(node: ChoiceNode): Alt[] {
  const out: Alt[] = [];
  if (node.kind === 'anyorder') {
    for (const s of node.items) out.push({ range: s.range, count: 1, seq: s, options: [] });
    return out;
  }
  for (const o of node.options) {
    const prev = out[out.length - 1];
    if (prev && prev.range[0] === o.range[0] && prev.range[1] === o.range[1]) {
      prev.count++;
      prev.options.push(o);
      continue;
    }
    out.push({ range: o.range, count: 1, seq: o.seq, option: o, options: [o] });
  }
  return out;
}

/** True when the alternatives can be added to, removed and reordered by patching text. */
export function isStructurallyEditable(node: ChoiceNode, src?: string): boolean {
  if (src !== undefined && choiceForm(src, node) === 'opaque') return false;
  const seen = new Set<string>();
  for (const a of alternatives(node)) {
    const key = a.range[0] + ':' + a.range[1];
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return seen.size > 0;
}

const sepChar = (node: ChoiceNode): string => (node.kind === 'anyorder' ? '&' : '|');

/** The text of a plain long-form line for `text`, quoted only when a bare line would be misread. */
export function longLine(text: string): string {
  const flat = text;
  // An empty line of long form is written as the keyword for it.
  if (flat.trim() === '') return 'nothing';
  const esc = escapeText(flat, true);
  if (flat !== flat.trim() || flat === '' || isReservedLine(esc) || /^".*"$/.test(esc) || /^&$/.test(esc)) return quoteLong(flat);
  return esc;
}

export function quoteLong(text: string): string {
  return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

/** Delete whole lines [lineStart(range[0]) .. lineEnd(range[1])] including one line break. */
function deleteLines(src: string, range: Range): Patch {
  const from = lineStart(src, range[0]);
  const end = lineEnd(src, range[1]);
  if (end >= src.length) return { from: from > 0 ? from - 1 : from, to: src.length, insert: '' };
  return { from, to: end + 1, insert: '' };
}

/** Add an alternative after alternative `after` (the last one when omitted). */
export function addAlternative(src: string, node: ChoiceNode, text = 'new', after?: number, branches?: ReadonlySet<string>): EditResult | undefined {
  if (!isStructurallyEditable(node, src)) return undefined;
  const alts = alternatives(node);
  // Added to the choice as a whole, a new alternative goes before a trailing empty one: [a|b|new|].
  const isEmpty = (a: Alt | undefined): boolean => !!a && ['', 'nothing'].includes(src.slice(...trimRange(src, a.range)));
  if (after === undefined && alts.length > 1 && isEmpty(alts[alts.length - 1])) after = alts.length - 2;
  const last = alts[after === undefined ? alts.length - 1 : Math.max(0, Math.min(after, alts.length - 1))];
  const first = alts[0];
  if (!last || !first) return undefined;
  const form = choiceForm(src, node);
  if (form === 'long') {
    const indent = indentOf(src, first.range[0]);
    const at = last.range[1];
    const line = text === '' ? 'nothing' : withReferences(longLine(text), branches);
    const insert = '\n' + indent + line;
    return { patches: [{ from: at, to: at, insert }], select: [at + 1 + indent.length, at + insert.length] };
  }
  const at = trimRange(src, last.range)[1];
  const sep = sepChar(node);
  const spaced = / [|&] /.test(src.slice(node.range[0], node.range[1])) || node.kind === 'anyorder' || (node.kind === 'group' && node.bare);
  const lead = spaced ? ` ${sep} ` : sep;
  const insert = lead + withReferences(escapeText(text, false), branches);
  return {
    patches: [{ from: at, to: at, insert }],
    select: [at + lead.length, at + insert.length],
  };
}

/** Patches that remove several alternatives at once (at least one must remain). */
export function removeAlternatives(src: string, node: ChoiceNode, indices: number[]): Patch[] | undefined {
  if (!isStructurallyEditable(node, src)) return undefined;
  const alts = alternatives(node);
  const drop = new Set(indices.filter((i) => i >= 0 && i < alts.length));
  if (drop.size === 0 || drop.size >= alts.length) return undefined;
  if (choiceForm(src, node) === 'long') {
    return normalizeDeletes([...drop].map((i) => deleteLines(src, (alts[i] as Alt).range)));
  }
  const sep = sepChar(node);
  const patches: Patch[] = [];
  let i = 0;
  while (i < alts.length) {
    if (!drop.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < alts.length && drop.has(j + 1)) j++;
    if (j < alts.length - 1) {
      // Remove the run and the separator that follows it.
      const cur = (alts[j] as Alt).range;
      if (src[cur[1]] !== sep) return undefined;
      let to = cur[1] + 1;
      if (i === 0) while (to < src.length && (src[to] === ' ' || src[to] === '\t')) to++;
      const from = i === 0 ? trimRange(src, (alts[0] as Alt).range)[0] : (alts[i] as Alt).range[0];
      patches.push({ from, to, insert: '' });
    } else {
      // The run reaches the end: remove the separator before it and the run itself.
      const prev = (alts[i - 1] as Alt).range;
      if (src[prev[1]] !== sep) return undefined;
      patches.push({ from: trimRange(src, prev)[1], to: trimRange(src, (alts[j] as Alt).range)[1], insert: '' });
    }
    i = j + 1;
  }
  return patches;
}

export function deleteAlternative(src: string, node: ChoiceNode, index: number): EditResult | undefined {
  const alts = alternatives(node);
  // A bracket choice left with one plain alternative is just that alternative: unwrap it
  // (unless a repeat or transform after the bracket needs it to stay one piece).
  const after = src[node.range[1]];
  if (alts.length === 2 && node.kind === 'group' && !node.bare && node.delimiter === undefined && choiceForm(src, node) === 'short' && after !== '{' && after !== ':') {
    const keep = alts[1 - index] as Alt;
    const opt = keep.option;
    if (keep.count === 1 && opt && !opt.tags.length && !opt.guard) {
      const kr = trimRange(src, keep.range);
      const text = src.slice(kr[0], kr[1]);
      let from = node.range[0];
      let to = node.range[1];
      if (text === '') {
        if (src[to] === ' ') to++;
        else if (src[from - 1] === ' ') from--;
      }
      return { patches: [{ from, to, insert: text }], select: [from, from + text.length] };
    }
  }
  const patches = removeAlternatives(src, node, [index]);
  if (!patches) return undefined;
  // Select the alternative that takes its place (or the one before, when it was the last).
  const neighbour = alts[index + 1] ?? alts[index - 1];
  if (!neighbour) return { patches };
  const at = mapOffset(patches, trimRange(src, neighbour.range)[0]);
  return { patches, select: [at, at] };
}

/** Move an alternative up (delta -1) or down (+1) by swapping the text of two neighbours. */
export function moveAlternative(src: string, node: ChoiceNode, index: number, delta: -1 | 1): EditResult | undefined {
  if (!isStructurallyEditable(node, src)) return undefined;
  const alts = alternatives(node);
  const j = index + delta;
  if (index < 0 || j < 0 || index >= alts.length || j >= alts.length) return undefined;
  const long = choiceForm(src, node) === 'long';
  // In long form, comment lines right above an alternative are about it, so they move with it.
  const withComments = (start: number): number => {
    let s = start;
    while (s > 0) {
      const prev = lineStart(src, s - 1);
      if (!/^[ \t]*#/.test(src.slice(prev, s - 1))) break;
      s = prev;
    }
    return s;
  };
  const region = (r: Range): Range => (long ? [withComments(lineStart(src, r[0])), r[1]] : trimRange(src, r));
  const a = region((alts[index] as Alt).range);
  const b = region((alts[j] as Alt).range);
  const ta = src.slice(a[0], a[1]);
  const tb = src.slice(b[0], b[1]);
  return {
    patches: [
      { from: a[0], to: a[1], insert: tb },
      { from: b[0], to: b[1], insert: ta },
    ],
  };
}

// --- text ------------------------------------------------------------------------

const RANGE_RE = /^(?:\d+\.\.\d+|[^\s.]\.\.[^\s.])$/u;

/** True when `text` is a range such as `0..9` or `A..F`. */
export function isRangeText(text: string): boolean {
  return RANGE_RE.test(text);
}

/**
 * Text typed into the chart is text, so `$` is escaped, except in `$name` where name is a branch:
 * typing `$closing` there means the reference.
 */
export function withReferences(escaped: string, branches: ReadonlySet<string> | undefined): string {
  if (!branches?.size) return escaped;
  return escaped.replace(/\\\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g, (m, name: string) => (branches.has(name) ? '$' + name : m));
}

export function editText(src: string, node: TextNode, value: string, branches?: ReadonlySet<string>): EditResult {
  const [from, to] = node.range;
  const long = formAt(src, from) === 'long';
  const raw = src.slice(from, to);
  let insert: string;
  if (long && isAtLineStart(src, from) && isAtLineEnd(src, to)) {
    // The text is a whole long-form line: keep quotes if it had them, quote when a bare line would be misread.
    insert = /^".*"$/.test(raw) && raw !== '"' ? quoteLong(value) : withReferences(longLine(value), branches);
  } else {
    insert = withReferences(escapeText(value, isAtLineStart(src, from)), branches);
  }
  return { patches: [{ from, to, insert }], select: [from, from + insert.length] };
}

/** Edit the source text of a range choice (`0..9`). Text that is not a range is escaped as plain text. */
export function editRange(src: string, range: Range, value: string): EditResult {
  const r = trimRange(src, range);
  const v = value.trim();
  const insert = isRangeText(v) ? v : escapeText(v, isAtLineStart(src, r[0]));
  return { patches: [{ from: r[0], to: r[1], insert }], select: [r[0], r[0] + insert.length] };
}

/**
 * Give text to an empty alternative. `optionRange` is the alternative's range; it may still
 * hold a guard or tags (`[@q|x]`), in which case the text goes after them.
 */
export function fillEmpty(src: string, optionRange: Range, value: string, branches?: ReadonlySet<string>): EditResult {
  const r = trimRange(src, optionRange);
  if (formAt(src, r[0]) === 'long' && src.slice(r[0], r[1]) === 'nothing') {
    const insert = withReferences(longLine(value), branches);
    return { patches: [{ from: r[0], to: r[1], insert }], select: [r[0], r[0] + insert.length] };
  }
  const hasContent = r[1] > r[0];
  const lead = hasContent ? ' ' : '';
  const insert = lead + withReferences(escapeText(value, !hasContent && isAtLineStart(src, r[1])), branches);
  return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + lead.length, r[1] + insert.length] };
}

// --- tags and guards -------------------------------------------------------------

export interface TagSpec {
  name: string;
  value?: string | undefined;
}
export type GuardSpec = { kind: 'else' } | { kind: 'tag'; name: string; negate: boolean; value?: string | undefined };

const NAME_RE = /^[A-Za-z_]\w*$/;

export function parseTagInput(input: string): { spec: TagSpec } | { error: string } {
  const t = input.trim().replace(/^@/, '');
  const m = /^([^=\s]*)(?:\s*=\s*(.*))?$/.exec(t);
  const name = m?.[1] ?? '';
  const value = m?.[2]?.trim();
  if (!NAME_RE.test(name)) return { error: 'A tag name starts with a letter or underscore and uses letters, digits and underscores. Example: q or severity=5' };
  if (value !== undefined && value !== '' && !/^[^\s|\]&;]+$/.test(value)) return { error: 'A tag value cannot contain spaces or the characters | ] & ;' };
  return value ? { spec: { name, value } } : { spec: { name } };
}

export function parseGuardInput(input: string): { spec: GuardSpec } | { error: string } {
  const t = input.trim().replace(/^@/, '').replace(/:$/, '').trim();
  if (t === 'else' || t === 'otherwise') return { spec: { kind: 'else' } };
  const m = /^(!|not\s+)?\s*([^=\s]*)(?:\s*=\s*(.*))?$/.exec(t);
  const name = m?.[2] ?? '';
  const value = m?.[3]?.trim();
  if (!NAME_RE.test(name)) return { error: 'A guard is a tag name, optionally with ! in front or =value after it. Example: q, !q, severity=5 or else' };
  if (value !== undefined && value !== '' && !/^[^\s:|\]&;]+$/.test(value)) return { error: 'A guard value cannot contain spaces or the characters : | ] & ;' };
  const base = { kind: 'tag' as const, name, negate: !!m?.[1] };
  return value ? { spec: { ...base, value } } : { spec: base };
}

export function tagInputOf(t: TagSpec | Tag): string {
  return t.name + (t.value !== undefined && t.value !== '' ? '=' + t.value : '');
}

export function guardInputOf(g: Guard | GuardSpec): string {
  if (g.kind === 'else') return 'else';
  return (g.negate ? '!' : '') + g.name + (g.value !== undefined && g.value !== '' ? '=' + g.value : '');
}

export function tagSource(spec: TagSpec, long: boolean): string {
  const v = spec.value !== undefined && spec.value !== '';
  return long ? `tag ${spec.name}${v ? ' = ' + spec.value : ''}` : `@${spec.name}${v ? '=' + spec.value : ''}`;
}

export function guardSource(spec: GuardSpec, long: boolean): string {
  if (spec.kind === 'else') return long ? 'otherwise' : '@else:';
  const v = spec.value !== undefined && spec.value !== '';
  if (long) return `when ${spec.negate ? 'not ' : ''}${spec.name}${v ? ' = ' + spec.value : ''}`;
  return `@${spec.negate ? '!' : ''}${spec.name}${v ? '=' + spec.value : ''}:`;
}

/** Remove an inline `@tag` or `@guard:` together with one run of the whitespace around it. */
function removeInline(src: string, range: Range): Patch {
  let [from, to] = range;
  if (from > 0 && /[ \t]/.test(src[from - 1] as string)) {
    while (from > 0 && /[ \t]/.test(src[from - 1] as string)) from--;
  } else {
    while (to < src.length && /[ \t]/.test(src[to] as string)) to++;
  }
  return { from, to, insert: '' };
}

const isInline = (src: string, range: Range): boolean => src[range[0]] === '@';

/** Rewrite a tag chip. `spec` of null removes it. */
export function editTag(src: string, tag: Tag, spec: TagSpec | null): EditResult | undefined {
  const range = tag.range;
  if (!range) return undefined;
  if (isInline(src, range)) {
    if (spec === null) return { patches: [removeInline(src, range)] };
    const insert = tagSource(spec, false);
    return { patches: [{ from: range[0], to: range[1], insert }], select: [range[0], range[0] + insert.length] };
  }
  if (spec === null) return { patches: [deleteLines(src, range)] };
  const insert = tagSource(spec, true);
  return { patches: [{ from: range[0], to: range[1], insert }] };
}

/** Rewrite a guard chip. `spec` of null removes it (a `when` block becomes a `sequence`). */
export function editGuard(src: string, guard: Guard, spec: GuardSpec | null): EditResult | undefined {
  const range = guard.range;
  if (!range) return undefined;
  if (isInline(src, range)) {
    if (spec === null) {
      let to = range[1];
      while (to < src.length && /[ \t]/.test(src[to] as string)) to++;
      return { patches: [{ from: range[0], to, insert: '' }] };
    }
    const insert = guardSource(spec, false);
    return { patches: [{ from: range[0], to: range[1], insert }], select: [range[0], range[0] + insert.length] };
  }
  const insert = spec === null ? 'sequence' : guardSource(spec, true);
  return { patches: [{ from: range[0], to: range[1], insert }] };
}

function altAt(src: string, node: ChoiceNode, index: number): { alt: Alt; form: ChoiceForm } | undefined {
  if (node.kind !== 'group' || !isStructurallyEditable(node, src)) return undefined;
  const alt = alternatives(node)[index];
  if (!alt || !alt.option || alt.count !== 1) return undefined;
  return { alt, form: choiceForm(src, node) };
}

const blockText = (src: string, range: Range): string => src.slice(lineStart(src, range[0]), range[1]);
const reindent = (block: string, prefix: string): string =>
  block
    .split('\n')
    .map((l) => (l.trim() === '' ? l : prefix + l))
    .join('\n');
const isSingleLine = (src: string, range: Range): boolean => !src.slice(range[0], range[1]).includes('\n');

/** True for an option that is one plain short-form line, which can carry inline `@tag` and `@guard:`. */
function isPlainLine(src: string, range: Range): boolean {
  return isSingleLine(src, range) && !isReservedLine(src.slice(range[0], range[1]).trim());
}

/** Add a tag to alternative `index` of a choice. Long form picks the least intrusive shape. */
export function addTag(src: string, node: ChoiceNode, index: number, spec: TagSpec): EditResult | undefined {
  const at = altAt(src, node, index);
  if (!at) return undefined;
  const r = at.alt.range;
  if (at.form === 'short') {
    const t = trimRange(src, r);
    const hasContent = t[1] > t[0];
    const insert = (hasContent ? ' ' : '') + tagSource(spec, false);
    const pos = hasContent ? t[1] : r[0];
    return { patches: [{ from: pos, to: pos, insert }], select: [pos + (hasContent ? 1 : 0), pos + insert.length] };
  }
  if (isPlainLine(src, r)) {
    const insert = ' ' + tagSource(spec, false);
    return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + 1, r[1] + insert.length] };
  }
  const header = src.slice(r[0], lineEnd(src, r[0])).trim();
  if (/^(sequence|tight|when\b.*|otherwise)$/.test(header) && !isSingleLine(src, r)) {
    if (header === 'tight') return wrapWith(src, r, 'sequence', tagSource(spec, true));
    const child = indentOf(src, lineEnd(src, r[0]) + 1);
    const insert = '\n' + child + tagSource(spec, true);
    return { patches: [{ from: r[1], to: r[1], insert }] };
  }
  return wrapWith(src, r, 'sequence', tagSource(spec, true));
}

/** Put the block under a new header line and optionally add a trailing line inside it. */
function wrapWith(src: string, r: Range, header: string, trailer?: string): EditResult {
  const indent = indentOf(src, r[0]);
  const step = indentUnit(src);
  let text = indent + header + '\n' + reindent(blockText(src, r), step);
  if (trailer) text += '\n' + indent + step + trailer;
  return { patches: [{ from: lineStart(src, r[0]), to: r[1], insert: text }] };
}

/** Add a guard to alternative `index`. Refused when it already has one (edit the chip instead). */
export function addGuard(src: string, node: ChoiceNode, index: number, spec: GuardSpec): EditResult | undefined {
  const at = altAt(src, node, index);
  if (!at || at.alt.option?.guard) return undefined;
  const r = at.alt.range;
  if (at.form === 'short') {
    const t = trimRange(src, r);
    const hasContent = t[1] > t[0];
    const insert = guardSource(spec, false) + (hasContent ? ' ' : '');
    return { patches: [{ from: hasContent ? t[0] : r[0], to: hasContent ? t[0] : r[0], insert }], select: [r[0], r[0] + insert.length] };
  }
  if (isPlainLine(src, r)) {
    const insert = guardSource(spec, false) + ' ';
    return { patches: [{ from: r[0], to: r[0], insert }] };
  }
  const header = src.slice(r[0], lineEnd(src, r[0])).trim();
  if (header === 'sequence' && !isSingleLine(src, r)) {
    return { patches: [{ from: r[0], to: r[0] + 'sequence'.length, insert: guardSource(spec, true) }] };
  }
  return wrapWith(src, r, guardSource(spec, true));
}

/**
 * Where an offset ends up after `moveAlternative`, which swaps the text of two regions.
 * Offsets inside a swapped region travel with their text; others shift as usual.
 */
export function mapAfterMove(patches: Patch[], pos: number): number {
  if (patches.length !== 2) return mapOffset(patches, pos);
  const [a, b] = patches as [Patch, Patch];
  const newStart = (p: Patch, other: Patch): number => p.from + (other.from < p.from ? other.insert.length - (other.to - other.from) : 0);
  if (pos >= a.from && pos <= a.to) return newStart(b, a) + (pos - a.from);
  if (pos >= b.from && pos <= b.to) return newStart(a, b) + (pos - b.from);
  return mapOffset(patches, pos);
}
