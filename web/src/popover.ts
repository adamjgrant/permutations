// A small modal-ish popover with one text field and a few buttons. Used for renaming,
// editing a tag or guard, naming a new branch. Keyboard: Enter runs the first button,
// Escape closes, Tab stays inside. Errors from an action are shown in place (aria-live).

export interface PopoverAction {
  label: string;
  kind?: 'primary' | 'danger' | 'plain';
  /** Gets the field's value, and the second field's when there is one. Return a message to keep the popover open and show it. */
  run(value: string, second: string): string | void;
}

export interface PopoverOptions {
  title: string;
  label?: string;
  value?: string;
  hint?: string;
  placeholder?: string;
  anchor: { left: number; top: number; right: number; bottom: number };
  actions: PopoverAction[];
  /** Element to focus after closing. */
  returnFocus?: HTMLElement | null;
  /** A paragraph of text instead of a field (for confirmations). */
  message?: string;
  /** Values offered as completions for the field. */
  suggestions?: string[];
  /** Custom content shown instead of a field (it must handle its own focus order). */
  content?: HTMLElement;
  /** A second, optional field under the first one. */
  second?: { label: string; value: string; placeholder?: string };
  /** A live line under the fields showing what the values will produce. */
  preview?: (value: string, second: string) => string;
  /** Ready-made values, as buttons that fill the field: the common cases in plain words. */
  picks?: { label: string; value: string }[];
}

let current: { close(): void } | undefined;

export function closePopover(): void {
  current?.close();
}

export function openPopover(o: PopoverOptions): { close(): void } {
  closePopover();
  const root = document.createElement('div');
  root.className = 'popover';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', o.title);

  const h = document.createElement('h3');
  h.textContent = o.title;
  root.appendChild(h);

  let input: HTMLInputElement | undefined;
  let secondInput: HTMLInputElement | undefined;
  if (o.content) {
    root.appendChild(o.content);
  } else if (o.message !== undefined) {
    const p = document.createElement('p');
    p.className = 'pop-message';
    p.textContent = o.message;
    root.appendChild(p);
  } else {
    const label = document.createElement('label');
    label.textContent = o.label ?? 'Value';
    input = document.createElement('input');
    input.type = 'text';
    input.value = o.value ?? '';
    input.placeholder = o.placeholder ?? '';
    input.spellcheck = false;
    input.autocomplete = 'off';
    label.appendChild(input);
    root.appendChild(label);
    if (o.second) {
      const label2 = document.createElement('label');
      label2.textContent = o.second.label;
      secondInput = document.createElement('input');
      secondInput.type = 'text';
      secondInput.value = o.second.value;
      secondInput.placeholder = o.second.placeholder ?? '';
      secondInput.spellcheck = false;
      secondInput.autocomplete = 'off';
      label2.appendChild(secondInput);
      root.appendChild(label2);
    }
    if (o.suggestions?.length) {
      const list = document.createElement('datalist');
      list.id = 'pop-suggest';
      for (const v of o.suggestions) {
        const opt = document.createElement('option');
        opt.value = v;
        list.appendChild(opt);
      }
      root.appendChild(list);
      input.setAttribute('list', list.id);
    }
  }
  if (o.hint) {
    const p = document.createElement('p');
    p.className = 'pop-hint';
    p.id = 'pop-hint';
    p.textContent = o.hint;
    root.appendChild(p);
    input?.setAttribute('aria-describedby', 'pop-hint');
  }
  if (o.picks?.length && input) {
    const row = document.createElement('div');
    row.className = 'pop-picks';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Suggestions');
    for (const pk of o.picks) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick';
      b.textContent = pk.label;
      b.addEventListener('click', () => {
        if (!input) return;
        input.value = pk.value;
        input.dispatchEvent(new Event('input'));
        input.focus();
      });
      row.appendChild(b);
    }
    root.appendChild(row);
  }
  if (o.preview && input) {
    const p = document.createElement('p');
    p.className = 'pop-preview';
    p.setAttribute('aria-live', 'polite');
    const show = (): void => {
      p.textContent = (o.preview as NonNullable<PopoverOptions['preview']>)(input?.value ?? '', secondInput?.value ?? '');
    };
    show();
    input.addEventListener('input', show);
    secondInput?.addEventListener('input', show);
    root.appendChild(p);
  }
  const error = document.createElement('p');
  error.className = 'pop-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  root.appendChild(error);

  const row = document.createElement('div');
  row.className = 'pop-actions';
  const buttons: HTMLButtonElement[] = [];
  const close = (): void => {
    root.remove();
    document.removeEventListener('pointerdown', outside, true);
    if (current === handle) current = undefined;
    o.returnFocus?.focus({ preventScroll: true });
  };
  const run = (a: PopoverAction): void => {
    const msg = a.run(input ? input.value : '', secondInput ? secondInput.value : '');
    if (msg) {
      error.textContent = msg;
      error.hidden = false;
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
    } else {
      // The caller re-renders and places focus itself after a successful action.
      o.returnFocus = null;
      close();
    }
  };
  for (const a of o.actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    if (a.kind === 'primary') b.classList.add('primary');
    if (a.kind === 'danger') b.classList.add('danger');
    b.addEventListener('click', () => run(a));
    buttons.push(b);
    row.appendChild(b);
  }
  root.appendChild(row);

  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && input && (e.target === input || e.target === secondInput)) {
      e.preventDefault();
      const first = o.actions[0];
      if (first) run(first);
    } else if (e.key === 'Tab') {
      const items = [...root.querySelectorAll<HTMLElement>('input, button:not(:disabled)')];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  });
  input?.addEventListener('input', () => {
    error.hidden = true;
    input?.removeAttribute('aria-invalid');
  });
  const outside = (e: Event): void => {
    if (!root.contains(e.target as Node)) close();
  };

  document.body.appendChild(root);
  const w = root.offsetWidth;
  const hgt = root.offsetHeight;
  const left = Math.max(8, Math.min(o.anchor.left, window.innerWidth - w - 8));
  let top = o.anchor.bottom + 6;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, o.anchor.top - hgt - 6);
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  const handle = { close };
  current = handle;
  if (input) {
    input.focus();
    input.select();
  } else (o.content?.querySelector<HTMLElement>('button') ?? buttons[0])?.focus();
  return handle;
}
