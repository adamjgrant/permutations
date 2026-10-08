// CodeMirror 6 editor for the DSL: light syntax colouring, a highlight range driven by the
// chart, and an error mark driven by the compiler.

import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { bracketMatching, indentService, indentUnit } from '@codemirror/language';
import { ChangeSet, EditorSelection, EditorState, Range as CMRange, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Range } from './ranges';

const setHighlight = StateEffect.define<Range | null>();
const setError = StateEffect.define<number | null>();

/**
 * Where you last put the cursor yourself (clicking, typing, moving with the keys), kept in place
 * as the text changes. Selecting in the chart moves the editor's cursor to show the piece, and
 * edits from the chart set it too; neither counts as yours.
 */
const USER_EVENTS = ['select', 'input.type', 'input.paste', 'input.drop', 'input.complete', 'input.snippet', 'delete', 'move'];
const userSelection = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    if (USER_EVENTS.some((e) => tr.isUserEvent(e))) return { from: tr.newSelection.main.from, to: tr.newSelection.main.to };
    if (v && tr.docChanged) return { from: tr.changes.mapPos(v.from, -1), to: tr.changes.mapPos(v.to, 1) };
    return v;
  },
});

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

/** Warnings from the compiler: a dotted underline on their place, the message on hover. */
const setWarnings = StateEffect.define<{ from: number; to: number; message: string }[]>();
const warnField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setWarnings)) {
        const len = tr.state.doc.length;
        const marks = e.value
          .filter((w) => w.from >= 0 && w.from < len)
          .map((w) => Decoration.mark({ class: 'cm-warn', attributes: { title: w.message } }).range(w.from, Math.min(Math.max(w.to, w.from + 1), len)));
        deco = Decoration.set(marks, true);
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
  // Not after a backslash: \$name and \@name are text.
  [/(?<!\\)\*?\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g, 'tok-ref'],
  [/(?<!\\)@(?:else|!?[A-Za-z_]\w*)(?:=[^\s:|\]&;]+)?:?/g, 'tok-tag'],
  [/(?<=\$[\w.]+|[\]}]):(?:[A-Za-z_]\w*|\[[^\]]*\])/g, 'tok-fn'],
  // A repeat only after a bracket, a reference, a transform or another repeat (very{2} is text).
  [/(?<=\]|\}|\$[A-Za-z_][\w.]*|:[A-Za-z_]\w*)\{\d+(?:\.\.\d+)?(?:\s*;[^}]*)?\}/g, 'tok-repeat'],
  [/;\s*(?:(?:delimiter|last)\s*=\s*"(?:[^"\\]|\\.)*"\s*)+/g, 'tok-setting'],
  [/(?<!\\)[\[\]|]|(?<=\s)&(?=\s)/g, 'tok-punct'],
];

// Long form: the keyword part of a line that is a keyword construct (DSL.md section 3.1).
const LONG_KEYWORD = /^([ \t]*)(branch|one of|sequence|tight|any order|nothing|otherwise|ref|repeat|transform|tag|when(?: not)?|delimiter|last)(?=$|[ \t])/;
const LONG_WHOLE = /^[ \t]*(?:one of|sequence|tight|any order|nothing|otherwise)[ \t]*$/;
const LONG_ARGS = /^[ \t]*(?:branch|ref|repeat|transform|tag|when(?: not)?|delimiter|last)[ \t]+\S/;

function tokenize(doc: string): DecorationSet {
  const out: CMRange<Decoration>[] = [];
  let pos = 0;
  for (const line of doc.split('\n')) {
    const kw = LONG_KEYWORD.exec(line);
    if (/^[ \t]*#/.test(line)) {
      out.push(Decoration.mark({ class: 'tok-comment' }).range(pos, pos + line.length));
    } else if (kw && (LONG_WHOLE.test(line) || LONG_ARGS.test(line))) {
      const s = pos + (kw[1] as string).length;
      out.push(Decoration.mark({ class: 'tok-kw' }).range(s, s + (kw[2] as string).length));
      const name = /^[ \t]*branch[ \t]+([A-Za-z_][\w.]*)/.exec(line);
      if (name) out.push(Decoration.mark({ class: 'tok-def' }).range(pos + line.indexOf(name[1] as string, (kw[1] as string).length + 6), pos + line.indexOf(name[1] as string, (kw[1] as string).length + 6) + (name[1] as string).length));
      const ref = /^[ \t]*ref[ \t]+([A-Za-z_][\w.]*)/.exec(line);
      if (ref) {
        const at = pos + line.lastIndexOf(ref[1] as string);
        out.push(Decoration.mark({ class: 'tok-ref' }).range(at, at + (ref[1] as string).length));
      }
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

// A new line keeps the indent of the line above, one level deeper after a long-form block header.
const BLOCK_HEADER = /^[ \t]*(?:branch[ \t]+\S+|one of|sequence|tight|any order|otherwise|when(?: not)?[ \t]+\S.*|repeat[ \t]+\S+|transform[ \t]+\S.*)[ \t]*$/;
const longFormIndent = indentService.of((ctx, pos) => {
  const line = ctx.state.doc.lineAt(pos);
  for (let n = line.number - (pos > line.from ? 0 : 1); n >= 1; n--) {
    const prev = ctx.state.doc.line(n);
    const text = n === line.number ? prev.text.slice(0, pos - prev.from) : prev.text;
    if (text.trim() === '') continue;
    const lead = /^[ \t]*/.exec(text)![0].replace(/\t/g, '  ').length;
    return BLOCK_HEADER.test(text) ? lead + ctx.unit : lead;
  }
  return 0;
});

// Typing [ adds the matching ]; typing ] in front of one just steps over it.
const closeBracket = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '[' && text !== ']') return false;
  const state = view.state;
  if (state.selection.ranges.length !== 1) return false;
  const before = state.sliceDoc(Math.max(0, from - 1), from);
  if (before === '\\') return false;
  if (text === ']') {
    if (from === to && state.sliceDoc(from, from + 1) === ']') {
      view.dispatch({ selection: EditorSelection.cursor(from + 1), userEvent: 'input.type' });
      return true;
    }
    return false;
  }
  const next = state.sliceDoc(to, to + 1);
  if (from === to && next !== '' && /\w/.test(next)) return false;
  const inner = state.sliceDoc(from, to);
  view.dispatch({ changes: { from, to, insert: `[${inner}]` }, selection: EditorSelection.range(from + 1, from + 1 + inner.length), userEvent: 'input.type' });
  return true;
});

export interface EditorHandlers {
  onChange(): void;
  onCursor(pos: number): void;
}

export interface Editor {
  view: EditorView;
  getText(): string;
  /**
   * Apply non-overlapping patches expressed in the coordinates of the current text. Returns the
   * change that takes them back out. With history false, undo and redo never see the change.
   */
  patch(patches: { from: number; to: number; insert: string }[], selection?: Range, opts?: { history?: boolean }): ChangeSet;
  /** Apply a change returned by patch, outside the undo history. */
  revert(changes: ChangeSet): void;
  setText(text: string): void;
  highlight(range: Range | null): void;
  /** Move the cursor to a range and reveal it without taking focus. */
  reveal(range: Range): void;
  error(offset: number | null): void;
  focusAt(offset: number): void;
  /** Where you last put the cursor yourself, or undefined if you have not been in the code. */
  userSelection(): { from: number; to: number } | undefined;
  /** Underline the compiler's warnings (and say each one on hover). */
  warnings(list: { from: number; to: number; message: string }[]): void;
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
        bracketMatching(),
        indentUnit.of('  '),
        longFormIndent,
        closeBracket,
        EditorState.languageData.of(() => [{ commentTokens: { line: '#' } }]),
        // Tab indents; Escape then Tab moves focus out of the editor, as CodeMirror documents.
        keymap.of([{ key: 'Mod-/', run: toggleComment }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Permutations code', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        syntax,
        hlField,
        errField,
        warnField,
        userSelection,
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
    patch(patches, selection, opts) {
      const tr = view.state.update({
        changes: patches,
        ...(selection ? { selection: { anchor: selection[0], head: selection[1] } } : {}),
        userEvent: 'input.chart',
        ...(opts?.history === false ? { annotations: Transaction.addToHistory.of(false) } : {}),
      });
      view.dispatch(tr);
      return tr.changes.invert(tr.startState.doc);
    },
    revert(changes) {
      view.dispatch({ changes, annotations: Transaction.addToHistory.of(false), userEvent: 'input.chart' });
    },
    setText(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      // A whole new text (an example, a share link) can change the layout under the editor:
      // measure again so the gutter's line numbers sit beside their lines.
      view.requestMeasure();
      window.requestAnimationFrame(() => view.requestMeasure());
    },
    highlight(range) {
      view.dispatch({ effects: setHighlight.of(range) });
    },
    reveal(range) {
      silent = true;
      try {
        const len = view.state.doc.length;
        // A highlight, not a selection: typing or Help's Insert must never replace the chart's pick.
        view.dispatch({
          selection: { anchor: Math.min(range[0], len) },
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
      view.dispatch({ selection: { anchor: offset }, scrollIntoView: true, userEvent: 'select' });
    },
    userSelection: () => view.state.field(userSelection) ?? undefined,
    warnings(list) {
      view.dispatch({ effects: setWarnings.of(list) });
    },
  };
}
