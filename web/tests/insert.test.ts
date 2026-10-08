import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../src/model';
import { insertReference, pieceRange, wrapInChoice } from '../src/insert';
import { meaning, refs, run, texts } from './helpers';

const text = (src: string, s: string) => texts(src).find((t) => t.value === s)!;
const bodies = (src: string) => {
  const a = analyze(src);
  return [a.main.body, ...a.others.map((o) => o.body)];
};

test('wrap text in a choice, short form', () => {
  const src = 'main = Hello [world|friend]!';
  const r = wrapInChoice(src, text(src, 'Hello'), 'new');
  const out = run(src, r);
  assert.equal(out, 'main = [Hello|new] [world|friend]!');
  assert.equal(out.slice(r.select![0], r.select![1]), 'new');
});

test('make text optional, and the meaning gains the shorter results', () => {
  const src = 'main = Good morning! How are you?';
  const out = run(src, wrapInChoice(src, text(src, 'Good morning! How are you?'), null));
  assert.equal(out, 'main = [Good morning! How are you?|]');
  assert.match(meaning(out), /""/);
});

test('wrap a reference', () => {
  const src = 'main = Say $x\nx = hi';
  assert.equal(run(src, wrapInChoice(src, refs(src)[0]!, 'bye')), 'main = Say [$x|bye]\nx = hi');
});

test('wrap a whole long-form line in a one of block', () => {
  const src = 'branch main\n  Hello\n  there\n';
  const r = wrapInChoice(src, text(src, 'Hello'), 'Hi');
  const out = run(src, r);
  assert.equal(out, 'branch main\n  one of\n    Hello\n    Hi\n  there\n');
  assert.equal(out.slice(r.select![0], r.select![1]), 'Hi');
  assert.match(meaning(out), /Hi there/);
  const opt = run(src, wrapInChoice(src, text(src, 'Hello'), null));
  assert.equal(opt, 'branch main\n  one of\n    Hello\n    nothing\n  there\n');
});

test('new alternative text is escaped', () => {
  const src = 'main = Hello';
  assert.equal(run(src, wrapInChoice(src, text(src, 'Hello'), 'a|b')), 'main = [Hello|a\\|b]');
});

test('insert a reference after a piece, short and long form', () => {
  const src = 'main = Hello [world|friend]!\ng = hi';
  const after = pieceRange(bodies(src), text(src, 'Hello'))!;
  assert.equal(run(src, insertReference(src, after, 'g')), 'main = Hello $g [world|friend]!\ng = hi');
  const long = 'branch main\n  Hello\n  there\ng = hi\n';
  const a2 = pieceRange(bodies(long), text(long, 'Hello'))!;
  assert.equal(run(long, insertReference(long, a2, 'g')), 'branch main\n  Hello\n  ref g\n  there\ng = hi\n');
});

test('inserting after a transformed reference goes after the transform', () => {
  const src = 'main = $x:upper now\nx = a\ny = b';
  const r = pieceRange(bodies(src), refs(src)[0]!)!;
  assert.equal(src.slice(r[0], r[1]), '$x:upper');
  assert.equal(run(src, insertReference(src, r, 'y')), 'main = $x:upper $y now\nx = a\ny = b');
});
