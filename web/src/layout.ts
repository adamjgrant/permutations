// Pure chart layout. Takes the definitions of a program (syntax trees with source ranges)
// and returns boxes and edges in plain coordinates. No DOM, no randomness.
//
// Reading the chart: a sequence runs left to right; the alternatives of a choice are rows
// stacked top to bottom between two rails. `main` is drawn first, then a dashed divider
// labelled BRANCHES, then every other named definition. Dashed curved edges run from each
// reference pill to the definition it names.

import type { AnyOrderNode, GroupNode, Node, Option, Range, SeqNode } from '../../src/core/types';
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
  | 'transform'
  | 'repeat'
  | 'anyorder'
  | 'delimiter';

/** Boxes that hold content. Containers (def, frame, row) may enclose these. */
export const LEAF_KINDS: ReadonlySet<BoxKind> = new Set<BoxKind>([
  'defLabel', 'nsHeader', 'sectionLabel', 'text', 'ref', 'value', 'empty', 'tag', 'guard', 'transform', 'repeat', 'anyorder', 'delimiter',
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
}

export interface Pt {
  x: number;
  y: number;
}

export type EdgeKind = 'flow' | 'rail' | 'ref' | 'divider';

export interface Edge {
  id: string;
  kind: EdgeKind;
  from: string | null;
  to: string | null;
  /** Polyline, or for kind 'ref' four points of a cubic Bezier. */
  points: Pt[];
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
}

export const M = {
  margin: 28,
  gap: 24,
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
  maxTextW: 300,
};

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
            edges.push({
              id: nid('e'),
              kind: 'flow',
              from: last,
              to: p.first,
              points: [
                { x: prevEnd, y: y + above },
                { x: cx, y: y + above },
              ],
            });
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
  const delimLabel = (d: string): string => 'delimiter ' + JSON.stringify(d);

  // --- nodes ---------------------------------------------------------------

  const nodeBlock = (node: Node): Block => {
    switch (node.kind) {
      case 'text':
        return leaf('text', node.value, { range: node.range, node });
      case 'ref': {
        const label = '$' + node.path;
        if (node.target?.kind === 'def') return leaf('ref', label, { range: node.range, node, target: node.target.def.name });
        return leaf('value', label, { range: node.range, node });
      }
      case 'seq':
        return seqBlock(node);
      case 'group':
        return choiceBlock(node);
      case 'anyorder':
        return choiceBlock(node);
      case 'repeat': {
        const label = node.min === node.max ? `×${node.min}` : `×${node.min}..${node.max}`;
        const chips: Block[] = [chip('repeat', label, { range: node.range, node })];
        if (node.delimiter !== undefined) chips.push(chip('delimiter', delimLabel(node.delimiter), { range: node.range, node }));
        return wrapper(nodeBlock(node.inner), chips, 'repeat', node);
      }
      case 'transform': {
        const label = node.fns.length > 1 ? ':[' + node.fns.join('|') + ']' : ':' + node.fns[0];
        return wrapper(nodeBlock(node.inner), [chip('transform', label, { range: node.range, node })], 'transform', node);
      }
    }
  };

  const seqItems = (seq: SeqNode, fallbackRange: Range): ChainItem[] => {
    if (seq.pieces.length === 0) return [{ b: leaf('empty', 'empty', { range: trim(fallbackRange), node: seq }), gapBefore: 0, link: false }];
    return seq.pieces.map((p, i) => ({ b: nodeBlock(p.node), gapBefore: M.gap, link: i > 0 }));
  };

  const seqBlock = (seq: SeqNode): Block => {
    const items = seqItems(seq, seq.range);
    return items.length === 1 ? (items[0] as ChainItem).b : chain(items);
  };

  /** One row of a choice: optional guard chip, the sequence, then tag chips. */
  const rowContent = (seq: SeqNode, range: Range, opt?: Option): Block => {
    const items: ChainItem[] = [];
    if (opt?.guard) items.push({ b: chip('guard', guardLabel(opt.guard), { range: trim(range) }), gapBefore: 0, link: false });
    const body = seqItems(seq, range);
    body.forEach((it, i) => {
      items.push(i === 0 && items.length > 0 ? { ...it, gapBefore: M.chipGap, link: false } : it);
    });
    for (const t of opt?.tags ?? []) items.push({ b: chip('tag', tagLabel(t), { range: trim(range) }), gapBefore: M.chipGap, link: false });
    return chain(items);
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

  const choiceBlock = (node: GroupNode | AnyOrderNode): Block => {
    const isAny = node.kind === 'anyorder';
    const alts: { seq: SeqNode; range: Range; opt?: Option }[] = isAny
      ? node.items.map((s) => ({ seq: s, range: s.range }))
      : node.options.map((o) => ({ seq: o.seq, range: o.range, opt: o }));
    const rows = alts.map((a) => {
      const content = rowContent(a.seq, a.range, a.opt);
      return { content, w: content.w + M.rowPadX * 2, h: content.h + M.rowPadY * 2, cy: content.cy + M.rowPadY, range: trim(a.range) };
    });
    const chips: Block[] = [];
    if (isAny) chips.push(chip('anyorder', 'any order', { range: node.range, node }));
    if (node.delimiter !== undefined) chips.push(chip('delimiter', delimLabel(node.delimiter), { range: node.range, node }));
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
          boxes.push({ id: nid('r'), kind: 'row', x: rx, y: ry, w: r.w, h: r.h, label: '', full: '', range: r.range, node, index: i, frameId: id, count: rows.length });
          const p = r.content.place(rx + M.rowPadX, ry + M.rowPadY);
          const sy = ry + r.cy;
          edges.push({ id: nid('e'), kind: 'flow', from: id, to: p.first, points: [{ x, y: sy }, { x: rx + M.rowPadX, y: sy }] });
          edges.push({ id: nid('e'), kind: 'flow', from: p.last, to: id, points: [{ x: rx + M.rowPadX + r.content.w, y: sy }, { x: x + w, y: sy }] });
        });
        if (rows.length > 1) {
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
    const title = leaf('defLabel', label, { name: def.name, range: def.range });
    const w = Math.max(title.w, body.w) + M.defPad * 2;
    const h = M.defPad + title.h + 10 + body.h + M.defPad;
    return {
      name: def.name,
      w,
      h,
      place(x, y) {
        const id = nid('d');
        boxes.push({ id, kind: 'def', x, y, w, h, label, full: label, name: def.name, range: def.range });
        title.place(x + M.defPad, y + M.defPad);
        body.place(x + M.defPad, y + M.defPad + title.h + 10);
        return id;
      },
    };
  };

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
    indent: number;
    w: number;
    h: number;
    place(x: number, y: number): void;
  }
  const items: Item[] = [];
  const defBoxes: Record<string, string> = {};
  const nsBoxes: Record<string, string> = {};
  const hiddenInNs: Record<string, string> = {};

  for (const e of entries) {
    if (e.kind === 'def') {
      const b = defBlock(e.def, e.def.name);
      items.push({ indent: 0, w: b.w, h: b.h, place: (x, y) => void (defBoxes[b.name] = b.place(x, y)) });
      continue;
    }
    const isCollapsed = collapsed.has(e.ns);
    const header = leaf('nsHeader', `${isCollapsed ? '▸' : '▾'} ${e.ns}  (${e.members.length})`, { ns: e.ns, collapsed: isCollapsed });
    items.push({
      indent: 0,
      w: header.w,
      h: header.h,
      place: (x, y) => void (nsBoxes[e.ns] = header.place(x, y).first),
    });
    if (isCollapsed) {
      for (const m of e.members) hiddenInNs[m.name] = e.ns;
      continue;
    }
    for (const m of e.members) {
      const b = defBlock(m, m.name);
      items.push({ indent: 24, w: b.w, h: b.h, place: (x, y) => void (defBoxes[b.name] = b.place(x, y)) });
    }
  }

  // --- vertical stacking ---------------------------------------------------
  let width = mainBlock.w;
  for (const it of items) width = Math.max(width, it.w + it.indent);
  width += M.margin * 2;
  width = Math.max(width, 360);

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
    edges.push({ id: nid('e'), kind: 'divider', from: null, to: null, points: [{ x: M.margin + lab.w + 12, y }, { x: width - M.margin, y }] });
    y += 28;
    for (const it of items) {
      it.place(M.margin + it.indent, y);
      y += it.h + M.defGap;
    }
    y -= M.defGap;
  }
  const height = y + M.margin;

  // Reference edges: pill -> the definition box (or the collapsed namespace header).
  const byId = new Map(boxes.map((b) => [b.id, b]));
  for (const p of pills) {
    const pill = byId.get(p.id) as Box;
    const ns = hiddenInNs[p.target];
    const targetId = ns !== undefined ? nsBoxes[ns] : defBoxes[p.target];
    const target = targetId ? byId.get(targetId) : undefined;
    if (!target) continue;
    const p0: Pt = { x: pill.x + pill.w / 2, y: pill.y + pill.h };
    const tx = target.x + Math.min(28, target.w / 2);
    let pts: Pt[];
    if (target.y >= p0.y) {
      const d = Math.max(36, (target.y - p0.y) / 2);
      pts = [p0, { x: p0.x, y: p0.y + d }, { x: tx, y: target.y - d }, { x: tx, y: target.y }];
    } else {
      const q0: Pt = { x: pill.x + pill.w / 2, y: pill.y };
      const ty = target.y + target.h;
      const d = Math.max(36, (q0.y - ty) / 2);
      pts = [q0, { x: q0.x, y: q0.y - d }, { x: tx, y: ty + d }, { x: tx, y: ty }];
    }
    edges.push({ id: nid('e'), kind: 'ref', from: p.id, to: target.id, points: pts });
  }

  const out: Layout = { boxes, edges, width, height, defBoxes };
  if (dividerY !== undefined) out.dividerY = dividerY;
  return out;
}
