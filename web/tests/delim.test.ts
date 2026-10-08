import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setDelimiter, setSettings } from '../src/delim';
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

test('last: set it next to the delimiter, keep it when the delimiter changes, clear both', () => {
  const src = 'main = [a & b & c]';
  const set = run(src, setSettings(src, choices(src)[0]!, { delimiter: ', ', last: ' and ' }));
  assert.equal(set, 'main = [a & b & c; delimiter=", " last=" and "]');
  assert.match(meaning(set), /"a, b and c"/);
  const changed = run(set, setDelimiter(set, choices(set)[0]!, '; '));
  assert.equal(changed, 'main = [a & b & c; delimiter="; " last=" and "]');
  const noDelim = run(changed, setDelimiter(changed, choices(changed)[0]!, null));
  assert.equal(noDelim, 'main = [a & b & c; last=" and "]');
  assert.equal(run(noDelim, setSettings(noDelim, choices(noDelim)[0]!, { last: null })), src);
});

test('last on repeats, short and long form, and never on a choice', () => {
  const src = 'main = [x|y]{3}';
  const rep = (s: string) => repeats(s)[0]!;
  const set = run(src, setSettings(src, rep(src), { delimiter: ', ', last: ' or ' }));
  assert.equal(set, 'main = [x|y]{3; delimiter=", " last=" or "}');
  assert.match(meaning(set), /"x, y or x"/);
  assert.equal(run(set, setDelimiter(set, rep(set), '-')), 'main = [x|y]{3; delimiter="-" last=" or "}');
  const long = 'branch main\n  any order\n    a\n    b\n';
  const lset = run(long, setSettings(long, choices(long)[0]!, { delimiter: ', ', last: ' and ' }));
  assert.equal(lset, 'branch main\n  any order\n    delimiter ", "\n    last " and "\n    a\n    b\n');
  const lclear = run(lset, setSettings(lset, choices(lset)[0]!, { delimiter: null, last: null }));
  assert.equal(lclear, long);
  const choice = 'main = x [a|b] y';
  assert.equal(setSettings(choice, choices(choice)[0]!, { last: ' and ' }), undefined);
});
