// Set or clear the settings of one choice, any-order group or repeat, as a text patch: the
// delimiter, and for any-order groups and repeats `last` (what joins the final two). Short form
// writes a clause, `[...; delimiter=", " last=" and "]` or `{3; delimiter=" "}`; long form
// writes `delimiter ", "` and `last " and "` lines under the block.

import type { AnyOrderNode, GroupNode, RepeatNode } from '../../src/core/types';
import { choiceForm, EditResult, formAt } from './patch';
import { indentOf, indentUnit, lineEnd, lineStart } from './ranges';

type DelimNode = GroupNode | AnyOrderNode | RepeatNode;
type Key = 'delimiter' | 'last';
/** For each key: a string sets it, null removes it, and a missing key leaves it as it is. */
export type SettingsChange = { [K in Key]?: string | null };

const STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const PAIR = String.raw`(?:delimiter|last)\s*=\s*${STRING}\s*`;
const CLAUSE = new RegExp(String.raw`;\s*((?:${PAIR})+)(?=\]$)`);
const REPEAT_SUFFIX = new RegExp(String.raw`\{(\d+(?:\.\.\d+)?)\s*(?:;\s*((?:${PAIR})+))?\}$`);
const lineRe = (key: Key): RegExp => new RegExp(String.raw`^[ \t]*${key}[ \t]+${STRING}[ \t]*$`);

const quote = (v: string): string => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
const unquote = (s: string): string => s.slice(1, -1).replace(/\\(.)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));

function parseClause(text: string | undefined): Partial<Record<Key, string>> {
  const out: Partial<Record<Key, string>> = {};
  if (!text) return out;
  const re = new RegExp(String.raw`(delimiter|last)\s*=\s*(${STRING})`, 'g');
  for (const m of text.matchAll(re)) out[m[1] as Key] = unquote(m[2] as string);
  return out;
}

function merge(old: Partial<Record<Key, string>>, change: SettingsChange): Partial<Record<Key, string>> {
  const out = { ...old };
  for (const key of ['delimiter', 'last'] as const) {
    const v = change[key];
    if (v === null) delete out[key];
    else if (v !== undefined) out[key] = v;
  }
  return out;
}

const printPairs = (s: Partial<Record<Key, string>>): string =>
  (['delimiter', 'last'] as const)
    .filter((k) => s[k] !== undefined)
    .map((k) => `${k}=${quote(s[k] as string)}`)
    .join(' ');

/** Repeats: `x{3}` becomes `x{3; delimiter=" "}`; a long-form `repeat 3` block gets setting lines. */
function setRepeatSettings(src: string, node: RepeatNode, change: SettingsChange): EditResult | undefined {
  const [from, to] = node.range;
  const text = src.slice(from, to);
  const m = REPEAT_SUFFIX.exec(text);
  if (m) {
    const pairs = printPairs(merge(parseClause(m[2]), change));
    return { patches: [{ from: from + m.index, to, insert: `{${m[1]}${pairs ? '; ' + pairs : ''}}` }] };
  }
  if (formAt(src, from) !== 'long' || !/^[ \t]*repeat[ \t]/.test(src.slice(lineStart(src, from), lineEnd(src, from)))) return undefined;
  return longBlockSettings(src, from, to, change);
}

/** Change the settings of a choice, any-order group or repeat. `last` is refused on a choice. */
export function setSettings(src: string, node: DelimNode, change: SettingsChange): EditResult | undefined {
  if (node.kind === 'group' && typeof change.last === 'string') return undefined;
  if (node.kind === 'repeat') return setRepeatSettings(src, node, change);
  const form = choiceForm(src, node);
  if (form === 'opaque') return undefined;
  if (form === 'short') {
    if (node.kind === 'group' && node.bare) return undefined;
    const [from, to] = node.range;
    const text = src.slice(from, to);
    if (!text.startsWith('[') || !text.endsWith(']')) return undefined;
    const m = CLAUSE.exec(text);
    const pairs = printPairs(merge(parseClause(m?.[1]), change));
    const clause = pairs ? `; ${pairs}` : '';
    if (m) {
      const s = from + m.index;
      return { patches: [{ from: s, to: s + m[0].length, insert: clause }] };
    }
    if (!clause) return { patches: [] };
    return { patches: [{ from: to - 1, to: to - 1, insert: clause }] };
  }
  return longBlockSettings(src, node.range[0], node.range[1], change);
}

/** `value` null removes the setting, so the group uses the delimiter around it again. */
export function setDelimiter(src: string, node: DelimNode, value: string | null): EditResult | undefined {
  return setSettings(src, node, { delimiter: value });
}

/** Set or remove the `delimiter "..."` and `last "..."` child lines of the long-form block at `start`. */
function longBlockSettings(src: string, start: number, end: number, change: SettingsChange): EditResult {
  const headerEnd = lineEnd(src, start);
  const childIndent = indentOf(src, start) + indentUnit(src);
  const patches: EditResult['patches'] = [];
  const missing: string[] = [];
  for (const key of ['delimiter', 'last'] as const) {
    const value = change[key];
    if (value === undefined) continue;
    const re = lineRe(key);
    let found = false;
    let pos = headerEnd + 1;
    while (pos <= end && pos < src.length) {
      const e = lineEnd(src, pos);
      const line = src.slice(pos, e);
      if (line.startsWith(childIndent) && !/^\s/.test(line.slice(childIndent.length)) && re.test(line)) {
        patches.push(value === null ? { from: pos, to: Math.min(src.length, e + 1), insert: '' } : { from: pos, to: e, insert: `${childIndent}${key} ${quote(value)}` });
        found = true;
        break;
      }
      pos = e + 1;
    }
    if (!found && value !== null) missing.push(`\n${childIndent}${key} ${quote(value)}`);
  }
  if (missing.length) patches.unshift({ from: headerEnd, to: headerEnd, insert: missing.join('') });
  return { patches };
}

/** The settings a short-form clause or long-form block has now (for the dialog). */
export function currentSettings(node: DelimNode): Partial<Record<Key, string>> {
  const out: Partial<Record<Key, string>> = {};
  if (node.delimiter !== undefined) out.delimiter = node.delimiter;
  const last = node.kind === 'repeat' ? node.last : node.kind === 'anyorder' ? node.last : undefined;
  if (last !== undefined) out.last = last;
  return out;
}
