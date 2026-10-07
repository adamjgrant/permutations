// CodeMirror 6 editor for the DSL: light syntax colouring, a highlight range driven by the
// chart, and an error mark driven by the compiler.

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState, Range as CMRange, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Range } from './ranges';

const setHighlight = StateEffect.define<Range | null>();
const setError = StateEffect.define<number | null>();

const hlField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        const r = e.value;
        const len = tr.state.doc.length;
        deco = r && r[1] > r[0] ? Decoration.set([Decoration.mark({ class: 'cm-chart-hl' }).range(Math.min(r[0], len), Math.min(r[1], len))]) : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const errField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) deco = Decoration.none;
    for (const e of tr.effects) {
      if (e.is(setError)) {
        const off = e.value;
        const len = tr.state.doc.length;
        if (off === null || len === 0) deco = Decoration.none;
        else {
          const from = Math.min(off, len - 1);
          deco = Decoration.set([Decoration.mark({ class: 'cm-err' }).range(from, Math.min(from + 1, len))]);
        }
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const TOKENS: [RegExp, string][] = [
  [/\\./g, 'tok-escape'],
  [/\*?\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g, 'tok-ref'],
  [/@(?:else|!?[A-Za-z_]\w*)(?:=[^\s:|\]&;]+)?:?/g, 'tok-tag'],
  [/(?<=\$[\w.]+|[\]}]):(?:[A-Za-z_]\w*|\[[^\]]*\])/g, 'tok-fn'],
  [/\{\d+(?:\.\.\d+)?(?:\s*;[^}]*)?\}/g, 'tok-repeat'],
  [/;\s*delimiter\s*=\s*"(?:[^"\\]|\\.)*"/g, 'tok-setting'],
  [/(?<!\\)[\[\]|]|(?<=\s)&(?=\s)/g, 'tok-punct'],
];

function tokenize(doc: string): DecorationSet {
  const out: CMRange<Decoration>[] = [];
  let pos = 0;
  for (const line of doc.split('\n')) {
    if (/^[ \t]*#/.test(line)) {
      out.push(Decoration.mark({ class: 'tok-comment' }).range(pos, pos + line.length));
    } else {
      const def = /^[ \t]*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?=[ \t]*=)/.exec(line);
      if (def) {
        const s = pos + def[0].length - (def[1] as string).length;
        out.push(Decoration.mark({ class: 'tok-def' }).range(s, pos + def[0].length));
      }
      for (const [re, cls] of TOKENS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          if (m[0].length === 0) {
            re.lastIndex++;
            continue;
          }
          out.push(Decoration.mark({ class: cls }).range(pos + m.index, pos + m.index + m[0].length));
        }
      }
    }
    pos += line.length + 1;
  }
  return Decoration.set(out, true);
}

const syntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tokenize(view.state.doc.toString());
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = tokenize(u.state.doc.toString());
    }
  },
  { decorations: (v) => v.decorations },
);

export interface EditorHandlers {
  onChange(): void;
  onCursor(pos: number): void;
}

export interface Editor {
  view: EditorView;
  getText(): string;
  /** Apply non-overlapping patches expressed in the coordinates of the current text. */
  patch(patches: { from: number; to: number; insert: string }[], selection?: Range): void;
  setText(text: string): void;
  highlight(range: Range | null): void;
  /** Move the cursor to a range and reveal it without taking focus. */
  reveal(range: Range): void;
  error(offset: number | null): void;
  focusAt(offset: number): void;
}

export function createEditor(parent: HTMLElement, doc: string, handlers: EditorHandlers): Editor {
  let silent = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Permutations code', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        syntax,
        hlField,
        errField,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) handlers.onChange();
          if ((u.selectionSet || u.docChanged) && !silent) handlers.onCursor(u.state.selection.main.head);
        }),
      ],
    }),
  });
  return {
    view,
    getText: () => view.state.doc.toString(),
    patch(patches, selection) {
      view.dispatch({ changes: patches, ...(selection ? { selection: { anchor: selection[0], head: selection[1] } } : {}), userEvent: 'input.chart' });
    },
    setText(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    highlight(range) {
      view.dispatch({ effects: setHighlight.of(range) });
    },
    reveal(range) {
      silent = true;
      try {
        const len = view.state.doc.length;
        view.dispatch({
          selection: { anchor: Math.min(range[0], len), head: Math.min(range[1], len) },
          effects: [setHighlight.of(range), EditorView.scrollIntoView(Math.min(range[0], len), { y: 'nearest', yMargin: 40 })],
        });
      } finally {
        silent = false;
      }
    },
    error(offset) {
      view.dispatch({ effects: setError.of(offset) });
    },
    focusAt(offset) {
      view.focus();
      view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    },
  };
}
