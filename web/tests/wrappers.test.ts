import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RepeatNode, TransformNode } from '../../src/core/types';
import { parseCount, removeRepeat, removeTransform, setRepeatCount, setTransforms } from '../src/wrappers';
import { meaning, nodes, run } from './helpers';

const rep = (s: string) => nodes<RepeatNode>(s, 'repeat')[0]!;
const tf = (s: string) => nodes<TransformNode>(s, 'transform')[0]!;

test('change and remove a repeat in short form, keeping its delimiter', () => {
  const src = 'main = [a|b]{2; delimiter=" "} end';
  assert.equal(run(src, setRepeatCount(src, rep(src), 3, 4)), 'main = [a|b]{3..4; delimiter=" "} end');
  assert.equal(run(src, removeRepeat(src, rep(src))), 'main = [a|b] end');
  const ref = 'main = $x{3}\nx = [p|q]';
  assert.equal(run(ref, setRepeatCount(ref, rep(ref), 2, 2)).split('\n')[0], 'main = $x{2}');
});

test('change and remove a transform', () => {
  const src = 'main = [Foo]:upper bar';
  assert.equal(run(src, setTransforms(src, tf(src), ['lower', 'upper'])), 'main = [Foo]:[lower|upper] bar');
  assert.equal(run(src, removeTransform(src, tf(src))), 'main = [Foo] bar');
});

test('long form: headers change, and removing keeps the lines one piece', () => {
  const src = 'branch main\n  one of\n    repeat 2\n      delimiter " "\n      ho\n    hey\n';
  const out = run(src, setRepeatCount(src, rep(src), 3, 3));
  assert.equal(out, 'branch main\n  one of\n    repeat 3\n      delimiter " "\n      ho\n    hey\n');
  const gone = run(src, removeRepeat(src, rep(src)));
  assert.equal(gone, 'branch main\n  one of\n    sequence\n      ho\n    hey\n');
  assert.equal(meaning(gone), meaning('main = [ho|hey]'));
  const t = 'branch main\n  transform upper\n    hello\n';
  assert.equal(run(t, setTransforms(t, tf(t), ['title'])), 'branch main\n  transform title\n    hello\n');
  assert.equal(meaning(run(t, removeTransform(t, tf(t)))), meaning('main = hello'));
});

test('parse a count', () => {
  assert.deepEqual(parseCount('3'), { min: 3, max: 3 });
  assert.deepEqual(parseCount(' 2 .. 4 '), { min: 2, max: 4 });
  assert.ok('error' in parseCount('4..2'));
  assert.ok('error' in parseCount('lots'));
  assert.ok('error' in parseCount('2000'));
});
