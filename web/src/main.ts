import type { RefNode, TextNode } from '../../src/core/types';
import { Analysis, analyze, DEFAULT_PROGRAM, decodeShare, describeError, encodeShare, formatCount, isBlank, tagLabel } from './model';
import { Box, layout, Layout } from './layout';
import { canvasMeasure, ChartActions, ChartView, DefAction, FocusKey } from './chart';
import { createEditor } from './editor';
import {
  addAlternative, addGuard, addTag, alternatives, applyPatches, ChoiceNode, deleteAlternative, EditResult, editGuard, editRange, editTag, editText, fillEmpty,
  guardInputOf, isStructurallyEditable, mapAfterMove, mapOffset, moveAlternative, parseGuardInput, parseTagInput, tagInputOf, Patch,
} from './patch';
import {
  convertForms, createDefinition, deleteDefinition, EditOrError, ExtractSelection, extractToBranch, failed, referencesTo, renameDefinition,
  inlineReference, retargetReference, skippedNotice, uniqueName,
} from './defs';
import { closePopover, openPopover } from './popover';
import { HELP_ITEMS, insertionFor, SHORTCUTS } from './help';
import { ActionBar, ActionId, barActions } from './actionbar';
import { insertReference, pieceRange, WrapNode, wrapInChoice } from './insert';
import { pathBoxes } from './trace';
import { setDelimiter } from './delim';
import { inside } from './nav';
import { redo, undo } from '@codemirror/commands';

const STORAGE_KEY = 'permutations.v3.source';
const ALL_LIMIT = 1000;
const DEBOUNCE_MS = 250;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// --- never white-screen --------------------------------------------------------

function showError(message: string, offset?: number, fix?: { label: string; run: () => void }): void {
  const box = $('error');
  box.hidden = false;
  box.textContent = message;
  box.title = offset === undefined ? '' : 'Click to jump to the error';
  box.onclick = offset === undefined ? null : () => editor.focusAt(offset);
  if (fix) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'error-fix';
    b.textContent = fix.label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      safe(fix.run)();
    });
    box.append(' ', b);
  }
}

/** Compiler messages written for the command line, said the way the web app works. */
function webError(message: string): { message: string; fix?: { label: string; run: () => void } } {
  const unknown = /^Unknown reference \$([A-Za-z_][\w.]*) \((line \d+, column \d+)\)/.exec(message);
  if (unknown) {
    const name = unknown[1] as string;
    return {
      message: `There is no branch named ${name} (${unknown[2]}). Fix the name, or create the branch.`,
      fix: {
        label: `Create branch ${name}`,
        run: () => {
          const r = createDefinition(editor.getText(), name);
          if (failed(r)) notify(r.error, 'warn');
          else applyEdit(r, { then: () => gotoBranch(name) });
        },
      },
    };
  }
  const mod = /^Cannot find module '([^']+)' \((line \d+, column \d+)\)/.exec(message);
  if (mod) return { message: `Imports do not work in the web app, so '${mod[1]}' cannot be loaded (${mod[2]}). Copy its branches into this code instead.` };
  return { message };
}

function showFatal(e: unknown): void {
  const { message } = describeError(e);
  try {
    showError(`Something went wrong: ${message}. Your code is unchanged.`);
  } catch {
    document.body.insertAdjacentText('afterbegin', `Something went wrong: ${message}`);
  }
}

window.addEventListener('error', (ev) => showFatal(ev.error ?? ev.message));
window.addEventListener('unhandledrejection', (ev) => showFatal(ev.reason));

/** Run an event handler so that no exception escapes. */
const safe =
  <A extends unknown[]>(fn: (...a: A) => void) =>
  (...a: A): void => {
    try {
      fn(...a);
    } catch (e) {
      showFatal(e);
    }
  };

// --- state -----------------------------------------------------------------

let analysis: Analysis | undefined;
let hasError = false;
let lastLayout: Layout | undefined;
const collapsed = new Set<string>();
let selectedId: string | undefined;
const multi = new Set<string>();
/** True when the selection came from the chart, so its action bar should show. */
let barOn = false;
let timer: number | undefined;
let hlActive = false;
let noticeTimer: number | undefined;
const measure = canvasMeasure();

function loadInitial(): string {
  try {
    const m = /^#code=(.+)$/.exec(location.hash);
    if (m) {
      const s = decodeShare(m[1] as string);
      if (s !== undefined) return s;
    }
    const s = localStorage.getItem(STORAGE_KEY);
    if (s !== null && s.trim() !== '') return s;
  } catch {
    /* storage may be unavailable */
  }
  return DEFAULT_PROGRAM;
}

// --- notices ---------------------------------------------------------------

function notify(message: string, kind: 'info' | 'warn' = 'info'): void {
  const n = $('notice');
  n.className = `notice ${kind}`;
  $('notice-text').textContent = message;
  n.hidden = false;
  window.clearTimeout(noticeTimer);
  if (kind === 'info') noticeTimer = window.setTimeout(clearNotice, 20000);
}

function clearNotice(): void {
  $('notice').hidden = true;
  $('notice-text').textContent = '';
}
$('notice-close').addEventListener('click', clearNotice);

// --- applying edits ----------------------------------------------------------

const canEdit = (): boolean => analysis !== undefined && !hasError && editor.getText() === analysis.source;

/**
 * Apply an edit as ONE editor change (one undo step). The result is checked first: an edit that
 * would leave a program that no longer compiles is refused with the reason. Returns an error message or undefined.
 */
function applyEdit(result: EditOrError | EditResult | undefined, opts: { startEdit?: boolean; focus?: Box; map?: (patches: Patch[], pos: number) => number; then?: (patches: Patch[]) => void } = {}): string | undefined {
  if (!result) {
    const m = 'That edit is not possible here.';
    notify(m, 'warn');
    return m;
  }
  if (failed(result)) {
    notify(result.error, 'warn');
    return result.error;
  }
  if (result.patches.length === 0) return undefined;
  const src = editor.getText();
  const next = applyPatches(src, result.patches);
  try {
    analyze(next);
  } catch (e) {
    const m = `That change would break the program (${describeError(e).message}), so it was not applied.`;
    notify(m, 'warn');
    return m;
  }
  clearNotice();
  const barFocus = bar.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset['action'] : undefined;
  const keepBar = barOn;
  const selected = chart.boxes.find((b) => b.id === selectedId);
  const key: FocusKey | undefined = opts.focus
    ? chart.focusKey(opts.focus)
    : chart.hasFocus()
      ? chart.focusKey()
      : document.activeElement?.closest('.popover')
        ? chart.lastKey()
        : selected
          ? chart.focusKey(selected)
          : undefined;
  editor.patch(result.patches);
  refresh();
  const map = (n: number): number => (opts.map ?? mapOffset)(result.patches, n);
  let landed: Box | undefined;
  if (key) landed = barFocus ? chart.boxForKey(key, map) : chart.restoreKey(key, map);
  if (landed && keepBar) {
    selectBox(landed, { bar: true });
    if (barFocus) bar.focusAction(barFocus);
  }
  opts.then?.(result.patches);
  const sel = result.select;
  if (sel && opts.startEdit) {
    const box = chart.findByRange('text', sel);
    if (box) {
      selectBox(box, { reveal: false, bar: true });
      chart.beginEdit(box);
    }
  }
  return undefined;
}

function selectBox(box: Box, opts: { reveal?: boolean; bar?: boolean } = {}): void {
  selectedId = box.id;
  barOn = opts.bar ?? true;
  chart.setSelected([box.id]);
  if ((opts.reveal ?? true) && box.range && canEdit()) {
    editor.reveal(box.range);
    hlActive = true;
  }
  updateTools();
}

function clearSelection(): void {
  const hadBarFocus = bar.contains(document.activeElement);
  const prev = selectedId;
  selectedId = undefined;
  multi.clear();
  barOn = false;
  chart.setSelected([]);
  editor.highlight(null);
  hlActive = false;
  updateTools();
  if (hadBarFocus && prev) chart.focusBox(prev, false, true);
}

/** Scroll to a branch, select its name and outline its card. */
function gotoBranch(name: string): void {
  let label = chart.boxes.find((b) => b.kind === 'defLabel' && b.name === name);
  const ns = name.includes('.') ? name.slice(0, name.indexOf('.')) : undefined;
  if (!label && ns && collapsed.has(ns)) {
    collapsed.delete(ns);
    relayout();
    label = chart.boxes.find((b) => b.kind === 'defLabel' && b.name === name);
  }
  if (!label) {
    notify(`There is no branch named ${name}.`, 'warn');
    return;
  }
  chart.focusBox(label.id, true, true);
  selectBox(label, { bar: true });
  const def = chart.boxes.find((b) => b.kind === 'def' && b.name === name);
  if (def) chart.flash(def.id);
}

function toggleRow(box: Box): void {
  const row = chart.contextFor(box.id).row;
  if (!row) return;
  if (multi.size === 0) {
    const cur = chart.contextFor(selectedId).row;
    if (cur) multi.add(cur.id);
  }
  const first = chart.boxes.find((b) => b.id === [...multi][0]);
  if (first && first.frameId !== row.frameId) multi.clear();
  if (multi.has(row.id)) multi.delete(row.id);
  else multi.add(row.id);
  selectedId = row.id;
  barOn = true;
  chart.setSelected([...multi]);
  notify(`${multi.size} ${multi.size === 1 ? 'alternative' : 'alternatives'} selected. Use Extract to branch to move them into a new branch.`);
  updateTools();
}

// --- popovers ---------------------------------------------------------------

function anchorOf(box: Box | undefined): { left: number; top: number; right: number; bottom: number } {
  const r = box ? chart.rectOf(box) : $('chart').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function nameDialog(title: string, label: string, value: string, hint: string, anchor: Box | undefined, run: (name: string) => string | void, okLabel: string): void {
  openPopover({
    title,
    label,
    value,
    hint,
    anchor: anchorOf(anchor),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      { label: okLabel, kind: 'primary', run: (v) => run(v.trim()) },
      { label: 'Cancel', run: () => undefined },
    ],
  });
}

// --- chart actions ---------------------------------------------------------

function altOf(row: Box): { node: ChoiceNode; index: number } | undefined {
  if (!row.node || (row.node.kind !== 'group' && row.node.kind !== 'anyorder')) return undefined;
  return { node: row.node, index: row.index ?? 0 };
}

const actions: ChartActions = {
  canEdit,
  canRestructure: (frame) => canEdit() && !!frame.node && isStructurallyEditable(frame.node as ChoiceNode, analysis?.source),
  rowCaps(row) {
    const a = altOf(row);
    if (!a || !analysis) return { tag: false, guard: false, move: false };
    const alt = alternatives(a.node)[a.index];
    const group = a.node.kind === 'group';
    return { move: true, tag: group && !!alt?.option && alt.count === 1, guard: group && !!alt?.option && alt.count === 1 && !alt.option.guard };
  },
  select(b, extend, withBar = true) {
    if (extend) toggleRow(b);
    else {
      multi.clear();
      selectBox(b, { bar: withBar });
    }
  },
  focused(b) {
    multi.clear();
    selectBox(b, { bar: true });
  },
  clearSelection,
  gotoRef(b) {
    if (b.target) gotoBranch(b.target);
  },
  editStarted() {
    /* the strip stays: it never covers the editor */
  },
  commitText(box, value) {
    if (!analysis || !canEdit()) return 'The code has an error, so the chart cannot edit it right now.';
    const src = analysis.source;
    let result: EditOrError | undefined;
    if (box.kind === 'text') result = editText(src, box.node as TextNode, value);
    else if (box.kind === 'empty') result = box.node?.kind === 'text' ? editText(src, box.node, value) : box.range ? fillEmpty(src, box.range, value) : undefined;
    else if (box.kind === 'range' && box.range) result = editRange(src, box.range, value);
    else if (box.kind === 'ref' && box.node?.kind === 'ref') result = retargetReference(src, box.node as RefNode, value);
    return applyEdit(result, { focus: box });
  },
  editChip: (box) => editChip(box),
  removeChip(box) {
    if (!analysis || !canEdit()) return;
    let err: string | undefined = 'none';
    if (box.kind === 'tag' && box.tag) err = applyEdit(editTag(analysis.source, box.tag, null), { focus: box });
    else if (box.kind === 'guard' && box.guard) err = applyEdit(editGuard(analysis.source, box.guard, null), { focus: box });
    if (!err) toast(`${box.kind === 'tag' ? 'Tag' : 'Guard'} removed.`, UNDO);
  },
  addAlternative(frame, after) {
    if (!analysis || !canEdit()) return;
    applyEdit(addAlternative(analysis.source, frame.node as ChoiceNode, 'new', after), { startEdit: true });
  },
  deleteAlternative(row) {
    if (!analysis || !canEdit()) return;
    if (!applyEdit(deleteAlternative(analysis.source, row.node as ChoiceNode, row.index ?? 0))) toast('Alternative deleted.', UNDO);
  },
  moveAlternative(row, delta) {
    if (!analysis || !canEdit()) return;
    applyEdit(moveAlternative(analysis.source, row.node as ChoiceNode, row.index ?? 0, delta), { map: mapAfterMove });
  },
  addTag(row) {
    const a = altOf(row);
    if (!a || !analysis || !canEdit()) return;
    const src = analysis.source;
    openPopover({
      title: 'Add a tag',
      label: 'Tag',
      value: '',
      hint: 'A name, or name=value. Example: q or severity=5. Later guards can test it.',
      placeholder: 'q',
      anchor: anchorOf(row),
      returnFocus: document.activeElement as HTMLElement | null,
      actions: [
        {
          label: 'Add tag',
          kind: 'primary',
          run(v) {
            const p = parseTagInput(v);
            if ('error' in p) return p.error;
            return applyEdit(addTag(src, a.node, a.index, p.spec));
          },
        },
        { label: 'Cancel', run: () => undefined },
      ],
    });
  },
  addGuard(row) {
    const a = altOf(row);
    if (!a || !analysis || !canEdit()) return;
    const src = analysis.source;
    const known = analysis.knownTags;
    openPopover({
      title: 'Add a guard',
      label: 'Guard',
      value: '',
      hint: 'A tag name, !name for "not set", name=value, or else. The alternative is only available when the guard holds, and the tag must be set earlier.',
      placeholder: 'q',
      anchor: anchorOf(row),
      returnFocus: document.activeElement as HTMLElement | null,
      actions: [
        {
          label: 'Add guard',
          kind: 'primary',
          run(v) {
            const p = parseGuardInput(v);
            if ('error' in p) return p.error;
            const err = applyEdit(addGuard(src, a.node, a.index, p.spec));
            if (!err && p.spec.kind === 'tag' && !known.has(p.spec.name)) {
              notify(`No alternative sets the tag "${p.spec.name}" yet, so this guard has nothing to test. Add the tag with @ on an earlier alternative.`, 'warn');
            }
            return err;
          },
        },
        { label: 'Cancel', run: () => undefined },
      ],
    });
  },
  toggleNamespace(ns) {
    if (collapsed.has(ns)) collapsed.delete(ns);
    else collapsed.add(ns);
    relayout();
  },
  defAction: (def, action) => defAction(def, action),
  announce: (m) => {
    if (m) notify(m, 'warn');
  },
};

function editChip(box: Box): void {
  if (!analysis || !canEdit()) return;
  const src = analysis.source;
  const isTag = box.kind === 'tag';
  if (isTag && !box.tag) return;
  if (!isTag && !box.guard) return;
  const known = analysis.knownTags;
  openPopover({
    title: isTag ? 'Edit tag' : 'Edit guard',
    label: isTag ? 'Tag' : 'Guard',
    value: isTag ? tagInputOf(box.tag!) : guardInputOf(box.guard!),
    hint: isTag
      ? 'A name, or name=value. Remove the tag with the Remove button.'
      : 'A tag name, !name for "not set", name=value, or else.' + (box.note ? ' ' + box.note : ''),
    anchor: anchorOf(box),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      {
        label: 'Save',
        kind: 'primary',
        run(v) {
          if (isTag) {
            const p = parseTagInput(v);
            if ('error' in p) return p.error;
            return applyEdit(editTag(src, box.tag!, p.spec), { focus: box });
          }
          const p = parseGuardInput(v);
          if ('error' in p) return p.error;
          const err = applyEdit(editGuard(src, box.guard!, p.spec), { focus: box });
          if (!err && p.spec.kind === 'tag' && !known.has(p.spec.name)) notify(`No alternative sets the tag "${p.spec.name}", so this guard has nothing to test.`, 'warn');
          return err;
        },
      },
      {
        label: 'Remove',
        kind: 'danger',
        run: () => applyEdit(isTag ? editTag(src, box.tag!, null) : editGuard(src, box.guard!, null), { focus: box }),
      },
      { label: 'Cancel', run: () => undefined },
    ],
  });
}

function defAction(def: Box, action: DefAction): void {
  if (!analysis || !canEdit() || !def.name) return;
  const src = analysis.source;
  const name = def.name === '<main>' ? 'main' : def.name;
  if (action === 'convert') {
    const mode = def.form === 'long' ? 'short' : 'long';
    runConvert(mode, [name], name);
    return;
  }
  if (action === 'rename') {
    const refs = referencesTo(src, name).length;
    nameDialog(`Rename ${name}`, 'New name', name, `The branch and ${refs} ${refs === 1 ? 'reference' : 'references'} to it will change together.`, def, (v) => {
      const r = renameDefinition(src, name, v);
      if (failed(r)) return r.error;
      const err = applyEdit(r, { then: () => gotoBranch(v) });
      if (!err && r.patches.length) notify(`Renamed ${name} to ${v}, ${refs} ${refs === 1 ? 'reference' : 'references'} updated.`);
      return err;
    }, 'Rename');
    return;
  }
  const r = deleteDefinition(src, name);
  if (failed(r)) {
    // Offer the way out: jump to the first branch that still uses this one.
    const users = [...new Set(referencesTo(src, name).map((x) => x.from))];
    const first = users[0];
    openPopover({
      title: `Cannot delete ${name}`,
      message: r.error,
      anchor: anchorOf(def),
      returnFocus: document.activeElement as HTMLElement | null,
      actions: [
        ...(first ? [{ label: `Go to ${first}`, kind: 'primary' as const, run: () => void gotoBranch(first) }] : []),
        { label: first ? 'Close' : 'OK', kind: first ? ('plain' as const) : ('primary' as const), run: () => undefined },
      ],
    });
    return;
  }
  openPopover({
    title: `Delete ${name}?`,
    message: 'Nothing refers to it. You can undo this in the code editor.',
    anchor: anchorOf(def),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      {
        label: 'Delete',
        kind: 'danger',
        run: () => {
          const err = applyEdit(r);
          if (!err) toast(`Branch ${name} deleted.`, UNDO);
          return err;
        },
      },
      { label: 'Cancel', run: () => undefined },
    ],
  });
}

function runConvert(mode: 'short' | 'long', names: string[] | undefined, label: string | undefined): void {
  if (!canEdit()) {
    notify('Fix the error in the code first, then Expand or Collapse.', 'warn');
    return;
  }
  const src = editor.getText();
  let res;
  try {
    res = convertForms(src, mode, names);
  } catch (e) {
    notify(describeError(e).message, 'warn');
    return;
  }
  const skipped = skippedNotice(res.skipped);
  const verb = mode === 'long' ? 'Expanded' : 'Collapsed';
  if (!res.patches.length) {
    notify(skipped || (label ? `${label} is already in ${mode} form.` : `Everything is already in ${mode} form.`), skipped ? 'warn' : 'info');
    return;
  }
  const err = applyEdit({ patches: res.patches });
  if (!err) notify(`${verb} ${res.changed.length} ${res.changed.length === 1 ? 'branch' : 'branches'}.${skipped ? ' ' + skipped : ''}`, skipped ? 'warn' : 'info');
}

// --- chart -----------------------------------------------------------------

const chart = new ChartView($('chart'), actions);

function relayout(): void {
  if (!analysis) return;
  clearTrace();
  lastLayout = layout({
    main: analysis.main,
    others: analysis.others,
    source: analysis.source,
    collapsed,
    measure,
    defaultDelimiter: analysis.delimiter,
    knownTags: analysis.knownTags,
    wrapWidth: Math.max(360, $('chart').clientWidth - 8),
  });
  chart.render(lastLayout);
  const names = [...new Set(lastLayout.boxes.filter((b) => b.kind === 'guard' && b.warn && b.guard?.kind === 'tag').map((b) => (b.guard as { name: string }).name))];
  const hints = $('chart-hints');
  hints.hidden = names.length === 0;
  hints.textContent = names.length
    ? `Hint: no alternative sets ${names.map((n) => `"${n}"`).join(', ')}, so ${names.length === 1 ? 'the guard on it has' : 'guards on them have'} nothing to test. Add the tag with @ on an earlier alternative.`
    : '';
  selectedId = undefined;
  multi.clear();
  barOn = false;
  syncFromCursor();
  updateTools();
}

/** Lay out again for a new pane width, and keep the selection. */
function relayoutKeepingSelection(): void {
  const sel = chart.boxes.find((b) => b.id === selectedId);
  const key = sel ? chart.focusKey(sel) : undefined;
  const keep = barOn;
  const focusInChart = chart.hasFocus();
  relayout();
  if (!key) return;
  const box = chart.boxForKey(key, (n) => n);
  if (!box) return;
  if (focusInChart) chart.focusBox(box.id, false, true);
  selectBox(box, { bar: keep, reveal: false });
}

/** Draw the same layout again (zoom) and keep the selection. */
function rerender(): void {
  if (!lastLayout) return;
  chart.render(lastLayout);
  chart.setSelected(multi.size ? [...multi] : selectedId ? [selectedId] : []);
  updateTools();
}

function syncFromCursor(scroll = false): void {
  if (!canEdit()) return;
  const pos = editor.view.state.selection.main.head;
  const box = chart.boxAtOffset(pos);
  selectedId = box?.id;
  barOn = false;
  chart.setSelected(box ? [box.id] : []);
  if (box && scroll) chart.scrollTo(box.id);
  updateTools();
}

function currentExtraction(): ExtractSelection | undefined {
  const boxes = chart.boxes;
  if (multi.size) {
    const rows = boxes.filter((b) => multi.has(b.id));
    const node = rows[0]?.node;
    if (node && (node.kind === 'group' || node.kind === 'anyorder')) return { kind: 'alts', node, indices: rows.map((r) => r.index ?? 0) };
    return undefined;
  }
  const b = boxes.find((x) => x.id === selectedId);
  if (!b) return undefined;
  if (b.kind === 'row' && b.node && (b.node.kind === 'group' || b.node.kind === 'anyorder')) return { kind: 'alts', node: b.node, indices: [b.index ?? 0] };
  if (b.kind === 'range') {
    const row = chart.contextFor(b.id).row;
    if (row?.node && (row.node.kind === 'group' || row.node.kind === 'anyorder')) return { kind: 'alts', node: row.node, indices: [row.index ?? 0] };
    return undefined;
  }
  if (b.kind === 'frame' && b.node && b.node.kind !== 'seq') return { kind: 'node', node: b.node };
  if ((b.kind === 'text' || b.kind === 'ref') && b.node) return { kind: 'node', node: b.node };
  return undefined;
}

function updateTools(): void {
  $<HTMLButtonElement>('t-new').disabled = !canEdit();
  $<HTMLButtonElement>('b-new').disabled = !analysis;
  $<HTMLButtonElement>('b-copy5').disabled = !analysis;
  updateBar();
}

function selectionLabel(b: Box): string {
  if (multi.size > 1) return `${multi.size} alternatives`;
  if (b.kind === 'def' || b.kind === 'defLabel') return `Branch ${b.name === '<main>' ? 'main' : b.name}`;
  const ctx = chart.contextFor(b.id);
  const short = (t: string): string => (t.length > 28 ? t.slice(0, 27) + '…' : t);
  const what =
    b.kind === 'row'
      ? 'Alternative'
      : b.kind === 'frame'
        ? 'Choice'
        : b.kind === 'ref'
          ? `Reference ${b.full}`
          : b.kind === 'empty'
            ? 'Empty alternative'
            : b.kind === 'tag' || b.kind === 'guard'
              ? `${b.kind === 'tag' ? 'Tag' : 'Guard'} ${b.label}`
              : b.kind === 'anyorder'
                ? `Any order (${b.label.replace(/^any order · /, '')})`
                : b.kind === 'delimiter'
                  ? `Delimiter ${b.label.replace(/^delimiter /, '')}`
                  : b.kind === 'repeat'
                    ? `Repeat ${b.label}`
                    : b.kind === 'transform'
                      ? `Transform ${b.label}`
                      : `“${short(b.full)}”`;
  return ctx.row && b.kind !== 'row' ? `${what} · alternative ${(ctx.row.index ?? 0) + 1} of ${ctx.row.count ?? 1}` : ctx.row ? `${what} ${(ctx.row.index ?? 0) + 1} of ${ctx.row.count ?? 1}` : what;
}

function updateBar(): void {
  const box = chart.boxes.find((b) => b.id === selectedId);
  if (!barOn || !box) {
    bar.hide();
    return;
  }
  const ok = canEdit();
  if (!ok) {
    bar.hide(hasError ? 'Fix the error in the code to edit from the chart.' : 'Updating the chart…');
    return;
  }
  const ctx = chart.contextFor(box.id);
  const restructure = ok && !!ctx.frame && actions.canRestructure(ctx.frame);
  const specs = barActions({
    box,
    row: ctx.row,
    frame: ctx.frame,
    multi: multi.size,
    canEdit: ok,
    restructure,
    caps: ctx.row ? actions.rowCaps(ctx.row) : { tag: false, guard: false, move: false },
    canExtract: ok && !!currentExtraction(),
    branches: branchNames().length,
    delimFrame: delimFrameFor(box),
  });
  bar.show(specs, selectionLabel(box));
}

function extractSelection(): void {
  if (!analysis || !canEdit()) return;
  const sel = currentExtraction();
  if (!sel) return;
  const src = analysis.source;
  const anchor = chart.boxes.find((b) => b.id === selectedId);
  nameDialog('Extract to branch', 'Name for the new branch', uniqueName(src, 'part'), 'The selection is replaced by a reference, and the new branch is added at the end of the code.', anchor, (v) => {
    const r = extractToBranch(src, sel, v);
    if (failed(r)) return r.error;
    return applyEdit(r, { then: () => gotoBranch(v) });
  }, 'Extract');
}

function runAction(id: ActionId): void {
  const box = chart.boxes.find((b) => b.id === selectedId);
  if (!box) return;
  const ctx = chart.contextFor(box.id);
  switch (id) {
    case 'edit':
    case 'retarget':
      chart.beginEdit(box);
      return;
    case 'goto':
      if (box.target) gotoBranch(box.target);
      return;
    case 'add':
      if (ctx.frame) actions.addAlternative(ctx.frame, box.kind === 'frame' ? undefined : ctx.row?.index);
      return;
    case 'up':
    case 'down':
      if (ctx.row) actions.moveAlternative(ctx.row, id === 'up' ? -1 : 1);
      return;
    case 'delete':
      if (ctx.row) actions.deleteAlternative(ctx.row);
      return;
    case 'tag':
      if (ctx.row) actions.addTag(ctx.row);
      return;
    case 'guard':
      if (ctx.row) actions.addGuard(ctx.row);
      return;
    case 'chip-edit':
      editChip(box);
      return;
    case 'chip-remove':
      actions.removeChip(box);
      return;
    case 'extract':
      extractSelection();
      return;
    case 'clear':
      clearSelection();
      return;
    case 'wrap':
    case 'optional':
      if (analysis && (box.node?.kind === 'text' || box.node?.kind === 'ref')) {
        applyEdit(wrapInChoice(analysis.source, box.node as WrapNode, id === 'wrap' ? 'new' : null), id === 'wrap' ? { startEdit: true } : { focus: box });
      }
      return;
    case 'insert-ref':
      insertRefDialog(box);
      return;
    case 'delimiter': {
      const f = delimFrameFor(box);
      if (f) delimiterDialog(f, box);
      return;
    }
    case 'inline':
      if (analysis && box.node?.kind === 'ref') {
        const name = box.node.path;
        const err = applyEdit(inlineReference(analysis.source, box.node as RefNode));
        if (!err) {
          const unused = referencesTo(editor.getText(), name).length === 0;
          toast(unused ? `Inlined ${name}. Nothing uses it any more.` : `Inlined ${name}.`, unused ? { label: `Delete ${name}`, run: () => deleteUnused(name) } : UNDO);
        }
      }
      return;
    case 'rename':
    case 'convert':
    case 'delete-def': {
      const def = chart.boxes.find((b) => b.kind === 'def' && b.name === box.name);
      if (def) defAction(def, id === 'rename' ? 'rename' : id === 'convert' ? 'convert' : 'delete');
      return;
    }
  }
}

/** The choice or any-order group whose delimiter a selection stands for. */
function delimFrameFor(box: Box): Box | undefined {
  const ok = (f: Box | undefined): Box | undefined =>
    f && f.kind === 'frame' && (f.frameOf === 'group' || f.frameOf === 'anyorder') && f.node && analysis && setDelimiter(analysis.source, f.node as ChoiceNode, ' ') ? f : undefined;
  if (box.kind === 'frame') return ok(box);
  if (box.kind !== 'anyorder' && box.kind !== 'delimiter') return undefined;
  // A chip sits in the header of the frame it describes; the any-order group is the frame inside.
  const around = chart.boxes.filter((f) => f.kind === 'frame' && inside(box, f)).sort((a, b) => a.w * a.h - b.w * b.h);
  const inner = chart.boxes.filter((f) => f.kind === 'frame' && f.frameOf === 'anyorder' && around[0] && inside(f, around[0])).sort((a, b) => b.w * b.h - a.w * a.h);
  return ok(box.kind === 'anyorder' ? (inner[0] ?? around[0]) : around[0]);
}

function delimiterDialog(frame: Box, anchor: Box): void {
  if (!analysis || !frame.node) return;
  const node = frame.node as ChoiceNode;
  const src = analysis.source;
  const current = node.kind === 'group' || node.kind === 'anyorder' ? node.delimiter : undefined;
  const around = analysis.delimiter;
  openPopover({
    title: 'Delimiter',
    label: 'What joins the parts here',
    value: current ?? around,
    hint: `Leave it empty for no space at all. Use default goes back to the delimiter around this choice (${JSON.stringify(around)}).`,
    anchor: anchorOf(anchor),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      { label: 'Set', kind: 'primary', run: (v) => applyEdit(setDelimiter(src, node, v), { focus: anchor }) },
      ...(current !== undefined ? [{ label: 'Use default', run: () => applyEdit(setDelimiter(src, node, null), { focus: anchor }) }] : []),
      { label: 'Cancel', run: () => undefined },
    ],
  });
}

function deleteUnused(name: string): void {
  const r = deleteDefinition(editor.getText(), name);
  if (failed(r)) notify(r.error, 'warn');
  else if (!applyEdit(r)) toast(`Branch ${name} deleted.`, UNDO);
}

function branchNames(): string[] {
  if (!analysis) return [];
  return [analysis.main.name === '<main>' ? 'main' : analysis.main.name, ...analysis.others.map((o) => o.name)];
}

function insertRefDialog(box: Box): void {
  if (!analysis || !canEdit() || !box.node) return;
  const src = analysis.source;
  const names = branchNames();
  const after = pieceRange([analysis.main.body, ...analysis.others.map((o) => o.body)], box.node);
  if (!after) {
    notify('A reference cannot be inserted here.', 'warn');
    return;
  }
  openPopover({
    title: 'Insert reference',
    label: 'Branch',
    value: '',
    placeholder: names.find((n) => n !== 'main') ?? 'name',
    hint: `Inserts $name right after “${box.label}”. Branches: ${names.join(', ')}.`,
    suggestions: names,
    anchor: anchorOf(box),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      {
        label: 'Insert',
        kind: 'primary',
        run(v) {
          const name = v.trim();
          if (!name) return 'Type the name of a branch.';
          if (!names.includes(name)) return `There is no branch named ${name}. Create it with New branch first.`;
          return applyEdit(insertReference(src, after, name));
        },
      },
      { label: 'Cancel', run: () => undefined },
    ],
  });
}

const bar = new ActionBar($('selbar'), (id) => safe(runAction)(id));

const on = (id: string, fn: () => void): void => $(id).addEventListener('click', safe(fn));

on('t-new', () => {
  if (!analysis || !canEdit()) return;
  const src = analysis.source;
  nameDialog('New branch', 'Name', uniqueName(src), 'Letters, digits and underscores. It is added at the end of the code in the same style as the rest.', undefined, (v) => {
    const r = createDefinition(src, v);
    if (failed(r)) return r.error;
    return applyEdit(r, { then: () => gotoBranch(v) });
  }, 'Create');
});

function zoom(factor: number): void {
  chart.fit = false;
  chart.scale = Math.max(0.3, Math.min(2.5, chart.scale * factor));
  rerender();
}
on('z-in', () => zoom(1.2));
// Pinch on a trackpad, or Cmd/Ctrl and the scroll wheel, zooms the chart.
$('chart').addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    safe(() => zoom(Math.exp(-e.deltaY * 0.002)))();
  },
  { passive: false },
);
on('z-out', () => zoom(1 / 1.2));
on('z-fit', () => {
  chart.fit = true;
  rerender();
});
let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(
    safe(() => {
      if (lastLayout) relayoutKeepingSelection();
    }),
    120,
  );
});

// --- editor ----------------------------------------------------------------

const editor = createEditor($('editor'), loadInitial(), {
  onChange: schedule,
  onCursor: safe(() => {
    if (hlActive) {
      hlActive = false;
      queueMicrotask(() => editor.highlight(null));
    }
    syncFromCursor(true);
  }),
});

function schedule(): void {
  // An Undo in a toast stands for one change: any later change makes it stale, so hide it.
  if (toastHasAction) {
    toastHasAction = false;
    $('toast').classList.remove('show');
  }
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

function showBlank(): void {
  hasError = false;
  analysis = undefined;
  lastLayout = undefined;
  selectedId = undefined;
  multi.clear();
  barOn = false;
  $('error').hidden = true;
  $('stale').hidden = true;
  $('ex-stale').hidden = true;
  $('chart-hints').hidden = true;
  editor.error(null);
  const box = document.createElement('div');
  box.className = 'chart-empty';
  box.innerHTML =
    '<h3>Nothing to draw yet</h3><p>Write a line in the code to see it here, for example <code>Hello [world|friend]!</code></p>';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'primary';
  b.textContent = 'Insert the example';
  b.addEventListener('click', safe(() => editor.setText(DEFAULT_PROGRAM)));
  box.appendChild(b);
  chart.showEmpty(box);
  $('count').textContent = '0';
  $('count').title = '';
  $('count-unit').textContent = 'permutations';
  $('samples').innerHTML = '<li><span class="empty-state">Examples appear here as soon as the code has something to run.</span></li>';
  $('sample-note').textContent = '';
  $('all-list').innerHTML = '';
  $('all-note').textContent = '';
  $('all-intro').innerHTML = '';
  updateTools();
}

function refresh(): void {
  window.clearTimeout(timer);
  const src = editor.getText();
  persist();
  if (isBlank(src)) {
    showBlank();
    return;
  }
  let next: Analysis;
  try {
    next = analyze(src);
  } catch (e) {
    // Any error, not only the compiler's own, lands here and keeps the last good chart.
    const { message, offset } = describeError(e);
    hasError = true;
    const w = webError(message);
    showError(w.message, offset, w.fix);
    editor.error(offset ?? null);
    $('stale').hidden = !analysis;
    $('ex-stale').hidden = !analysis;
    if (!analysis) chart.render(emptyLayout());
    updateTools();
    return;
  }
  hasError = false;
  analysis = next;
  $('error').hidden = true;
  $('stale').hidden = true;
  $('ex-stale').hidden = true;
  editor.error(null);
  try {
    relayout();
    renderCount();
    renderSamples();
    resetAll();
  } catch (e) {
    hasError = true;
    showFatal(e);
  }
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

function item(n: number, text: string, tags: Record<string, string | number | true>, index: bigint): string {
  const shown = text === '' ? '<span class="note">(empty text)</span>' : escapeHtml(text);
  return `<li><button type="button" class="ex-row" data-index="${index}" aria-pressed="false" title="Show how this one is made, in the chart"><span class="n">${n}</span><span class="t">${shown}</span><span class="chips">${chipsFor(tags)}</span></button></li>`;
}

// --- tracing an example through the chart ----------------------------------------

let traced: string | undefined;

function clearTrace(): void {
  if (traced === undefined) return;
  traced = undefined;
  chart.setTrace(null);
  document.querySelectorAll('.ex-row[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  $('trace-note').hidden = true;
}

function toggleTrace(btn: HTMLElement): void {
  if (!analysis || btn.dataset['index'] === undefined) return;
  const key = `${btn.closest('ol')?.id}:${btn.dataset['index']}`;
  if (traced === key) {
    clearTrace();
    return;
  }
  clearTrace();
  const tr = analysis.program.trace(BigInt(btn.dataset['index']));
  chart.setTrace(pathBoxes(chart.boxes, tr));
  traced = key;
  btn.setAttribute('aria-pressed', 'true');
  const note = $('trace-note');
  note.hidden = false;
  $('trace-text').textContent = `The chart shows how “${tr.text.length > 60 ? tr.text.slice(0, 59) + '…' : tr.text}” is made.`;
}

for (const id of ['samples', 'all-list']) {
  $(id).addEventListener(
    'click',
    safe((e: Event) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.ex-row');
      if (btn) toggleTrace(btn);
    }),
  );
}
on('trace-stop', clearTrace);

function renderCount(): void {
  if (!analysis) return;
  const c = analysis.program.count;
  $('count').textContent = formatCount(c);
  $('count').title = c.toString().length > 15 ? `${new Intl.NumberFormat('en-US').format(c)} permutations` : '';
  $('count-unit').textContent = c === 1n ? 'permutation' : 'permutations';
}

function renderSamples(): void {
  const list = $('samples');
  const note = $('sample-note');
  if (!analysis) return;
  const p = analysis.program;
  try {
    clearTrace();
    const idx = p.sampleIndices(5);
    list.innerHTML = idx.map((ix, i) => {
      const o = p.at(ix);
      return item(i + 1, o.text, o.tags, ix);
    }).join('');
    note.textContent = p.count <= 5n ? 'That is every permutation. Click one to see how it is made.' : `${idx.length} distinct random outputs. Click one to see how it is made.`;
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
  $('b-list').addEventListener('click', safe(listAll));
}

function listAll(): void {
  if (!analysis) return;
  const p = analysis.program;
  const rows: string[] = [];
  let i = 0;
  for (const o of p.all({ limit: ALL_LIMIT })) {
    rows.push(item(i + 1, o.text, o.tags, BigInt(i)));
    i++;
  }
  $('all-list').innerHTML = rows.join('');
  const intro = $('all-intro');
  const shown = p.count > BigInt(ALL_LIMIT) ? `Showing the first ${formatCount(BigInt(ALL_LIMIT))} of ${formatCount(p.count)} permutations.` : `Showing all ${formatCount(p.count)}.`;
  intro.innerHTML = `<span>${shown}</span><button id="b-copy-all" type="button">Copy ${formatCount(BigInt(i))}</button>`;
  $('b-copy-all').addEventListener('click', safe(() => copyTexts('#all-list')));
  $('all-note').textContent = p.count > BigInt(ALL_LIMIT) ? 'The rest are not listed. The command line tool can write them all: perm file.perm --all' : '';
}

function showTab(which: 'random' | 'all'): void {
  $('view-random').hidden = which !== 'random';
  $('view-all').hidden = which !== 'all';
  $('tab-random').setAttribute('aria-selected', String(which === 'random'));
  $('tab-all').setAttribute('aria-selected', String(which === 'all'));
}
on('tab-random', () => showTab('random'));
on('tab-all', () => showTab('all'));
on('b-new', renderSamples);
on('b-copy5', () => copyTexts('#samples'));

/** Copy the texts of a list of examples, one per line. */
function copyTexts(list: string): void {
  const texts = [...document.querySelectorAll<HTMLElement>(`${list} .ex-row .t`)].map((e) => e.textContent ?? '');
  if (!texts.length) return;
  const n = texts.length;
  navigator.clipboard.writeText(texts.join('\n')).then(
    () => toast(`Copied ${n} ${n === 1 ? 'example' : 'examples'}`),
    () => toast('Copy failed: the browser did not allow it'),
  );
}

// --- toolbar ---------------------------------------------------------------

let toastTimer: number | undefined;
let toastHasAction = false;

/** A short message at the bottom of the window, optionally with one action such as Undo. */
function toast(msg: string, action?: { label: string; run: () => void }): void {
  const t = $('toast');
  t.textContent = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener(
      'click',
      safe(() => {
        t.classList.remove('show');
        action.run();
      }),
    );
    t.appendChild(b);
  }
  t.classList.add('show');
  toastHasAction = !!action;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.classList.remove('show');
    toastHasAction = false;
  }, action ? 8000 : 2200);
}

$('b-share').addEventListener(
  'click',
  safe(async () => {
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
  }),
);
on('b-reset', () => {
  const before = editor.getText();
  if (before === DEFAULT_PROGRAM) {
    toast('This is already the example.');
    return;
  }
  editor.setText(DEFAULT_PROGRAM);
  toast('Example loaded. Your code was replaced.', { label: 'Undo', run: () => editor.setText(before) });
});
on('b-expand', () => runConvert('long', undefined, undefined));
on('b-collapse', () => runConvert('short', undefined, undefined));

// --- syntax help -------------------------------------------------------------

function buildHelp(): void {
  const list = $('help-list');
  list.textContent = '';
  for (const h of HELP_ITEMS) {
    const li = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = h.title;
    const text = document.createElement('span');
    text.textContent = h.text;
    const code = document.createElement('code');
    code.textContent = h.snippet.trimEnd();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Insert';
    btn.setAttribute('aria-label', `Insert ${h.title} snippet into the code`);
    btn.addEventListener(
      'click',
      safe(() => {
        const sel = editor.view.state.selection.main;
        const ins = insertionFor(h, editor.getText(), sel.from, sel.to);
        editor.view.dispatch({ changes: { from: ins.from, to: ins.to, insert: ins.insert }, selection: { anchor: ins.cursor }, scrollIntoView: true, userEvent: 'input.snippet' });
        toast(`Inserted ${h.title.toLowerCase()}`);
      }),
    );
    li.append(title, text, code, btn);
    list.appendChild(li);
  }
  const keys = $('help-keys');
  keys.textContent = '';
  for (const [k, what] of SHORTCUTS) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    for (const [i, part] of k.split(' / ').entries()) {
      if (i) th.append(' / ');
      const kbd = document.createElement('kbd');
      kbd.textContent = part;
      th.appendChild(kbd);
    }
    const td = document.createElement('td');
    td.textContent = what;
    tr.append(th, td);
    keys.appendChild(tr);
  }
}
buildHelp();

function setHelp(open: boolean): void {
  $('help').hidden = !open;
  $('b-help').setAttribute('aria-expanded', String(open));
  if (open) $('help-close').focus();
  else $('b-help').focus();
}
on('b-help', () => setHelp($('help').hidden !== false));
on('b-keys', () => {
  setHelp(true);
  $('help-keys-title').scrollIntoView({ block: 'start' });
});
on('help-close', () => setHelp(false));
$('help').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setHelp(false);
});

// --- start -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.popover')) closePopover();
  else clearTrace();
});

// Undo and redo work everywhere, so a change made in the chart can be undone from the chart.
// Inside the code editor and text fields their own undo applies.
function undoOnce(): void {
  if (undo(editor.view)) refresh();
}
const UNDO = { label: 'Undo', run: undoOnce };
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  const isUndo = k === 'z' && !e.shiftKey;
  const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.metaKey);
  if (!isUndo && !isRedo) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest('.cm-editor, input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
  safe(() => {
    const did = isUndo ? undo(editor.view) : redo(editor.view);
    if (did) refresh();
    toast(did ? (isUndo ? 'Undone' : 'Redone') : isUndo ? 'Nothing to undo' : 'Nothing to redo');
  })();
});
refresh();
showTab('random');
