import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setDelimiter } from '../src/delim';
import { choices, meaning, run } from './helpers';

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
