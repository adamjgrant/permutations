import type { Node, RefNode, TextNode } from '../../src/core/types';
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
import { EXAMPLE_PROGRAMS, HELP_ITEMS, insertionFor, SHORTCUTS } from './help';
import { ActionBar, ActionId, barActions } from './actionbar';
import { insertReference, pieceRange, varyWords, wordsOf, WrapNode, wrapInChoice } from './insert';
import { pathBoxes } from './trace';
import { deletePiece, isSolePiece, locatePiece } from './remove';
import { setDelimiter } from './delim';
type DelimTarget = Parameters<typeof setDelimiter>[1];
import { inside } from './nav';
import { redo, undo } from '@codemirror/commands';
import { seededRandom, visit } from '../../src/index';

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
function applyEdit(
  result: EditOrError | EditResult | undefined,
  opts: {
    startEdit?: boolean;
    /** With startEdit: the same edit with the typed text instead of the placeholder, so adding
     *  and naming become one change (one undo step). */
    fresh?: (value: string) => EditOrError | EditResult | undefined;
    focus?: Box;
    map?: (patches: Patch[], pos: number) => number;
    then?: (patches: Patch[]) => void;
  } = {},
): string | undefined {
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
  // A dialog opened from the chart or the strip hands focus back to the chart afterwards.
  const fromDialog = !!document.activeElement?.closest('.popover') && chart.lastKey() !== undefined;
  const chartArea = chart.hasFocus() || !!barFocus || fromDialog;
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
  const sel = result.select;
  let landed: Box | undefined;
  if (!opts.focus && sel && !opts.startEdit) {
    // The edit says where its result is (an inlined branch, an inserted reference): go there.
    landed = chart.boxAtOffset(sel[0]);
    if (landed && chartArea && !barFocus) chart.focusBox(landed.id, true, true);
  } else if (key) {
    landed = barFocus ? chart.boxForKey(key, map) : chart.restoreKey(key, map, false);
  }
  if (landed && (keepBar || chartArea)) {
    selectBox(landed, { bar: true, reveal: false });
    if (barFocus) bar.focusAction(barFocus);
    else if (fromDialog) chart.focusBox(landed.id, true, true);
  }
  opts.then?.(result.patches);
  if (sel && opts.startEdit) {
    const box = chart.findByRange('text', sel);
    if (box) {
      selectBox(box, { reveal: false, bar: true });
      // Escape (or clicking away untouched) means "I did not want that": take it back out.
      const fresh = opts.fresh;
      chart.beginEdit(box, {
        placeholder: true,
        onCancel: () => void historyStep(undo, true),
        ...(fresh
          ? {
              onCommit: (value: string) => {
                // Take the placeholder back out, then make the whole change again with your text.
                undo(editor.view);
                const err = applyEdit(fresh(value));
                if (err) redo(editor.view);
                return err;
              },
            }
          : {}),
      });
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
  focusStrip: () => bar.focusFirst(),
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
  deleteBox(box) {
    if (!analysis || !canEdit()) return;
    if (box.kind === 'tag' || box.kind === 'guard') return actions.removeChip(box);
    const ctx = chart.contextFor(box.id);
    const info = pieceInfo(box);
    if (info && info.deletable && !info.sole) {
      const err = removePiece(box);
      if (err) notify(err, 'warn');
      return;
    }
    if (ctx.row && ctx.frame && actions.canRestructure(ctx.frame) && box.kind !== 'frame') {
      if ((ctx.row.count ?? 1) < 2) notify('The only alternative of a choice cannot be deleted. Delete the choice, or change its text.', 'warn');
      else actions.deleteAlternative(ctx.row);
      return;
    }
    notify(
      box.kind === 'defLabel' || box.kind === 'def'
        ? 'To delete a branch, use Delete branch… in the strip.'
        : info?.sole
          ? 'This is all its branch holds, so it cannot be deleted on its own. Delete the branch instead.'
          : 'This cannot be deleted from the chart. Delete it in the code.',
      'warn',
    );
  },
  removeChip(box) {
    if (!analysis || !canEdit()) return;
    let err: string | undefined = 'none';
    if (box.kind === 'tag' && box.tag) err = applyEdit(editTag(analysis.source, box.tag, null), { focus: box });
    else if (box.kind === 'guard' && box.guard) err = applyEdit(editGuard(analysis.source, box.guard, null), { focus: box });
    if (!err) toast(`${box.kind === 'tag' ? 'Tag' : 'Guard'} removed.`, UNDO);
  },
  addAlternative(frame, after) {
    if (!analysis || !canEdit()) return;
    const src = analysis.source;
    const node = frame.node as ChoiceNode;
    applyEdit(addAlternative(src, node, 'new', after), { startEdit: true, fresh: (v) => addAlternative(src, node, v, after) });
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
      hint: `A tag name, !name for "not set", name=value, or else. The alternative is only available when the guard holds, and the tag must be set earlier.${known.size ? ` Tags so far: ${[...known].join(', ')}.` : ' No alternative sets a tag yet.'}`,
      placeholder: [...known][0] ?? 'tag name',
      suggestions: [...known, ...[...known].map((k) => '!' + k), 'else'],
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
  if (action === 'rename' && name === 'main') {
    notify('main is where the program starts, so it keeps its name.', 'warn');
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

function relayout(keepTrace = false): void {
  if (!analysis) return;
  if (!keepTrace) clearTrace();
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
  const notes: string[] = [];
  if (names.length) notes.push(`no alternative sets ${names.map((n) => `"${n}"`).join(', ')}, so ${names.length === 1 ? 'the guard on it has' : 'guards on them have'} nothing to test. Add the tag with @ on an earlier alternative.`);
  // Two empty alternatives in one choice make leaving it out twice as likely: usually a slip.
  let doubled = 0;
  for (const d of [analysis.main, ...analysis.others]) {
    visit(d.body, (n) => {
      if (n.kind === 'group' && n.options.filter((o) => o.seq.pieces.every((p) => p.node.kind === 'text' && p.node.value === '')).length > 1) doubled++;
    });
  }
  if (doubled) notes.push(`${doubled === 1 ? 'a choice has' : `${doubled} choices have`} more than one empty alternative, so leaving it out is more likely than any other alternative.`);
  const hints = $('chart-hints');
  hints.hidden = notes.length === 0;
  hints.textContent = notes.length ? `Hint: ${notes.join(' Also, ')}` : '';
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
  relayout(true);
  reapplyTrace();
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
  reapplyTrace();
  updateTools();
}

function syncFromCursor(scroll = false): void {
  // Mirror the code cursor in the chart only while you are working in the code; otherwise a
  // box would look selected (with nothing in the strip) before you have touched anything.
  const inCode = editor.view.contentDOM.contains(document.activeElement);
  if (!canEdit() || !inCode) {
    if (!inCode && !barOn) {
      selectedId = undefined;
      chart.setSelected([]);
    }
    return;
  }
  const pos = editor.view.state.selection.main.head;
  const box = chart.boxAtOffset(pos);
  selectedId = box?.id;
  barOn = false;
  chart.setSelected(box ? [box.id] : [], true);
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
  $<HTMLButtonElement>('b-new').disabled = !analysis || analysis.program.count <= 5n;
  $('b-new').title = analysis && analysis.program.count <= 5n ? 'Every permutation is already shown' : 'Pick five other examples';
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
  const unit = ctx.frame?.frameOf === 'anyorder' ? 'item' : 'alternative';
  const of = ctx.row ? `${(ctx.row.index ?? 0) + 1} of ${ctx.row.count ?? 1}` : '';
  if (b.kind === 'row') return `${unit === 'item' ? 'Item' : 'Alternative'} ${of}`;
  return ctx.row ? `${what} · ${unit} ${of}` : what;
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
    piece: pieceInfo(box),
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
    case 'delete-piece': {
      const err = removePiece(box);
      if (err) notify(err, 'warn');
      return;
    }
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
      if (id === 'optional' && box.kind === 'frame' && analysis && box.node) {
        applyEdit(addAlternative(analysis.source, box.node as ChoiceNode, ''), { focus: box });
        return;
      }
      if (analysis && (box.node?.kind === 'text' || box.node?.kind === 'ref')) {
        const src = analysis.source;
        const node = box.node as WrapNode;
        applyEdit(wrapInChoice(src, node, id === 'wrap' ? 'new' : null), id === 'wrap' ? { startEdit: true, fresh: (v) => wrapInChoice(src, node, v) } : { focus: box });
      }
      return;
    case 'insert-ref':
      insertRefDialog(box);
      return;
    case 'vary':
      varyDialog(box);
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
    f && f.kind === 'frame' && (f.frameOf === 'group' || f.frameOf === 'anyorder' || f.frameOf === 'repeat') && f.node && analysis && setDelimiter(analysis.source, f.node as DelimTarget, ' ') ? f : undefined;
  if (box.kind === 'frame') return ok(box);
  if (box.kind !== 'anyorder' && box.kind !== 'delimiter' && box.kind !== 'repeat') return undefined;
  // A chip sits in the header of the frame it describes; the any-order group is the frame inside.
  const around = chart.boxes.filter((f) => f.kind === 'frame' && inside(box, f)).sort((a, b) => a.w * a.h - b.w * b.h);
  const inner = chart.boxes.filter((f) => f.kind === 'frame' && f.frameOf === 'anyorder' && around[0] && inside(f, around[0])).sort((a, b) => b.w * b.h - a.w * a.h);
  return ok(box.kind === 'anyorder' ? (inner[0] ?? around[0]) : around[0]);
}

function delimiterDialog(frame: Box, anchor: Box): void {
  if (!analysis || !frame.node) return;
  const node = frame.node as DelimTarget;
  const src = analysis.source;
  const current = node.delimiter;
  const around = node.kind === 'repeat' ? '' : analysis.delimiter;
  openPopover({
    title: 'Delimiter',
    label: 'What joins the parts here',
    value: current ?? (node.kind === 'repeat' ? ' ' : around),
    hint:
      node.kind === 'repeat'
        ? 'What goes between the copies. A space separates words; leave it empty to glue them. Use default glues them again.'
        : `Leave it empty for no space at all. Use default goes back to the delimiter around this choice (${JSON.stringify(around)}).`,
    anchor: anchorOf(anchor),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      { label: 'Set', kind: 'primary', run: (v) => applyEdit(setDelimiter(src, node, v), { focus: anchor }) },
      ...(current !== undefined ? [{ label: 'Use default', run: () => applyEdit(setDelimiter(src, node, null), { focus: anchor }) }] : []),
      { label: 'Cancel', run: () => undefined },
    ],
  });
}

function bodies(): Node[] {
  return analysis ? [analysis.main.body, ...analysis.others.map((o) => o.body)] : [];
}

/** Where a selected piece sits, for the strip's Delete buttons. */
function pieceInfo(box: Box): { sole: boolean; deletable: boolean } | undefined {
  const node = box.kind === 'frame' ? box.node : box.kind === 'text' || box.kind === 'ref' || box.kind === 'value' ? box.node : undefined;
  if (!node || !analysis) return undefined;
  const loc = locatePiece(bodies(), node);
  if (!loc) return undefined;
  return { sole: isSolePiece(loc), deletable: !failed(deletePiece(analysis.source, loc)) };
}

/** Delete one piece of a sequence (Delete in the strip, or the Delete key). */
function removePiece(box: Box): string | undefined {
  if (!analysis || !box.node) return 'Nothing to delete.';
  const loc = locatePiece(bodies(), box.node);
  if (!loc) return 'This cannot be deleted from the chart. Delete it in the code.';
  const r = deletePiece(analysis.source, loc);
  if (failed(r)) return r.error;
  const err = applyEdit(r);
  const what = box.kind === 'frame' ? 'the choice' : `“${box.full.length > 30 ? box.full.slice(0, 29) + '…' : box.full}”`;
  if (!err) toast(`Deleted ${what}.`, UNDO);
  return err;
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

/** Pick some words of a text box and make them a choice, or optional. */
function varyDialog(box: Box): void {
  if (!analysis || box.node?.kind !== 'text') return;
  const node = box.node as TextNode;
  const src = analysis.source;
  const words = wordsOf(node.value);
  let first = -1;
  let last = -1;
  const content = document.createElement('div');
  content.className = 'vary';
  const hint = document.createElement('p');
  hint.className = 'pop-hint';
  hint.textContent = 'Pick the words that should vary. Shift-click another word to take a run of words.';
  const row = document.createElement('div');
  row.className = 'vary-words';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Words');
  const btns = words.map((w, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = w;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', (e) => {
      if (e.shiftKey && first !== -1) {
        first = Math.min(first, i);
        last = Math.max(last, i);
      } else if (first === i && last === i) {
        first = last = -1;
      } else first = last = i;
      btns.forEach((x, j) => x.setAttribute('aria-pressed', String(first !== -1 && j >= first && j <= last)));
      for (const a of actionsEl()) a.disabled = first === -1;
    });
    row.appendChild(b);
    return b;
  });
  content.append(hint, row);
  const actionsEl = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.popover .pop-actions button')].filter((b) => b.dataset['needs'] === 'words');
  const run = (alt: string | null): string | undefined => {
    if (first === -1) return 'Pick a word first.';
    const a = first;
    const z = last;
    return applyEdit(varyWords(src, node, a, z, alt), alt === null ? { focus: box } : { startEdit: true, fresh: (v) => varyWords(src, node, a, z, v) });
  };
  openPopover({
    title: 'Vary words',
    content,
    anchor: anchorOf(box),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      { label: 'Make a choice', kind: 'primary', run: () => run('new') },
      { label: 'Make optional', run: () => run(null) },
      { label: 'Cancel', run: () => undefined },
    ],
  });
  document.querySelectorAll<HTMLButtonElement>('.popover .pop-actions button').forEach((b, i) => {
    if (i < 2) {
      b.dataset['needs'] = 'words';
      b.disabled = true;
    }
  });
}

/** Branches a reference from inside `into` can point at without making a loop. */
function safeTargets(into: string): string[] {
  if (!analysis) return [];
  const defs = [analysis.main, ...analysis.others];
  const uses = new Map<string, Set<string>>();
  for (const d of defs) {
    const out = new Set<string>();
    visit(d.body, (n) => {
      if (n.kind === 'ref' && n.target?.kind === 'def') out.add(n.target.def.name);
    });
    uses.set(d.name, out);
  }
  const reaches = (from: string, goal: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const n = stack.pop() as string;
      if (n === goal) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of uses.get(n) ?? []) stack.push(m);
    }
    return false;
  };
  return defs.map((d) => d.name).filter((n) => n !== into && n !== '<main>' && !reaches(n, into));
}

function insertRefDialog(box: Box): void {
  if (!analysis || !canEdit() || !box.node) return;
  const src = analysis.source;
  const card = chart.boxes.find((d) => d.kind === 'def' && inside(box, d));
  const names = safeTargets(card?.name ?? analysis.main.name);
  if (!names.length) {
    openPopover({
      title: 'Insert reference',
      message: 'No branch can go here without making a loop, where a branch ends up using itself. Create a new branch first, then insert it.',
      anchor: anchorOf(box),
      returnFocus: document.activeElement as HTMLElement | null,
      actions: [
        { label: 'New branch…', kind: 'primary', run: () => void setTimeout(() => $('t-new').click(), 0) },
        { label: 'Cancel', run: () => undefined },
      ],
    });
    return;
  }
  const after = locatePiece(bodies(), box.node);
  if (!after) {
    notify('A reference cannot be inserted here.', 'warn');
    return;
  }
  openPopover({
    title: 'Insert reference',
    label: 'Branch',
    value: '',
    placeholder: names[0] ?? 'name',
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
          if (!names.includes(name)) {
            return branchNames().includes(name)
              ? `${name} cannot go here: it uses this branch already, so it would loop.`
              : `There is no branch named ${name}. Create it with New branch first.`;
          }
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
  chart.fitAll();
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

/** True once you have put the cursor in the code yourself (Help inserts at your cursor then). */
let editorTouched = false;
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

let lastKeyTab = false;
document.addEventListener('keydown', (e) => (lastKeyTab = e.key === 'Tab'), true);
document.addEventListener('pointerdown', () => (lastKeyTab = false), true);
let tabHintTimer: number | undefined;
editor.view.contentDOM.addEventListener('focus', () => {
  editorTouched = true;
  // Reached with the keyboard: say that Tab indents here, and how to move on.
  if (!lastKeyTab) return;
  const h = $('editor-hint');
  h.hidden = false;
  window.clearTimeout(tabHintTimer);
  tabHintTimer = window.setTimeout(() => (h.hidden = true), 6000);
});
editor.view.contentDOM.addEventListener('blur', () => {
  $('editor-hint').hidden = true;
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
  // A shared link's code is only the starting point: once you edit, drop it from the address
  // bar, so a reload brings back your latest work instead of the shared version.
  if (location.hash.startsWith('#code=') && decodeShare(location.hash.slice(6)) !== editor.getText()) {
    history.replaceState(null, '', location.pathname + location.search);
  }
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
let tracedIndex: bigint | undefined;

/** Light the traced path again after the chart was drawn anew (zoom, resize). */
function reapplyTrace(): void {
  if (traced === undefined || tracedIndex === undefined || !analysis) return;
  chart.setTrace(pathBoxes(chart.boxes, analysis.program.trace(tracedIndex)), false);
}

function clearTrace(): void {
  if (traced === undefined) return;
  traced = undefined;
  tracedIndex = undefined;
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
  tracedIndex = BigInt(btn.dataset['index']);
  // On a narrow screen the chart may be scrolled out of sight: bring it into view.
  const r = $('chart').getBoundingClientRect();
  if (r.bottom < 40 || r.top > window.innerHeight - 40) $('chart').scrollIntoView({ block: 'start', behavior: 'smooth' });
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
    // A fixed seed keeps the same five while you edit; Make a new 5 moves to the next seed.
    const idx = p.sampleIndices(5, seededRandom(sampleSeed));
    const outs = idx.map((ix) => p.at(ix));
    list.innerHTML = outs.map((o, i) => item(i + 1, o.text, o.tags, idx[i] as bigint)).join('');
    // After an edit, mark the examples it changed, so its effect is easy to see.
    // (Only when some stayed the same: when everything changed, flashing says nothing.)
    const changed = outs.map((o, i) => lastSamples[i] !== undefined && lastSamples[i] !== o.text);
    if (flashChanges && changed.some((c) => !c) && changed.some((c) => c)) {
      list.querySelectorAll('.ex-row').forEach((row, i) => {
        if (changed[i]) row.classList.add('changed');
      });
    }
    lastSamples = outs.map((o) => o.text);
    flashChanges = true;
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
  $('b-list').addEventListener('click', safe(() => listAll()));
  // A short list needs no extra click.
  if (c <= 200n) listAll();
}

/** List results in the All tab: in order, or (for big programs) a random sample of them. */
function listAll(random = false): void {
  if (!analysis) return;
  const p = analysis.program;
  const big = p.count > BigInt(ALL_LIMIT);
  const indices: bigint[] = random ? p.sampleIndices(ALL_LIMIT, seededRandom(sampleSeed + 7)) : [];
  if (!random) for (let i = 0n; i < p.count && i < BigInt(ALL_LIMIT); i++) indices.push(i);
  if (random) indices.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  $('all-list').innerHTML = indices.map((ix, i) => {
    const o = p.at(ix);
    return item(i + 1, o.text, o.tags, ix);
  }).join('');
  const n = indices.length;
  const intro = $('all-intro');
  const shown = !big
    ? `Showing all ${formatCount(p.count)}.`
    : random
      ? `Showing ${formatCount(BigInt(n))} at random of ${formatCount(p.count)} permutations.`
      : `Showing the first ${formatCount(BigInt(n))} of ${formatCount(p.count)} permutations.`;
  intro.innerHTML = `<span>${shown}</span>${big ? `<button id="b-list-other" type="button">${random ? `The first ${formatCount(BigInt(ALL_LIMIT))}` : `${formatCount(BigInt(ALL_LIMIT))} at random`}</button>` : ''}<button id="b-copy-all" type="button">Copy ${formatCount(BigInt(n))}</button>`;
  $('b-copy-all').addEventListener('click', safe(() => copyTexts('#all-list')));
  if (big) $('b-list-other').addEventListener('click', safe(() => listAll(!random)));
  $('all-note').textContent = big ? 'The rest are not listed. The command line tool can write them all: perm file.perm --all' : '';
}

function showTab(which: 'random' | 'all'): void {
  $('view-random').hidden = which !== 'random';
  $('view-all').hidden = which !== 'all';
  for (const [id, on] of [['tab-random', which === 'random'], ['tab-all', which === 'all']] as const) {
    $(id).setAttribute('aria-selected', String(on));
    $(id).tabIndex = on ? 0 : -1;
  }
}
// The tabs are one Tab stop; arrow keys switch between them.
document.querySelector('.tabs')?.addEventListener('keydown', (e) => {
  const k = (e as KeyboardEvent).key;
  if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
  e.preventDefault();
  const next = $('tab-random').getAttribute('aria-selected') === 'true' ? 'all' : 'random';
  showTab(next);
  $(next === 'all' ? 'tab-all' : 'tab-random').focus();
});
on('tab-random', () => showTab('random'));
on('tab-all', () => showTab('all'));
let sampleSeed = Math.floor(Math.random() * 2 ** 31);
let lastSamples: string[] = [];
let flashChanges = false;
on('b-new', () => {
  sampleSeed = (sampleSeed + 1) % 2 ** 31;
  flashChanges = false;
  renderSamples();
});
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
        const doc = editor.getText();
        const taken = new Set(branchNames());
        // Into main unless your cursor is inside a branch: on a line of its own, a snippet
        // would belong to no branch at all.
        const inBranch = !!analysis && [analysis.main, ...analysis.others].some((d) => sel.from >= d.range[0] && sel.from <= d.range[1]);
        const mainEnd = analysis && (!editorTouched || !inBranch) ? analysis.main.range[1] : undefined;
        const ins = insertionFor(h, doc, sel.from, sel.to, { taken, ...(mainEnd !== undefined ? { mainEnd } : {}) });
        editor.view.dispatch({
          changes: { from: ins.from, to: ins.to, insert: ins.insert },
          selection: { anchor: ins.select[0], head: ins.select[1] },
          scrollIntoView: true,
          userEvent: 'input.snippet',
        });
        editor.highlight(ins.select);
        toast(`Inserted ${h.title.toLowerCase()}. It is highlighted in the code.`);
      }),
    );
    li.append(title, text, code, btn);
    list.appendChild(li);
  }
  const ex = $('help-examples');
  ex.textContent = '';
  for (const p of EXAMPLE_PROGRAMS) {
    const li = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = p.title;
    const text = document.createElement('span');
    text.textContent = p.text;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Load';
    btn.setAttribute('aria-label', `Load the ${p.title} example, replacing your code (you can undo)`);
    btn.addEventListener(
      'click',
      safe(() => {
        const before = editor.getText();
        if (before === p.source) return;
        editor.setText(p.source);
        refresh();
        toast(`Loaded ${p.title}. Your code was replaced.`, { label: 'Undo', run: () => editor.setText(before) });
      }),
    );
    li.append(title, text, btn);
    ex.appendChild(li);
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
  // Make room: the code wraps to the left of the open drawer instead of hiding under it.
  document.querySelector('.editor-wrap')?.classList.toggle('help-open', open);
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
  historyStep(undo);
}

/**
 * Undo or redo, then put the selection (and keyboard focus, if it was in the chart, the strip
 * or a toast) on the box where the change happened, instead of dropping focus to the page.
 */
function historyStep(step: typeof undo, focusChart = false): boolean {
  const a = document.activeElement;
  const inChartArea = focusChart || chart.hasFocus() || bar.contains(a) || !!a?.closest('.toast, .inline-edit');
  if (!step(editor.view)) return false;
  refresh();
  const box = chart.boxAtOffset(editor.view.state.selection.main.head);
  if (box && inChartArea) {
    chart.focusBox(box.id, true, true);
    selectBox(box, { bar: true, reveal: false });
  }
  return true;
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
    const did = historyStep(isUndo ? undo : redo);
    toast(did ? (isUndo ? 'Undone' : 'Redone') : isUndo ? 'Nothing to undo' : 'Nothing to redo');
  })();
});
refresh();
showTab('random');
