// Set or clear the delimiter of one choice or any-order group, as a text patch. Short form
// writes `[...; delimiter=", "]`; long form writes a `delimiter ", "` line under the block.

import type { AnyOrderNode, GroupNode } from '../../src/core/types';
import { choiceForm, EditResult } from './patch';
import { indentOf, indentUnit, lineEnd, lineStart } from './ranges';

type DelimNode = GroupNode | AnyOrderNode;

const quote = (v: string): string => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const CLAUSE = /;\s*delimiter\s*=\s*"(?:[^"\\]|\\.)*"\s*(?=\]$)/;
const LINE = /^[ \t]*delimiter[ \t]+"(?:[^"\\]|\\.)*"[ \t]*$/;

/** `value` null removes the setting, so the group uses the delimiter around it again. */
export function setDelimiter(src: string, node: DelimNode, value: string | null): EditResult | undefined {
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
  // Long form: the block header line, then its children one indent deeper.
  const headerStart = lineStart(src, node.range[0]);
  const headerEnd = lineEnd(src, node.range[0]);
  const childIndent = indentOf(src, node.range[0]) + indentUnit(src);
  let pos = headerEnd + 1;
  while (pos <= node.range[1] && pos < src.length) {
    const end = lineEnd(src, pos);
    const line = src.slice(pos, end);
    if (line.startsWith(childIndent) && !/^\s/.test(line.slice(childIndent.length)) && LINE.test(line)) {
      if (value === null) return { patches: [{ from: pos, to: Math.min(src.length, end + 1), insert: '' }] };
      return { patches: [{ from: pos, to: end, insert: `${childIndent}delimiter ${quote(value)}` }] };
    }
    pos = end + 1;
  }
  if (value === null) return { patches: [] };
  void headerStart;
  return { patches: [{ from: headerEnd, to: headerEnd, insert: `\n${childIndent}delimiter ${quote(value)}` }] };
}
