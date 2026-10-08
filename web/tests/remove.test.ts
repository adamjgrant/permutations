import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Node } from '../../src/core/types';
import { analyze } from '../src/model';
import { deletePiece, isSolePiece, locatePiece } from '../src/remove';
import { groups, meaning, refs, run, texts } from './helpers';

const bodies = (src: string): Node[] => {
  const a = analyze(src);
  return [a.main.body, ...a.others.map((o) => o.body)];
};
const del = (src: string, node: Node) => deletePiece(src, locatePiece(bodies(src), node)!);
const text = (src: string, v: string) => texts(src).find((t) => t.value === v)!;

test('delete a word run, a reference, or a whole choice from a sequence', () => {
  const src = 'main = Hello [big|small] world $tail\ntail = and more';
  assert.equal(run(src, del(src, text(src, 'world'))).split('\n')[0], 'main = Hello [big|small] $tail');
  assert.equal(run(src, del(src, refs(src)[0]!)).split('\n')[0], 'main = Hello [big|small] world');
  assert.equal(run(src, del(src, groups(src)[0]!)).split('\n')[0], 'main = Hello world $tail');
  assert.equal(run(src, del(src, text(src, 'Hello'))).split('\n')[0], 'main = [big|small] world $tail');
});

test('a piece inside an alternative goes alone; the rest of the alternative stays', () => {
  const src = "main = [How [are you|'s it]|What]";
  const out = run(src, del(src, text(src, 'How')));
  assert.equal(out, "main = [[are you|'s it]|What]");
  assert.match(meaning(out), /are you/);
});

test('the only piece of an alternative or a branch is not deleted on its own', () => {
  const src = 'main = [Hello|Hi] there';
  const loc = locatePiece(bodies(src), text(src, 'Hello'))!;
  assert.ok(isSolePiece(loc));
  assert.match((deletePiece(src, loc) as { error: string }).error, /Delete the alternative/);
  const one = 'main = Hello';
  assert.match((del(one, text(one, 'Hello')) as { error: string }).error, /Delete the branch/);
});

test('a transform or repeat goes with the reference it wraps', () => {
  const src = 'main = Say $x:upper now\nx = hi';
  assert.equal(run(src, del(src, refs(src)[0]!)).split('\n')[0], 'main = Say now');
});

test('long form: deleting a piece removes its line', () => {
  const src = 'branch main\n  Hello\n  one of\n    a\n    b\n  there\n';
  assert.equal(run(src, del(src, text(src, 'there'))), 'branch main\n  Hello\n  one of\n    a\n    b\n');
  assert.equal(run(src, del(src, groups(src)[0]!)), 'branch main\n  Hello\n  there\n');
});
