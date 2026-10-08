import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setDelimiter } from '../src/delim';
import { choices, meaning, nodes, run } from './helpers';
import type { RepeatNode } from '../../src/core/types';
const repeats = (s: string): RepeatNode[] => nodes<RepeatNode>(s, 'repeat');

test('set, change and clear a delimiter on a bracket group', () => {
  const src = 'main = x [a & b] y';
  const set = run(src, setDelimiter(src, choices(src)[0]!, ', '));
  assert.equal(set, 'main = x [a & b; delimiter=", "] y');
  assert.match(meaning(set), /a, b/);
  const changed = run(set, setDelimiter(set, choices(set)[0]!, '+'));
  assert.equal(changed, 'main = x [a & b; delimiter="+"] y');
  assert.equal(run(changed, setDelimiter(changed, choices(changed)[0]!, null)), src);
});

test('quotes and backslashes in a delimiter are escaped', () => {
  const src = 'main = [a & b]';
  const out = run(src, setDelimiter(src, choices(src)[0]!, ' "and" '));
  assert.equal(out, 'main = [a & b; delimiter=" \\"and\\" "]');
  assert.ok(meaning(out).includes(JSON.stringify('a "and" b')));
});

test('long form: add, change and remove a delimiter line', () => {
  const src = 'branch main\n  any order\n    a\n    b\n';
  const set = run(src, setDelimiter(src, choices(src)[0]!, ''));
  assert.equal(set, 'branch main\n  any order\n    delimiter ""\n    a\n    b\n');
  assert.match(meaning(set), /"ab"/);
  const changed = run(set, setDelimiter(set, choices(set)[0]!, '-'));
  assert.equal(changed, 'branch main\n  any order\n    delimiter "-"\n    a\n    b\n');
  assert.equal(run(changed, setDelimiter(changed, choices(changed)[0]!, null)), src);
});

test('a bare definition choice has no brackets to carry a delimiter', () => {
  const src = 'main = a | b';
  assert.equal(setDelimiter(src, choices(src)[0]!, ', '), undefined);
});

test('repeats: set and clear the delimiter between copies, short and long form', () => {
  const src = 'main = [ho|ha]{3} there';
  const rep = (s: string) => repeats(s)[0]!;
  const set = run(src, setDelimiter(src, rep(src), ' '));
  assert.equal(set, 'main = [ho|ha]{3; delimiter=" "} there');
  assert.match(meaning(set), /"ho ha ho there"/);
  assert.equal(run(set, setDelimiter(set, rep(set), null)), src);
  const range = 'main = [a|b]{1..2}';
  assert.equal(run(range, setDelimiter(range, rep(range), '-')), 'main = [a|b]{1..2; delimiter="-"}');
  const long = 'branch main\n  repeat 2\n    one of\n      ho\n      ha\n';
  const lset = run(long, setDelimiter(long, rep(long), ' '));
  assert.equal(lset, 'branch main\n  repeat 2\n    delimiter " "\n    one of\n      ho\n      ha\n');
  assert.match(meaning(lset), /"ho ha"/);
});
