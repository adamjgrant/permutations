// SVG view of a Layout. Draws boxes and edges, tracks selection and focus, and turns pointer
// and keyboard gestures into callbacks. It knows nothing about patches.
//
// Pointer model: click a box to select it (the action bar appears next to it), click a selected
// text box again or double-click it to edit, double-click a reference to go to its branch, click
// empty space to clear the selection. Nothing depends on hover.
//
// Keyboard model: the chart is one tab stop (roving tabindex), and selection follows focus.
// Arrow keys move between boxes, Enter runs the box's main action, Delete removes an alternative
// (or a tag or guard chip), Alt+Up/Down reorders, `+` adds an alternative, `t` and `g` add a tag
// or guard, Space adds the alternative to a multi-selection, Escape clears the selection, and Tab
// moves into the action bar.

import { Box, BoxKind, Edge, Layout, LEAF_KINDS, Measure, usedByText } from './layout';
import { Dir, focusable, inside, isChoiceFrame, navigate, readingOrder, rowContext, selectable } from './nav';
import { fromField, spoken, toField } from './visible';
import { alternatives } from './patch';
import type { Range } from './ranges';

const NS = 'http://www.w3.org/2000/svg';

export type DefAction = 'convert' | 'rename' | 'delete';

export interface RowCaps {
  tag: boolean;
  guard: boolean;
  move: boolean;
}

export interface ChartActions {
  /** True when the code currently parses and chart edits are allowed. */
  canEdit(): boolean;
  /** False for choices that cannot be edited structurally. */
  canRestructure(frame: Box): boolean;
  rowCaps(row: Box): RowCaps;
  /** Select a box. `bar` is false when the click opens something else (a chip's popover). */
  select(box: Box, extend: boolean, bar?: boolean): void;
  /** A box got keyboard focus: selection follows focus. */
  focused(box: Box): void;
  clearSelection(): void;
  /** Show the branch a reference points at. */
  gotoRef(box: Box): void;
  /** Inline editing started: hide anything floating over the chart. */
  editStarted(): void;
  /** Move keyboard focus to the strip's first action; false when it has none. */
  focusStrip(): boolean;
  /** Commit inline text for text, empty, range and reference boxes. Return a message to keep the field open. */
  commitText(box: Box, value: string): string | void;
  editChip(box: Box): void;
  removeChip(box: Box): void;
  /** Add an alternative to a choice, after alternative `after` (at the end when omitted). */
  addAlternative(frame: Box, after?: number): void;
  deleteAlternative(row: Box): void;
  moveAlternative(row: Box, delta: -1 | 1): void;
  /** Delete key: remove the selected piece, alternative or chip, or say why it cannot go. */
  deleteBox(box: Box): void;
  addTag(row: Box): void;
  addGuard(row: Box): void;
  toggleNamespace(ns: string): void;
  defAction(def: Box, action: DefAction): void;
  announce(message: string): void;
}

export interface FocusKey {
  kind: BoxKind;
  start: number;
  name?: string | undefined;
}

export interface EditContext {
  row?: Box | undefined;
  frame?: Box | undefined;
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
const FONTS: Partial<Record<BoxKind, string>> = {
  defLabel: `600 15px ${FONT}`,
  sectionLabel: `600 11px ${FONT}`,
  tag: `500 11px ${FONT}`,
  guard: `500 11px ${FONT}`,
  transform: `500 11px ${FONT}`,
  repeat: `500 11px ${FONT}`,
  anyorder: `500 11px ${FONT}`,
  delimiter: `500 11px ${FONT}`,
  range: `500 13px ${FONT}`,
  ref: `500 13px ${FONT}`,
  value: `500 13px ${FONT}`,
  nsHeader: `500 13px ${FONT}`,
  empty: `italic 12px ${FONT}`,
};

/** Measure text with the same fonts the CSS uses, so boxes fit their labels. */
export function canvasMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  return (text, kind) => {
    ctx.font = FONTS[kind] ?? `13px ${FONT}`;
    return ctx.measureText(text).width;
  };
}


const CHIP_TITLES: Partial<Record<BoxKind, string>> = {
  tag: 'Sets a tag when this alternative is chosen. Click to edit or remove it.',
  guard: 'Only available when the tag condition holds. Click to edit or remove it.',
  transform: 'Transform applied to the item',
  repeat: 'Repeat count',
  anyorder: 'Every ordering of these items',
  delimiter: 'Delimiter used to join here',
};

function describe(b: Box): string {
  switch (b.kind) {
    case 'text':
      return `Text: ${spoken(b.full)}`;
    case 'empty':
      return 'Empty alternative';
    case 'range':
      return `Range ${b.full}, ${b.values ?? 0} values`;
    case 'ref':
      return `Reference to ${b.target ?? b.full}`;
    case 'value':
      return `Host value ${b.full}`;
    case 'tag':
      return `Tag ${b.label}`;
    case 'guard':
      return `Guard ${b.label}${b.note ? '. ' + b.note : ''}`;
    case 'anyorder':
      return `${b.label}${b.note ? '. ' + b.note : ''}`;
    case 'defLabel':
      return `Branch ${b.label}`;
    case 'nsHeader':
      return `Namespace ${b.ns ?? ''}, ${b.collapsed ? 'collapsed' : 'expanded'}`;
    case 'delimiter':
      return `Settings: ${b.label}`;
    case 'repeat':
      return `Repeat ${b.label}`;
    case 'transform':
      return `Transform ${b.label}`;
    default:
      return `${b.kind} ${b.label}`;
  }
}

export class ChartView {
  private svg: SVGSVGElement | undefined;
  private layout: Layout | undefined;
  private elements = new Map<string, SVGElement>();
  private selected = new Set<string>();
  private ring: SVGRectElement | undefined;
  private input: HTMLInputElement | undefined;
  private focusId: string | undefined;
  private lastFocused: FocusKey | undefined;
  private context = new Set<string>();
  private mirror = false;
  /** Set while focus moves for a reason other than the user moving it (no selection change). */
  private quiet = false;
  /** The box the user last clicked. A click edits text only when it repeats a click on that box,
   *  never when the app moved the selection there (after an edit, from the code cursor). */
  private clickedId: string | undefined;
  scale = 1;
  fit = true;

  constructor(
    private host: HTMLElement,
    private actions: ChartActions,
  ) {
    // A click on the pane outside the drawing clears the selection.
    host.addEventListener('click', (ev) => {
      if (ev.target === host) this.actions.clearSelection();
    });
  }

  /** The element the chart draws into (the action bar and inline editor live here too). */
  get element(): HTMLElement {
    return this.host;
  }

  private measureCtx: CanvasRenderingContext2D | undefined;
  private measureText(text: string): number {
    this.measureCtx ??= document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    this.measureCtx.font = FONTS.tag ?? '500 11px sans-serif';
    return this.measureCtx.measureText(text).width;
  }

  /** ", alternative 2 of 3" (or item) for a screen reader, from the layout's row of a box. */
  private position(b: Box): string {
    if (b.rowId === undefined) return '';
    const row = this.rowById.get(b.rowId);
    if (!row) return '';
    const frame = this.frameById.get(row.frameId ?? '');
    return `, ${frame?.frameOf === 'anyorder' ? 'item' : 'alternative'} ${(row.index ?? 0) + 1} of ${row.count ?? 1}`;
  }
  private rowById = new Map<string, Box>();
  private frameById = new Map<string, Box>();

  get boxes(): Box[] {
    return this.layout?.boxes ?? [];
  }

  private byId(id: string | undefined): Box | undefined {
    return id ? this.boxes.find((b) => b.id === id) : undefined;
  }

  private focusedBox(): Box | undefined {
    const a = document.activeElement;
    if (!a || !this.svg?.contains(a)) return undefined;
    return this.byId(a.closest('[data-id]')?.getAttribute('data-id') ?? undefined);
  }

  /** True while keyboard focus is somewhere inside the chart. */
  hasFocus(): boolean {
    return !!this.svg && this.svg.contains(document.activeElement);
  }

  render(layout: Layout): void {
    this.cancelEdit();
    this.clickedId = undefined;
    this.layout = layout;
    this.rowById = new Map(layout.boxes.filter((b) => b.kind === 'row').map((b) => [b.id, b]));
    this.frameById = new Map(layout.boxes.filter((b) => b.kind === 'frame').map((b) => [b.id, b]));
    const avail = this.host.clientWidth - 8;
    // Fit shrinks a little at most: below this, text gets too small to read, so scroll instead.
    if (this.fit) this.scale = Math.max(0.8, Math.min(1, avail / layout.width));
    this.host.textContent = '';
    this.elements.clear();
    const svg = el('svg', {
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      width: Math.ceil(layout.width * this.scale),
      height: Math.ceil(layout.height * this.scale),
      class: 'chart-svg',
      role: 'group',
      tabindex: -1,
      focusable: 'false',
      'aria-label': 'Flow chart of the program. Arrow keys move between boxes, Enter edits, Delete removes.',
    });
    this.svg = svg;
    // With many references the lines tangle: then they show only for the selection or a trace.
    if (layout.edges.filter((e) => e.kind === 'ref').length > 8) svg.classList.add('many-refs');
    const back = el('g', { class: 'back' }, svg);
    const edgeLayer = el('g', { class: 'edges' }, svg);
    const refLayer = el('g', { class: 'refs' }, svg);
    const fore = el('g', { class: 'fore' }, svg);
    this.ring = el('rect', { class: 'focus-ring', rx: 8, visibility: 'hidden', 'pointer-events': 'none' }, svg);

    for (const b of layout.boxes) {
      if (b.kind === 'def' || b.kind === 'frame' || b.kind === 'row') this.drawBox(b, back);
    }
    for (const e of layout.edges) this.drawEdge(e, e.kind === 'ref' ? refLayer : edgeLayer);
    for (const b of layout.boxes) {
      if (LEAF_KINDS.has(b.kind)) this.drawBox(b, fore);
    }
    this.initRoving();
    svg.addEventListener('click', (ev) => this.onClick(ev));
    svg.addEventListener('dblclick', (ev) => this.onDblClick(ev));
    svg.addEventListener('keydown', (ev) => this.onKey(ev));
    svg.addEventListener('focusin', (ev) => this.onFocusIn(ev));
    svg.addEventListener('focusout', (ev) => this.onFocusOut(ev));
    this.host.appendChild(svg);
    this.applySelection();
  }

  private drawEdge(e: Edge, parent: Element): void {
    const p = e.points;
    const first = p[0];
    if (!first) return;
    if (e.kind === 'ref') {
      const end = p[p.length - 1] ?? first;
      const path = el('path', { d: roundedPath(p, 10), class: 'edge ref', fill: 'none' }, parent);
      path.dataset['from'] = e.from ?? '';
      path.dataset['to'] = e.to ?? '';
      const dot = el('circle', { cx: end.x, cy: end.y, r: 3, class: 'ref-end' }, parent);
      dot.dataset['from'] = e.from ?? '';
      dot.dataset['to'] = e.to ?? '';
      return;
    }
    if (e.kind === 'joiner') {
      // Between two any-order items: what joins them (& when nothing but a space).
      const t = el('text', { x: first.x, y: first.y, class: 'joiner', 'text-anchor': 'start', 'dominant-baseline': 'central' }, parent);
      t.textContent = e.label ?? '&';
      el('title', {}, t).textContent = 'Every item is used, in every order, joined like this';
      return;
    }
    const d = 'M' + p.map((q) => `${q.x},${q.y}`).join(' L');
    const path = el('path', { d, class: 'edge ' + e.kind + (e.glued ? ' glued' : ''), fill: 'none' }, parent);
    if (e.glued) el('title', {}, path).textContent = 'Written touching, so nothing goes between these two';
    if (e.label !== undefined) {
      const last = p[p.length - 1] ?? first;
      const rail = e.kind === 'rail';
      const t = el('text', { x: rail ? first.x + 7 : (first.x + last.x) / 2, y: (first.y + last.y) / 2 - (rail ? 0 : 5), class: 'edge-label', 'text-anchor': rail ? 'start' : 'middle', 'dominant-baseline': rail ? 'central' : 'auto' }, parent);
      t.textContent = e.label;
      el('title', {}, t).textContent = 'Delimiter that joins the pieces here';
    }
  }

  private drawBox(b: Box, parent: Element): void {
    const g = el('g', { class: `box k-${b.kind}${b.warn ? ' warn' : ''}${b.frameOf ? ' f-' + b.frameOf : ''}`, 'data-id': b.id }, parent);
    this.elements.set(b.id, g);
    if (focusable(b)) {
      g.setAttribute('tabindex', '-1');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', describe(b) + this.position(b));
    } else if (isChoiceFrame(b)) {
      // Reached by clicking its background or with Shift+Up from inside; not on the arrow path.
      g.setAttribute('tabindex', '-1');
      g.setAttribute('role', 'group');
      // Alternatives as drawn: a range is one alternative, however many values it has.
      const n = b.node && (b.node.kind === 'group' || b.node.kind === 'anyorder') ? alternatives(b.node).length : 0;
      const plural = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
      g.setAttribute('aria-label', b.frameOf === 'anyorder' ? `Any order, ${plural(n, 'item', 'items')}` : `Choice of ${plural(n, 'alternative', 'alternatives')}`);
    }
    const rect = (rx: number): SVGRectElement => el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx }, g);
    const text = (cls = ''): void => {
      const t = el('text', { x: b.x + b.w / 2, y: b.y + b.h / 2 + 0.5, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      if (b.lines) {
        // Centred as a block: the first line goes up by half the extra height.
        const first = -((b.lines.length - 1) * 16) / 2;
        b.lines.forEach((line, i) => {
          const span = el('tspan', { x: b.x + b.w / 2, dy: i === 0 ? first : 16 }, t);
          span.textContent = line;
        });
      } else t.textContent = b.label;
      if (b.full !== b.label || b.lines) el('title', {}, g).textContent = b.full;
    };
    switch (b.kind) {
      case 'def':
        rect(14);
        break;
      case 'frame':
        rect(12);
        break;
      case 'row':
        rect(8);
        break;
      case 'text':
        rect(7);
        text();
        break;
      case 'range':
        rect(7);
        text();
        el('title', {}, g).textContent = `Range of ${b.values ?? 0} values. Double-click to edit the range.`;
        break;
      case 'ref':
        rect(b.h / 2);
        text();
        el('title', {}, g).textContent = `Reference to ${b.target ?? ''}. Double-click to go to it.`;
        break;
      case 'value':
        rect(b.h / 2);
        text();
        el('title', {}, g).textContent = 'Host value';
        break;
      case 'empty':
        rect(7);
        text();
        el('title', {}, g).textContent = 'Empty alternative';
        break;
      case 'defLabel': {
        const t = el('text', { x: b.x, y: b.y + b.h / 2 + 0.5, 'dominant-baseline': 'central' }, g);
        t.textContent = b.label;
        el('rect', { x: b.x - 4, y: b.y - 2, width: Math.max(b.w, 24) + 8, height: b.h + 4, rx: 5, class: 'hit' }, g);
        if (b.unused) {
          // Nothing refers to this branch, so its text never shows up in the results.
          const bx = b.x + b.w + 10;
          const badge = el('g', { class: 'unused-badge' }, g);
          el('rect', { x: bx, y: b.y + 2, width: 64, height: b.h - 4, rx: (b.h - 4) / 2 }, badge);
          el('text', { x: bx + 32, y: b.y + b.h / 2 + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, badge).textContent = 'not used';
          el('title', {}, g).textContent = 'Nothing refers to this branch, so it never appears in the results. Insert a reference to it, or delete it.';
        }
        if (b.usedBy?.length) {
          // Who refers to this branch, so you need not follow the dashed lines to find out.
          const label = usedByText(b.usedBy);
          const tw = Math.min(208, this.measureText(label));
          const bx = b.x + b.w + 10;
          const chip = el('g', { class: 'usedby-chip' }, g);
          el('rect', { x: bx, y: b.y + 2, width: tw + 14, height: b.h - 4, rx: (b.h - 4) / 2 }, chip);
          el('text', { x: bx + 7, y: b.y + b.h / 2 + 0.5, 'dominant-baseline': 'central' }, chip).textContent = label;
          el('title', {}, g).textContent = `Used by ${b.usedBy.join(', ')}`;
        }
        break;
      }
      case 'sectionLabel': {
        const t = el('text', { x: b.x, y: b.y + b.h / 2 + 0.5, 'dominant-baseline': 'central' }, g);
        t.textContent = b.label;
        break;
      }
      case 'nsHeader':
        rect(8);
        text();
        el('title', {}, g).textContent = b.collapsed ? 'Click to expand' : 'Click to collapse';
        break;
      default:
        rect(b.h / 2);
        text();
        el('title', {}, g).textContent = b.note ?? CHIP_TITLES[b.kind] ?? '';
    }
  }

  // --- selection and focus ---------------------------------------------------

  /** `mirror` marks the code cursor's box: shown, but not a selection you can act on. */
  setSelected(ids: string[], mirror = false): void {
    this.mirror = mirror;
    this.selected = new Set(ids);
    this.context = new Set();
    // Show what the selection acts on: its alternative and choice, or a reference's target.
    if (ids.length === 1) {
      const b = this.byId(ids[0]);
      const ctx = rowContext(this.boxes, b);
      // Outline the alternative only when it holds more than the selected box itself.
      if (ctx.row && ctx.row.id !== b?.id && b) {
        const others = this.boxes.some((x) => x.id !== b.id && focusable(x) && x.kind !== 'tag' && x.kind !== 'guard' && inside(x, ctx.row!));
        if (others) this.context.add(ctx.row.id);
      }
      if (ctx.frame && ctx.frame.id !== b?.id) this.context.add(ctx.frame.id);
      if (b?.kind === 'ref' && b.target) {
        const def = this.boxes.find((x) => x.kind === 'def' && x.name === b.target);
        if (def) this.context.add(def.id);
      }
    }
    this.applySelection();
  }

  isSelected(id: string): boolean {
    return this.selected.has(id);
  }

  private applySelection(): void {
    for (const [id, e] of this.elements) {
      const on = this.selected.has(id);
      e.classList.toggle('sel', on && !this.mirror);
      e.classList.toggle('mirror', on && this.mirror);
      e.classList.toggle('ctx', this.context.has(id) && !this.mirror);
      if (on && !this.mirror) e.setAttribute('aria-current', 'true');
      else e.removeAttribute('aria-current');
    }
    const one = this.selected.size === 1 ? this.byId([...this.selected][0]) : undefined;
    // A selected branch lights up the references into it; a selected pill, its own edge.
    const branch = one && (one.kind === 'def' || one.kind === 'defLabel') ? this.boxes.find((x) => x.kind === 'def' && x.name === one.name) : undefined;
    this.svg?.querySelectorAll<SVGElement>('.edge.ref, .ref-end').forEach((p) => {
      p.classList.toggle('active', !!one && (p.dataset['from'] === one.id || (!!branch && p.dataset['to'] === branch.id)));
    });
  }

  /** Make exactly one box the tab stop. */
  private initRoving(): void {
    const order = readingOrder(this.boxes);
    const keep = this.byId(this.focusId) ?? order[0];
    for (const b of order) this.elements.get(b.id)?.setAttribute('tabindex', b.id === keep?.id ? '0' : '-1');
    if (keep) this.focusId = keep.id;
  }

  focusBox(id: string, scroll = true, quiet = false): void {
    const e = this.elements.get(id);
    if (!e) return;
    for (const [bid, g] of this.elements) if (g.hasAttribute('tabindex')) g.setAttribute('tabindex', bid === id ? '0' : '-1');
    this.focusId = id;
    this.quiet = quiet;
    try {
      (e as unknown as HTMLElement).focus({ preventScroll: true });
    } finally {
      this.quiet = false;
    }
    if (scroll) this.scrollTo(id);
  }

  private onFocusIn(ev: FocusEvent): void {
    const target = ev.target as Element;
    const g = target.closest('.box');
    if (!g) return;
    const b = this.byId(g.getAttribute('data-id') ?? undefined);
    if (!b) return;
    this.focusId = b.id;
    this.lastFocused = this.focusKey(b);
    for (const [bid, e] of this.elements) if (e.hasAttribute('tabindex')) e.setAttribute('tabindex', bid === b.id ? '0' : '-1');
    const visible = (g as unknown as Element).matches(':focus-visible');
    this.showRing(visible ? b : undefined);
    // Pointer clicks select on their own; keyboard focus moves the selection with it.
    if (visible && !this.quiet && !this.selected.has(b.id)) this.actions.focused(b);
  }

  private onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Element | null;
    if (next && this.svg?.contains(next)) return;
    this.showRing(undefined);
  }

  private showRing(b: Box | undefined): void {
    const r = this.ring;
    if (!r) return;
    if (!b) {
      r.setAttribute('visibility', 'hidden');
      return;
    }
    r.setAttribute('x', String(b.x - 4));
    r.setAttribute('y', String(b.y - 4));
    r.setAttribute('width', String(b.w + 8));
    r.setAttribute('height', String(b.h + 8));
    r.setAttribute('visibility', 'visible');
  }

  scrollTo(id: string): void {
    const b = this.boxes.find((x) => x.id === id);
    if (!b) return;
    const s = this.scale;
    const host = this.host;
    const top = b.y * s;
    const left = b.x * s;
    if (top < host.scrollTop + 20 || top + b.h * s > host.scrollTop + host.clientHeight - 20) host.scrollTop = Math.max(0, top - host.clientHeight / 3);
    if (left < host.scrollLeft + 20 || left + b.w * s > host.scrollLeft + host.clientWidth - 20) host.scrollLeft = Math.max(0, left - host.clientWidth / 3);
  }

  /** The on-screen rectangle of a box, for placing a popover next to it. */
  rectOf(b: Box): DOMRect {
    const e = this.elements.get(b.id);
    if (e) return e.getBoundingClientRect();
    return this.host.getBoundingClientRect();
  }

  /** Smallest box holding `pos`, preferring content over containers on ties. */
  boxAtOffset(pos: number): Box | undefined {
    let best: Box | undefined;
    let bestLen = Infinity;
    for (const b of this.boxes) {
      if (!b.range || b.kind === 'sectionLabel' || b.kind === 'nsHeader') continue;
      if (pos < b.range[0] || pos > b.range[1]) continue;
      const len = b.range[1] - b.range[0];
      const better = len < bestLen || (len === bestLen && best !== undefined && rank(b) > rank(best));
      if (better) {
        best = b;
        bestLen = len;
      }
    }
    return best;
  }

  contextFor(id: string | undefined): EditContext {
    return rowContext(this.boxes, this.byId(id));
  }

  // --- pointer -------------------------------------------------------------

  private boxFromEvent(ev: Event): Box | undefined {
    const t = (ev.target as Element).closest('[data-id]');
    const id = t?.getAttribute('data-id');
    return id ? this.boxes.find((b) => b.id === id) : undefined;
  }

  private onClick(ev: MouseEvent): void {
    const target = ev.target as Element;
    const b = this.boxFromEvent(ev);
    if (!b) {
      this.actions.clearSelection();
      return;
    }
    if (b.kind === 'nsHeader' && b.ns !== undefined) {
      this.actions.toggleNamespace(b.ns);
      return;
    }
    const extend = ev.shiftKey || ev.metaKey || ev.ctrlKey;
    const wasOnlySelection = this.selected.size === 1 && this.selected.has(b.id) && this.clickedId === b.id;
    this.clickedId = b.id;
    if (selectable(b)) this.focusBox(b.id, false);
    this.actions.select(b, extend, true);
    // A second, separate click on a selected box edits it, like renaming a file: text in place,
    // a tag or guard chip in its dialog. The first click only selects, so the strip shows what
    // can be done, the same for every kind of box.
    const again = !extend && wasOnlySelection && ev.detail === 1;
    if (again && (b.kind === 'tag' || b.kind === 'guard') && this.actions.canEdit()) this.actions.editChip(b);
    else if (again && isEditableText(b)) this.beginEdit(b);
  }

  private onDblClick(ev: MouseEvent): void {
    const b = this.boxFromEvent(ev);
    if (!b) return;
    if (b.kind === 'ref') {
      ev.preventDefault();
      this.actions.gotoRef(b);
      return;
    }
    if (b.kind === 'defLabel') {
      const def = this.boxes.find((x) => x.kind === 'def' && x.name === b.name);
      if (def && this.actions.canEdit()) this.actions.defAction(def, 'rename');
      return;
    }
    if (b.kind === 'tag' || b.kind === 'guard') {
      if (this.actions.canEdit()) this.actions.editChip(b);
      return;
    }
    if (!isEditableText(b)) return;
    ev.preventDefault();
    this.beginEdit(b);
  }

  // --- keyboard ------------------------------------------------------------

  private onKey(ev: KeyboardEvent): void {
    if (this.input) return;
    const g = (ev.target as Element).closest('.box');
    if (!g) return;
    const b = this.byId(g.getAttribute('data-id') ?? undefined);
    if (!b || !selectable(b)) return;
    const ctx = rowContext(this.boxes, b);
    // Shift+Up selects the choice around the selection; Shift+Down goes back into it.
    if (ev.shiftKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !ev.altKey) {
      ev.preventDefault();
      if (ev.key === 'ArrowUp') {
        const around = isChoiceFrame(b)
          ? this.boxes.filter((f) => isChoiceFrame(f) && f.id !== b.id && inside(b, f)).sort((p, q) => p.w * p.h - q.w * q.h)[0]
          : ctx.frame;
        if (around) this.focusBox(around.id, true, false);
      } else if (isChoiceFrame(b)) {
        const first = readingOrder(this.boxes).find((x) => inside(x, b));
        if (first) this.focusBox(first.id, true, false);
      }
      return;
    }
    // Tab moves on to the strip's actions, from a box or a choice alike.
    if (ev.key === 'Tab' && !ev.shiftKey) {
      if (this.actions.focusStrip()) ev.preventDefault();
      return;
    }
    const dirs: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const dir = dirs[ev.key];
    const editable = this.actions.canEdit();
    if (dir && ev.altKey) {
      if (dir === 'up' || dir === 'down') {
        ev.preventDefault();
        if (ctx.row && editable) this.actions.moveAlternative(ctx.row, dir === 'up' ? -1 : 1);
      }
      return;
    }
    if (dir) {
      ev.preventDefault();
      const next = navigate(this.boxes, b, dir);
      if (next) this.focusBox(next.id);
      return;
    }
    switch (ev.key) {
      case 'Home':
      case 'End': {
        ev.preventDefault();
        const order = readingOrder(this.boxes);
        const t = ev.key === 'Home' ? order[0] : order[order.length - 1];
        if (t) this.focusBox(t.id);
        return;
      }
      case 'Enter':
        ev.preventDefault();
        this.activate(b);
        return;
      case 'F2':
        ev.preventDefault();
        if (isTextual(b)) this.beginEdit(b);
        else this.activate(b);
        return;
      case ' ':
        ev.preventDefault();
        this.actions.select(b, true);
        return;
      case 'Delete':
      case 'Backspace':
        ev.preventDefault();
        if (!editable) return;
        this.actions.deleteBox(b);
        return;
      case '+':
      case '=':
        if (editable && ctx.frame) {
          ev.preventDefault();
          this.actions.addAlternative(ctx.frame, ctx.row?.index);
        }
        return;
      case 'Escape':
        this.actions.clearSelection();
        return;
      default:
    }
    if (ev.key.length !== 1 || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // Typing on a text box starts editing it, with what you type in place of the text (Escape
    // puts it back), as in a spreadsheet. Elsewhere t and g add a tag or a guard.
    if (isTextual(b) && editable) {
      ev.preventDefault();
      this.beginEdit(b, { initial: ev.key });
      return;
    }
    if ((ev.key === 't' || ev.key === 'g') && editable && ctx.row) {
      ev.preventDefault();
      if (ev.key === 't') this.actions.addTag(ctx.row);
      else this.actions.addGuard(ctx.row);
    }
  }

  /** Enter on a box: edit text, retarget a pill, edit a chip, rename a definition, toggle a namespace. */
  private activate(b: Box): void {
    if (b.kind === 'ref') this.actions.gotoRef(b);
    else if (isTextual(b)) this.beginEdit(b);
    else if (b.kind === 'tag' || b.kind === 'guard') {
      if (this.actions.canEdit()) this.actions.editChip(b);
    } else if (b.kind === 'nsHeader' && b.ns !== undefined) this.actions.toggleNamespace(b.ns);
    else if (b.kind === 'defLabel') {
      const def = this.boxes.find((x) => x.kind === 'def' && x.name === b.name);
      if (def && this.actions.canEdit()) this.actions.defAction(def, 'rename');
    } else this.actions.select(b, false);
  }

  // --- inline text editing -------------------------------------------------

  /**
   * Edit a box's text in place. `onCancel` runs when Escape abandons the edit, and also when a
   * `placeholder` (a just-added "new") loses focus untouched. `onCommit` replaces the usual
   * text edit, so adding and naming an alternative can be one undo step.
   */
  beginEdit(b: Box, opts: { onCancel?: () => void; onCommit?: (value: string) => string | void; placeholder?: boolean; initial?: string } = {}): void {
    if (!this.actions.canEdit()) {
      this.actions.select(b, false);
      return;
    }
    this.cancelEdit();
    this.actions.editStarted();
    // Line breaks and tabs show as \n and \t in the field, and are written back as such.
    const initial = b.kind === 'empty' ? '' : b.kind === 'ref' ? (b.target ?? b.full.replace(/^\$/, '')) : toField(b.full);
    const label = b.kind === 'ref' ? 'Name of the branch this points at' : b.kind === 'range' ? 'Range, for example 0..9' : 'Edit text';
    const input = document.createElement('input');
    input.className = 'inline-edit';
    input.type = 'text';
    input.value = opts.initial ?? initial;
    input.setAttribute('aria-label', label);
    input.placeholder = b.kind === 'empty' ? 'Type text' : '';
    const s = this.scale;
    const w = Math.max(b.w + 24, 140);
    // Readable even on a zoomed-out chart: never smaller than 12px text in a 24px field.
    const font = Math.max(12, 13 * s);
    input.style.cssText = `left:${b.x * s - 4}px;top:${b.y * s - 2}px;width:${Math.max(w * s, 180)}px;height:${Math.max((b.h + 4) * s, 24)}px;font-size:${font}px`;
    let done = false;
    const finish = (commitWanted: boolean, fromBlur = false): void => {
      let commit = commitWanted;
      if (done) return;
      // Mark first: removing the input fires blur, which must not commit a second time.
      done = true;
      const v = input.value;
      // Clicking away from a placeholder nobody typed into means you did not want it.
      if (commit && fromBlur && opts.placeholder && v === initial) commit = false;
      // A placeholder kept as it is (Enter on "new") is still a change to make, as one undo step.
      if (commit && (v !== initial || opts.placeholder) && (v !== '' || b.kind !== 'empty')) {
        const text = b.kind === 'ref' ? v : fromField(v);
        const err = opts.onCommit ? opts.onCommit(text) : this.actions.commitText(b, text);
        if (err) {
          this.actions.announce(err);
          if (!fromBlur) {
            done = false;
            input.setAttribute('aria-invalid', 'true');
            input.title = err;
            return;
          }
        }
      }
      if (this.input === input) this.input = undefined;
      if (input.isConnected) input.remove();
      if (!commit && (!fromBlur || opts.placeholder) && opts.onCancel) {
        opts.onCancel();
        return;
      }
      if (!fromBlur) this.restoreFocus(b);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('title');
    });
    input.addEventListener('blur', () => finish(true, true));
    this.host.appendChild(input);
    this.input = input;
    input.focus();
    // Typing started the edit: keep what was typed and go on after it.
    if (opts.initial !== undefined) input.setSelectionRange(input.value.length, input.value.length);
    else input.select();
  }

  private restoreFocus(b: Box): void {
    // After a cancelled edit the box is still there; after a commit the chart re-renders and main restores focus.
    const e = this.elements.get(b.id);
    if (e && this.layout && this.byId(b.id)) (e as unknown as HTMLElement).focus({ preventScroll: true });
  }

  /** Replace the drawing with a message (nothing to draw yet). */
  showEmpty(content: HTMLElement): void {
    this.cancelEdit();
    this.layout = undefined;
    this.svg = undefined;
    this.elements.clear();
    this.selected = new Set();
    this.host.textContent = '';
    this.host.appendChild(content);
  }

  /** Scale so the whole chart fits the pane, both ways (the Fit button). */
  fitAll(): void {
    if (!this.layout) return;
    const w = this.host.clientWidth - 8;
    const h = this.host.clientHeight - 8;
    this.fit = false;
    this.scale = Math.max(0.3, Math.min(1, w / this.layout.width, h / this.layout.height));
  }

  /** Show how one result was made: light the boxes on its path and dim the rest. */
  setTrace(ids: Set<string> | null, scroll = true, order?: Map<string, number>): void {
    this.svg?.classList.toggle('tracing', !!ids);
    // Any-order items get the position they were used in, on the left of each.
    this.svg?.querySelectorAll('.order-badge').forEach((e) => e.remove());
    if (ids && order && this.svg) {
      for (const [rowId, n] of order) {
        const r = this.byId(rowId);
        if (!r) continue;
        const g = el('g', { class: 'order-badge', 'aria-hidden': 'true' }, this.svg);
        el('circle', { cx: r.x - 5, cy: r.y + r.h / 2, r: 7 }, g);
        el('text', { x: r.x - 5, y: r.y + r.h / 2 + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g).textContent = String(n);
      }
    }
    for (const [id, e] of this.elements) e.classList.toggle('on-path', !!ids && ids.has(id));
    this.svg?.querySelectorAll<SVGElement>('.edge.ref, .ref-end').forEach((p) => p.classList.toggle('on-path', !!ids && ids.has(p.dataset['from'] ?? '')));
    if (ids && scroll) {
      const first = readingOrder(this.boxes).find((b) => ids.has(b.id) && b.kind !== 'defLabel');
      if (first) this.scrollTo(first.id);
    }
  }

  isEditing(): boolean {
    return !!this.input;
  }

  cancelEdit(): void {
    if (this.input) {
      const i = this.input;
      this.input = undefined;
      i.remove();
    }
  }

  findByRange(kind: BoxKind, range: Range): Box | undefined {
    return this.boxes.find((b) => b.kind === kind && b.range && b.range[0] === range[0] && b.range[1] === range[1]);
  }

  /** The last box that had keyboard focus, even if focus has since moved into a dialog. */
  lastKey(): FocusKey | undefined {
    return this.lastFocused;
  }

  /** A box (by default the focused one) as a stable key that survives a re-render. */
  focusKey(box?: Box): FocusKey | undefined {
    const b = box ?? this.focusedBox();
    if (!b) return undefined;
    return { kind: b.kind, start: b.range?.[0] ?? -1, name: b.name };
  }

  /** Re-focus the box nearest the key, after a re-render. */
  restoreKey(key: FocusKey, mapStart: (n: number) => number, fallback = true): Box | undefined {
    const want = key.start < 0 ? -1 : mapStart(key.start);
    let best: Box | undefined;
    let bestD = Infinity;
    for (const b of this.boxes) {
      if (!selectable(b) || b.kind !== key.kind) continue;
      if (key.name !== undefined && b.name !== key.name) continue;
      const d = Math.abs((b.range?.[0] ?? -1) - want);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    if (!best && fallback) best = readingOrder(this.boxes)[0];
    if (best) this.focusBox(best.id, false);
    return best;
  }

  /** The box a key stands for, after a re-render, without moving focus. */
  boxForKey(key: FocusKey, mapStart: (n: number) => number): Box | undefined {
    const want = key.start < 0 ? -1 : mapStart(key.start);
    let best: Box | undefined;
    let bestD = Infinity;
    for (const b of this.boxes) {
      if (b.kind !== key.kind) continue;
      if (key.name !== undefined && b.name !== key.name) continue;
      const d = Math.abs((b.range?.[0] ?? -1) - want);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** Briefly outline a box, to show where a jump landed. */
  flash(id: string): void {
    const e = this.elements.get(id);
    if (!e) return;
    e.classList.remove('flash');
    void (e as unknown as HTMLElement).getBoundingClientRect();
    e.classList.add('flash');
    window.setTimeout(() => e.classList.remove('flash'), 1300);
  }
}

/** A polyline with its corners rounded off. */
function roundedPath(p: { x: number; y: number }[], r: number): string {
  const first = p[0];
  if (!first) return '';
  let d = `M${first.x},${first.y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const c = p[i + 1]!;
    const d1 = Math.hypot(b.x - a.x, b.y - a.y);
    const d2 = Math.hypot(c.x - b.x, c.y - b.y);
    if (d1 < 0.01 || d2 < 0.01) continue;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    d += ` L${b.x + ((a.x - b.x) * rr) / d1},${b.y + ((a.y - b.y) * rr) / d1} Q${b.x},${b.y} ${b.x + ((c.x - b.x) * rr) / d2},${b.y + ((c.y - b.y) * rr) / d2}`;
  }
  const last = p[p.length - 1]!;
  return d + ` L${last.x},${last.y}`;
}

function isTextual(b: Box): boolean {
  return b.kind === 'text' || b.kind === 'empty' || b.kind === 'range' || b.kind === 'ref';
}

/** Boxes whose label is their text, so editing in place is the natural action. */
function isEditableText(b: Box): boolean {
  return b.kind === 'text' || b.kind === 'empty' || b.kind === 'range';
}

function rank(b: Box): number {
  if (LEAF_KINDS.has(b.kind)) return 3;
  if (b.kind === 'row') return 2;
  if (b.kind === 'frame') return 1;
  return 0;
}
