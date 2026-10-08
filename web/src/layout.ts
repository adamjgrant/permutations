// Pure chart layout. Takes the definitions of a program (syntax trees with source ranges)
// and returns boxes and edges in plain coordinates. No DOM, no randomness.
//
// Reading the chart: a sequence runs left to right; the alternatives of a choice are rows
// stacked top to bottom between two rails. `main` is drawn first, then a dashed divider
// labelled BRANCHES, then every other named definition. Dashed curved edges run from each
// reference pill to the definition it names.

import type { AnyOrderNode, GroupNode, Guard, Node, Option, Range, SeqNode, Tag } from '../../src/core/types';
import { visit } from '../../src/core/compile';
import { Alt, alternatives, isRangeText } from './patch';
import { trimRange } from './ranges';

export type BoxKind =
  | 'def'
  | 'frame'
  | 'row'
  | 'defLabel'
  | 'nsHeader'
  | 'sectionLabel'
  | 'text'
  | 'ref'
  | 'value'
  | 'empty'
  | 'tag'
  | 'guard'
  | 'range'
  | 'transform'
  | 'repeat'
  | 'anyorder'
  | 'delimiter';

/** Boxes that hold content. Containers (def, frame, row) may enclose these. */
export const LEAF_KINDS: ReadonlySet<BoxKind> = new Set<BoxKind>([
  'defLabel', 'nsHeader', 'sectionLabel', 'text', 'range', 'ref', 'value', 'empty', 'tag', 'guard', 'transform', 'repeat', 'anyorder', 'delimiter',
]);

export interface Box {
  id: string;
  kind: BoxKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text drawn in the box (possibly shortened). */
  label: string;
  /** Untruncated text. */
  full: string;
  /** Source range this box stands for. */
  range?: Range;
  /** The syntax node, for edits. For rows and frames this is the choice node. */
  node?: Node;
  /** Rows: index of the alternative inside its choice. */
  index?: number;
  /** Rows: id of the frame that holds them. */
  frameId?: string;
  /** Rows: number of alternatives in that choice. */
  count?: number;
  /** Frames: what the frame wraps. */
  frameOf?: 'group' | 'anyorder' | 'repeat' | 'transform';
  /** Namespace headers: the namespace and whether it is collapsed. */
  ns?: string;
  collapsed?: boolean;
  /** Pills: the definition name they point at. */
  target?: string;
  /** Defs and def labels: the definition name. */
  name?: string;
  /** Defs: the syntax the definition is written in. */
  form?: 'short' | 'long';
  /** Tag and guard chips: the syntax node they stand for. */
  tag?: Tag;
  guard?: Guard;
  /** Chips that deserve a warning style (a huge any-order group, a guard nobody sets). */
  warn?: boolean;
  /** Explains `warn`. */
  note?: string;
  /** Range boxes: how many values the range stands for. */
  values?: number;
  /** Definition labels: nothing refers to this branch, so its text never appears. */
  unused?: boolean;
  /** Definition labels: the branches that refer to this one. */
  usedBy?: string[];
  /** Leaves: the innermost alternative (row) the box sits in. */
  rowId?: string;
}

export interface Pt {
  x: number;
  y: number;
}

/** `joiner` is a label between two any-order items: & or the delimiter that joins them. */
export type EdgeKind = 'flow' | 'rail' | 'ref' | 'divider' | 'joiner';

export interface Edge {
  id: string;
  kind: EdgeKind;
  /** A flow edge between pieces written touching. */
  glued?: boolean;
  from: string | null;
  to: string | null;
  /** Polyline, or for kind 'ref' four points of a cubic Bezier. */
  points: Pt[];
  /** Text drawn on the edge, such as the delimiter that joins what the edge connects. */
  label?: string;
}

export interface Layout {
  boxes: Box[];
  edges: Edge[];
  width: number;
  height: number;
  /** Definition name to the id of its box. */
  defBoxes: Record<string, string>;
  dividerY?: number;
}

export interface LDef {
  name: string;
  body: Node;
  range: Range;
  form?: 'short' | 'long';
}

export type Measure = (text: string, kind: BoxKind) => number;

export interface LayoutInput {
  main: LDef;
  others: LDef[];
  /** The source the ranges index into. Used to trim ranges of alternatives. */
  source?: string;
  /** Namespaces drawn collapsed. */
  collapsed?: ReadonlySet<string>;
  measure?: Measure;
  /** The delimiter that needs no label (the program's own). */
  defaultDelimiter?: string;
  /** Names of every tag some option sets. A guard on any other name gets a hint. */
  knownTags?: ReadonlySet<string>;
  /** Width to fill before branch cards wrap to a new row (layout units). Default: one column. */
  wrapWidth?: number;
}

export const M = {
  margin: 28,
  gap: 24,
  /** Between pieces written touching (glued, with no delimiter): close, so they read as one word. */
  glueGap: 6,
  chipGap: 8,
  rowPadX: 4,
  rowPadY: 3,
  rowGap: 14,
  framePad: 12,
  frameTop: 8,
  frameTopHeader: 32,
  frameBottom: 14,
  textH: 34,
  pillH: 30,
  chipH: 20,
  defPad: 16,
  defLabelH: 22,
  defGap: 28,
  defControlsW: 0,
  unusedW: 74,
  maxTextW: 300,
};

/** "← main, opener" for a branch's card: who refers to it, at most two names and a count. */
export function usedByText(users: string[]): string {
  const shown = users.slice(0, 2).join(', ');
  return `← ${shown}${users.length > 2 ? `, +${users.length - 2}` : ''}`;
}

/** Rough text width for 13px UI text. The browser passes a canvas-based measure instead. */
export const estimateMeasure: Measure = (text, kind) => {
  const per = kind === 'defLabel' || kind === 'sectionLabel' ? 8 : kind === 'tag' || kind === 'guard' || kind === 'transform' || kind === 'repeat' || kind === 'delimiter' || kind === 'anyorder' ? 6.4 : 7;
  return text.length * per;
};

const PAD_X: Partial<Record<BoxKind, number>> = { text: 12, empty: 10, ref: 16, value: 16, defLabel: 0, nsHeader: 12, sectionLabel: 0 };
const HEIGHT: Partial<Record<BoxKind, number>> = { text: M.textH, empty: 26, ref: M.pillH, value: M.pillH, defLabel: M.defLabelH, nsHeader: 28, sectionLabel: 18 };

interface Block {
  w: number;
  h: number;
  /** Height of the centre line (where connectors attach) below the top. */
  cy: number;
  place(x: number, y: number): Placed;
}

interface Placed {
  first: string;
  last: string;
}

interface ChainItem {
  b: Block;
  gapBefore: number;
  link: boolean;
  /** Written touching the piece before it, so nothing joins them. */
  glued?: boolean;
  /** Delimiter drawn on the link edge that joins this item to the previous one. */
  label?: string;
}

export function layout(input: LayoutInput): Layout {
  const measure = input.measure ?? estimateMeasure;
  const source = input.source;
  const collapsed = input.collapsed ?? new Set<string>();
  const boxes: Box[] = [];
  const edges: Edge[] = [];
  const pills: { id: string; target: string }[] = [];
  let counter = 0;
  const nid = (p: string): string => `${p}${++counter}`;

  const trim = (r: Range): Range => (source === undefined ? r : trimRange(source, r));

  const truncate = (label: string, kind: BoxKind): string => {
    if (measure(label, kind) <= M.maxTextW) return label;
    let s = label;
    while (s.length > 1 && measure(s + '…', kind) > M.maxTextW) s = s.slice(0, -1);
    return s + '…';
  };

  const leaf = (kind: BoxKind, label: string, extra: Partial<Box> = {}): Block => {
    const shown = truncate(label, kind);
    const padX = PAD_X[kind] ?? 8;
    const h = HEIGHT[kind] ?? M.chipH;
    const w = Math.max(kind === 'text' ? 36 : kind === 'empty' ? 56 : 24, Math.ceil(measure(shown, kind)) + padX * 2);
    return {
      w,
      h,
      cy: h / 2,
      place(x, y) {
        const id = nid('b');
        boxes.push({ id, kind, x, y, w, h, label: shown, full: label, ...extra });
        if (kind === 'ref' && extra.target !== undefined) pills.push({ id, target: extra.target });
        return { first: id, last: id };
      },
    };
  };

  /** Blocks joined left to right on a common centre line. */
  const chain = (items: ChainItem[]): Block => {
    let w = 0;
    let above = 0;
    let below = 0;
    items.forEach((it, i) => {
      w += (i === 0 ? 0 : it.gapBefore) + it.b.w;
      above = Math.max(above, it.b.cy);
      below = Math.max(below, it.b.h - it.b.cy);
    });
    return {
      w,
      h: above + below,
      cy: above,
      place(x, y) {
        let cx = x;
        let first = '';
        let last = '';
        let prevEnd = x;
        items.forEach((it, i) => {
          if (i > 0) cx += it.gapBefore;
          const p = it.b.place(cx, y + above - it.b.cy);
          if (i === 0) first = p.first;
          else if (it.link) {
            const e: Edge = {
              id: nid('e'),
              kind: 'flow',
              from: last,
              to: p.first,
              points: [
                { x: prevEnd, y: y + above },
                { x: cx, y: y + above },
              ],
            };
            if (it.label !== undefined) e.label = it.label;
            if (it.glued) e.glued = true;
            edges.push(e);
          }
          last = p.last;
          cx += it.b.w;
          prevEnd = cx;
        });
        return { first, last };
      },
    };
  };

  const chip = (kind: BoxKind, label: string, extra: Partial<Box> = {}): Block => leaf(kind, label, extra);

  const tagLabel = (t: { name: string; value?: string | undefined }): string => '@' + t.name + (t.value !== undefined ? '=' + t.value : '');
  const guardLabel = (g: NonNullable<Option['guard']>): string =>
    g.kind === 'else' ? '@else:' : '@' + (g.negate ? '!' : '') + g.name + (g.value !== undefined ? '=' + g.value : '') + ':';
  /** The chip for a node's own settings: its delimiter, and what joins the final two (last). */
  const settingsLabel = (d: string | undefined, l: string | undefined): string | undefined =>
    d === undefined && l === undefined
      ? undefined
      : [d !== undefined ? 'delimiter ' + JSON.stringify(d) : '', l !== undefined ? 'last ' + JSON.stringify(l) : ''].filter(Boolean).join(' \u00B7 ');
  const defaultDelim = input.defaultDelimiter ?? ' ';
  const knownTags = input.knownTags;
  /** The delimiter in force below a node that sets `own`, or undefined when it is the default (nothing to label). */
  const effective = (own: string | undefined, inherited: string | undefined): string | undefined =>
    own === undefined ? inherited : own === defaultDelim ? undefined : own;
  const edgeText = (d: string): string => {
    const j = JSON.stringify(d);
    return j.length > 9 ? j.slice(0, 7) + '…"' : j;
  };
  const fact = (n: number): bigint => {
    let r = 1n;
    for (let i = 2n; i <= BigInt(n); i++) r *= i;
    return r;
  };

  // --- nodes ---------------------------------------------------------------

  const nodeBlock = (node: Node, d?: string): Block => {
    switch (node.kind) {
      case 'text':
        if (node.value === '') return leaf('empty', 'empty', { range: trim(node.range), node });
        return leaf('text', node.value, { range: node.range, node });
      case 'ref': {
        const label = '$' + node.path;
        if (node.target?.kind === 'def') return leaf('ref', label, { range: node.range, node, target: node.target.def.name });
        return leaf('value', label, { range: node.range, node });
      }
      case 'seq':
        return seqBlock(node, d);
      case 'group':
        return choiceBlock(node, d);
      case 'anyorder':
        return choiceBlock(node, d);
      case 'repeat': {
        const label = node.min === node.max ? `×${node.min}` : `×${node.min}..${node.max}`;
        // Copies are glued with no space unless a delimiter is set: right for hex codes, a
        // surprise for words. Flag it when the repeated part has spaces in it.
        let words = false;
        const seenDefs = new Set<string>();
        const scan = (root: Node): void =>
          visit(root, (n) => {
            // Two letters in a row make a word; ranges of single characters (hex digits) do not.
            if (n.kind === 'text' && /\p{L}{2}/u.test(n.value)) words = true;
            if ((n.kind === 'seq' && n.pieces.some((p, i) => i > 0 && p.join)) || n.kind === 'anyorder') words = true;
            if (n.kind === 'ref' && n.target?.kind === 'def' && !seenDefs.has(n.target.def.name)) {
              seenDefs.add(n.target.def.name);
              scan(n.target.def.body);
            }
          });
        scan(node.inner);
        const glued = node.delimiter === undefined && node.max > 1 && words;
        const chips: Block[] = [
          chip('repeat', label, {
            range: node.range,
            node,
            ...(glued ? { warn: true, note: 'The copies are joined with no space between them. Select this and use Delimiter… to separate them.' } : {}),
          }),
        ];
        const repeatSettings = settingsLabel(node.delimiter, node.last);
        if (repeatSettings) chips.push(chip('delimiter', repeatSettings, { range: node.range, node }));
        return wrapper(nodeBlock(node.inner, d), chips, 'repeat', node);
      }
      case 'transform': {
        const label = node.fns.length > 1 ? ':[' + node.fns.join('|') + ']' : ':' + node.fns[0];
        return wrapper(nodeBlock(node.inner, d), [chip('transform', label, { range: node.range, node })], 'transform', node);
      }
    }
  };

  const seqItems = (seq: SeqNode, fallbackRange: Range, d?: string): ChainItem[] => {
    if (seq.pieces.length === 0) return [{ b: leaf('empty', 'empty', { range: trim(fallbackRange), node: seq }), gapBefore: 0, link: false }];
    const here = effective(seq.joinDelim, d);
    const inner = effective(seq.scopeDelim, d);
    return seq.pieces.map((p, i) => {
      const item: ChainItem = { b: nodeBlock(p.node, inner), gapBefore: i > 0 && !p.join ? M.glueGap : M.gap, link: i > 0 };
      if (i > 0 && !p.join) item.glued = true;
      if (i > 0 && p.join && here !== undefined) {
        const label = edgeText(here);
        item.label = label;
        item.gapBefore = Math.max(M.gap, Math.ceil(measure(label, 'delimiter')) + 14);
      }
      return item;
    });
  };

  const seqBlock = (seq: SeqNode, d?: string): Block => {
    const items = seqItems(seq, seq.range, d);
    return items.length === 1 ? (items[0] as ChainItem).b : chain(items);
  };

  /** One row of a choice: optional guard chip, the sequence, then tag chips. */
  const rowContent = (alt: Alt, d?: string): Block => {
    const opt = alt.option;
    const range = alt.range;
    const items: ChainItem[] = [];
    if (opt?.guard) {
      const g = opt.guard;
      const extra: Partial<Box> = { range: g.range ?? trim(range), guard: g };
      if (g.kind === 'tag' && !g.negate && knownTags && !knownTags.has(g.name)) {
        extra.warn = true;
        extra.note = `No alternative sets the tag "${g.name}", so this guard can never match.`;
      } else if (g.kind === 'tag' && knownTags && !knownTags.has(g.name)) {
        extra.warn = true;
        extra.note = `No alternative sets the tag "${g.name}", so this guard always matches.`;
      }
      items.push({ b: chip('guard', guardLabel(g), extra), gapBefore: 0, link: false });
    }
    const rangeText = rangeLabel(alt);
    const body: ChainItem[] =
      rangeText !== undefined
        ? [{ b: leaf('range', rangeText, { range: trim(range), values: alt.count, ...(alt.option ? { node: alt.option.seq } : {}) }), gapBefore: 0, link: false }]
        : seqItems(alt.seq, range, d);
    body.forEach((it, i) => {
      items.push(i === 0 && items.length > 0 ? { ...it, gapBefore: M.chipGap, link: false } : it);
    });
    for (const t of opt?.tags ?? []) items.push({ b: chip('tag', tagLabel(t), { range: t.range ?? trim(range), tag: t }), gapBefore: M.chipGap, link: false });
    return chain(items);
  };

  /** The source text of a range alternative such as `0..9`, or undefined for ordinary alternatives. */
  const rangeLabel = (alt: Alt): string | undefined => {
    if (!alt.option) return undefined;
    const first = alt.option.seq.pieces[0]?.node;
    if (first?.kind !== 'text' || alt.option.seq.pieces.length !== 1) return undefined;
    if (source !== undefined) {
      const t = trim(alt.range);
      const text = source.slice(t[0], t[1]);
      if (isRangeText(text) && (alt.count > 1 || text !== first.value)) return text;
      return undefined;
    }
    return alt.count > 1 ? first.value + '..' : undefined;
  };

  const wrapper = (inner: Block, chips: Block[], frameOf: 'repeat' | 'transform', node: Node): Block => {
    const chipsW = chips.reduce((a, c, i) => a + c.w + (i ? M.chipGap : 0), 0);
    const w = Math.max(inner.w, chipsW) + M.framePad * 2;
    const top = M.frameTopHeader;
    const h = top + inner.h + M.frameBottom - 6;
    const cy = top + inner.cy;
    return {
      w,
      h,
      cy,
      place(x, y) {
        const id = nid('f');
        boxes.push({ id, kind: 'frame', x, y, w, h, label: '', full: '', range: node.range, node, frameOf });
        let cx = x + M.framePad;
        for (const c of chips) {
          c.place(cx, y + 6);
          cx += c.w + M.chipGap;
        }
        const p = inner.place(x + M.framePad, y + top);
        edges.push({ id: nid('e'), kind: 'flow', from: id, to: p.first, points: [{ x, y: y + cy }, { x: x + M.framePad, y: y + cy }] });
        edges.push({ id: nid('e'), kind: 'flow', from: p.last, to: id, points: [{ x: x + M.framePad + inner.w, y: y + cy }, { x: x + w, y: y + cy }] });
        return { first: id, last: id };
      },
    };
  };

  const choiceBlock = (node: GroupNode | AnyOrderNode, inherited?: string): Block => {
    const isAny = node.kind === 'anyorder';
    const d = effective(node.delimiter, inherited);
    const alts = alternatives(node);
    // A choice's delimiter reaches inside its alternatives; an any-order group's only joins its
    // items, and the pieces inside each item keep the delimiter around the group.
    const rows = alts.map((a) => {
      const content = rowContent(a, isAny ? inherited : d);
      return { content, w: content.w + M.rowPadX * 2, h: content.h + M.rowPadY * 2, cy: content.cy + M.rowPadY, range: trim(a.range) };
    });
    const chips: Block[] = [];
    if (isAny) {
      const n = node.items.length;
      const big = n > 7;
      const label = `${big ? '\u26A0 ' : ''}any order \u00B7 ${n}! = ${fact(n).toLocaleString('en-US')}`;
      const extra: Partial<Box> = { range: node.range, node };
      if (big) {
        extra.warn = true;
        extra.note = `${n} items give ${fact(n).toLocaleString('en-US')} orderings. Consider fewer items.`;
      }
      chips.push(chip('anyorder', label, extra));
    }
    const settings = settingsLabel(node.delimiter, node.kind === 'anyorder' ? node.last : undefined);
    if (settings) chips.push(chip('delimiter', settings, { range: node.range, node }));
    const chipsW = chips.reduce((a, c, i) => a + c.w + (i ? M.chipGap : 0), 0);
    const rowsW = rows.reduce((a, r) => Math.max(a, r.w), 0);
    const w = Math.max(rowsW, chipsW) + M.framePad * 2;
    const top = chips.length ? M.frameTopHeader : M.frameTop;
    const offsets: number[] = [];
    let yy = top;
    for (const r of rows) {
      offsets.push(yy);
      yy += r.h + M.rowGap;
    }
    const h = yy - M.rowGap + M.frameBottom;
    const firstCy = offsets[0]! + rows[0]!.cy;
    const lastCy = offsets[rows.length - 1]! + rows[rows.length - 1]!.cy;
    const cy = (firstCy + lastCy) / 2;
    return {
      w,
      h,
      cy,
      place(x, y) {
        const id = nid('f');
        boxes.push({ id, kind: 'frame', x, y, w, h, label: '', full: '', range: node.range, node, frameOf: isAny ? 'anyorder' : 'group' });
        let cx = x + M.framePad;
        for (const c of chips) {
          c.place(cx, y + 6);
          cx += c.w + M.chipGap;
        }
        rows.forEach((r, i) => {
          const ry = y + (offsets[i] as number);
          const rx = x + M.framePad;
          const rowId = nid('r');
          boxes.push({ id: rowId, kind: 'row', x: rx, y: ry, w: r.w, h: r.h, label: '', full: '', range: r.range, node, index: i, frameId: id, count: rows.length });
          const before = boxes.length;
          const p = r.content.place(rx + M.rowPadX, ry + M.rowPadY);
          // Leaves placed for this row belong to it, unless a nested row claimed them first.
          for (let k = before; k < boxes.length; k++) {
            const lb = boxes[k] as Box;
            if (LEAF_KINDS.has(lb.kind) && lb.rowId === undefined) lb.rowId = rowId;
          }
          if (isAny) {
            // Not a choice: every item is used, in some order. No rails, only what joins them.
            if (i > 0) edges.push({ id: nid('e'), kind: 'joiner', from: id, to: id, points: [{ x: rx + 14, y: ry - M.rowGap / 2 }], label: d !== undefined ? edgeText(d) : '&' });
            return;
          }
          const sy = ry + r.cy;
          edges.push({ id: nid('e'), kind: 'flow', from: id, to: p.first, points: [{ x, y: sy }, { x: rx + M.rowPadX, y: sy }] });
          edges.push({ id: nid('e'), kind: 'flow', from: p.last, to: id, points: [{ x: rx + M.rowPadX + r.content.w, y: sy }, { x: x + w, y: sy }] });
        });
        if (rows.length > 1 && !isAny) {
          edges.push({ id: nid('e'), kind: 'rail', from: id, to: id, points: [{ x, y: y + firstCy }, { x, y: y + lastCy }] });
          edges.push({ id: nid('e'), kind: 'rail', from: id, to: id, points: [{ x: x + w, y: y + firstCy }, { x: x + w, y: y + lastCy }] });
        }
        return { first: id, last: id };
      },
    };
  };

  // --- definitions ---------------------------------------------------------

  interface DefBlock {
    name: string;
    w: number;
    h: number;
    place(x: number, y: number): string;
  }

  const defBlock = (def: LDef, label: string): DefBlock => {
    const body = nodeBlock(def.body);
    const unused = def !== input.main && !usedNames.has(def.name);
    const users = def === input.main ? [] : (usedBy.get(def.name) ?? []);
    const title = leaf('defLabel', label, {
      name: def.name,
      range: def.range,
      ...(def.form ? { form: def.form } : {}),
      ...(unused ? { unused: true } : {}),
      ...(users.length ? { usedBy: users } : {}),
    });
    const usedW = users.length ? Math.min(220, measure(usedByText(users), 'tag') + 22) : 0;
    const w = Math.max(title.w + 24 + M.defControlsW + (unused ? M.unusedW : 0) + usedW, body.w) + M.defPad * 2;
    const h = M.defPad + title.h + 10 + body.h + M.defPad;
    return {
      name: def.name,
      w,
      h,
      place(x, y) {
        const id = nid('d');
        boxes.push({ id, kind: 'def', x, y, w, h, label, full: label, name: def.name, range: def.range, ...(def.form ? { form: def.form } : {}) });
        title.place(x + M.defPad, y + M.defPad);
        body.place(x + M.defPad, y + M.defPad + title.h + 10);
        return id;
      },
    };
  };

  // Which branches something refers to (main always runs, so it counts as used).
  const usedNames = new Set<string>();
  const usedBy = new Map<string, string[]>();
  for (const d of [input.main, ...input.others]) {
    const user = d.name === '<main>' ? 'main' : d.name;
    visit(d.body, (n) => {
      if (n.kind !== 'ref' || n.target?.kind !== 'def') return;
      const name = n.target.def.name;
      usedNames.add(name);
      const list = usedBy.get(name) ?? [];
      if (!list.includes(user)) list.push(user);
      usedBy.set(name, list);
    });
  }
  const mainName = input.main.name === '<main>' ? 'main' : input.main.name;
  const mainBlock = defBlock(input.main, mainName);

  // Group the other definitions: namespaced names (`letters.B`) cluster under one header.
  type Entry = { kind: 'def'; def: LDef } | { kind: 'ns'; ns: string; members: LDef[] };
  const entries: Entry[] = [];
  const seenNs = new Set<string>();
  for (const d of input.others) {
    const dot = d.name.lastIndexOf('.');
    if (dot === -1) {
      entries.push({ kind: 'def', def: d });
      continue;
    }
    const ns = d.name.slice(0, dot);
    if (seenNs.has(ns)) continue;
    seenNs.add(ns);
    entries.push({ kind: 'ns', ns, members: input.others.filter((o) => o.name.lastIndexOf('.') !== -1 && o.name.slice(0, o.name.lastIndexOf('.')) === ns) });
  }

  interface Item {
    w: number;
    h: number;
    /** Names of the definitions in this item (a namespace column holds several). */
    names: string[];
    place(x: number, y: number): void;
  }
  const items: Item[] = [];
  const defBoxes: Record<string, string> = {};
  const nsBoxes: Record<string, string> = {};
  const hiddenInNs: Record<string, string> = {};

  for (const e of entries) {
    if (e.kind === 'def') {
      const b = defBlock(e.def, e.def.name);
      items.push({ w: b.w, h: b.h, names: [b.name], place: (x, y) => void (defBoxes[b.name] = b.place(x, y)) });
      continue;
    }
    // A namespace is one column: its header, then its members indented under it.
    const isCollapsed = collapsed.has(e.ns);
    const header = leaf('nsHeader', `${isCollapsed ? '▸' : '▾'} ${e.ns}  (${e.members.length})`, { ns: e.ns, collapsed: isCollapsed });
    if (isCollapsed) for (const m of e.members) hiddenInNs[m.name] = e.ns;
    const members = isCollapsed ? [] : e.members.map((m) => defBlock(m, m.name));
    const indent = 24;
    const w = Math.max(header.w, ...members.map((m) => m.w + indent));
    const h = header.h + members.reduce((acc, m) => acc + M.defGap + m.h, 0);
    items.push({
      w,
      h,
      names: e.members.map((m) => m.name),
      place: (x, y) => {
        nsBoxes[e.ns] = header.place(x, y).first;
        let yy = y + header.h;
        for (const m of members) {
          yy += M.defGap;
          defBoxes[m.name] = m.place(x + indent, yy);
          yy += m.h;
        }
      },
    });
  }

  // --- placement: main on top, then the branches in rows that wrap ------------
  const wrap = Math.max(mainBlock.w, input.wrapWidth !== undefined ? input.wrapWidth - M.margin * 2 : 0);
  let width = mainBlock.w;
  for (const it of items) width = Math.max(width, it.w);

  // Rows of cards ("shelves"): their top edges, and which shelf each definition sits on (main is -1).
  const shelfTops: number[] = [];
  const shelfOf: Record<string, number> = {};
  let y = M.margin;
  mainBlock.place(M.margin, y);
  defBoxes[mainBlock.name] = boxes.find((b) => b.kind === 'def')!.id;
  y += mainBlock.h;

  let dividerY: number | undefined;
  if (items.length) {
    y += 36;
    dividerY = y;
    const lab = leaf('sectionLabel', 'BRANCHES');
    lab.place(M.margin, y - lab.h / 2);
    y += 28;
    let x = M.margin;
    let rowH = 0;
    shelfTops.push(y);
    for (const it of items) {
      if (x > M.margin && x - M.margin + it.w > wrap) {
        y += rowH + M.defGap;
        x = M.margin;
        rowH = 0;
        shelfTops.push(y);
      }
      for (const n of it.names) shelfOf[n] = shelfTops.length - 1;
      it.place(x, y);
      width = Math.max(width, x - M.margin + it.w);
      x += it.w + M.defGap;
      rowH = Math.max(rowH, it.h);
    }
    y += rowH;
    edges.push({ id: nid('e'), kind: 'divider', from: null, to: null, points: [{ x: M.margin + lab.w + 12, y: dividerY }, { x: M.margin + Math.max(width, 300), y: dividerY }] });
  }
  width = Math.max(width + M.margin * 2, 360);
  const height = y + M.margin;

  // Reference edges: pill -> the definition box (or the collapsed namespace header). They run
  // through the gaps between cards: into the gap above the next row of cards, or down the left
  // margin to rows further away, so they do not cut across other cards.
  const byId = new Map(boxes.map((b) => [b.id, b]));
  // The gap above shelf k. Above the first shelf the lane runs between main and the divider.
  const laneBase = (k: number): number => (k === 0 ? (dividerY ?? shelfTops[0]! - 28) - 18 : shelfTops[k]! - M.defGap / 2);
  const laneUse = new Map<number, number>();
  const lane = (k: number): number => {
    const n = laneUse.get(k) ?? 0;
    laneUse.set(k, n + 1);
    // Spread edges that share a lane a little, so each stays traceable.
    return laneBase(k) + ((n % 3) - 1) * 4;
  };
  const shelfOfBox = (b: Box): number => {
    for (const [name, id] of Object.entries(defBoxes)) {
      const d = byId.get(id);
      if (d && b.x >= d.x && b.y >= d.y && b.x + b.w <= d.x + d.w && b.y + b.h <= d.y + d.h) return name === mainBlock.name ? -1 : (shelfOf[name] ?? -1);
    }
    return -1;
  };
  // Leaving a pill downward: straight down, unless another box sits under it in the same card,
  // in which case the line steps out to the right of the choice first, so it does not run
  // through that box and look like a link between the two.
  const exitDown = (pill: Box): Pt[] => {
    const cx = pill.x + pill.w / 2;
    const card = boxes.find((d) => d.kind === 'def' && pill.x >= d.x && pill.y >= d.y && pill.x + pill.w <= d.x + d.w && pill.y + pill.h <= d.y + d.h);
    const blocked = boxes.some(
      (b) => b.id !== pill.id && LEAF_KINDS.has(b.kind) && b.y >= pill.y + pill.h - 1 && b.x <= cx && b.x + b.w >= cx && (!card || (b.y + b.h <= card.y + card.h && b.x >= card.x && b.x + b.w <= card.x + card.w)),
    );
    if (!blocked) return [{ x: cx, y: pill.y + pill.h }];
    const frame = boxes
      .filter((f) => f.kind === 'frame' && pill.x >= f.x && pill.y >= f.y && pill.x + pill.w <= f.x + f.w && pill.y + pill.h <= f.y + f.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const y = pill.y + pill.h / 2;
    const ex = frame ? frame.x + frame.w + 6 : pill.x + pill.w + 10;
    return [{ x: pill.x + pill.w, y }, { x: ex, y }];
  };
  const targetOrder = new Map<string, number>();
  for (const p of pills) {
    const pill = byId.get(p.id) as Box;
    const ns = hiddenInNs[p.target];
    const targetId = ns !== undefined ? nsBoxes[ns] : defBoxes[p.target];
    const target = targetId ? byId.get(targetId) : undefined;
    if (!target) continue;
    if (!targetOrder.has(target.id)) targetOrder.set(target.id, targetOrder.size);
    const from = shelfOfBox(pill);
    const to = target.id === defBoxes[mainBlock.name] ? -1 : (shelfOf[p.target] ?? shelfOfBox(target));
    const atColumnTop = to >= 0 && Math.abs(target.y - shelfTops[to]!) < 1;
    const entryY = target.y + Math.min(26, target.h / 2);
    const gutter = 6 + ((targetOrder.get(target.id) ?? 0) % 4) * 3;
    let pts: Pt[];
    if (to === from && target.y < pill.y && target.y + target.h > pill.y) {
      // Side by side on one row: a short sideways connector into the card's header.
      const right = target.x > pill.x;
      const s0: Pt = { x: right ? pill.x + pill.w : pill.x, y: pill.y + pill.h / 2 };
      const t0: Pt = { x: right ? target.x : target.x + target.w, y: entryY };
      const mx = right ? Math.max(s0.x + 12, target.x - M.defGap / 2) : Math.min(s0.x - 12, target.x + target.w + M.defGap / 2);
      pts = [s0, { x: mx, y: s0.y }, { x: mx, y: t0.y }, t0];
    } else if (to === from + 1 && atColumnTop) {
      // The next row down: drop into the gap above it, then into the top of the card.
      const head = exitDown(pill);
      const sx = head[head.length - 1]!.x;
      const tx = target.x + Math.min(28, target.w / 2);
      const ly = lane(to);
      pts = [...head, { x: sx, y: ly }, { x: tx, y: ly }, { x: tx, y: target.y }];
    } else if (to > from) {
      // Further down: through the gap under this row, down the left margin, along the gap above
      // the target's row, and into the card from above (or from beside, inside a namespace column).
      const head = exitDown(pill);
      const sx = head[head.length - 1]!.x;
      const l1 = lane(from + 1);
      const l2 = lane(to);
      if (atColumnTop) {
        const tx = target.x + Math.min(28, target.w / 2);
        pts = [...head, { x: sx, y: l1 }, { x: gutter, y: l1 }, { x: gutter, y: l2 }, { x: tx, y: l2 }, { x: tx, y: target.y }];
      } else {
        const gx = target.x - Math.min(M.defGap / 2, 10);
        pts = [...head, { x: sx, y: l1 }, { x: gutter, y: l1 }, { x: gutter, y: l2 }, { x: gx, y: l2 }, { x: gx, y: entryY }, { x: target.x, y: entryY }];
      }
    } else {
      // Up to an earlier row (or to main): through the gap above this row, up the left margin,
      // and into the card from its left side.
      const p0: Pt = { x: pill.x + pill.w / 2, y: pill.y };
      const ly = from >= 0 ? lane(from) : pill.y - 12;
      pts = [p0, { x: p0.x, y: ly }, { x: gutter, y: ly }, { x: gutter, y: entryY }, { x: target.x, y: entryY }];
    }
    edges.push({ id: nid('e'), kind: 'ref', from: p.id, to: target.id, points: pts });
  }

  const out: Layout = { boxes, edges, width, height, defBoxes };
  if (dividerY !== undefined) out.dividerY = dividerY;
  return out;
}
