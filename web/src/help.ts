// Content of the "Syntax help" drawer: the essentials of the language, each with a snippet
// that can be inserted into the editor with one click.

export interface HelpItem {
  id: string;
  title: string;
  text: string;
  snippet: string;
  /** `cursor` inserts at the caret; `end` adds a new line at the end of the file. */
  at: 'cursor' | 'end';
}

export const HELP_ITEMS: HelpItem[] = [
  { id: 'choice', title: 'Choice', text: 'Square brackets with | between the options. One is picked each time.', snippet: '[red|green|blue]', at: 'cursor' },
  { id: 'empty', title: 'Empty option', text: 'Leave an option empty to make the thing optional.', snippet: '[Good morning! |]', at: 'cursor' },
  { id: 'reference', title: 'Reference', text: 'Give a piece a name, then use it anywhere with $name.', snippet: 'greeting = [Hello|Hi]\n', at: 'end' },
  { id: 'use', title: 'Use a reference', text: 'The name ends at the first character that is not a letter, digit or underscore.', snippet: '$greeting', at: 'cursor' },
  { id: 'anyorder', title: 'Any order', text: 'Every ordering of the items. n items give n! results, so keep it small.', snippet: '[foo & bar & baz]', at: 'cursor' },
  { id: 'repeat', title: 'Repeat', text: 'Repeat the piece before it n times, or between n and m times.', snippet: '[0..9|A..F]{6}', at: 'cursor' },
  { id: 'range', title: 'Range', text: 'A range of numbers or characters, shown as one box in the chart.', snippet: '[1..6]', at: 'cursor' },
  { id: 'tag', title: 'Tag', text: 'Write @name after an option to set a tag when it is chosen.', snippet: '[what @q|that]', at: 'cursor' },
  { id: 'guard', title: 'Guard', text: 'Start an option with @name: so it is only eligible when the tag is set. @else: catches the rest.', snippet: '[@q: ?|@else: .]', at: 'cursor' },
  { id: 'delimiter', title: 'Delimiter', text: 'What joins the pieces of one group. The default is a space.', snippet: '[A & T; delimiter="-"]', at: 'cursor' },
  { id: 'transform', title: 'Transform', text: 'Change the text of one piece: lower, upper, capitalize, title, trim.', snippet: '[hello]:upper', at: 'cursor' },
  { id: 'long', title: 'Long form', text: 'The same constructs, one per line. Use Expand on a branch card to convert.', snippet: 'branch pick\n  one of\n    first\n    second\n', at: 'end' },
];

/** Where and what to insert for a help item, given the current document. */
export function insertionFor(item: HelpItem, doc: string, selFrom: number, selTo: number): { from: number; to: number; insert: string; cursor: number } {
  if (item.at === 'end') {
    const lead = doc === '' || doc.endsWith('\n') ? '' : '\n';
    const insert = lead + item.snippet;
    return { from: doc.length, to: doc.length, insert, cursor: doc.length + insert.length };
  }
  return { from: selFrom, to: selTo, insert: item.snippet, cursor: selFrom + item.snippet.length };
}

export const SHORTCUTS: [string, string][] = [
  ['Click', 'Select a box. Its action bar appears next to it.'],
  ['Click again', 'Edit the selected text.'],
  ['Double-click', 'Edit text, or go to the branch a reference points at.'],
  ['Shift-click', 'Select several alternatives of one choice, to extract them together.'],
  ['Arrow keys', 'Move between boxes. The selection follows.'],
  ['Enter', 'Edit text, go to a reference, edit a tag or guard.'],
  ['F2', 'Edit text, or point a reference at another branch.'],
  ['Tab', 'Move from the chart into the action bar.'],
  ['+', 'Add an alternative after the selected one.'],
  ['Alt+Up / Alt+Down', 'Move the selected alternative.'],
  ['Delete', 'Delete the selected alternative, tag or guard.'],
  ['t / g', 'Add a tag or a guard to the selected alternative.'],
  ['Space', 'Add the alternative to a multi-selection.'],
  ['Escape', 'Clear the selection, or close a dialog.'],
];
