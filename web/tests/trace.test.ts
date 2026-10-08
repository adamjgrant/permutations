import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layout } from '../src/layout';
import { analyze } from '../src/model';
import { anyOrderSequence, pathBoxes } from '../src/trace';

function setup(src: string) {
  const a = analyze(src);
  const boxes = layout({ main: a.main, others: a.others, source: src, defaultDelimiter: a.delimiter, knownTags: a.knownTags }).boxes;
  const find = (text: string) => boxes.find((b) => (b.kind === 'text' || b.kind === 'ref' || b.kind === 'range') && b.full === text)!;
  const indexOf = (text: string): bigint => {
    for (let i = 0n; i < a.program.count; i++) if (a.program.at(i).text === text) return i;
    throw new Error('no such result: ' + text);
  };
  return { a, boxes, find, on: (text: string) => pathBoxes(boxes, a.program.trace(indexOf(text))) };
}

test('the sketch: a path lights its text, its alternatives and the branch it went through', () => {
  const s = setup("main = [Hello|Oh, Hi] $greeting\ngreeting = [How [are you|'s [it|everything]]|What [is new|is going on]]");
  const on = s.on("Oh, Hi How's everything");
  for (const t of ['Oh, Hi', '$greeting', 'How', "'s", 'everything']) assert.ok(on.has(s.find(t).id), `${t} is on the path`);
  for (const t of ['Hello', 'are you', 'it', 'What', 'is new']) assert.ok(!on.has(s.find(t).id), `${t} is not on the path`);
  const greeting = s.boxes.find((b) => b.kind === 'def' && b.name === 'greeting')!;
  assert.ok(on.has(greeting.id), 'the referenced branch is lit');
  const rows = s.boxes.filter((b) => b.kind === 'row' && on.has(b.id));
  assert.equal(rows.length, 4, 'one alternative per choice the path passed: main, greeting, How..., \'s...');
});

test('a range alternative lights its range box', () => {
  const s = setup('main = #[0..9|A..F]{2}');
  const on = s.on('#AB');
  assert.ok(on.has(s.find('A..F').id));
  assert.ok(!on.has(s.find('0..9').id));
  const mixed = s.on('#A1');
  assert.ok(mixed.has(s.find('A..F').id) && mixed.has(s.find('0..9').id), 'both alternatives of a repeated choice can be on one path');
});

test('chips follow their alternative; empty alternatives light when taken', () => {
  const s = setup('main = [what @q|that|] is it [@q: ?|@else: .]');
  const on = s.on('what is it?');
  const tag = s.boxes.find((b) => b.kind === 'tag')!;
  const guards = s.boxes.filter((b) => b.kind === 'guard');
  assert.ok(on.has(tag.id));
  assert.ok(on.has(guards.find((g) => g.label === '@q:')!.id));
  assert.ok(!on.has(guards.find((g) => g.label === '@else:')!.id));
  const empty = s.boxes.find((b) => b.kind === 'empty')!;
  assert.ok(s.on('is it.').has(empty.id));
});

test('an any-order trace knows the order the items came in', () => {
  const s = setup('main = Pack [tent & stove & map]');
  for (let i = 0n; i < s.a.program.count; i++) {
    const tr = s.a.program.trace(i);
    const order = anyOrderSequence(s.boxes, tr);
    const rows = s.boxes.filter((b) => b.kind === 'row');
    const byPos = rows.slice().sort((p, q) => (order.get(p.id) ?? 0) - (order.get(q.id) ?? 0));
    const words = byPos.map((r) => s.boxes.find((b) => b.kind === 'text' && b.rowId === r.id)!.full);
    assert.equal('Pack ' + words.join(' '), tr.text);
  }
});
