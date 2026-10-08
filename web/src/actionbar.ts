// The selection's action bar. Clicking a box selects it, and this strip at the bottom of the
// chart pane names the selection and offers labelled buttons for it. It never covers the chart
// and nothing depends on hover. `barActions` is pure, so what each kind of selection offers is
// unit-tested; `ActionBar` only draws the buttons.

import type { Box } from './layout';

export type ActionId =
  | 'edit'
  | 'goto'
  | 'retarget'
  | 'add'
  | 'up'
  | 'down'
  | 'delete'
  | 'tag'
  | 'guard'
  | 'chip-edit'
  | 'chip-remove'
  | 'extract'
  | 'clear'
  | 'rename'
  | 'convert'
  | 'delete-def'
  | 'wrap'
  | 'optional'
  | 'insert-ref'
  | 'inline'
  | 'delimiter'
  | 'delete-piece'
  | 'vary'
  | 'repeat-edit'
  | 'repeat-remove'
  | 'transform-edit'
  | 'transform-remove';

export interface ActionSpec {
  id: ActionId;
  label: string;
  /** Tooltip and accessible name, with the keyboard shortcut when there is one. */
  title: string;
  disabled?: boolean;
  danger?: boolean;
  /** Buttons in different groups get a divider between them. */
  group: number;
}

export interface BarInput {
  box: Box | undefined;
  /** The alternative the selection sits in, if any. */
  row: Box | undefined;
  /** The choice that holds that alternative, if any. */
  frame: Box | undefined;
  /** How many alternatives are selected for extraction (0 or 1 means a plain selection). */
  multi: number;
  canEdit: boolean;
  /** The choice can be edited structurally (add, move, delete). */
  restructure: boolean;
  caps: { tag: boolean; guard: boolean; move: boolean };
  canExtract: boolean;
  /** How many branches a reference could point at. */
  branches?: number;
  /** A choice whose delimiter this selection can set (the choice itself, or its chips). */
  delimFrame?: Box | undefined;
  /** The selected piece in its sequence: is it all its alternative (or branch) holds, can it go? */
  piece?: { sole: boolean; deletable: boolean } | undefined;
}

const TEXTUAL = new Set(['text', 'empty', 'range']);

export function barActions(s: BarInput): ActionSpec[] {
  const b = s.box;
  if (!b || !s.canEdit) return [];
  if (s.multi > 1) {
    return [
      { id: 'extract', label: `Extract ${s.multi} alternatives…`, title: 'Move the selected alternatives into a new branch', group: 0, disabled: !s.canExtract },
      { id: 'clear', label: 'Clear selection', title: 'Clear the selection (Escape)', group: 1 },
      { id: 'delete', label: `Delete ${s.multi} alternatives`, title: 'Delete the selected alternatives (Delete)', group: 4, danger: true },
    ];
  }
  if (b.kind === 'def' || b.kind === 'defLabel') {
    const long = b.form === 'long';
    const isMain = b.name === 'main' || b.name === '<main>';
    return [
      { id: 'rename', label: 'Rename…', title: isMain ? 'main is where the program starts, so it keeps its name' : 'Rename this branch and every reference to it', group: 0, disabled: isMain },
      { id: 'convert', label: long ? 'Collapse to short form' : 'Expand to long form', title: long ? 'Write this branch on one line' : 'Write this branch one piece per line', group: 0 },
      { id: 'delete-def', label: 'Delete branch…', title: isMain ? 'main is where the program starts, so it cannot be deleted' : 'Delete this branch (only when nothing refers to it)', group: 1, danger: true, disabled: isMain },
    ];
  }
  if (b.kind === 'nsHeader' || b.kind === 'sectionLabel') return [];

  const out: ActionSpec[] = [];
  if (TEXTUAL.has(b.kind)) {
    const label = b.kind === 'empty' ? 'Fill in' : b.kind === 'range' ? 'Edit range' : 'Edit';
    out.push({ id: 'edit', label, title: `${label} (Enter, or double-click)`, group: 0 });
    // Several words in one box: let some of them vary without retyping the rest.
    if (b.kind === 'text' && /\S\s+\S/.test(b.full)) out.push({ id: 'vary', label: 'Vary words…', title: 'Make some of these words a choice, or optional', group: 0 });
  } else if (b.kind === 'ref') {
    const name = b.target ?? b.full.replace(/^\$/, '');
    out.push({ id: 'goto', label: `Go to ${name}`, title: `Show the ${name} branch (Enter, or double-click)`, group: 0 });
    out.push({ id: 'retarget', label: 'Change target', title: 'Point this reference at another branch (F2)', group: 0 });
    out.push({ id: 'inline', label: 'Inline', title: `Replace this reference with what ${name} contains`, group: 0 });
  } else if (b.kind === 'repeat') {
    out.push({ id: 'repeat-edit', label: 'Change count…', title: 'Set how many times this repeats', group: 0 });
    out.push({ id: 'repeat-remove', label: 'Remove repeat', title: 'Use the part once instead', group: 4, danger: true });
  } else if (b.kind === 'transform') {
    out.push({ id: 'transform-edit', label: 'Change…', title: 'Pick other transforms (lower, upper, capitalize, title, trim)', group: 0 });
    out.push({ id: 'transform-remove', label: 'Remove transform', title: 'Use the text as it is', group: 4, danger: true });
  } else if (b.kind === 'tag' || b.kind === 'guard') {
    out.push({ id: 'chip-edit', label: b.kind === 'tag' ? 'Edit tag' : 'Edit guard', title: `Change this ${b.kind} (Enter)`, group: 0 });
    out.push({ id: 'chip-remove', label: b.kind === 'tag' ? 'Remove tag' : 'Remove guard', title: `Remove this ${b.kind} (Delete)`, group: 4, danger: true });
  }

  const inChoice = !!s.frame && s.restructure;
  const any = s.frame?.frameOf === 'anyorder';
  if (inChoice && s.row) {
    const idx = s.row.index ?? 0;
    const count = s.row.count ?? 1;
    out.push({ id: 'add', label: any ? '+ Item' : '+ Alternative', title: any ? 'Add an item after this one (+)' : 'Add an alternative after this one (+)', group: 1 });
    // Any-order items are used in every order, so moving one changes nothing: no arrows.
    if (!any) {
      out.push({ id: 'up', label: '↑', title: 'Move this alternative up (Alt+Up)', group: 1, disabled: !s.caps.move || idx <= 0 });
      out.push({ id: 'down', label: '↓', title: 'Move this alternative down (Alt+Down)', group: 1, disabled: !s.caps.move || idx >= count - 1 });
    }
    if (b.kind !== 'tag' && b.kind !== 'guard') {
      const own = b.kind === 'text' || b.kind === 'ref' || b.kind === 'value';
      if (own && s.piece && !s.piece.sole && s.piece.deletable) {
        // The alternative holds more than this piece: say which one Delete removes.
        out.push({ id: 'delete-piece', label: 'Delete', title: `Delete “${b.full}” only (Delete)`, group: 4, danger: true });
        out.push({ id: 'delete', label: any ? 'Delete item' : 'Delete alternative', title: count < 2 ? `The only ${any ? 'item' : 'alternative'} cannot be deleted` : `Delete the whole ${any ? 'item' : 'alternative'}, everything in it`, group: 4, danger: true, disabled: count < 2 });
      } else {
        out.push({ id: 'delete', label: 'Delete', title: count < 2 ? `The only ${any ? 'item' : 'alternative'} cannot be deleted` : `Delete this ${any ? 'item' : 'alternative'} (Delete)`, group: 4, danger: true, disabled: count < 2 });
      }
    }
    if (s.frame?.frameOf === 'group') {
      if (s.caps.tag) out.push({ id: 'tag', label: '+ Tag…', title: 'Set a tag when this alternative is chosen (t)', group: 2 });
      if (s.caps.guard) out.push({ id: 'guard', label: '+ Guard…', title: 'Only allow this alternative when a tag is set (g)', group: 2 });
    }
  } else if (inChoice && b.kind === 'frame') {
    out.push({ id: 'add', label: any ? '+ Item' : '+ Alternative', title: any ? 'Add an item at the end (+)' : 'Add an alternative at the end (+)', group: 1 });
  } else if (b.kind === 'text' || b.kind === 'ref') {
    // Not in a choice yet: offer to make one.
    out.push({ id: 'wrap', label: '+ Alternative', title: 'Turn this into a choice with another alternative (+)', group: 1 });
    out.push({ id: 'optional', label: 'Make optional', title: 'Allow this to be left out: adds an empty alternative', group: 1 });
    if (s.piece?.deletable && !s.piece.sole) out.push({ id: 'delete-piece', label: 'Delete', title: `Delete “${b.full}” (Delete)`, group: 4, danger: true });
  }
  if (b.kind === 'frame' && inChoice && !any && b.node?.kind === 'group') {
    // Always in the same slot: disabled when already optional, so buttons never slide around.
    const already = b.node.options.some((o) => o.seq.pieces.length === 0 || o.seq.pieces.every((p) => p.node.kind === 'text' && p.node.value === ''));
    out.push({ id: 'optional', label: 'Make optional', title: already ? 'Already optional: it has an empty alternative' : 'Add an empty alternative, so this choice can be left out', group: 1, disabled: already });
  }
  if (b.kind === 'frame' && s.piece?.deletable && !s.piece.sole) {
    out.push({ id: 'delete-piece', label: 'Delete choice', title: 'Delete this whole choice (Delete)', group: 4, danger: true });
  }
  if ((b.kind === 'text' || b.kind === 'ref') && (s.branches ?? 1) > 0) {
    out.push({ id: 'insert-ref', label: 'Insert reference…', title: 'Insert $name of a branch right after this', group: 3 });
  }
  if (s.delimFrame && (b.kind === 'frame' || b.kind === 'anyorder' || b.kind === 'delimiter' || b.kind === 'repeat')) {
    const what = s.delimFrame.frameOf === 'repeat' ? 'the copies of this repeat' : 'the parts of this choice';
    out.push({ id: 'delimiter', label: 'Delimiter…', title: `Set what joins ${what}`, group: 2 });
  }
  if (s.canExtract) out.push({ id: 'extract', label: 'Extract…', title: 'Move this into a new branch and refer to it by name', group: 3 });
  // Destructive actions go last, so nothing else slides under the pointer into their place.
  return out.map((a, i) => ({ a, i })).sort((x, y) => x.a.group - y.a.group || x.i - y.i).map((x) => x.a);
}

export class ActionBar {
  private specs: ActionSpec[] = [];
  private lastAction: string | undefined;
  private actions: HTMLDivElement;
  private caption: HTMLSpanElement;
  private hint: HTMLElement;

  /** `root` holds the hint (shown when nothing is selected) and gets the caption and buttons. */
  constructor(
    readonly el: HTMLElement,
    private onRun: (id: ActionId) => void,
  ) {
    this.hint = el.querySelector('.selbar-hint') as HTMLElement;
    this.caption = document.createElement('span');
    this.caption.className = 'selbar-caption';
    this.caption.hidden = true;
    this.actions = document.createElement('div');
    this.actions.className = 'selbar-actions';
    this.actions.setAttribute('role', 'toolbar');
    this.actions.hidden = true;
    el.append(this.caption, this.actions);
    this.actions.addEventListener('scroll', () => this.markOverflow(), { passive: true });
    // A plain mouse wheel scrolls the row sideways.
    this.actions.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || this.actions.scrollWidth <= this.actions.clientWidth) return;
        e.preventDefault();
        this.actions.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
    new ResizeObserver(() => this.markOverflow()).observe(this.actions);
    // Focus moving along the row reveals hidden buttons; keep the fade up to date.
    this.actions.addEventListener('focusin', () => requestAnimationFrame(() => this.markOverflow()));
    this.actions.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.onRun('clear');
        return;
      }
      const btns = [...this.actions.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (i === -1) return;
      let next: HTMLButtonElement | undefined;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') next = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      else if (e.key === 'Home') next = btns[0];
      else if (e.key === 'End') next = btns[btns.length - 1];
      if (next) {
        e.preventDefault();
        this.rove(next);
        next.focus();
      }
    });
  }

  get visible(): boolean {
    return !this.actions.hidden;
  }

  /** Show the selection's name and its actions. With no actions, show `note` instead (or the hint). */
  show(specs: ActionSpec[], label: string, note?: string): void {
    if (!specs.length) {
      this.hide(note);
      return;
    }
    if (!sameSpecs(specs, this.specs) || this.actions.hidden) {
      this.specs = specs;
      this.actions.textContent = '';
      let group = specs[0]?.group;
      for (const s of specs) {
        if (s.group !== group) {
          const sep = document.createElement('span');
          sep.className = 'sep';
          sep.setAttribute('aria-hidden', 'true');
          this.actions.appendChild(sep);
          group = s.group;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = s.label;
        btn.title = s.title;
        if (s.label.length <= 2) btn.setAttribute('aria-label', s.title);
        btn.dataset['action'] = s.id;
        if (s.danger) btn.classList.add('danger');
        btn.disabled = !!s.disabled;
        btn.addEventListener('click', (e) => {
          // The second click of a double-click acts on whatever the first click left selected, so
          // it is ignored: a double-clicked Delete deletes one thing, not two. Only the move
          // buttons repeat, so clicking Move down quickly moves several places.
          const repeats = s.id === 'up' || s.id === 'down';
          if (e.detail >= 2 && !(repeats && this.lastAction === s.id)) return;
          this.lastAction = s.id;
          this.onRun(s.id);
        });
        btn.addEventListener('focus', () => this.rove(btn));
        this.actions.appendChild(btn);
      }
      // A toolbar is one Tab stop: arrows move between its buttons.
      const first = this.actions.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if (first) this.rove(first);
    }
    this.caption.textContent = label;
    this.caption.title = label;
    this.caption.classList.remove('note');
    this.caption.hidden = false;
    this.actions.hidden = false;
    this.actions.setAttribute('aria-label', `Actions for ${label}`);
    this.hint.hidden = true;
    this.markOverflow();
  }

  hide(note?: string): void {
    this.specs = [];
    this.actions.hidden = true;
    this.actions.textContent = '';
    this.caption.hidden = note === undefined;
    this.caption.textContent = note ?? '';
    this.caption.title = note ?? '';
    // A note gets the whole strip, so it is never cut short.
    this.caption.classList.toggle('note', note !== undefined);
    this.hint.hidden = note !== undefined;
  }

  /** Fade the right edge when there are more buttons than fit, so it is clear the row scrolls. */
  markOverflow(): void {
    const a = this.actions;
    a.classList.toggle('overflowing', a.scrollWidth > a.clientWidth + 1 && a.scrollLeft + a.clientWidth < a.scrollWidth - 1);
  }

  private rove(to: HTMLButtonElement): void {
    for (const b of this.actions.querySelectorAll<HTMLButtonElement>('button')) b.tabIndex = b === to ? 0 : -1;
  }

  /** Focus the button for an action, or the first enabled one when it is gone or disabled. */
  /** Focus the button for `id`; false when the strip no longer has it. */
  focusAction(id: string): boolean {
    const b = this.actions.querySelector<HTMLButtonElement>(`button[data-action="${id}"]:not(:disabled)`);
    b?.focus();
    return !!b;
  }

  /** Focus the first enabled button. */
  focusFirst(): boolean {
    const b = this.actions.querySelector<HTMLButtonElement>('button:not(:disabled)');
    b?.focus();
    return !!b;
  }

  contains(node: Node | null): boolean {
    return !!node && this.actions.contains(node);
  }
}

function sameSpecs(a: ActionSpec[], b: ActionSpec[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i]?.id && s.label === b[i]?.label && !!s.disabled === !!b[i]?.disabled);
}
