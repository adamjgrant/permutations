// Pure keyboard navigation over a layout: which box does an arrow key lead to?
// Left and Right follow the line of boxes, Up and Down move between the alternatives
// (rows) of the same choice, falling back to the nearest box above or below.

import { Box, LEAF_KINDS } from './layout';

export type Dir = 'left' | 'right' | 'up' | 'down';

const area = (b: Box): number => b.w * b.h;
export const inside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;

/** Boxes that take focus. Section labels are decoration. */
export const focusable = (b: Box): boolean => LEAF_KINDS.has(b.kind) && b.kind !== 'sectionLabel';

export interface RowContext {
  row?: Box | undefined;
  frame?: Box | undefined;
}

/** The innermost alternative (row) a box sits in, and the choice frame that holds it. */
export function rowContext(boxes: Box[], b: Box | undefined): RowContext {
  if (!b) return {};
  const frameById = (id: string | undefined): Box | undefined => boxes.find((x) => x.id === id);
  if (b.kind === 'row') return { row: b, frame: frameById(b.frameId) };
  if (b.kind === 'frame') return b.frameOf === 'group' || b.frameOf === 'anyorder' ? { frame: b } : {};
  if (!LEAF_KINDS.has(b.kind)) return {};
  const rows = boxes.filter((r) => r.kind === 'row' && inside(b, r)).sort((p, q) => area(p) - area(q));
  const row = rows[0];
  return row ? { row, frame: frameById(row.frameId) } : {};
}

const cx = (b: Box): number => b.x + b.w / 2;
const cy = (b: Box): number => b.y + b.h / 2;

export function navigate(boxes: Box[], from: Box, dir: Dir): Box | undefined {
  const leaves = boxes.filter((b) => focusable(b) && b.id !== from.id);
  if (dir === 'left' || dir === 'right') {
    const along = (ref: Box, tol: number): Box | undefined => {
      let best: Box | undefined;
      let bestGap = Infinity;
      for (const c of leaves) {
        if (Math.abs(cy(c) - cy(ref)) > tol) continue;
        const gap = dir === 'right' ? c.x - (ref.x + ref.w) : ref.x - (c.x + c.w);
        if (gap < -1) continue;
        if (gap < bestGap) {
          best = c;
          bestGap = gap;
        }
      }
      return best;
    };
    const direct = along(from, Math.max(from.h, 34) / 2 + 2);
    if (direct) return direct;
    // Nothing in this alternative's line: leave the choice and continue from its connector.
    const frames = boxes.filter((f) => f.kind === 'frame' && inside(from, f)).sort((p, q) => area(p) - area(q));
    for (const f of frames) {
      const hit = along(f, 19);
      if (hit && !inside(hit, f)) return hit;
    }
    return undefined;
  }
  const down = dir === 'down';
  // Sibling alternatives first.
  const ctx = rowContext(boxes, from);
  if (ctx.row && ctx.frame) {
    const wanted = (ctx.row.index ?? 0) + (down ? 1 : -1);
    const sibling = boxes.find((r) => r.kind === 'row' && r.frameId === ctx.row?.frameId && r.index === wanted);
    if (sibling) {
      let best: Box | undefined;
      let bestScore = Infinity;
      for (const c of leaves) {
        if (!inside(c, sibling)) continue;
        const score = Math.abs(c.x - from.x) + Math.abs(cy(c) - cy(sibling)) * 0.5;
        if (score < bestScore) {
          best = c;
          bestScore = score;
        }
      }
      if (best) return best;
    }
  }
  let best: Box | undefined;
  let bestScore = Infinity;
  for (const c of leaves) {
    const dy = down ? cy(c) - cy(from) : cy(from) - cy(c);
    if (dy <= 4) continue;
    const score = dy + Math.abs(cx(c) - cx(from)) * 0.6;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Reading order: top to bottom, then left to right. */
export function readingOrder(boxes: Box[]): Box[] {
  return boxes.filter(focusable).sort((a, b) => a.y - b.y || a.x - b.x);
}
