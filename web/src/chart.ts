// SVG view of a Layout. Draws boxes and edges, tracks selection and hover, and turns
// pointer gestures into callbacks. It knows nothing about the DSL or about patches.

import { Box, BoxKind, Edge, Layout, LEAF_KINDS, Measure } from './layout';
import type { Range } from './ranges';

const NS = 'http://www.w3.org/2000/svg';

export interface ChartActions {
  /** True when the code currently parses and chart edits are allowed. */
  canEdit(): boolean;
  /** False for choices that cannot be edited structurally (for example `[1..6]`). */
  canRestructure(frame: Box): boolean;
  select(box: Box): void;
  editText(box: Box, value: string): void;
  addAlternative(frame: Box): void;
  deleteAlternative(row: Box): void;
  moveAlternative(row: Box, delta: -1 | 1): void;
  toggleNamespace(ns: string): void;
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

const area = (b: Box): number => b.w * b.h;
const inside = (inner: Box, outer: Box): boolean => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;
const hits = (b: Box, x: number, y: number): boolean => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

export class ChartView {
  private svg: SVGSVGElement | undefined;
  private layout: Layout | undefined;
  private elements = new Map<string, SVGElement>();
  private selected = new Set<string>();
  private overlay: SVGGElement | undefined;
  private input: HTMLInputElement | undefined;
  scale = 1;
  fit = true;

  constructor(
    private host: HTMLElement,
    private actions: ChartActions,
  ) {
    host.addEventListener('mouseleave', () => this.clearOverlay());
  }

  get boxes(): Box[] {
    return this.layout?.boxes ?? [];
  }

  render(layout: Layout): void {
    this.cancelEdit();
    this.layout = layout;
    const avail = this.host.clientWidth - 8;
    if (this.fit) this.scale = Math.max(0.4, Math.min(1, avail / layout.width));
    this.host.textContent = '';
    this.elements.clear();
    const svg = el('svg', {
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      width: Math.ceil(layout.width * this.scale),
      height: Math.ceil(layout.height * this.scale),
      class: 'chart-svg',
      role: 'img',
      'aria-label': 'Flow chart of the program',
    });
    this.svg = svg;
    const back = el('g', { class: 'back' }, svg);
    const edgeLayer = el('g', { class: 'edges' }, svg);
    const refLayer = el('g', { class: 'refs' }, svg);
    const fore = el('g', { class: 'fore' }, svg);
    this.overlay = el('g', { class: 'overlay' }, svg);

    for (const b of layout.boxes) {
      if (b.kind === 'def' || b.kind === 'frame' || b.kind === 'row') this.drawBox(b, back);
    }
    for (const e of layout.edges) this.drawEdge(e, e.kind === 'ref' ? refLayer : edgeLayer);
    for (const b of layout.boxes) {
      if (LEAF_KINDS.has(b.kind)) this.drawBox(b, fore);
    }
    svg.addEventListener('click', (ev) => this.onClick(ev));
    svg.addEventListener('dblclick', (ev) => this.onDblClick(ev));
    svg.addEventListener('mousemove', (ev) => this.onMove(ev));
    this.host.appendChild(svg);
    this.applySelection();
  }

  private drawEdge(e: Edge, parent: Element): void {
    const p = e.points;
    const first = p[0];
    if (!first) return;
    if (e.kind === 'ref') {
      const [a, b, c, d] = p as [typeof first, typeof first, typeof first, typeof first];
      const path = el('path', { d: `M${a.x},${a.y} C${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`, class: 'edge ref', fill: 'none' }, parent);
      path.dataset['from'] = e.from ?? '';
      path.dataset['to'] = e.to ?? '';
      el('circle', { cx: d.x, cy: d.y, r: 3, class: 'ref-end' }, parent);
      return;
    }
    const d = 'M' + p.map((q) => `${q.x},${q.y}`).join(' L');
    el('path', { d, class: 'edge ' + e.kind, fill: 'none' }, parent);
  }

  private drawBox(b: Box, parent: Element): void {
    const g = el('g', { class: `box k-${b.kind}`, 'data-id': b.id }, parent);
    this.elements.set(b.id, g);
    const rect = (rx: number): SVGRectElement => el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx }, g);
    const text = (cls = ''): void => {
      const t = el('text', { x: b.x + b.w / 2, y: b.y + b.h / 2 + 0.5, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = b.label;
      if (b.full !== b.label) el('title', {}, g).textContent = b.full;
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
      case 'ref':
        rect(b.h / 2);
        text();
        el('title', {}, g).textContent = `Reference to ${b.target ?? ''}`;
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
        el('title', {}, g).textContent = CHIP_TITLES[b.kind] ?? '';
    }
  }

  // --- selection -----------------------------------------------------------

  setSelected(ids: string[]): void {
    this.selected = new Set(ids);
    this.applySelection();
  }

  private applySelection(): void {
    for (const [id, e] of this.elements) e.classList.toggle('sel', this.selected.has(id));
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
    const b = id ? this.boxes.find((x) => x.id === id) : undefined;
    if (!b) return {};
    if (b.kind === 'row') return { row: b, frame: this.boxes.find((x) => x.id === b.frameId) };
    if (b.kind === 'frame') return b.frameOf === 'group' || b.frameOf === 'anyorder' ? { frame: b } : {};
    if (!LEAF_KINDS.has(b.kind)) return {};
    const rows = this.boxes.filter((r) => r.kind === 'row' && inside(b, r)).sort((p, q) => area(p) - area(q));
    const row = rows[0];
    return row ? { row, frame: this.boxes.find((x) => x.id === row.frameId) } : {};
  }

  // --- pointer -------------------------------------------------------------

  private boxFromEvent(ev: Event): Box | undefined {
    const t = (ev.target as Element).closest('[data-id]');
    const id = t?.getAttribute('data-id');
    return id ? this.boxes.find((b) => b.id === id) : undefined;
  }

  private onClick(ev: MouseEvent): void {
    const target = ev.target as Element;
    if (target.closest('.overlay')) return;
    const b = this.boxFromEvent(ev);
    if (!b) return;
    if (b.kind === 'nsHeader' && b.ns !== undefined) {
      this.actions.toggleNamespace(b.ns);
      return;
    }
    this.actions.select(b);
  }

  private onDblClick(ev: MouseEvent): void {
    const b = this.boxFromEvent(ev);
    if (!b || (b.kind !== 'text' && b.kind !== 'empty')) return;
    ev.preventDefault();
    this.beginEdit(b);
  }

  private point(ev: MouseEvent): { x: number; y: number } {
    const r = (this.svg as SVGSVGElement).getBoundingClientRect();
    return { x: (ev.clientX - r.left) / this.scale, y: (ev.clientY - r.top) / this.scale };
  }

  private onMove(ev: MouseEvent): void {
    if (!this.actions.canEdit() || this.input) return;
    if ((ev.target as Element).closest('.overlay')) return;
    const { x, y } = this.point(ev);
    const rows = this.boxes.filter((b) => b.kind === 'row' && hits(b, x, y)).sort((a, b) => area(a) - area(b));
    const frames = this.boxes.filter((b) => b.kind === 'frame' && (b.frameOf === 'group' || b.frameOf === 'anyorder') && hits(b, x, y)).sort((a, b) => area(a) - area(b));
    const row = rows[0];
    const frame = frames[0];
    // Only show a row's tools while the row belongs to the innermost frame under the pointer.
    this.showOverlay(row && frame && row.frameId === frame.id ? row : undefined, frame);
  }

  clearOverlay(): void {
    if (this.overlay) this.overlay.textContent = '';
  }

  private showOverlay(row: Box | undefined, frame: Box | undefined): void {
    const o = this.overlay;
    if (!o) return;
    o.textContent = '';
    if (!frame) return;
    const editable = this.isEditableFrame(frame);
    if (!editable) return;
    const btn = (cx: number, cy: number, glyph: string, label: string, onClick: () => void, disabled = false): void => {
      const g = el('g', { class: 'ctl' + (disabled ? ' disabled' : ''), role: 'button', 'aria-label': label, 'aria-disabled': String(disabled) }, o);
      el('circle', { cx, cy, r: 8 }, g);
      const t = el('text', { x: cx, y: cy + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = glyph;
      el('title', {}, g).textContent = label;
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      });
    };
    btn(frame.x + frame.w / 2, frame.y + frame.h - 6, '+', 'Add an alternative', () => this.actions.addAlternative(frame));
    if (row) {
      const any = frame.frameOf === 'anyorder';
      const count = row.count ?? 1;
      const idx = row.index ?? 0;
      const cy = row.y - 6;
      let cx = row.x + row.w - 10;
      btn(cx, cy, '×', 'Delete this alternative', () => this.actions.deleteAlternative(row), count < 2);
      if (!any) {
        cx -= 20;
        btn(cx, cy, '↓', 'Move this alternative down', () => this.actions.moveAlternative(row, 1), idx >= count - 1);
        cx -= 20;
        btn(cx, cy, '↑', 'Move this alternative up', () => this.actions.moveAlternative(row, -1), idx <= 0);
      }
    }
  }

  private isEditableFrame(frame: Box): boolean {
    return this.actions.canRestructure(frame);
  }

  // --- inline text editing -------------------------------------------------

  beginEdit(b: Box): void {
    if (!this.actions.canEdit()) {
      this.actions.select(b);
      return;
    }
    this.cancelEdit();
    this.clearOverlay();
    const input = document.createElement('input');
    input.className = 'inline-edit';
    input.type = 'text';
    input.value = b.kind === 'empty' ? '' : b.full;
    input.setAttribute('aria-label', 'Edit text');
    input.placeholder = b.kind === 'empty' ? 'Type text' : '';
    const s = this.scale;
    const w = Math.max(b.w + 24, 140);
    input.style.cssText = `left:${b.x * s - 4}px;top:${b.y * s - 2}px;width:${w * s}px;height:${(b.h + 4) * s}px;font-size:${13 * s}px`;
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      const v = input.value;
      input.remove();
      this.input = undefined;
      if (commit && v !== (b.kind === 'empty' ? '' : b.full) && (v !== '' || b.kind !== 'empty')) this.actions.editText(b, v);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    this.host.appendChild(input);
    this.input = input;
    input.focus();
    input.select();
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
}

const CHIP_TITLES: Partial<Record<BoxKind, string>> = {
  tag: 'Sets a tag on this alternative',
  guard: 'Only available when the tag condition holds',
  transform: 'Transform applied to the item',
  repeat: 'Repeat count',
  anyorder: 'Every ordering of these items',
  delimiter: 'Delimiter used to join here',
};

function rank(b: Box): number {
  if (LEAF_KINDS.has(b.kind)) return 3;
  if (b.kind === 'row') return 2;
  if (b.kind === 'frame') return 1;
  return 0;
}
