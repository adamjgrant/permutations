import type { Node, RefNode, TextNode } from '../../src/core/types';
import { Analysis, analyze, DEFAULT_PROGRAM, decodeShare, describeError, encodeShare, formatCount, isBlank, tagLabel } from './model';
import { Box, layout, Layout } from './layout';
import { canvasMeasure, ChartActions, ChartView, DefAction, FocusKey } from './chart';
import { createEditor } from './editor';
import {
  addAlternative, addGuard, addTag, alternatives, applyPatches, ChoiceNode, deleteAlternative, EditResult, editGuard, editRange, editTag, editText, fillEmpty,
  guardInputOf, isStructurallyEditable, mapAfterMove, mapOffset, moveAlternative, parseGuardInput, parseTagInput, removeAlternatives, tagInputOf, Patch,
} from './patch';
import {
  convertForms, createDefinition, deleteDefinition, EditOrError, ExtractSelection, extractToBranch, failed, referencesTo, renameDefinition,
  inlineReference, retargetReference, skippedNotice, uniqueName,
} from './defs';
import { closePopover, openPopover } from './popover';
import { EXAMPLE_PROGRAMS, HELP_ITEMS, insertionFor, SHORTCUTS } from './help';
import { ActionBar, ActionId, barActions } from './actionbar';
import { insertReference, pieceRange, varyWords, wordsOf, WrapNode, wrapInChoice } from './insert';
import { anyOrderSequence, pathBoxes } from './trace';
import { deletePiece, isSolePiece, locatePiece } from './remove';
import { setDelimiter, setSettings } from './delim';
import { parseCount, removeRepeat, removeTransform, setRepeatCount, setTransforms } from './wrappers';
type DelimTarget = Parameters<typeof setDelimiter>[1];
import { focusable, inside, selectable } from './nav';
import { redo, undo } from '@codemirror/commands';
import { builtinTransforms, seededRandom, visit } from '../../src/index';
import type { Output, Trace } from '../../src/index';

const STORAGE_KEY = 'permutations.v3.source';
const ALL_LIMIT = 1000;
const DEBOUNCE_MS = 250;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// --- never white-screen --------------------------------------------------------

type Fix = { label: string; run: () => void };

function showError(message: string, offset?: number, fixes: Fix[] = []): void {
  const box = $('error');
  box.hidden = false;
  box.textContent = message;
  box.title = offset === undefined ? '' : 'Click to jump to the error';
  box.onclick = offset === undefined ? null : () => editor.focusAt(offset);
  for (const fix of fixes) {
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

/** Replace the reference the error points at with `insert` (the reference is `$path` at `offset`). */
const replaceRef = (offset: number, path: string, insert: string): Fix['run'] => () => {
  const src = editor.getText();
  if (src.slice(offset, offset + path.length + 1) !== `$${path}`) return;
  applyEdit({ patches: [{ from: offset, to: offset + path.length + 1, insert }] });
};

/** Compiler messages written for the command line, said the way the web app works. */
function webError(message: string, offset?: number): { message: string; fixes: Fix[] } {
  const unknown = /^Unknown reference \$([A-Za-z_][\w.]*) \((line \d+, column \d+)\)\.?\s*(.*)$/s.exec(message);
  if (unknown) {
    const name = unknown[1] as string;
    const where = unknown[2] as string;
    const rest = unknown[3] ?? '';
    const create: Fix = {
      label: `Create branch ${name}`,
      run: () => {
        const r = createDefinition(editor.getText(), name);
        if (failed(r)) notify(r.error, 'warn');
        else applyEdit(r, { then: () => gotoBranch(name) });
      },
    };
    const near = /Did you mean \$([\w.]+)\?/.exec(rest);
    if (near && offset !== undefined) {
      const to = near[1] as string;
      return { message: `There is no branch named ${name} (${where}). Did you mean ${to}?`, fixes: [{ label: `Use ${to}`, run: replaceRef(offset, name, `$${to}`) }, create] };
    }
    const letters = /use brackets: (\[\$([\w.]+)\]\w+)/.exec(rest);
    if (letters && offset !== undefined) {
      const fixed = letters[1] as string;
      return {
        message: `There is no branch named ${name} (${where}). To put letters right after $${letters[2]}, write ${fixed}.`,
        fixes: [{ label: `Write ${fixed}`, run: replaceRef(offset, name, fixed) }, create],
      };
    }
    const group = /is a group of branches, so pick one: (.*)$/.exec(rest);
    if (group) return { message: `${name} is a group of branches, not one branch (${where}). Pick one: ${group[1]}.`, fixes: [] };
    return { message: `There is no branch named ${name} (${where}). Fix the name, or create the branch.`, fixes: [create] };
  }
  const mod = /^Cannot find module '([^']+)' \((line \d+, column \d+)\)/.exec(message);
  if (mod) return { message: `Imports do not work in the web app, so “${mod[1]}” cannot be loaded (${mod[2]}). Copy its branches into this code instead.`, fixes: [] };
  // The compiler's messages are written for a terminal; here they read as sentences.
  return { message: /[.!?…]$/.test(message) ? message : message + '.', fixes: [] };
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
    const m = `That change was not applied, because it would break the program: ${describeError(e).message}.`;
    notify(m, 'warn');
    return m;
  }
  clearNotice();
  const barFocus = bar.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset['action'] : undefined;
  // A dialog opened from the chart or the strip hands focus back to the chart afterwards.
  const fromDialog = !!document.activeElement?.closest('.popover');
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
  // A placeholder that you name straight away (+ Alternative, Wrap, Vary words) stays out of
  // the undo history: naming it makes the whole change again, as one step, and cancelling takes
  // it out without leaving anything for Redo to bring back.
  const placeholder = !!(opts.startEdit && opts.fresh);
  const inverse = editor.patch(result.patches, undefined, placeholder ? { history: false } : undefined);
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
    // Back to the strip button that was used, or, when the selection no longer has it (the
    // thing it removed is gone), to the box in the chart.
    if (barFocus) {
      if (!bar.focusAction(barFocus)) chart.focusBox(landed.id, true, true);
    } else if (fromDialog) chart.focusBox(landed.id, true, true);
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
        onCancel: () => void historyStep(placeholder ? () => (editor.revert(inverse), true) : undo, true),
        ...(fresh
          ? {
              onCommit: (value: string) => {
                // Take the placeholder back out, then make the whole change again with your text.
                editor.revert(inverse);
                const err = applyEdit(fresh(value));
                if (err) editor.patch(result.patches, undefined, { history: false });
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
  // The note about a multi-selection goes with it.
  if (multi.size && /alternatives? selected/.test($('notice-text').textContent ?? '')) clearNotice();
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

/** The first box in an alternative that can take focus (rows themselves cannot). */
function firstIn(row: Box): Box | undefined {
  return chart.boxes
    .filter((b) => b.id !== row.id && focusable(b) && b.kind !== 'tag' && b.kind !== 'guard' && inside(b, row))
    .sort((a, b) => a.y - b.y || a.x - b.x)[0];
}

/** Delete every selected alternative of one choice, as one change. */
function deleteSelectedRows(): void {
  if (!analysis || !canEdit()) return;
  const rows = chart.boxes.filter((b) => multi.has(b.id) && b.kind === 'row');
  const node = rows[0]?.node as ChoiceNode | undefined;
  if (!node || rows.some((r) => r.node !== node)) return;
  if (rows.length >= alternatives(node).length) {
    notify('A choice needs at least one alternative. Select fewer, or delete the whole choice.', 'warn');
    return;
  }
  const patches = removeAlternatives(analysis.source, node, rows.map((r) => r.index ?? 0));
  const n = rows.length;
  const first = rows.reduce((a, r) => ((r.index ?? 0) < (a.index ?? 0) ? r : a));
  const keep = chart.boxes.find((b) => b.kind === 'row' && b.node === node && !multi.has(b.id) && (b.index ?? 0) < (first.index ?? 0)) ?? chart.boxes.find((b) => b.kind === 'row' && b.node === node && !multi.has(b.id));
  multi.clear();
  const target = keep ? (firstIn(keep) ?? keep) : undefined;
  if (!applyEdit(patches ? { patches } : undefined, target ? { focus: target } : {})) toast(`${n} alternatives deleted.`, UNDO);
}

function toggleRow(box: Box): void {
  const row = chart.contextFor(box.id).row;
  if (!row) return;
  if (multi.size === 0) {
    // Start the set with the alternative that was selected, unless that is the one toggled.
    const cur = chart.contextFor(selectedId).row;
    if (cur && cur.id !== row.id) multi.add(cur.id);
  }
  const first = chart.boxes.find((b) => b.id === [...multi][0]);
  if (first && first.frameId !== row.frameId) multi.clear();
  if (multi.has(row.id)) multi.delete(row.id);
  else multi.add(row.id);
  selectedId = row.id;
  barOn = true;
  chart.setSelected([...multi]);
  notify(
    multi.size === 1
      ? '1 alternative selected. Shift-click more, then use Extract… in the strip.'
      : `${multi.size} alternatives selected. Use Extract… in the strip to move them into a new branch.`,
  );
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
    // Moving with the arrows through the same choice keeps a multi-selection, so Space can add
    // the alternative focus lands on.
    if (multi.size > 0) {
      const row = chart.contextFor(b.id).row;
      const first = chart.boxes.find((x) => x.id === [...multi][0]);
      if (row && first && first.frameId === row.frameId) {
        selectedId = b.id;
        chart.setSelected([...multi]);
        updateTools();
        return;
      }
    }
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
    const branches = new Set(branchNames());
    if (box.kind === 'text') result = editText(src, box.node as TextNode, value, branches);
    else if (box.kind === 'empty') result = box.node?.kind === 'text' ? editText(src, box.node, value, branches) : box.range ? fillEmpty(src, box.range, value, branches) : undefined;
    else if (box.kind === 'range' && box.range) result = editRange(src, box.range, value);
    else if (box.kind === 'ref' && box.node?.kind === 'ref') result = retargetReference(src, box.node as RefNode, value);
    const err = applyEdit(result, { focus: box });
    if (!err && (box.kind === 'text' || box.kind === 'empty')) {
      const named = [...value.matchAll(/\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g)].map((m) => m[1] as string);
      const made = named.filter((n) => branches.has(n));
      const unknown = named.filter((n) => !branches.has(n));
      if (made.length) toast(`${made.map((n) => '$' + n).join(', ')} ${made.length === 1 ? 'is a reference' : 'are references'} to the branch${made.length === 1 ? '' : 'es'} of that name.`, UNDO);
      else if (unknown.length) notify(`There is no branch named ${unknown[0]}, so $${unknown[0]} is written as text. To make it a reference, create the branch first, or use Insert reference.`);
    }
    return err;
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
          ? chart.boxes.find((d) => d.kind === 'def' && inside(box, d))?.name === analysis.main.name
            ? 'This is all main holds, so it cannot be deleted. Change its text instead.'
            : 'This is all its branch holds, so it cannot be deleted on its own. Delete the branch instead.'
          : 'This cannot be deleted from the chart. Delete it in the code.',
      'warn',
    );
  },
  removeChip(box) {
    if (!analysis || !canEdit()) return;
    let err: string | undefined = 'none';
    const owner = ownerOf(box);
    const focus = owner ? { focus: owner } : {};
    if (box.kind === 'tag' && box.tag) err = applyEdit(editTag(analysis.source, box.tag, null), focus);
    else if (box.kind === 'guard' && box.guard) err = applyEdit(editGuard(analysis.source, box.guard, null), focus);
    if (!err) toast(`${box.kind === 'tag' ? 'Tag' : 'Guard'} removed.`, UNDO);
  },
  addAlternative(frame, after) {
    if (!analysis || !canEdit()) return;
    const src = analysis.source;
    const node = frame.node as ChoiceNode;
    applyEdit(addAlternative(src, node, 'new', after), { startEdit: true, fresh: (v) => addAlternative(src, node, v, after, new Set(branchNames())) });
  },
  deleteAlternative(row) {
    if (!analysis || !canEdit()) return;
    if (multi.size > 1 && multi.has(row.id)) {
      deleteSelectedRows();
      return;
    }
    const what = (row.node as ChoiceNode).kind === 'anyorder' ? 'Item' : 'Alternative';
    if (!applyEdit(deleteAlternative(analysis.source, row.node as ChoiceNode, row.index ?? 0))) toast(`${what} deleted.`, UNDO);
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
    // Only tags set before this choice can guard it; the walk knows which ones those are.
    const before = analysis.program.tagsBefore(a.node);
    const usable = before ? [...known].filter((k) => before.has(k)) : [...known];
    const later = before ? [...known].filter((k) => !before.has(k)) : [];
    const hintTags = usable.length
      ? ` Tags set before this choice: ${usable.join(', ')}.`
      : known.size
        ? ' No tag is set before this choice yet.'
        : ' No alternative sets a tag yet.';
    openPopover({
      title: 'Add a guard',
      label: 'Guard',
      value: '',
      hint: `A tag name, !name for "not set", name=value, or else. The alternative is only available when the guard holds.${hintTags}${later.length ? ` (${later.join(', ')} ${later.length === 1 ? 'is' : 'are'} only set later, so ${later.length === 1 ? 'it cannot' : 'they cannot'} guard this.)` : ''}`,
      placeholder: usable[0] ?? 'tag name',
      suggestions: [...usable, ...usable.map((k) => '!' + k), 'else'],
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
              notify(`No alternative sets the tag “${p.spec.name}” yet, so this guard has nothing to test. Add the tag with @ on an earlier alternative.`, 'warn');
            } else if (!err && p.spec.kind === 'tag' && later.includes(p.spec.name)) {
              notify(`“${p.spec.name}” is only set after this choice, so this guard never holds. A guard only sees tags set before it.`, 'warn');
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

/**
 * The box that takes focus when `box` goes away: the alternative a tag or guard chip sits on,
 * the piece a repeat or transform was around, or the label of the branch it is in.
 */
function ownerOf(box: Box): Box | undefined {
  const ctx = chart.contextFor(box.id);
  const node = box.node;
  if (node && (node.kind === 'repeat' || node.kind === 'transform')) {
    const inner = chart.boxes.find((b) => b.node === node.inner && selectable(b) && b.id !== box.id);
    if (inner) return inner;
  }
  if (ctx.row && ctx.row.id !== box.id) return firstIn(ctx.row) ?? ctx.row;
  const def = chart.boxes.find((d) => d.kind === 'def' && inside(box, d));
  return def ? chart.boxes.find((b) => b.kind === 'defLabel' && b.name === def.name) : undefined;
}

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
          if (!err && p.spec.kind === 'tag' && !known.has(p.spec.name)) notify(`No alternative sets the tag “${p.spec.name}”, so this guard has nothing to test.`, 'warn');
          return err;
        },
      },
      {
        label: 'Remove',
        kind: 'danger',
        run: () => {
          const owner = ownerOf(box);
          const err = applyEdit(isTag ? editTag(src, box.tag!, null) : editGuard(src, box.guard!, null), owner ? { focus: owner } : {});
          if (!err) toast(`${isTag ? 'Tag' : 'Guard'} removed.`, UNDO);
          return err;
        },
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
    message: 'Nothing refers to it. You can undo this with ⌘Z.',
    anchor: anchorOf(def),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      {
        label: 'Delete',
        kind: 'danger',
        run: () => {
          const err = applyEdit(r, neighbourLabel(name));
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
  if (names.length) notes.push(`no alternative sets ${names.map((n) => `“${n}”`).join(', ')}, so ${names.length === 1 ? 'the guard on it has' : 'guards on them have'} nothing to test. Add the tag with @ on an earlier alternative.`);
  // Two empty alternatives in one choice make leaving it out twice as likely: usually a slip.
  let doubled = 0;
  for (const d of [analysis.main, ...analysis.others]) {
    visit(d.body, (n) => {
      if (n.kind === 'group' && n.options.filter((o) => o.seq.pieces.every((p) => p.node.kind === 'text' && p.node.value === '')).length > 1) doubled++;
    });
  }
  if (doubled) notes.push(`${doubled === 1 ? 'a choice has' : `${doubled} choices have`} more than one empty alternative, so leaving it out is more likely than any other alternative.`);
  const hints = $('chart-hints');
  hints.textContent = '';
  if (notes.length) {
    const p = document.createElement('span');
    p.textContent = `Hint: ${notes.join(' Also, ')} `;
    hints.appendChild(p);
  }
  // The compiler's warnings: code that parses but probably does not do what it looks like.
  const warnings = analysis.program.warnings.filter((w) => !w.path && w.line > 0);
  for (const w of warnings.slice(0, 3)) {
    const row = document.createElement('span');
    row.className = 'warning-item';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'linkish';
    go.textContent = `Line ${w.line}`;
    go.title = 'Show it in the code';
    go.addEventListener('click', safe(() => editor.focusAt(w.offset)));
    row.append(go, `: ${w.message}. `);
    hints.appendChild(row);
  }
  if (warnings.length > 3) hints.append(`And ${warnings.length - 3} more.`);
  hints.hidden = notes.length === 0 && warnings.length === 0;
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
        ? b.frameOf === 'anyorder'
          ? 'Any-order group'
          : b.frameOf === 'repeat'
            ? 'Repeat'
            : b.frameOf === 'transform'
              ? 'Transform'
              : 'Choice'
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
  if (hasError && !analysis) {
    bar.hide('Fix the error in the code first.');
    return;
  }
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
  if (!specs.length && box.kind !== 'def' && box.kind !== 'defLabel') {
    bar.hide(`${selectionLabel(box)}. To change it, edit the code.`);
    return;
  }
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
      if (multi.size > 1) deleteSelectedRows();
      else if (ctx.row) actions.deleteAlternative(ctx.row);
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
    case 'repeat-edit':
    case 'repeat-remove':
    case 'transform-edit':
    case 'transform-remove':
      wrapperAction(id, box);
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
  // A choice's delimiter only goes between the pieces inside its alternatives, never between
  // alternatives: offer it only when some alternative has pieces to join.
  const joins = (n: Node): boolean => {
    let any = false;
    visit(n, (m) => {
      if (m.kind === 'seq' && m.pieces.some((p, i) => i > 0 && p.join)) any = true;
    });
    return any;
  };
  const ok = (f: Box | undefined): Box | undefined =>
    f &&
    f.kind === 'frame' &&
    (f.frameOf === 'group' || f.frameOf === 'anyorder' || f.frameOf === 'repeat') &&
    f.node &&
    (f.frameOf !== 'group' || joins(f.node)) &&
    analysis &&
    setDelimiter(analysis.source, f.node as DelimTarget, ' ')
      ? f
      : undefined;
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
  // Any-order groups and repeats are lists, so they can also say what joins the final two.
  const list = node.kind !== 'group';
  const last = node.kind === 'group' ? undefined : node.last;
  const items = node.kind === 'anyorder' ? Math.max(2, Math.min(3, node.items.length)) : 3;
  const sample = (d: string, l: string): string =>
    ['one', 'two', 'three'].slice(0, items).reduce((acc, w, i, all) => (i === 0 ? w : acc + (i === all.length - 1 && l !== '' ? l : d) + w), '');
  openPopover({
    title: list ? 'Delimiter and last join' : 'Delimiter',
    label: node.kind === 'repeat' ? 'Between the copies' : node.kind === 'anyorder' ? 'Between the items' : 'What joins the parts here',
    value: current ?? (node.kind === 'repeat' ? ' ' : around),
    hint:
      node.kind === 'repeat'
        ? 'A space separates words; leave it empty to glue the copies. Spaces count, so type " and " with a space on each side.'
        : list
          ? `Spaces count, so type " and " with a space on each side. Use default goes back to the delimiter around this group (${JSON.stringify(around)}).`
          : `Leave it empty for no space at all. Use default goes back to the delimiter around this choice (${JSON.stringify(around)}).`,
    ...(list ? { second: { label: 'Before the last one (optional)', value: last ?? '' } } : {}),
    ...(list ? { preview: (d: string, l: string) => `Gives: “${sample(d, l)}”` } : {}),
    anchor: anchorOf(anchor),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      {
        label: 'Set',
        kind: 'primary',
        run: (v, l) => applyEdit(list ? setSettings(src, node, { delimiter: v, last: l === '' ? null : l }) : setDelimiter(src, node, v), { focus: anchor }),
      },
      ...(current !== undefined || last !== undefined
        ? [{ label: 'Use default', run: () => applyEdit(list ? setSettings(src, node, { delimiter: null, last: null }) : setDelimiter(src, node, null), { focus: anchor }) }]
        : []),
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
  else if (!applyEdit(r, neighbourLabel(name))) toast(`Branch ${name} deleted.`, UNDO);
}

/** Focus for after deleting a branch: the label of the branch before it, or main's. */
function neighbourLabel(name: string): { focus?: Box } {
  const names = branchNames();
  const i = names.indexOf(name);
  const prev = names[i - 1] ?? names.find((n) => n !== name);
  const label = prev ? chart.boxes.find((b) => b.kind === 'defLabel' && (b.name === prev || (prev === 'main' && b.name === '<main>'))) : undefined;
  return label ? { focus: label } : {};
}

function branchNames(): string[] {
  if (!analysis) return [];
  return [analysis.main.name === '<main>' ? 'main' : analysis.main.name, ...analysis.others.map((o) => o.name)];
}

/** Change or remove the repeat or transform a chip stands for. */
function wrapperAction(id: ActionId, box: Box): void {
  if (!analysis || !box.node) return;
  const src = analysis.source;
  const owner = ownerOf(box);
  const focus = owner ? { focus: owner } : {};
  if (id === 'repeat-remove' && box.node.kind === 'repeat') {
    if (!applyEdit(removeRepeat(src, box.node), focus)) toast('Repeat removed.', UNDO);
    return;
  }
  if (id === 'transform-remove' && box.node.kind === 'transform') {
    if (!applyEdit(removeTransform(src, box.node), focus)) toast('Transform removed.', UNDO);
    return;
  }
  if (id === 'repeat-edit' && box.node.kind === 'repeat') {
    const node = box.node;
    openPopover({
      title: 'Repeat',
      label: 'How many times',
      value: node.min === node.max ? `${node.min}` : `${node.min}..${node.max}`,
      hint: 'A number such as 3, or a range such as 2..4 (each count equally likely per result).',
      anchor: anchorOf(box),
      returnFocus: document.activeElement as HTMLElement | null,
      actions: [
        {
          label: 'Set',
          kind: 'primary',
          run(v) {
            const c = parseCount(v);
            if ('error' in c) return c.error;
            return applyEdit(setRepeatCount(src, node, c.min, c.max), { focus: box });
          },
        },
        { label: 'Cancel', run: () => undefined },
      ],
    });
    return;
  }
  if (id === 'transform-edit' && box.node.kind === 'transform') {
    const node = box.node;
    const known = Object.keys(builtinTransforms);
    openPopover({
      title: 'Transform',
      label: 'Transforms',
      value: node.fns.join(' | '),
      hint: `One name, or several with | between them to pick one at random: ${known.join(', ')}.`,
      suggestions: known,
      anchor: anchorOf(box),
      returnFocus: document.activeElement as HTMLElement | null,
      actions: [
        {
          label: 'Set',
          kind: 'primary',
          run(v) {
            const fns = v.split('|').map((f) => f.trim()).filter(Boolean);
            const bad = fns.find((f) => !known.includes(f));
            if (!fns.length) return 'Type at least one transform.';
            if (bad) return `There is no transform named ${bad}. Use one of: ${known.join(', ')}.`;
            return applyEdit(setTransforms(src, node, fns), { focus: box });
          },
        },
        { label: 'Cancel', run: () => undefined },
      ],
    });
  }
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
  // The label may end with its own full stop: do not add a second one after the quote.
  const what = box.label.replace(/[.!?…]+$/, '');
  openPopover({
    title: 'Insert reference',
    label: 'Branch',
    // With one branch to choose from, it is already filled in.
    value: names.length === 1 ? (names[0] as string) : '',
    placeholder: names[0] ?? 'name',
    hint: `Inserts $name right after “${what}”. Branches: ${names.join(', ')}.`,
    suggestions: names,
    anchor: anchorOf(box),
    returnFocus: document.activeElement as HTMLElement | null,
    actions: [
      {
        label: 'Insert',
        kind: 'primary',
        run(v) {
          const name = v.trim().replace(/^\$/, '') || (names.length === 1 ? (names[0] as string) : '');
          if (!name) return `Type the name of a branch: ${names.join(', ')}.`;
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
  nameDialog('New branch', 'Name', uniqueName(src), 'Letters, digits and underscores; a dot groups branches, like letters.A. It is added at the end of the code in the same style as the rest.', undefined, (v) => {
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
    const w = webError(message, offset);
    showError(w.message, offset, w.fixes);
    editor.error(offset ?? null);
    $('stale').hidden = !analysis;
    $('ex-stale').hidden = !analysis;
    if (!analysis) showBrokenStart(offset);
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

/** The code had an error from the start, so there is no last good chart: say so plainly. */
function showBrokenStart(offset: number | undefined): void {
  const box = document.createElement('div');
  box.className = 'chart-empty';
  box.innerHTML = '<h3>The code has an error</h3><p>Fix it in the code, and the chart and the examples appear.</p>';
  if (offset !== undefined) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primary';
    b.textContent = 'Go to the error';
    b.addEventListener('click', safe(() => editor.focusAt(offset)));
    box.appendChild(b);
  }
  chart.showEmpty(box);
  $('count').textContent = '–';
  $('count').title = 'The code has an error';
  $('count-unit').textContent = 'permutations';
  $('samples').innerHTML = '<li><span class="empty-state">Examples appear when the code has no error.</span></li>';
  $('sample-note').textContent = '';
  bar.hide('Fix the error in the code first.');
}

function emptyLayout(): Layout {
  return { boxes: [], edges: [], width: 360, height: 120, defBoxes: {} };
}

// --- examples --------------------------------------------------------------

function chipsFor(tags: Record<string, string | number | boolean>): string {
  return Object.entries(tags)
    .map(([k, v]) => `<span class="chip">${escapeHtml(tagLabel(k, v))}</span>`)
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function item(n: number, text: string, tags: Record<string, string | number | boolean>, index: bigint): string {
  const shown = text === '' ? '<span class="note">(empty text)</span>' : escapeHtml(text);
  return `<li><button type="button" class="ex-row" data-index="${index}" aria-pressed="false" title="Show how this one is made, in the chart"><span class="n">${n}</span><span class="t">${shown}</span><span class="chips">${chipsFor(tags)}</span></button></li>`;
}

// --- tracing an example through the chart ----------------------------------------

let traced: string | undefined;
let tracedIndex: bigint | undefined;
/** The traces of the examples on show in Random 5 (their rows carry the position). */
let sampleTraces: (Trace & Output)[] = [];

/** How the example behind a row was made: a stored trace for Random 5, an index for All. */
function traceFor(btn: HTMLElement): (Trace & Output) | undefined {
  if (!analysis || btn.dataset['index'] === undefined) return undefined;
  const i = BigInt(btn.dataset['index']);
  if (btn.closest('ol')?.id === 'samples') return sampleTraces[Number(i)];
  return analysis.program.trace(i);
}
let tracedRow: string | undefined;

/** Light the traced path again after the chart was drawn anew (zoom, resize). */
function reapplyTrace(): void {
  if (traced === undefined || !analysis || !tracedRow) return;
  const btn = document.querySelector<HTMLElement>(tracedRow);
  const tr = btn ? traceFor(btn) : undefined;
  if (tr) chart.setTrace(pathBoxes(chart.boxes, tr), false, anyOrderSequence(chart.boxes, tr));
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
  const tr = traceFor(btn);
  if (!tr) return;
  chart.setTrace(pathBoxes(chart.boxes, tr), true, anyOrderSequence(chart.boxes, tr));
  traced = key;
  tracedIndex = BigInt(btn.dataset['index']);
  tracedRow = `#${btn.closest('ol')?.id} .ex-row[data-index="${btn.dataset['index']}"]`;
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
  // The count is of paths: when some print the same text, say how many different texts.
  let note = '';
  if (c > 1n && c <= 5000n) {
    const texts = new Set<string>();
    for (const o of analysis.program.all()) texts.add(o.text);
    if (BigInt(texts.size) < c) note = `, ${formatCount(BigInt(texts.size))} different`;
  }
  $('count-unit').textContent = (c === 1n ? 'permutation' : 'permutations') + note;
}

function renderSamples(): void {
  const list = $('samples');
  const note = $('sample-note');
  if (!analysis) return;
  const p = analysis.program;
  try {
    clearTrace();
    // Steady examples: each choice picks by the seed and its own place in the program, so an
    // edit changes only what it touches. Make a new 5 moves to the next seed.
    const outs = p.sampleSteady(5, sampleSeed);
    sampleTraces = outs;
    list.innerHTML = outs.map((o, i) => item(i + 1, o.text, o.tags, BigInt(i))).join('');
    // After an edit, mark the examples it changed, so its effect is easy to see.
    // (Only when some stayed the same: when everything changed, flashing says nothing.)
    // A row counts as changed when its text is new, not when it merely moved down a row.
    const before = new Set(lastSamples);
    const changed = outs.map((o) => lastSamples.length > 0 && !before.has(o.text));
    if (flashChanges && changed.some((c) => !c) && changed.some((c) => c)) {
      list.querySelectorAll('.ex-row').forEach((row, i) => {
        if (changed[i]) row.classList.add('changed');
      });
    }
    lastSamples = outs.map((o) => o.text);
    flashChanges = true;
    note.textContent = p.count <= 5n ? 'That is every permutation. Click one to see how it is made.' : `${outs.length} distinct random outputs. Click one to see how it is made.`;
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
    () => toast(`Copied ${n} ${n === 1 ? 'example' : 'examples'}.`),
    () => toast('Copy failed: the browser did not allow it.'),
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
  // Above the chart's hint bar and strip, so it never covers a warning or the buttons.
  const hints = $('chart-hints');
  const floor = (!hints.hidden ? hints : $('selbar')).getBoundingClientRect().top;
  const onScreen = floor > 80 && floor <= window.innerHeight;
  t.style.bottom = `${onScreen ? Math.max(16, Math.round(window.innerHeight - floor + 8)) : 16}px`;
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
      toast('Link copied.');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? 'Link copied.' : 'Copy failed. The link is in the address bar.');
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
        // Your own cursor in the code, not the place a chart selection showed.
        const sel = editor.userSelection();
        const doc = editor.getText();
        const taken = new Set(branchNames());
        // Into main unless your cursor is inside a branch: on a line of its own, a snippet
        // would belong to no branch at all.
        const inBranch = !!sel && !!analysis && [analysis.main, ...analysis.others].some((d) => sel.from >= d.range[0] && sel.from <= d.range[1]);
        const mainEnd = analysis && (!sel || !inBranch) ? analysis.main.range[1] : undefined;
        const ins = insertionFor(h, doc, sel?.from ?? 0, sel?.to ?? 0, { taken, ...(mainEnd !== undefined ? { mainEnd } : {}) });
        editor.view.dispatch({
          changes: { from: ins.from, to: ins.to, insert: ins.insert },
          selection: { anchor: ins.select[0], head: ins.select[1] },
          scrollIntoView: true,
          userEvent: 'input.snippet',
        });
        editor.highlight(ins.select);
        toast(`Inserted ${h.at === 'end' ? 'a new branch' : h.title.toLowerCase()}. It is highlighted in the code.`);
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
  const help = $('help');
  // Wide windows: the drawer sits beside the code, which wraps to its left. Narrower ones have
  // no room for both, so the drawer covers the examples pane and leaves the code whole.
  const narrow = window.innerWidth < 1200;
  const home = narrow ? document.querySelector('.ex-pane') : document.querySelector('.editor-wrap');
  if (open && home && help.parentElement !== home) home.appendChild(help);
  help.classList.toggle('over-examples', narrow);
  help.hidden = !open;
  document.querySelector('.editor-wrap')?.classList.toggle('help-open', open && !narrow);
  // The code wraps to a new width: have the editor measure again, or the gutter's line
  // numbers stay where the old lines were.
  editor.view.requestMeasure();
  window.requestAnimationFrame(() => editor.view.requestMeasure());
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
  // An example row that had focus is redrawn: keep focus on the row in the same place.
  const exRow = a?.closest('.ex-row');
  const exList = exRow?.closest('ol')?.id;
  const exIndex = exRow ? [...(exRow.closest('ol')?.querySelectorAll('.ex-row') ?? [])].indexOf(exRow) : -1;
  if (!step(editor.view)) return false;
  refresh();
  if (exList && exIndex >= 0) {
    const rows = document.querySelectorAll<HTMLElement>(`#${exList} .ex-row`);
    (rows[Math.min(exIndex, rows.length - 1)] ?? null)?.focus();
  }
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
    toast(did ? (isUndo ? 'Undone.' : 'Redone.') : isUndo ? 'Nothing to undo.' : 'Nothing to redo.');
  })();
});
refresh();
showTab('random');

// A click that ends an inline edit: the edit commits as the field loses focus (on pointerdown),
// the chart redraws, and the element the click was aimed at is gone before the click arrives. Do
// what it was for afterwards: select the box now under the pointer, or run the strip button.
document.addEventListener(
  'pointerdown',
  (e) => {
    const field = document.querySelector('input.inline-edit');
    const target = e.target as Element | null;
    if (!field || !target || field === target || e.button !== 0) return;
    const action = target.closest('.selbar-actions button')?.getAttribute('data-action') ?? undefined;
    const onChart = !!target.closest('#chart');
    if (!action && !onChart) return;
    const { clientX: x, clientY: y } = e;
    let arrived = false;
    const seen = (): void => {
      arrived = true;
    };
    document.addEventListener('click', seen, { capture: true, once: true });
    window.addEventListener(
      'pointerup',
      () =>
        window.setTimeout(
          safe(() => {
            document.removeEventListener('click', seen, { capture: true });
            if (arrived || document.querySelector('input.inline-edit, .popover')) return;
            if (action) {
              const b = document.querySelector<HTMLButtonElement>(`.selbar-actions button[data-action="${action}"]:not(:disabled)`);
              b?.click();
              return;
            }
            document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
          }),
          0,
        ),
      { once: true },
    );
  },
  true,
);
