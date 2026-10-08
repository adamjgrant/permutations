import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barActions, BarInput } from '../src/actionbar';
import { layout } from '../src/layout';
import { analyze } from '../src/model';
import { rowContext } from '../src/nav';
import { addAlternative } from '../src/patch';
import { choices, run } from './helpers';

function build(src: string) {
  const a = analyze(src);
  return layout({ main: a.main, others: a.others, source: src, defaultDelimiter: a.delimiter, knownTags: a.knownTags }).boxes;
}

function input(src: string, pick: (b: ReturnType<typeof build>[number]) => boolean, extra: Partial<BarInput> = {}): BarInput {
  const boxes = build(src);
  const box = boxes.find(pick);
  assert.ok(box, 'box not found');
  const ctx = rowContext(boxes, box);
  return { box, row: ctx.row, frame: ctx.frame, multi: 0, canEdit: true, restructure: true, caps: { tag: true, guard: true, move: true }, canExtract: true, ...extra };
}
const ids = (i: BarInput): string[] => barActions(i).map((a) => a.id);

test('text in a choice offers edit, alternative actions, tag, guard and extract', () => {
  const i = input('main = Say [red|green|blue] now', (b) => b.kind === 'text' && b.full === 'green');
  assert.deepEqual(ids(i), ['edit', 'add', 'up', 'down', 'delete', 'tag', 'guard', 'insert-ref', 'extract']);
  const acts = barActions(i);
  assert.equal(acts.find((a) => a.id === 'up')?.disabled, false);
  assert.equal(acts.find((a) => a.id === 'down')?.disabled, false);
});

test('first and last alternatives disable the moves that would fall off the end', () => {
  const first = barActions(input('main = [red|green]', (b) => b.kind === 'text' && b.full === 'red'));
  assert.equal(first.find((a) => a.id === 'up')?.disabled, true);
  assert.equal(first.find((a) => a.id === 'down')?.disabled, false);
  const last = barActions(input('main = [red|green]', (b) => b.kind === 'text' && b.full === 'green'));
  assert.equal(last.find((a) => a.id === 'down')?.disabled, true);
});

test('text outside any choice can become a choice or optional', () => {
  assert.deepEqual(ids(input('main = Say [red|green] now', (b) => b.kind === 'text' && b.full === 'Say')), ['edit', 'wrap', 'optional', 'insert-ref', 'extract']);
  assert.deepEqual(ids(input('main = Say [red|green] now', (b) => b.kind === 'text' && b.full === 'Say', { branches: 0 })), ['edit', 'wrap', 'optional', 'extract']);
});

test('a reference offers go to and change target', () => {
  const acts = barActions(input('main = [Hello|Hi] $greeting\ngreeting = there', (b) => b.kind === 'ref'));
  assert.equal(acts[0]?.id, 'goto');
  assert.equal(acts[0]?.label, 'Go to greeting');
  assert.equal(acts[1]?.id, 'retarget');
  assert.equal(acts[2]?.id, 'inline');
});

test('a reference inside a choice also gets the alternative actions', () => {
  assert.deepEqual(ids(input('main = [$a|b]\na = x', (b) => b.kind === 'ref')), ['goto', 'retarget', 'inline', 'add', 'up', 'down', 'delete', 'tag', 'guard', 'insert-ref', 'extract']);
});

test('chips offer edit and remove; a guard chip has no Delete for the alternative', () => {
  const tag = ids(input('main = [what @q|that]', (b) => b.kind === 'tag'));
  assert.deepEqual(tag.slice(0, 2), ['chip-edit', 'chip-remove']);
  assert.ok(!tag.includes('delete'));
});

test('any-order items cannot take tags or guards', () => {
  const i = input('main = [a & b & c]', (b) => b.kind === 'text' && b.full === 'b');
  assert.deepEqual(ids(i).filter((x) => x === 'tag' || x === 'guard'), []);
});

test('the only alternative cannot be deleted', () => {
  const acts = barActions(input('main = [x @t]', (b) => b.kind === 'text' && b.full === 'x'));
  assert.equal(acts.find((a) => a.id === 'delete')?.disabled, true);
});

test('nothing to offer when the code has an error', () => {
  assert.deepEqual(ids(input('main = [a|b]', (b) => b.kind === 'text', { canEdit: false })), []);
});

test('a branch name offers rename, expand or collapse, and delete', () => {
  assert.deepEqual(ids(input('main = [a|b]', (b) => b.kind === 'defLabel')), ['rename', 'convert', 'delete-def']);
  const long = barActions(input('branch main\n  one of\n    a\n    b\n', (b) => b.kind === 'defLabel'));
  assert.equal(long.find((a) => a.id === 'convert')?.label, 'Collapse to short form');
});

test('a multi-selection offers extract and clear', () => {
  const acts = barActions(input('main = [a|b|c]', (b) => b.kind === 'row', { multi: 2 }));
  assert.deepEqual(acts.map((a) => a.id), ['extract', 'clear']);
  assert.match(acts[0]!.label, /2 alternatives/);
});

test('groups are separated so the bar can draw dividers', () => {
  const acts = barActions(input('main = Say [red|green|blue] now', (b) => b.kind === 'text' && b.full === 'green'));
  assert.deepEqual([...new Set(acts.map((a) => a.group))], [0, 1, 2, 3]);
  assert.ok(acts.filter((a) => a.group === 3).length === 2, 'insert reference and extract share the last group');
});

test('adding an alternative after a given one, in short and long form', () => {
  const src = 'main = [a|b|c]';
  assert.equal(run(src, addAlternative(src, choices(src)[0]!, 'new', 0)), 'main = [a|new|b|c]');
  const spaced = 'main = a | b | c';
  assert.equal(run(spaced, addAlternative(spaced, choices(spaced)[0]!, 'new', 1)), 'main = a | b | new | c');
  const long = 'branch main\n  one of\n    a\n    b\n';
  assert.equal(run(long, addAlternative(long, choices(long)[0]!, 'new', 0)), 'branch main\n  one of\n    a\n    new\n    b\n');
  assert.equal(run(src, addAlternative(src, choices(src)[0]!, 'new')), 'main = [a|b|c|new]');
});
