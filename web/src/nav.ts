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

/** A choice or any-order group: not on the arrow-key path, but it can be selected and focused. */
export const isChoiceFrame = (b: Box): boolean => b.kind === 'frame' && (b.frameOf === 'group' || b.frameOf === 'anyorder');

/** Anything that can hold keyboard focus: leaves, and choices reached with Shift+Up. */
export const selectable = (b: Box): boolean => focusable(b) || isChoiceFrame(b);

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
  // The layout records each leaf's alternative; fall back to geometry for boxes without one.
  const row = b.rowId !== undefined ? boxes.find((r) => r.id === b.rowId) : boxes.filter((r) => r.kind === 'row' && inside(b, r)).sort((p, q) => area(p) - area(q))[0];
  return row ? { row, frame: frameById(row.frameId) } : {};
}

const cx = (b: Box): number => b.x + b.w / 2;
const cy = (b: Box): number => b.y + b.h / 2;

/**
 * Moving sideways into a choice lands on one of ITS alternatives (the one nearest the line we
 * came along), never on a box nested deeper that happens to sit on that line.
 */
function enterChoice(boxes: Box[], from: Box, hit: Box, dir: Dir, origin: Box = from): Box {
  const outer = boxes
    .filter((f) => f.kind === 'frame' && (f.frameOf === 'group' || f.frameOf === 'anyorder') && inside(hit, f) && !inside(origin, f) && !inside(from, f))
    .sort((p, q) => area(q) - area(p))[0];
  if (!outer) return hit;
  const rows = boxes.filter((r) => r.kind === 'row' && r.frameId === outer.id);
  // The alternative nearest the line we came along (the first of two at the same distance).
  const row = rows.sort((p, q) => Math.abs(cy(p) - cy(from)) - Math.abs(cy(q) - cy(from)) || p.y - q.y)[0];
  if (!row) return hit;
  const inRow = boxes.filter((b) => focusable(b) && inside(b, row));
  const pick = inRow.sort((p, q) => (dir === 'right' ? p.x - q.x : q.x + q.w - (p.x + p.w)) || Math.abs(cy(p) - cy(row)) - Math.abs(cy(q) - cy(row)))[0];
  return pick ?? hit;
}

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
    const gapTo = (ref: Box, c: Box): number => (dir === 'right' ? c.x - (ref.x + ref.w) : ref.x - (c.x + c.w));
    // A choice ahead whose side the line runs into. With an even number of alternatives no box
    // sits on the line itself (the rows are above and below it), so look for the frame too.
    const choiceAhead = (ref: Box): Box | undefined => {
      let best: Box | undefined;
      let bestGap = Infinity;
      for (const f of boxes) {
        if (!isChoiceFrame(f) || inside(from, f) || inside(ref, f)) continue;
        if (cy(ref) < f.y || cy(ref) > f.y + f.h) continue;
        const gap = gapTo(ref, f);
        if (gap < -1) continue;
        if (gap < bestGap) {
          best = f;
          bestGap = gap;
        }
      }
      return best;
    };
    const step = (ref: Box, tol: number): Box | undefined => {
      const direct = along(ref, tol);
      const frame = choiceAhead(ref);
      if (frame && (!direct || gapTo(ref, frame) < gapTo(ref, direct))) {
        const inner = boxes.find((b) => focusable(b) && inside(b, frame));
        if (inner) return enterChoice(boxes, ref === from ? from : ref, inner, dir, from);
      }
      return direct ? enterChoice(boxes, from, direct, dir) : undefined;
    };
    // From a branch's name, Right goes into the branch: its first piece.
    if (from.kind === 'defLabel' && dir === 'right') {
      const card = boxes.find((d) => d.kind === 'def' && d.name === from.name);
      const firstIn = card ? readingOrder(boxes).find((b) => b.id !== from.id && b.kind !== 'defLabel' && inside(b, card)) : undefined;
      if (firstIn) return firstIn;
    }
    const next = step(from, Math.max(from.h, 34) / 2 + 2);
    if (next) return next;
    // Nothing in this alternative's line: leave the choice and continue from its connector.
    const frames = boxes.filter((f) => f.kind === 'frame' && inside(from, f)).sort((p, q) => area(p) - area(q));
    for (const f of frames) {
      // The line enters and leaves a choice somewhere along its side, not always at its middle.
      const hit = step(f, f.h / 2);
      if (hit && !inside(hit, f)) return hit;
    }
    // At the end of a wrapped line of a branch, Right goes on to the start of the next line,
    // and Left from the start of a line goes back to the end of the one above.
    const at = from.wrapLine;
    if (at === undefined) return undefined;
    const card = boxes.filter((d) => d.kind === 'def' && inside(from, d)).sort((p, q) => area(p) - area(q))[0];
    const line = leaves.filter((b) => b.wrapLine === at + (dir === 'right' ? 1 : -1) && (!card || inside(b, card)));
    if (dir === 'right') return line.sort((p, q) => p.x - q.x || Math.abs(cy(p) - cy(from)) - Math.abs(cy(q) - cy(from)))[0];
    return line.sort((p, q) => q.x + q.w - (p.x + p.w))[0];
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
