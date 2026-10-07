// A small modal-ish popover with one text field and a few buttons. Used for renaming,
// editing a tag or guard, naming a new branch. Keyboard: Enter runs the first button,
// Escape closes, Tab stays inside. Errors from an action are shown in place (aria-live).

export interface PopoverAction {
  label: string;
  kind?: 'primary' | 'danger' | 'plain';
  /** Return a message to keep the popover open and show it. */
  run(value: string): string | void;
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
  if (o.message !== undefined) {
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
  }
  if (o.hint) {
    const p = document.createElement('p');
    p.className = 'pop-hint';
    p.id = 'pop-hint';
    p.textContent = o.hint;
    root.appendChild(p);
    input?.setAttribute('aria-describedby', 'pop-hint');
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
    const msg = a.run(input ? input.value : '');
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
    } else if (e.key === 'Enter' && input && e.target === input) {
      e.preventDefault();
      const first = o.actions[0];
      if (first) run(first);
    } else if (e.key === 'Tab') {
      const items = [...root.querySelectorAll<HTMLElement>('input, button')];
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
  } else buttons[0]?.focus();
  return handle;
}
