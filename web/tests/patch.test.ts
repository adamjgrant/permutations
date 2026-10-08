import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GroupNode, TextNode, AnyOrderNode } from '../../src/core/types';
import { analyze } from '../src/model';
import { visit } from '../../src/index';
import { addAlternative, applyPatches, deleteAlternative, editText, EditResult, fillEmpty, mapOffset, moveAlternative } from '../src/patch';
import { escapeText } from '../src/ranges';
import { choices } from './helpers';

function groups(src: string): GroupNode[] {
  const a = analyze(src);
  const out: GroupNode[] = [];
  for (const d of [a.main, ...a.others]) visit(d.body, (n) => { if (n.kind === 'group') out.push(n); });
  return out;
}
function texts(src: string): TextNode[] {
  const a = analyze(src);
  const out: TextNode[] = [];
  for (const d of [a.main, ...a.others]) visit(d.body, (n) => { if (n.kind === 'text') out.push(n); });
  return out;
}
const run = (src: string, r: EditResult | undefined): string => {
  assert.ok(r, 'edit refused');
  return applyPatches(src, r.patches);
};
const allTexts = (src: string): string[] => {
  const a = analyze(src);
  return a.program.sample(1000).map((o) => o.text).sort();
};

test('edit text: only the node range changes, comments and layout survive', () => {
  const src = '# keep me\nmain = [Hello|Oh, Hi]   $x\nx = a\n';
  const t = texts(src).find((n) => n.value === 'Hello')!;
  const out = run(src, editText(src, t, 'Howdy'));
  assert.equal(out, '# keep me\nmain = [Howdy|Oh, Hi]   $x\nx = a\n');
});

test('edit text escapes DSL specials and reads back identically', () => {
  const src = 'main = [a|b]';
  const t = texts(src).find((n) => n.value === 'a')!;
  const nasty = 'x [y] | $z @w \\ q';
  const out = run(src, editText(src, t, nasty));
  assert.ok(out.includes('\\['));
  assert.deepEqual(allTexts(out).includes(nasty), true);
  assert.equal(escapeText('plain'), 'plain');
  assert.equal(escapeText('a & b'), 'a \\& b');
});

test('edit text escapes a leading # at line start', () => {
  const src = 'main = $x\nx = [b|c]';
  const t = texts(src).find((n) => n.value === 'b')!;
  const out = run(src, editText(src, t, '#hash'));
  assert.ok(analyze(out).program.sample(5).some((o) => o.text === '#hash'));
});

test('add alternative to bracket group, spaced style and tight style', () => {
  const tight = 'main = [a|b] c';
  const g = groups(tight)[0]!;
  const r = addAlternative(tight, g)!;
  assert.equal(applyPatches(tight, r.patches), 'main = [a|b|new] c');
  assert.equal(applyPatches(tight, r.patches).slice(...(r.select as [number, number])), 'new');
  const spaced = 'main = [a | b] c';
  assert.equal(run(spaced, addAlternative(spaced, groups(spaced)[0]!)), 'main = [a | b | new] c');
});

test('add alternative keeps a delimiter setting and empty tail', () => {
  const src = 'main = [a|b; delimiter=" "]';
  assert.equal(run(src, addAlternative(src, groups(src)[0]!)), 'main = [a|b|new; delimiter=" "]');
  const tail = 'main = [a|]';
  const out = run(tail, addAlternative(tail, groups(tail)[0]!));
  assert.equal(analyze(out).program.count, 3n);
});

test('add alternative to a bare definition choice', () => {
  const src = 'main = $g\ng = x | y\n';
  const g = groups(src).find((x) => x.bare)!;
  assert.equal(run(src, addAlternative(src, g)), 'main = $g\ng = x | y | new\n');
});

test('add item to an any-order group', () => {
  const src = 'main = [a & b]';
  const a = analyze(src);
  let any: AnyOrderNode | undefined;
  visit(a.main.body, (n) => { if (n.kind === 'anyorder') any = n; });
  assert.equal(run(src, addAlternative(src, any!)), 'main = [a & b & new]');
  assert.equal(run(src, deleteAlternative(src, any!, 0)), 'main = [b]');
});

test('delete first, middle and last alternative', () => {
  const src = 'main = [a | b | c] d';
  const g = groups(src)[0]!;
  assert.equal(run(src, deleteAlternative(src, g, 0)), 'main = [b | c] d');
  assert.equal(run(src, deleteAlternative(src, g, 1)), 'main = [a | c] d');
  assert.equal(run(src, deleteAlternative(src, g, 2)), 'main = [a | b] d');
  const tight = 'main = [a|b|c]';
  const t = groups(tight)[0]!;
  assert.equal(run(tight, deleteAlternative(tight, t, 1)), 'main = [a|c]');
  assert.equal(run(tight, deleteAlternative(tight, t, 2)), 'main = [a|b]');
  assert.equal(run(tight, deleteAlternative(tight, t, 0)), 'main = [b|c]');
});

test('delete with delimiter setting and in a bare choice', () => {
  const src = 'main = [a|b; delimiter="-"]';
  assert.equal(run(src, deleteAlternative(src, groups(src)[0]!, 1)), 'main = [a; delimiter="-"]');
  const bare = 'g = x | y | z\nmain = $g';
  const g = groups(bare).find((x) => x.bare)!;
  assert.equal(run(bare, deleteAlternative(bare, g, 0)), 'g = y | z\nmain = $g');
  assert.equal(run(bare, deleteAlternative(bare, g, 2)), 'g = x | y\nmain = $g');
});

test('cannot delete the only alternative', () => {
  const src = 'main = [a]';
  assert.equal(deleteAlternative(src, groups(src)[0]!, 0), undefined);
});

test('reorder swaps neighbours and carries tags with them', () => {
  const src = 'main = [one @x|two|three]';
  const g = groups(src)[0]!;
  assert.equal(run(src, moveAlternative(src, g, 0, 1)), 'main = [two|one @x|three]');
  assert.equal(run(src, moveAlternative(src, g, 2, -1)), 'main = [one @x|three|two]');
  assert.equal(moveAlternative(src, g, 0, -1), undefined);
  assert.equal(moveAlternative(src, g, 2, 1), undefined);
});

test('reorder works with an empty alternative', () => {
  const src = 'main = [a||b]';
  const g = groups(src)[0]!;
  const out = run(src, moveAlternative(src, g, 0, 1));
  assert.equal(out, 'main = [|a|b]');
});

test('range-expanded groups edit as one alternative per range', () => {
  const src = 'main = [1..4]';
  const g = groups(src)[0]!;
  assert.equal(run(src, addAlternative(src, g)), 'main = [1..4|new]');
  assert.equal(deleteAlternative(src, g, 0), undefined, 'a range alone cannot be deleted');
  assert.equal(moveAlternative(src, g, 0, 1), undefined);
});

test('fill an empty alternative, also behind a tag or guard', () => {
  const src = 'main = [a|] z';
  const g = groups(src)[0]!;
  assert.equal(run(src, fillEmpty(src, g.options[1]!.range, 'hey')), 'main = [a|hey] z');
  const tagged = 'main = [a|@q]';
  const g2 = groups(tagged)[0]!;
  const out = run(tagged, fillEmpty(tagged, g2.options[1]!.range, 'hey'));
  assert.equal(out, 'main = [a|@q hey]');
  assert.deepEqual(analyze(out).program.sample(5).map((o) => o.text).sort(), ['a', 'hey']);
});

test('patch offsets map to the new document', () => {
  const src = 'main = [a|b]';
  const r = addAlternative(src, groups(src)[0]!)!;
  assert.equal(mapOffset(r.patches, src.length), src.length + 4);
});

test('deleting down to one alternative unwraps the choice, and keeps a repeat working', () => {
  const src = 'main = [a|b] tail';
  const g = () => choices(src)[0]!;
  assert.equal(run(src, deleteAlternative(src, g(), 1)), 'main = a tail');
  const empty = 'main = Say [really|] so';
  assert.equal(run(empty, deleteAlternative(empty, choices(empty)[0]!, 0)), 'main = Say so');
  const rep = 'main = [a|b]{2}';
  assert.equal(run(rep, deleteAlternative(rep, choices(rep)[0]!, 1)), 'main = [a]{2}');
  const three = 'main = [a|b|c]';
  const r = deleteAlternative(three, choices(three)[0]!, 0)!;
  const out = run(three, r);
  assert.equal(out, 'main = [b|c]');
  assert.equal(out.slice(r.select![0], r.select![0] + 1), 'b', 'the neighbour is selected');
});
