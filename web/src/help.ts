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
  { id: 'long', title: 'Long form', text: 'The same constructs, one per line. To convert a branch, select its name and choose Expand to long form.', snippet: 'branch pick\n  one of\n    first\n    second\n', at: 'end' },
];

/** Where and what to insert for a help item, given the current document. */
export function insertionFor(
  item: HelpItem,
  doc: string,
  selFrom: number,
  selTo: number,
  opts: { taken?: ReadonlySet<string>; mainEnd?: number } = {},
): { from: number; to: number; insert: string; cursor: number; select: [number, number] } {
  if (item.at === 'end') {
    // A definition snippet takes a name nobody uses yet, so it never duplicates one.
    let snippet = item.snippet;
    const m = /^(branch[ \t]+)?([A-Za-z_]\w*)/.exec(snippet);
    if (m && opts.taken?.has(m[2] as string)) {
      const base = m[2] as string;
      let i = 2;
      while (opts.taken.has(base + i)) i++;
      snippet = (m[1] ?? '') + base + i + snippet.slice(m[0].length);
    }
    const lead = doc === '' || doc.endsWith('\n') ? '' : '\n';
    const insert = lead + snippet;
    const start = doc.length + lead.length;
    return { from: doc.length, to: doc.length, insert, cursor: doc.length + insert.length, select: [start, start + snippet.trimEnd().length] };
  }
  // Without a cursor of your own (you have not clicked into the code), add to the end of main.
  let from = selFrom;
  let to = selTo;
  if (opts.mainEnd !== undefined) from = to = opts.mainEnd;
  // Keep words apart: a space where the snippet would otherwise glue onto its neighbours.
  const before = doc[from - 1];
  const after = doc[to];
  const pre = before !== undefined && !/\s/.test(before) && !'[|'.includes(before) ? ' ' : '';
  const post = after !== undefined && !/\s/.test(after) && !']|'.includes(after) ? ' ' : '';
  const insert = pre + item.snippet + post;
  const s = from + pre.length;
  return { from, to, insert, cursor: s + item.snippet.length, select: [s, s + item.snippet.length] };
}

export const SHORTCUTS: [string, string][] = [
  ['Click', 'Select a box. Its actions appear in the strip at the bottom of the chart.'],
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
  ['Escape', 'Clear the selection, stop showing an example, or close a dialog.'],
  ['⌘Z / ⇧⌘Z', 'Undo or redo, also for changes made in the chart.'],
  ['In the code: Tab', 'Indent. Press Escape first to move focus out of the editor instead.'],
  ['In the code: ⌘/', 'Comment or uncomment the line.'],
];

/** Whole programs to learn from, loaded from Help (your code can be brought back with Undo). */
export const EXAMPLE_PROGRAMS: { title: string; text: string; source: string }[] = [
  {
    title: 'Greeting (the sketch)',
    text: 'Two openings, then a shared branch with nested choices.',
    source: "main = [Hello|Oh, Hi] $greeting\ngreeting = [How [are you|'s [it|everything]]|What [is new|is going on]]\n",
  },
  {
    title: 'Weather report',
    text: 'A sentence with three independent choices and a range of numbers.',
    source: "main = It's [windy|still|blustery], [cloudy|partly cloudy|clear], with a [10..90]% chance of rain.\n",
  },
  {
    title: 'Support reply with tags',
    text: 'A tag set by the opening decides how the reply ends.',
    source: '# A friendly or a formal reply, consistently\nmain = $opening, $name. $body $closing\nopening = [Hi @casual|Hey there @casual|Good [morning|afternoon] @formal]\nname = [Sam|Alex|Jordan]\nbody = Thanks for getting in touch. [We are looking into it.|A fix is on its way.]\nclosing = [@casual: Cheers!|@formal: Kind regards.]\n',
  },
  {
    title: 'Hex colours',
    text: 'A repeat of a range choice: sixteen million results, sampled instantly.',
    source: 'main = #$hex{6}\nhex = [0..9|A..F]\n',
  },
  {
    title: 'Packing list in any order',
    text: 'Every item is used, in every order, joined with commas and a final and.',
    source: 'main = Pack [the tent & the stove & the map; delimiter=", "] and the [torch|lamp].\n',
  },
  {
    title: 'A letter in long form',
    text: 'The same language, one piece per line: easier to read and comment.',
    source: '# Long form: one piece per line\nbranch main\n  Dear\n  one of\n    friend\n    colleague\n  ref closing\n\nbranch closing\n  one of\n    sequence\n      ,\n      thank you for everything.\n    \", see you soon.\"\n',
  },
];
