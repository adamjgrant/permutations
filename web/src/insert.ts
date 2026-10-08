// Edits that create structure around or after one piece: turn a piece into a choice (or make it
// optional), and insert a reference after a piece. Like everything in patch.ts, the result is a
// set of text patches against the source; the source is never regenerated.

import { compile, visit } from '../../src/index';
import type { Node, SeqNode, TextNode } from '../../src/core/types';
import { EditResult, formAt, longLine } from './patch';
import { isReservedLine } from '../../src/core/longform';
import { escapeText, indentOf, indentUnit, isAtLineEnd, isAtLineStart, Range, trimRange } from './ranges';

/** A piece that can be wrapped or followed: plain text or a reference. */
export type WrapNode = Extract<Node, { kind: 'text' } | { kind: 'ref' }>;

const isWholeLine = (src: string, r: Range): boolean => isAtLineStart(src, r[0]) && isAtLineEnd(src, r[1]);

/**
 * Turn a piece into a choice with one more alternative: `X` becomes `[X|alt]`, or `[X|]` when
 * `alt` is null (an empty alternative makes X optional). A whole long-form line becomes a
 * `one of` block instead. `select` is the new alternative's text, for editing it straight away.
 */
export function wrapInChoice(src: string, node: WrapNode, alt: string | null): EditResult {
  const r = trimRange(src, node.range);
  const raw = src.slice(r[0], r[1]);
  if (formAt(src, r[0]) === 'long' && isWholeLine(src, r)) {
    const ind = indentOf(src, r[0]);
    const unit = indentUnit(src);
    const second = alt === null ? 'nothing' : longLine(alt);
    const insert = `one of\n${ind}${unit}${raw}\n${ind}${unit}${second}`;
    const at = r[0] + insert.length - second.length;
    return { patches: [{ from: r[0], to: r[1], insert }], select: [at, at + second.length] };
  }
  const second = alt === null ? '' : escapeText(alt, false);
  const insert = `[${raw}|${second}]`;
  const at = r[0] + raw.length + 2;
  return { patches: [{ from: r[0], to: r[1], insert }], select: [at, at + second.length] };
}

/** The range of the sequence piece that holds `node` (a transform or repeat around it counts). */
export function pieceRange(bodies: Node[], node: Node): Range | undefined {
  let best: Range | undefined;
  for (const body of bodies) {
    visit(body, (n) => {
      if (n.kind !== 'seq') return;
      for (const p of (n as SeqNode).pieces) {
        const pr = p.node.range;
        if (pr[0] <= node.range[0] && pr[1] >= node.range[1] && containsNode(p.node, node)) {
          if (!best || pr[1] - pr[0] <= best[1] - best[0]) best = pr;
        }
      }
    });
  }
  return best;
}

/** True when `inner` (matched by kind and source range, so any parse of the same text works) is in `outer`. */
function containsNode(outer: Node, inner: Node): boolean {
  let found = false;
  visit(outer, (n) => {
    if (n.kind === inner.kind && n.range[0] === inner.range[0] && n.range[1] === inner.range[1]) found = true;
  });
  return found;
}

/**
 * Insert a reference to `name` right after a piece. Inside a line this adds ` $name`. After a
 * whole long-form line it adds a `ref name` line at the same indent, except when that line is
 * itself an alternative of `one of` (or an any-order item): a sibling line there would be a new
 * alternative, so the reference joins the line instead (` $name`, or a `sequence` block for a
 * keyword or quoted line).
 */
export function insertReference(src: string, at: { range: Range; seq?: SeqNode; parent?: string }, name: string): EditResult {
  const r = trimRange(src, at.range);
  if (formAt(src, r[0]) === 'long' && isWholeLine(src, r)) {
    const lineIsAlternative = !!at.seq && at.seq.pieces.length === 1 && (at.parent === 'option' || at.parent === 'item');
    if (lineIsAlternative) {
      const text = src.slice(r[0], r[1]);
      if (!text.includes('\n') && !isReservedLine(text.trim()) && !text.trim().startsWith('"')) {
        const insert = ` $${name}`;
        return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + 1, r[1] + insert.length] };
      }
      // A keyword or quoted line (or a block): wrap it and the reference in a sequence.
      const ind = indentOf(src, r[0]);
      const unit = indentUnit(src);
      const body = text.split('\n').map((l, i) => (i === 0 ? ind + unit + l : unit + l)).join('\n');
      const insert = `sequence\n${body}\n${ind}${unit}ref ${name}`;
      return { patches: [{ from: r[0], to: r[1], insert }], select: [r[0] + insert.length - name.length, r[0] + insert.length] };
    }
    const line = `ref ${name}`;
    const insert = `\n${indentOf(src, r[0])}${line}`;
    return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + insert.length - line.length, r[1] + insert.length] };
  }
  const insert = ` $${name}`;
  return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + 1, r[1] + insert.length] };
}

/**
 * True when replacing [from, to) with `probe` (the words as a choice of themselves) prints the
 * same texts as before, so the new join points print the spaces they replace.
 */
function spacingKept(src: string, from: number, to: number, probe: string): boolean {
  try {
    const opts = { load: () => undefined };
    const before = compile(src, opts);
    const after = compile(src.slice(0, from) + probe + src.slice(to), opts);
    if (before.count > 2000n) return true;
    const a = new Set([...before.all()].map((o) => o.text));
    const b = new Set([...after.all()].map((o) => o.text));
    return a.size === b.size && [...a].every((t) => b.has(t));
  } catch {
    return true;
  }
}

/** The words of a text, as the Vary words dialog shows them. */
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== '');
}

/**
 * Make some words of a text run vary: words first..last become `[those words|alt]`, or
 * `[those words|]` when `alt` is null (optional), and the words around them stay as they were.
 * `select` is the new alternative, for editing it straight away.
 */
export function varyWords(src: string, node: TextNode, first: number, last: number, alt: string | null): EditResult | undefined {
  const parts = node.value.trim().split(/(\s+)/);
  const words = parts.filter((_, i) => i % 2 === 0);
  if (first < 0 || last >= words.length || first > last) return undefined;
  const before = parts.slice(0, first * 2).join('').trimEnd();
  const picked = parts.slice(first * 2, last * 2 + 1).join('');
  const after = parts.slice(last * 2 + 2).join('').trimStart();
  // Punctuation at the edges of the picked words stays outside the choice, so "Sam," varies
  // as [Sam|Alex], and every alternative keeps the comma.
  const m = /^([("“‘¿¡\[]*)([\s\S]*?)([.,;:!?)”’"…\]]*)$/u.exec(picked) as RegExpExecArray;
  const [lead, chosen, trail] = (m[2] as string) === '' ? ['', picked, ''] : [m[1] as string, m[2] as string, m[3] as string];
  const [from, to] = node.range;
  const second = alt === null ? '' : escapeText(alt, false);
  const group = `[${escapeText(chosen, false)}|${second}]`;
  // Outside the brackets a standalone & is plain text, so leave the words around as they were.
  const plain = (t: string, atStart: boolean): string => escapeText(t, atStart).replace(/\\&/g, '&');
  const head = before ? plain(before, isAtLineStart(src, from)) + ' ' : '';
  const open = lead ? plain(lead, !head && isAtLineStart(src, from)) : '';
  const close = trail ? plain(trail, false) : '';
  const build = (alternative: string): string => head + open + `[${escapeText(chosen, false)}|${alternative}]` + close + (after ? ' ' + plain(after, false) : '');
  let insert = build(second);
  let at = from + head.length + open.length + 1 + escapeText(chosen, false).length + 1;
  // The spaces around the new choice become join points, which print the delimiter in force. When
  // that is not a space (delimiter = "-"), the words around would change too: pin the spacing.
  if ((head || after) && !spacingKept(src, from, to, build(escapeText(chosen, false)))) {
    insert = `[${insert}; delimiter=" "]`;
    at += 1;
  }
  return { patches: [{ from, to, insert }], select: [at, at + second.length] };
}
