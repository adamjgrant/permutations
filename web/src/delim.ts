// Set or clear the delimiter of one choice or any-order group, as a text patch. Short form
// writes `[...; delimiter=", "]`; long form writes a `delimiter ", "` line under the block.

import type { AnyOrderNode, GroupNode, RepeatNode } from '../../src/core/types';
import { choiceForm, EditResult, formAt } from './patch';
import { indentOf, indentUnit, lineEnd, lineStart } from './ranges';

type DelimNode = GroupNode | AnyOrderNode | RepeatNode;
const REPEAT_SUFFIX = /\{(\d+(?:\.\.\d+)?)\s*(?:;\s*delimiter\s*=\s*"(?:[^"\\]|\\.)*"\s*)?\}$/;

const quote = (v: string): string => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const CLAUSE = /;\s*delimiter\s*=\s*"(?:[^"\\]|\\.)*"\s*(?=\]$)/;
const LINE = /^[ \t]*delimiter[ \t]+"(?:[^"\\]|\\.)*"[ \t]*$/;

/** Repeats: `x{3}` becomes `x{3; delimiter=" "}`; a long-form `repeat 3` block gets a delimiter line. */
function setRepeatDelimiter(src: string, node: RepeatNode, value: string | null): EditResult | undefined {
  const [from, to] = node.range;
  const text = src.slice(from, to);
  const m = REPEAT_SUFFIX.exec(text);
  if (m) {
    const s = from + m.index;
    const insert = value === null ? `{${m[1]}}` : `{${m[1]}; delimiter=${quote(value)}}`;
    return { patches: [{ from: s, to, insert }] };
  }
  if (formAt(src, from) !== 'long' || !/^[ \t]*repeat[ \t]/.test(src.slice(lineStart(src, from), lineEnd(src, from)))) return undefined;
  return longBlockDelimiter(src, from, to, value);
}

/** `value` null removes the setting, so the group uses the delimiter around it again. */
export function setDelimiter(src: string, node: DelimNode, value: string | null): EditResult | undefined {
  if (node.kind === 'repeat') return setRepeatDelimiter(src, node, value);
  const form = choiceForm(src, node);
  if (form === 'opaque') return undefined;
  if (form === 'short') {
    if (node.kind === 'group' && node.bare) return undefined;
    const [from, to] = node.range;
    const text = src.slice(from, to);
    if (!text.startsWith('[') || !text.endsWith(']')) return undefined;
    const m = CLAUSE.exec(text);
    const clause = value === null ? '' : `; delimiter=${quote(value)}`;
    if (m) {
      const s = from + m.index;
      return { patches: [{ from: s, to: s + m[0].length, insert: clause }] };
    }
    if (value === null) return { patches: [] };
    return { patches: [{ from: to - 1, to: to - 1, insert: clause }] };
  }
  return longBlockDelimiter(src, node.range[0], node.range[1], value);
}

/** Set or remove the `delimiter "..."` child line of the long-form block that starts at `start`. */
function longBlockDelimiter(src: string, start: number, end: number, value: string | null): EditResult {
  const headerEnd = lineEnd(src, start);
  const childIndent = indentOf(src, start) + indentUnit(src);
  let pos = headerEnd + 1;
  while (pos <= end && pos < src.length) {
    const e = lineEnd(src, pos);
    const line = src.slice(pos, e);
    if (line.startsWith(childIndent) && !/^\s/.test(line.slice(childIndent.length)) && LINE.test(line)) {
      if (value === null) return { patches: [{ from: pos, to: Math.min(src.length, e + 1), insert: '' }] };
      return { patches: [{ from: pos, to: e, insert: `${childIndent}delimiter ${quote(value)}` }] };
    }
    pos = e + 1;
  }
  if (value === null) return { patches: [] };
  return { patches: [{ from: headerEnd, to: headerEnd, insert: `\n${childIndent}delimiter ${quote(value)}` }] };
}
