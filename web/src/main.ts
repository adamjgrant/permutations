import * as core from '../../src/index';
import type { TextNode } from '../../src/core/types';
import { Analysis, analyze, DEFAULT_PROGRAM, decodeShare, describeError, encodeShare, formatCount, tagLabel } from './model';
import { Box, layout, Layout } from './layout';
import { canvasMeasure, ChartActions, ChartView } from './chart';
import { createEditor } from './editor';
import { addAlternative, ChoiceNode, deleteAlternative, EditResult, editText, fillEmpty, isStructurallyEditable, moveAlternative, replaceAll } from './patch';

const STORAGE_KEY = 'permutations.v3.source';
const ALL_LIMIT = 1000;
const DEBOUNCE_MS = 250;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// A formatter may arrive in the core later. Nothing here depends on it.
type Formatter = (source: string, mode: 'short' | 'long' | 'auto') => string;
const FORMATTER_EXPORT = 'format' + 'Source';
const formatter = (core as unknown as Record<string, unknown>)[FORMATTER_EXPORT] as Formatter | undefined;

// --- state -----------------------------------------------------------------

let analysis: Analysis | undefined;
let hasError = false;
let lastLayout: Layout | undefined;
const collapsed = new Set<string>();
let selectedId: string | undefined;
let timer: number | undefined;
let hlActive = false;
const measure = canvasMeasure();

function loadInitial(): string {
  const m = /^#code=(.+)$/.exec(location.hash);
  if (m) {
    const s = decodeShare(m[1] as string);
    if (s !== undefined) return s;
  }
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s !== null && s.trim() !== '') return s;
  } catch {
    /* storage may be unavailable */
  }
  return DEFAULT_PROGRAM;
}

// --- chart actions ---------------------------------------------------------

const canEdit = (): boolean => analysis !== undefined && !hasError && editor.getText() === analysis.source;

function applyEdit(result: EditResult | undefined, opts: { startEdit?: boolean } = {}): void {
  if (!result || result.patches.length === 0) return;
  editor.patch(result.patches);
  refresh();
  const sel = result.select;
  if (sel && opts.startEdit) {
    const box = chart.findByRange('text', sel);
    if (box) {
      selectBox(box, false);
      chart.beginEdit(box);
    }
  }
}

function selectBox(box: Box, reveal = true): void {
  selectedId = box.id;
  chart.setSelected([box.id]);
  if (reveal && box.range && canEdit()) {
    editor.reveal(box.range);
    hlActive = true;
  }
  updateTools();
}

const actions: ChartActions = {
  canEdit,
  canRestructure: (frame) => !!frame.node && isStructurallyEditable(frame.node as ChoiceNode),
  select: (b) => selectBox(b),
  editText(box, value) {
    if (!analysis || !canEdit()) return;
    if (box.kind === 'text') applyEdit(editText(analysis.source, box.node as TextNode, value));
    else if (box.kind === 'empty' && box.range) applyEdit(fillEmpty(analysis.source, box.range, value));
  },
  addAlternative(frame) {
    if (!analysis || !canEdit()) return;
    applyEdit(addAlternative(analysis.source, frame.node as ChoiceNode), { startEdit: true });
  },
  deleteAlternative(row) {
    if (!analysis || !canEdit()) return;
    applyEdit(deleteAlternative(analysis.source, row.node as ChoiceNode, row.index ?? 0));
  },
  moveAlternative(row, delta) {
    if (!analysis || !canEdit()) return;
    applyEdit(moveAlternative(analysis.source, row.node as ChoiceNode, row.index ?? 0, delta));
  },
  toggleNamespace(ns) {
    if (collapsed.has(ns)) collapsed.delete(ns);
    else collapsed.add(ns);
    relayout();
  },
};

// --- chart -----------------------------------------------------------------

const chart = new ChartView($('chart'), actions);

function relayout(): void {
  if (!analysis) return;
  lastLayout = layout({ main: analysis.main, others: analysis.others, source: analysis.source, collapsed, measure });
  chart.render(lastLayout);
  selectedId = undefined;
  syncFromCursor();
  updateTools();
}

function syncFromCursor(scroll = false): void {
  if (!canEdit()) return;
  const pos = editor.view.state.selection.main.head;
  const box = chart.boxAtOffset(pos);
  selectedId = box?.id;
  chart.setSelected(box ? [box.id] : []);
  if (box && scroll) chart.scrollTo(box.id);
  updateTools();
}

function updateTools(): void {
  const ctx = chart.contextFor(selectedId);
  const ok = canEdit();
  const restructure = ok && !!ctx.frame && actions.canRestructure(ctx.frame);
  const row = ctx.row;
  const any = ctx.frame?.frameOf === 'anyorder';
  $<HTMLButtonElement>('t-add').disabled = !restructure;
  $<HTMLButtonElement>('t-del').disabled = !(restructure && row && (row.count ?? 1) > 1);
  $<HTMLButtonElement>('t-up').disabled = !(restructure && row && !any && (row.index ?? 0) > 0);
  $<HTMLButtonElement>('t-down').disabled = !(restructure && row && !any && (row.index ?? 0) < (row.count ?? 1) - 1);
}

$('t-add').addEventListener('click', () => {
  const f = chart.contextFor(selectedId).frame;
  if (f) actions.addAlternative(f);
});
$('t-del').addEventListener('click', () => {
  const r = chart.contextFor(selectedId).row;
  if (r) actions.deleteAlternative(r);
});
$('t-up').addEventListener('click', () => {
  const r = chart.contextFor(selectedId).row;
  if (r) actions.moveAlternative(r, -1);
});
$('t-down').addEventListener('click', () => {
  const r = chart.contextFor(selectedId).row;
  if (r) actions.moveAlternative(r, 1);
});

function zoom(factor: number): void {
  chart.fit = false;
  chart.scale = Math.max(0.3, Math.min(2.5, chart.scale * factor));
  if (lastLayout) chart.render(lastLayout);
  syncFromCursor();
}
$('z-in').addEventListener('click', () => zoom(1.2));
$('z-out').addEventListener('click', () => zoom(1 / 1.2));
$('z-fit').addEventListener('click', () => {
  chart.fit = true;
  if (lastLayout) chart.render(lastLayout);
  syncFromCursor();
});
let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (chart.fit && lastLayout) {
      chart.render(lastLayout);
      syncFromCursor();
    }
  }, 120);
});

// --- editor ----------------------------------------------------------------

const editor = createEditor($('editor'), loadInitial(), {
  onChange: schedule,
  onCursor() {
    if (hlActive) {
      hlActive = false;
      queueMicrotask(() => editor.highlight(null));
    }
    syncFromCursor(true);
  },
});

function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(refresh, DEBOUNCE_MS);
  persist();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, editor.getText());
  } catch {
    /* ignore */
  }
}

function refresh(): void {
  window.clearTimeout(timer);
  const src = editor.getText();
  persist();
  let next: Analysis;
  try {
    next = analyze(src);
  } catch (e) {
    const { message, offset } = describeError(e);
    hasError = true;
    const box = $('error');
    box.hidden = false;
    box.textContent = message;
    box.title = 'Click to jump to the error';
    box.onclick = offset === undefined ? null : () => editor.focusAt(offset);
    editor.error(offset ?? null);
    $('stale').hidden = !analysis;
    if (!analysis) chart.render(emptyLayout());
    updateTools();
    return;
  }
  hasError = false;
  analysis = next;
  $('error').hidden = true;
  $('stale').hidden = true;
  editor.error(null);
  relayout();
  renderCount();
  renderSamples();
  resetAll();
}

function emptyLayout(): Layout {
  return { boxes: [], edges: [], width: 360, height: 120, defBoxes: {} };
}

// --- examples --------------------------------------------------------------

function chipsFor(tags: Record<string, string | number | true>): string {
  return Object.entries(tags)
    .map(([k, v]) => `<span class="chip">${escapeHtml(tagLabel(k, v))}</span>`)
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function item(n: number, text: string, tags: Record<string, string | number | true>): string {
  const shown = text === '' ? '<span class="note">(empty text)</span>' : escapeHtml(text);
  return `<li><span class="n">${n}</span><span class="t">${shown}</span><span class="chips">${chipsFor(tags)}</span></li>`;
}

function renderCount(): void {
  if (!analysis) return;
  const c = analysis.program.count;
  $('count').textContent = formatCount(c);
  $('count-unit').textContent = c === 1n ? 'permutation' : 'permutations';
}

function renderSamples(): void {
  const list = $('samples');
  const note = $('sample-note');
  if (!analysis) return;
  const p = analysis.program;
  try {
    const rows = p.sample(5);
    list.innerHTML = rows.map((o, i) => item(i + 1, o.text, o.tags)).join('');
    note.textContent = p.count <= 5n ? 'That is every permutation.' : `${rows.length} distinct random outputs`;
  } catch (e) {
    list.innerHTML = `<li><span class="empty-state">${escapeHtml(describeError(e).message)}</span></li>`;
    note.textContent = '';
  }
}

function resetAll(): void {
  $('all-list').innerHTML = '';
  $('all-note').textContent = '';
  const intro = $('all-intro');
  if (!analysis) return;
  const c = analysis.program.count;
  if (c === 0n) {
    intro.innerHTML = '<span class="empty-state">This program has no permutations.</span>';
    return;
  }
  const label = c > BigInt(ALL_LIMIT) ? `List the first ${formatCount(BigInt(ALL_LIMIT))}` : `List all ${formatCount(c)}`;
  intro.innerHTML = `<span>This program has <strong>${formatCount(c)}</strong> ${c === 1n ? 'permutation' : 'permutations'}.</span><button id="b-list" type="button" class="primary">${label}</button>`;
  $('b-list').addEventListener('click', listAll);
}

function listAll(): void {
  if (!analysis) return;
  const p = analysis.program;
  const rows: string[] = [];
  let i = 0;
  for (const o of p.all({ limit: ALL_LIMIT })) rows.push(item(++i, o.text, o.tags));
  $('all-list').innerHTML = rows.join('');
  $('all-note').textContent = p.count > BigInt(ALL_LIMIT) ? `Showing the first ${formatCount(BigInt(ALL_LIMIT))} of ${formatCount(p.count)} permutations. The rest are not listed.` : `Showing all ${formatCount(p.count)}.`;
  $('b-list').hidden = true;
}

function showTab(which: 'random' | 'all'): void {
  $('view-random').hidden = which !== 'random';
  $('view-all').hidden = which !== 'all';
  $('tab-random').setAttribute('aria-selected', String(which === 'random'));
  $('tab-all').setAttribute('aria-selected', String(which === 'all'));
}
$('tab-random').addEventListener('click', () => showTab('random'));
$('tab-all').addEventListener('click', () => showTab('all'));
$('b-new').addEventListener('click', renderSamples);

// --- toolbar ---------------------------------------------------------------

function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  window.setTimeout(() => t.classList.remove('show'), 2200);
}

$('b-share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#code=${encodeShare(editor.getText())}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? 'Link copied' : 'Copy failed. The link is in the address bar.');
  }
});
$('b-reset').addEventListener('click', () => editor.setText(DEFAULT_PROGRAM));

if (formatter) {
  const run = (mode: 'long' | 'short'): void => {
    const src = editor.getText();
    try {
      const r = replaceAll(src, formatter(src, mode));
      if (r.patches.length) editor.patch(r.patches);
    } catch (e) {
      toast(describeError(e).message);
    }
  };
  $('b-expand').hidden = false;
  $('b-collapse').hidden = false;
  $('b-expand').addEventListener('click', () => run('long'));
  $('b-collapse').addEventListener('click', () => run('short'));
}

refresh();
showTab('random');
