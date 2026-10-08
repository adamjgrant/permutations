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
  | 'insert-ref';

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
}

const TEXTUAL = new Set(['text', 'empty', 'range']);

export function barActions(s: BarInput): ActionSpec[] {
  const b = s.box;
  if (!b || !s.canEdit) return [];
  if (s.multi > 1) {
    return [
      { id: 'extract', label: `Extract ${s.multi} alternatives…`, title: 'Move the selected alternatives into a new branch', group: 0, disabled: !s.canExtract },
      { id: 'clear', label: 'Clear selection', title: 'Clear the selection (Escape)', group: 1 },
    ];
  }
  if (b.kind === 'def' || b.kind === 'defLabel') {
    const long = b.form === 'long';
    return [
      { id: 'rename', label: 'Rename…', title: 'Rename this branch and every reference to it', group: 0 },
      { id: 'convert', label: long ? 'Collapse to short form' : 'Expand to long form', title: long ? 'Write this branch on one line' : 'Write this branch one piece per line', group: 0 },
      { id: 'delete-def', label: 'Delete branch…', title: 'Delete this branch (only when nothing refers to it)', group: 1, danger: true },
    ];
  }
  if (b.kind === 'nsHeader' || b.kind === 'sectionLabel') return [];

  const out: ActionSpec[] = [];
  if (TEXTUAL.has(b.kind)) {
    const label = b.kind === 'empty' ? 'Fill in' : b.kind === 'range' ? 'Edit range' : 'Edit';
    out.push({ id: 'edit', label, title: `${label} (Enter, or double-click)`, group: 0 });
  } else if (b.kind === 'ref') {
    const name = b.target ?? b.full.replace(/^\$/, '');
    out.push({ id: 'goto', label: `Go to ${name}`, title: `Show the ${name} branch (Enter, or double-click)`, group: 0 });
    out.push({ id: 'retarget', label: 'Change target', title: 'Point this reference at another branch (F2)', group: 0 });
  } else if (b.kind === 'tag' || b.kind === 'guard') {
    out.push({ id: 'chip-edit', label: b.kind === 'tag' ? 'Edit tag' : 'Edit guard', title: `Change this ${b.kind} (Enter)`, group: 0 });
    out.push({ id: 'chip-remove', label: b.kind === 'tag' ? 'Remove tag' : 'Remove guard', title: `Remove this ${b.kind} (Delete)`, group: 0, danger: true });
  }

  const inChoice = !!s.frame && s.restructure;
  if (inChoice && s.row) {
    const idx = s.row.index ?? 0;
    const count = s.row.count ?? 1;
    out.push({ id: 'add', label: '+ Alternative', title: 'Add an alternative after this one (+)', group: 1 });
    out.push({ id: 'up', label: '↑', title: 'Move this alternative up (Alt+Up)', group: 1, disabled: !s.caps.move || idx <= 0 });
    out.push({ id: 'down', label: '↓', title: 'Move this alternative down (Alt+Down)', group: 1, disabled: !s.caps.move || idx >= count - 1 });
    if (b.kind !== 'tag' && b.kind !== 'guard') {
      out.push({ id: 'delete', label: 'Delete', title: count < 2 ? 'The only alternative cannot be deleted' : 'Delete this alternative (Delete)', group: 1, danger: true, disabled: count < 2 });
    }
    if (s.frame?.frameOf === 'group') {
      if (s.caps.tag) out.push({ id: 'tag', label: '+ Tag', title: 'Set a tag when this alternative is chosen (t)', group: 2 });
      if (s.caps.guard) out.push({ id: 'guard', label: '+ Guard', title: 'Only allow this alternative when a tag is set (g)', group: 2 });
    }
  } else if (inChoice && b.kind === 'frame') {
    out.push({ id: 'add', label: '+ Alternative', title: 'Add an alternative at the end (+)', group: 1 });
  } else if (b.kind === 'text' || b.kind === 'ref') {
    // Not in a choice yet: offer to make one.
    out.push({ id: 'wrap', label: '+ Alternative', title: 'Turn this into a choice with another alternative (+)', group: 1 });
    out.push({ id: 'optional', label: 'Make optional', title: 'Allow this to be left out: adds an empty alternative', group: 1 });
  }
  if ((b.kind === 'text' || b.kind === 'ref') && (s.branches ?? 1) > 0) {
    out.push({ id: 'insert-ref', label: 'Insert reference…', title: 'Insert $name of a branch right after this', group: 3 });
  }
  if (s.canExtract) out.push({ id: 'extract', label: 'Extract…', title: 'Move this into a new branch and refer to it by name', group: 3 });
  return out;
}

export class ActionBar {
  private specs: ActionSpec[] = [];
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
    this.actions.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.onRun('clear');
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const btns = [...this.actions.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (i === -1) return;
        e.preventDefault();
        btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length]?.focus();
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
        btn.addEventListener('click', () => this.onRun(s.id));
        this.actions.appendChild(btn);
      }
    }
    this.caption.textContent = label;
    this.caption.title = label;
    this.caption.hidden = false;
    this.actions.hidden = false;
    this.actions.setAttribute('aria-label', `Actions for ${label}`);
    this.hint.hidden = true;
  }

  hide(note?: string): void {
    this.specs = [];
    this.actions.hidden = true;
    this.actions.textContent = '';
    this.caption.hidden = note === undefined;
    this.caption.textContent = note ?? '';
    this.hint.hidden = note !== undefined;
  }

  /** Focus the button for an action, or the first enabled one when it is gone or disabled. */
  focusAction(id: string): void {
    const b = this.actions.querySelector<HTMLButtonElement>(`button[data-action="${id}"]:not(:disabled)`);
    if (b) b.focus();
    else this.focusFirst();
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
