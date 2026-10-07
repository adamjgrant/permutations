// Chart edits expressed as text patches against the current source.
// Nothing here regenerates the document from the tree: every edit touches only the
// characters it needs to. Patch offsets all index into the same original source, so a
// list of patches is non-overlapping and can be handed straight to CodeMirror.
//
// A later "Expand" / "Collapse" button can call a formatter and feed the result through
// `replaceAll`, which is expressed as a single patch too.

import type { AnyOrderNode, GroupNode, TextNode } from '../../src/core/types';
import { escapeText, isAtLineStart, Range, trimRange } from './ranges';

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

/** Replace the whole document (for a future formatter button). */
export function replaceAll(src: string, next: string): EditResult {
  if (src === next) return { patches: [] };
  return { patches: [{ from: 0, to: src.length, insert: next }] };
}

// --- choices ---------------------------------------------------------------

/** Ranges of alternatives. Anyorder items and group options both expose seq + range. */
function alternativeRanges(node: ChoiceNode): Range[] {
  return node.kind === 'group' ? node.options.map((o) => o.range) : node.items.map((s) => s.range);
}

/**
 * Structural edits need one distinct source range per alternative. Range expansion
 * (`[1..6]`) makes many alternatives share one range, so those are read-only.
 */
export function isStructurallyEditable(node: ChoiceNode): boolean {
  const seen = new Set<string>();
  for (const r of alternativeRanges(node)) {
    const key = r[0] + ':' + r[1];
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function sepChar(node: ChoiceNode): string {
  return node.kind === 'anyorder' ? '&' : '|';
}

export function addAlternative(src: string, node: ChoiceNode, text = 'new'): EditResult | undefined {
  if (!isStructurallyEditable(node)) return undefined;
  const ranges = alternativeRanges(node);
  const last = ranges[ranges.length - 1];
  if (!last) return undefined;
  const at = trimRange(src, last)[1];
  const sep = sepChar(node);
  const spaced = / [|&] /.test(src.slice(node.range[0], node.range[1])) || node.kind === 'anyorder' || (node.kind === 'group' && node.bare);
  const lead = spaced ? ` ${sep} ` : sep;
  const insert = lead + escapeText(text, false);
  return {
    patches: [{ from: at, to: at, insert }],
    select: [at + lead.length, at + insert.length],
  };
}

export function deleteAlternative(src: string, node: ChoiceNode, index: number): EditResult | undefined {
  if (!isStructurallyEditable(node)) return undefined;
  const ranges = alternativeRanges(node);
  if (ranges.length < 2 || index < 0 || index >= ranges.length) return undefined;
  const sep = sepChar(node);
  const cur = ranges[index] as Range;
  if (index < ranges.length - 1) {
    // Remove the alternative and the separator that follows it.
    if (src[cur[1]] !== sep) return undefined;
    let to = cur[1] + 1;
    if (index === 0) while (to < src.length && (src[to] === ' ' || src[to] === '\t')) to++;
    const from = index === 0 ? trimRange(src, cur)[0] : cur[0];
    return { patches: [{ from, to, insert: '' }] };
  }
  // Last alternative: remove the separator before it and the alternative itself.
  const prev = ranges[index - 1] as Range;
  if (src[prev[1]] !== sep) return undefined;
  return { patches: [{ from: trimRange(src, prev)[1], to: trimRange(src, cur)[1], insert: '' }] };
}

/** Move an alternative up (delta -1) or down (+1) by swapping the text of two neighbours. */
export function moveAlternative(src: string, node: ChoiceNode, index: number, delta: -1 | 1): EditResult | undefined {
  if (node.kind !== 'group' || !isStructurallyEditable(node)) return undefined;
  const j = index + delta;
  if (index < 0 || j < 0 || index >= node.options.length || j >= node.options.length) return undefined;
  const a = trimRange(src, (node.options[index] as { range: Range }).range);
  const b = trimRange(src, (node.options[j] as { range: Range }).range);
  const ta = src.slice(a[0], a[1]);
  const tb = src.slice(b[0], b[1]);
  return {
    patches: [
      { from: a[0], to: a[1], insert: tb },
      { from: b[0], to: b[1], insert: ta },
    ],
  };
}

// --- text ------------------------------------------------------------------

export function editText(src: string, node: TextNode, value: string): EditResult {
  const insert = escapeText(value, isAtLineStart(src, node.range[0]));
  return { patches: [{ from: node.range[0], to: node.range[1], insert }], select: [node.range[0], node.range[0] + insert.length] };
}

/**
 * Give text to an empty alternative. `optionRange` is the alternative's range; it may still
 * hold a guard or tags (`[@q|x]`), in which case the text goes after them.
 */
export function fillEmpty(src: string, optionRange: Range, value: string): EditResult {
  const r = trimRange(src, optionRange);
  const hasContent = r[1] > r[0];
  const lead = hasContent ? ' ' : '';
  const insert = lead + escapeText(value, !hasContent && isAtLineStart(src, r[1]));
  return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + lead.length, r[1] + insert.length] };
}
