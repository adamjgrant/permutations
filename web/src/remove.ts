// Delete one piece of a sequence (a word run, a reference, a choice), as a text patch. The
// alternative a piece sits in is left alone unless the piece is all it holds; then the caller
// deletes the alternative instead.

import { visit } from '../../src/index';
import type { Node, SeqNode } from '../../src/core/types';
import { EditResult, formAt } from './patch';
import { isAtLineEnd, isAtLineStart, lineEnd, lineStart, Range, trimRange } from './ranges';

export interface PieceLoc {
  seq: SeqNode;
  index: number;
  /** The source range of the whole piece (a transform or repeat around the node included). */
  range: Range;
  /** What the sequence is: an alternative of a choice, an item of an any-order group, a branch body. */
  parent: 'option' | 'item' | 'body' | 'other';
}

const same = (a: Node, b: Node): boolean => a.kind === b.kind && a.range[0] === b.range[0] && a.range[1] === b.range[1];

function contains(outer: Node, inner: Node): boolean {
  let found = false;
  visit(outer, (n) => {
    if (same(n, inner)) found = true;
  });
  return found;
}

/** Where `node` sits: the innermost sequence that has it (or a wrapper around it) as a piece. */
export function locatePiece(bodies: Node[], node: Node): PieceLoc | undefined {
  let loc = innermost(bodies, node);
  // A long-form line is its own one-piece sequence: the piece the user sees is the line, which
  // sits in the sequence of the block around it.
  while (loc && loc.parent === 'other' && loc.seq.pieces.length === 1) {
    const up = innermost(bodies, loc.seq);
    if (!up || up.seq === loc.seq) break;
    loc = up;
  }
  return loc;
}

function innermost(bodies: Node[], node: Node): PieceLoc | undefined {
  let best: PieceLoc | undefined;
  for (const body of bodies) {
    const parents = new Map<SeqNode, PieceLoc['parent']>();
    if (body.kind === 'seq') parents.set(body, 'body');
    visit(body, (n) => {
      if (n.kind === 'group') for (const o of n.options) parents.set(o.seq, 'option');
      if (n.kind === 'anyorder') for (const it of n.items) parents.set(it, 'item');
    });
    visit(body, (n) => {
      if (n.kind !== 'seq') return;
      n.pieces.forEach((p, i) => {
        const r = p.node.range;
        if (r[0] > node.range[0] || r[1] < node.range[1] || !contains(p.node, node)) return;
        if (!best || r[1] - r[0] <= best.range[1] - best.range[0]) best = { seq: n, index: i, range: r, parent: parents.get(n) ?? 'other' };
      });
    });
  }
  return best;
}

/** True when the piece is all its sequence holds (so deleting it means deleting the alternative). */
export function isSolePiece(loc: PieceLoc): boolean {
  return loc.seq.pieces.filter((p) => !(p.node.kind === 'text' && p.node.value === '')).length <= 1;
}

export function deletePiece(src: string, loc: PieceLoc): EditResult | { error: string } {
  if (isSolePiece(loc)) {
    return { error: loc.parent === 'body' ? 'A branch needs something in it. Delete the branch instead.' : 'This is all the alternative holds. Delete the alternative instead.' };
  }
  const [a, b] = trimRange(src, loc.range);
  if (formAt(src, a) === 'long' && isAtLineStart(src, a) && isAtLineEnd(src, b)) {
    const from = lineStart(src, a);
    const end = lineEnd(src, b);
    return { patches: [{ from, to: end < src.length ? end + 1 : end, insert: '' }], select: [from, from] };
  }
  // Take one run of spaces with it: the one after, or before when it is the last piece.
  let from = a;
  let to = b;
  let j = b;
  while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
  const last = loc.index === loc.seq.pieces.length - 1;
  if (!last && j > b) to = j;
  else {
    let i = a;
    while (i > 0 && (src[i - 1] === ' ' || src[i - 1] === '\t')) i--;
    from = i;
  }
  return { patches: [{ from, to, insert: '' }], select: [from, from] };
}
