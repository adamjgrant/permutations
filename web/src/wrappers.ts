// Change or remove the repeat or transform around a piece: `x{3}` and `x:upper` in short
// form, a `repeat 3` or `transform upper` block in long form. Text patches, like every edit.

import type { RepeatNode, TransformNode } from '../../src/core/types';
import { EditResult, formAt } from './patch';
import { indentOf, indentUnit, lineEnd, lineStart } from './ranges';

const REPEAT_SUFFIX = /\{(\d+(?:\.\.\d+)?)(\s*;\s*delimiter\s*=\s*"(?:[^"\\]|\\.)*"\s*)?\}$/;
const TRANSFORM_SUFFIX = /:(?:[A-Za-z_]\w*|\[[^\]]*\])$/;
const LONG_DELIM = /^[ \t]*delimiter[ \t]+"(?:[^"\\]|\\.)*"[ \t]*$/;

const header = (src: string, at: number): [number, number] => [lineStart(src, at), lineEnd(src, at)];
const isLongBlock = (src: string, node: { range: [number, number] }, word: string): boolean =>
  formAt(src, node.range[0]) === 'long' && new RegExp(`^[ \\t]*${word}[ \\t]`).test(src.slice(...header(src, node.range[0])));

export function parseCount(input: string): { min: number; max: number } | { error: string } {
  const m = /^\s*(\d+)\s*(?:\.\.\s*(\d+)\s*)?$/.exec(input);
  if (!m) return { error: 'Type a number, or a range such as 2..4.' };
  const min = Number(m[1]);
  const max = m[2] !== undefined ? Number(m[2]) : min;
  if (max < min) return { error: `${min}..${max} runs backwards.` };
  if (max > 1000) return { error: 'At most 1000 copies.' };
  return { min, max };
}

const countText = (min: number, max: number): string => (min === max ? `${min}` : `${min}..${max}`);

export function setRepeatCount(src: string, node: RepeatNode, min: number, max: number): EditResult | undefined {
  const [from, to] = node.range;
  if (isLongBlock(src, node, 'repeat')) {
    const [hs, he] = header(src, from);
    const insert = `${indentOf(src, from)}repeat ${countText(min, max)}`;
    return { patches: [{ from: hs, to: he, insert }] };
  }
  const m = REPEAT_SUFFIX.exec(src.slice(from, to));
  if (!m) return undefined;
  const s = from + m.index;
  return { patches: [{ from: s, to, insert: `{${countText(min, max)}${m[2] ?? ''}}` }] };
}

/** Remove a repeat: the piece is used once. In long form the block becomes a `sequence`. */
export function removeRepeat(src: string, node: RepeatNode): EditResult | undefined {
  const [from, to] = node.range;
  if (isLongBlock(src, node, 'repeat')) return unwrapBlock(src, from, to);
  const m = REPEAT_SUFFIX.exec(src.slice(from, to));
  if (!m) return undefined;
  return { patches: [{ from: from + m.index, to, insert: '' }] };
}

export function setTransforms(src: string, node: TransformNode, fns: string[]): EditResult | undefined {
  const [from, to] = node.range;
  const spec = fns.length === 1 ? fns[0] : `[${fns.join('|')}]`;
  if (isLongBlock(src, node, 'transform')) {
    const [hs, he] = header(src, from);
    return { patches: [{ from: hs, to: he, insert: `${indentOf(src, from)}transform ${fns.join(' | ')}` }] };
  }
  const m = TRANSFORM_SUFFIX.exec(src.slice(from, to));
  if (!m) return undefined;
  return { patches: [{ from: from + m.index, to, insert: `:${spec}` }] };
}

export function removeTransform(src: string, node: TransformNode): EditResult | undefined {
  const [from, to] = node.range;
  if (isLongBlock(src, node, 'transform')) return unwrapBlock(src, from, to);
  const m = TRANSFORM_SUFFIX.exec(src.slice(from, to));
  if (!m) return undefined;
  return { patches: [{ from: from + m.index, to, insert: '' }] };
}

/**
 * A long-form `repeat` or `transform` block without its effect: the header becomes `sequence`,
 * which keeps the lines under it one piece, and a delimiter line (between copies) goes.
 */
function unwrapBlock(src: string, from: number, to: number): EditResult {
  const [hs, he] = header(src, from);
  const patches = [{ from: hs, to: he, insert: `${indentOf(src, from)}sequence` }];
  const child = indentOf(src, from) + indentUnit(src);
  let pos = he + 1;
  while (pos < to && pos < src.length) {
    const end = lineEnd(src, pos);
    const line = src.slice(pos, end);
    if (line.startsWith(child) && !/^\s/.test(line.slice(child.length)) && LONG_DELIM.test(line)) {
      patches.push({ from: pos, to: Math.min(src.length, end + 1), insert: '' });
      break;
    }
    pos = end + 1;
  }
  return { patches };
}
