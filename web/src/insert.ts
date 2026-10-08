// Edits that create structure around or after one piece: turn a piece into a choice (or make it
// optional), and insert a reference after a piece. Like everything in patch.ts, the result is a
// set of text patches against the source; the source is never regenerated.

import { compile, visit } from '../../src/index';
import type { Node, SeqNode, TextNode } from '../../src/core/types';
import { EditResult, formAt, longLine, withReferences } from './patch';
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
  return insertAfter(src, at, `$${name}`, `ref ${name}`);
}

/** Insert typed text right after a piece. `$name` of a branch in it becomes a reference. */
export function insertText(src: string, at: { range: Range; seq?: SeqNode; parent?: string }, text: string, branches?: ReadonlySet<string>): EditResult {
  return insertAfter(src, at, withReferences(escapeText(text.trim(), false), branches), withReferences(longLine(text.trim()), branches));
}

/**
 * Insert right after a piece: `short` (a short-form snippet, `$name` or text) inside a line, or
 * `line` (a whole long-form line, `ref name`) after a whole long-form line.
 */
function insertAfter(src: string, at: { range: Range; seq?: SeqNode; parent?: string }, short: string, line: string): EditResult {
  const r = trimRange(src, at.range);
  if (formAt(src, r[0]) === 'long' && isWholeLine(src, r)) {
    const lineIsAlternative = !!at.seq && at.seq.pieces.length === 1 && (at.parent === 'option' || at.parent === 'item');
    if (lineIsAlternative) {
      const text = src.slice(r[0], r[1]);
      if (!text.includes('\n') && !isReservedLine(text.trim()) && !text.trim().startsWith('"')) {
        const insert = ` ${short}`;
        return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + 1, r[1] + insert.length] };
      }
      // A keyword or quoted line (or a block): wrap it and the new line in a sequence.
      const ind = indentOf(src, r[0]);
      const unit = indentUnit(src);
      const body = text.split('\n').map((l, i) => (i === 0 ? ind + unit + l : unit + l)).join('\n');
      const insert = `sequence\n${body}\n${ind}${unit}${line}`;
      return { patches: [{ from: r[0], to: r[1], insert }], select: [r[0] + insert.length - line.length, r[0] + insert.length] };
    }
    const insert = `\n${indentOf(src, r[0])}${line}`;
    return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + insert.length - line.length, r[1] + insert.length] };
  }
  const insert = ` ${short}`;
  return { patches: [{ from: r[1], to: r[1], insert }], select: [r[1] + 1, r[1] + insert.length] };
}

/**
 * Add text or a reference at the end of a branch. A bracket-free choice is bracketed first, so
 * what is added follows the whole choice rather than joining its last alternative.
 */
export function appendToBranch(
  src: string,
  def: { body: Node; range: Range; form?: 'short' | 'long' | undefined },
  value: { ref: string } | { text: string; branches?: ReadonlySet<string> },
): EditResult {
  const short = 'ref' in value ? `$${value.ref}` : withReferences(escapeText(value.text.trim(), false), value.branches);
  const line = 'ref' in value ? `ref ${value.ref}` : withReferences(longLine(value.text.trim()), value.branches);
  if (def.form === 'long') {
    // After the last line of the body, at the body's indent.
    const end = trimRange(src, def.range)[1];
    const first = src.indexOf('\n', def.range[0]);
    const bodyIndent = first === -1 ? indentUnit(src) : (/^[ \t]*/.exec(src.slice(first + 1)) as RegExpExecArray)[0];
    const insert = `\n${bodyIndent}${line}`;
    return { patches: [{ from: end, to: end, insert }], select: [end + insert.length - line.length, end + insert.length] };
  }
  const [b0, b1] = trimRange(src, def.body.range);
  if (def.body.kind === 'group' && def.body.bare) {
    const insert = ` ${short}`;
    return {
      patches: [
        { from: b0, to: b0, insert: '[' },
        { from: b1, to: b1, insert: ']' + insert },
      ],
      select: [b1 + 2 + 1, b1 + 2 + insert.length],
    };
  }
  const insert = ` ${short}`;
  return { patches: [{ from: b1, to: b1, insert }], select: [b1 + 1, b1 + insert.length] };
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
 * The punctuation at the edges of a run of words, which stays outside a choice made of them
 * ("Sam," varies as [Sam|Alex],). All punctuation is the core when nothing else is left.
 */
export function splitEdges(words: string): { lead: string; core: string; trail: string } {
  const m = /^([("“‘¿¡\[]*)([\s\S]*?)([.,;:!?)”’"…\]]*)$/u.exec(words) as RegExpExecArray;
  if ((m[2] as string) === '') return { lead: '', core: words, trail: '' };
  return { lead: m[1] as string, core: m[2] as string, trail: m[3] as string };
}

/**
 * Make some words of a text run vary: words first..last become `[those words|alt]`, or
 * `[those words|]` when `alt` is null (optional), and the words around them stay as they were.
 * Punctuation at the edges stays outside the choice, and a line break next to the words stays
 * a line break. `select` is the new alternative, for editing it straight away.
 */
export function varyWords(src: string, node: TextNode, first: number, last: number, alt: string | null): EditResult | undefined {
  const parts = node.value.trim().split(/(\s+)/);
  const words = parts.filter((_, i) => i % 2 === 0);
  if (first < 0 || last >= words.length || first > last) return undefined;
  const sepBefore = first > 0 ? (parts[first * 2 - 1] as string) : '';
  const sepAfter = last * 2 + 1 < parts.length ? (parts[last * 2 + 1] as string) : '';
  const before = parts.slice(0, Math.max(0, first * 2 - 1)).join('');
  const picked = parts.slice(first * 2, last * 2 + 1).join('');
  const after = parts.slice(last * 2 + 2).join('');
  const { lead, core: chosen, trail } = splitEdges(picked);
  const [from, to] = node.range;
  const second = alt === null ? '' : escapeText(alt, false);
  // Outside the brackets a standalone & is plain text, so leave the words around as they were.
  const plain = (t: string, atStart: boolean): string => escapeText(t, atStart).replace(/\\&/g, '&');
  // Next to the choice, a space is a join point; a line break is kept as text, glued to it.
  const head = before ? (sepBefore.includes('\n') ? plain(before + sepBefore, isAtLineStart(src, from)) : plain(before, isAtLineStart(src, from)) + ' ') : '';
  const tail = after ? (sepAfter.includes('\n') ? plain(sepAfter + after, false) : ' ' + plain(after, false)) : '';
  const open = lead ? plain(lead, !head && isAtLineStart(src, from)) : '';
  const close = trail ? plain(trail, false) : '';
  const build = (alternative: string): string => head + open + `[${escapeText(chosen, false)}|${alternative}]` + close + tail;
  let insert = build(second);
  let at = from + head.length + open.length + 1 + escapeText(chosen, false).length + 1;
  // The spaces around the new choice become join points, which print the delimiter in force. When
  // that is not a space (delimiter = "-"), the words around would change too: pin the spacing.
  if ((head || tail) && !spacingKept(src, from, to, build(escapeText(chosen, false)))) {
    insert = `[${insert}; delimiter=" "]`;
    at += 1;
  }
  return { patches: [{ from, to, insert }], select: [at, at + second.length] };
}
