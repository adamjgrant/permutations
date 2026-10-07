import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../src/model';
import {
  addAlternative, addGuard, addTag, alternatives, applyPatches, choiceForm, deleteAlternative, editGuard, editRange, editTag, editText, fillEmpty,
  guardSource, moveAlternative, parseGuardInput, parseTagInput, tagSource,
} from '../src/patch';
import { choices, count, groups, meaning, run, texts } from './helpers';

const LONG = [
  'branch main',
  '  Excuse me,',
  '  one of',
  '    sequence',
  '      what',
  '      tag q',
  '    that',
  '  is really neat',
  '  one of',
  '    when q',
  '      ?',
  '    otherwise',
  '      .',
  '',
].join('\n');

test('long form: the choices are recognised as long', () => {
  const c = choices(LONG);
  assert.equal(c.length, 2);
  assert.ok(c.every((n) => choiceForm(LONG, n) === 'long'));
  assert.equal(alternatives(c[0]!).length, 2);
});

test('long form: edit text of a plain line keeps the indent and the rest of the file', () => {
  const t = texts(LONG).find((n) => n.value === 'that')!;
  const out = run(LONG, editText(LONG, t, 'this'));
  assert.equal(out, LONG.replace('    that', '    this'));
  assert.deepEqual(analyze(out).program.sample(10).map((o) => o.text).sort(), ['Excuse me, this is really neat.', 'Excuse me, what is really neat?'].sort());
});

test('long form: edit text escapes specials and quotes a keyword line', () => {
  const t = texts(LONG).find((n) => n.value === 'that')!;
  const a = run(LONG, editText(LONG, t, 'x [y] $z'));
  assert.ok(a.includes('    x \\[y\\] \\$z\n'));
  assert.ok(analyze(a).program.sample(10).some((o) => o.text.includes('x [y] $z')));
  const b = run(LONG, editText(LONG, t, 'nothing'));
  assert.ok(b.includes('    "nothing"\n'));
  assert.ok(analyze(b).program.sample(10).some((o) => o.text.includes('Excuse me, nothing is')));
  const c = run(LONG, editText(LONG, t, ' padded '));
  assert.ok(c.includes('    " padded "\n'));
});

test('long form: editing a quoted line keeps it quoted', () => {
  const src = 'branch main\n  Hello\n  "!"\n';
  const t = texts(src).find((n) => n.value === '!')!;
  const out = run(src, editText(src, t, '?"'));
  assert.equal(out, 'branch main\n  Hello\n  "?\\""\n');
  assert.equal(analyze(out).program.one().text, 'Hello?"');
});

test('long form: text inside a short expression on a long line uses short escaping', () => {
  const src = 'branch main\n  one of\n    How [are|is] it\n    Fine\n';
  const t = texts(src).find((n) => n.value === 'are')!;
  const out = run(src, editText(src, t, 'were'));
  assert.equal(out, 'branch main\n  one of\n    How [were|is] it\n    Fine\n');
});

test('long form: add an alternative at the right indent under one of', () => {
  const g = choices(LONG)[0]!;
  const r = addAlternative(LONG, g)!;
  const out = applyPatches(LONG, r.patches);
  assert.equal(out, LONG.replace('    that\n', '    that\n    new\n'));
  assert.equal(out.slice(...(r.select as [number, number])), 'new');
  assert.equal(count(out), 3n);
});

test('long form: add after a block option, with tab indentation', () => {
  const src = 'branch main\n\tone of\n\t\tsequence\n\t\t\ta\n\t\t\tb\n';
  const g = choices(src)[0]!;
  const out = run(src, addAlternative(src, g, 'z'));
  assert.equal(out, 'branch main\n\tone of\n\t\tsequence\n\t\t\ta\n\t\t\tb\n\t\tz\n');
  assert.equal(count(out), 2n);
});

test('long form: add when the file has no trailing newline', () => {
  const src = 'branch main\n  one of\n    a\n    b';
  const out = run(src, addAlternative(src, choices(src)[0]!, 'c'));
  assert.equal(out, 'branch main\n  one of\n    a\n    b\n    c');
});

test('long form: add to any order', () => {
  const src = 'branch main\n  any order\n    a\n    b\n';
  const out = run(src, addAlternative(src, choices(src)[0]!, 'c'));
  assert.equal(out, 'branch main\n  any order\n    a\n    b\n    c\n');
  assert.equal(count(out), 6n);
});

test('long form: new alternative text that would read as a keyword is quoted', () => {
  const src = 'branch main\n  one of\n    a\n    b\n';
  const out = run(src, addAlternative(src, choices(src)[0]!, 'one of'));
  assert.ok(out.endsWith('    "one of"\n'));
  assert.equal(count(out), 3n);
});

test('long form: delete an option removes its line and children', () => {
  const g = choices(LONG)[0]!;
  const first = run(LONG, deleteAlternative(LONG, g, 0));
  assert.equal(first, LONG.replace('    sequence\n      what\n      tag q\n', ''));
  assert.equal(count(first), 1n);
  const second = run(LONG, deleteAlternative(LONG, g, 1));
  assert.equal(second, LONG.replace('    that\n', ''));
  const g2 = choices(LONG)[1]!;
  const out = run(LONG, deleteAlternative(LONG, g2, 0));
  assert.ok(!out.includes('when q'));
  assert.ok(out.includes('    otherwise\n      .\n'));
});

test('long form: delete the last option of a file without a trailing newline', () => {
  const src = 'branch main\n  one of\n    a\n    b\n    c';
  const out = run(src, deleteAlternative(src, choices(src)[0]!, 2));
  assert.equal(out, 'branch main\n  one of\n    a\n    b');
  assert.equal(count(out), 2n);
});

test('long form: cannot delete the only option', () => {
  const src = 'branch main\n  one of\n    a\n';
  assert.equal(deleteAlternative(src, choices(src)[0]!, 0), undefined);
});

test('long form: reorder swaps whole blocks and keeps both indents', () => {
  const g = choices(LONG)[0]!;
  const out = run(LONG, moveAlternative(LONG, g, 0, 1));
  assert.equal(out, LONG.replace('    sequence\n      what\n      tag q\n    that\n', '    that\n    sequence\n      what\n      tag q\n'));
  assert.equal(meaning(out), meaning(LONG));
  assert.equal(moveAlternative(LONG, g, 0, -1), undefined);
  assert.equal(moveAlternative(LONG, g, 1, 1), undefined);
});

test('long form: any order items can be reordered', () => {
  const src = 'branch main\n  any order\n    a\n    b\n    c\n';
  const g = choices(src)[0]!;
  assert.equal(run(src, moveAlternative(src, g, 2, -1)), 'branch main\n  any order\n    a\n    c\n    b\n');
});

test('short form any order can be reordered too', () => {
  const src = 'main = [a & b & c]';
  const g = choices(src)[0]!;
  assert.equal(run(src, moveAlternative(src, g, 0, 1)), 'main = [b & a & c]');
});

test('long form: fill a nothing option', () => {
  const src = 'branch main\n  one of\n    a\n    nothing\n';
  const g = groups(src)[0]!;
  const out = run(src, fillEmpty(src, g.options[1]!.range, 'b'));
  assert.equal(out, 'branch main\n  one of\n    a\n    b\n');
});

test('long form: edit a nothing piece inside a sequence', () => {
  const src = 'branch main\n  one of\n    sequence\n      nothing\n      tag q\n    x\n';
  const t = texts(src).find((n) => n.value === '')!;
  const out = run(src, editText(src, t, 'hey'));
  assert.equal(out, 'branch main\n  one of\n    sequence\n      hey\n      tag q\n    x\n');
});

test('long form edits leave neighbouring definitions and comments alone', () => {
  const src = '# top\nmain = $a\n\n# the a branch\nbranch a\n  one of\n    x\n    y\n\nz = q\n';
  const g = choices(src)[0]!;
  const out = run(src, addAlternative(src, g, 'w'));
  assert.equal(out, '# top\nmain = $a\n\n# the a branch\nbranch a\n  one of\n    x\n    y\n    w\n\nz = q\n');
});

// --- ranges -----------------------------------------------------------------

test('range choices are one alternative and are editable as a unit', () => {
  const src = 'main = #[0..9|A..F]';
  const g = groups(src)[0]!;
  assert.equal(g.options.length, 16);
  assert.equal(alternatives(g).length, 2);
  assert.deepEqual(alternatives(g).map((a) => a.count), [10, 6]);
  const out = run(src, editRange(src, alternatives(g)[0]!.range, '0..4'));
  assert.equal(out, 'main = #[0..4|A..F]');
  assert.equal(count(out), 11n);
  assert.equal(run(src, editRange(src, alternatives(g)[1]!.range, 'a..c')), 'main = #[0..9|a..c]');
  // text that is not a range is escaped plain text
  const plain = run(src, editRange(src, alternatives(g)[1]!.range, 'x|y'));
  assert.equal(plain, 'main = #[0..9|x\\|y]');
  assert.equal(count(plain), 11n);
});

test('range choices: add, delete and reorder act on the unit', () => {
  const src = 'main = [0..9|A..F]';
  const g = groups(src)[0]!;
  assert.equal(run(src, addAlternative(src, g, 'z')), 'main = [0..9|A..F|z]');
  assert.equal(run(src, deleteAlternative(src, g, 0)), 'main = [A..F]');
  assert.equal(run(src, moveAlternative(src, g, 0, 1)), 'main = [A..F|0..9]');
  const only = 'main = [1..6]';
  assert.equal(deleteAlternative(only, groups(only)[0]!, 0), undefined);
  assert.equal(run(only, addAlternative(only, groups(only)[0]!, 'x')), 'main = [1..6|x]');
});

// --- tags and guards -------------------------------------------------------------

test('tag input and guard input parse the friendly forms', () => {
  assert.deepEqual(parseTagInput('q'), { spec: { name: 'q' } });
  assert.deepEqual(parseTagInput('@sev = 5'), { spec: { name: 'sev', value: '5' } });
  assert.ok('error' in parseTagInput('9x'));
  assert.ok('error' in parseTagInput('a=b c'));
  assert.deepEqual(parseGuardInput('else'), { spec: { kind: 'else' } });
  assert.deepEqual(parseGuardInput('!q'), { spec: { kind: 'tag', name: 'q', negate: true } });
  assert.deepEqual(parseGuardInput('@k=5:'), { spec: { kind: 'tag', name: 'k', negate: false, value: '5' } });
  assert.deepEqual(parseGuardInput('not q'), { spec: { kind: 'tag', name: 'q', negate: true } });
  assert.ok('error' in parseGuardInput(''));
  assert.equal(tagSource({ name: 'k', value: '5' }, true), 'tag k = 5');
  assert.equal(guardSource({ kind: 'tag', name: 'q', negate: true }, true), 'when not q');
  assert.equal(guardSource({ kind: 'else' }, false), '@else:');
});

test('short form: edit and remove a tag chip', () => {
  const src = 'main = [what @q|that] is [@q: ?|@else: .]';
  const tag = groups(src)[0]!.options[0]!.tags[0]!;
  assert.equal(run(src, editTag(src, tag, { name: 'z', value: '2' })), 'main = [what @z=2|that] is [@q: ?|@else: .]');
  assert.equal(run(src, editTag(src, tag, null)), 'main = [what|that] is [@q: ?|@else: .]');
  const lone = 'main = [@q|x]';
  assert.equal(run(lone, editTag(lone, groups(lone)[0]!.options[0]!.tags[0]!, null)), 'main = [|x]');
});

test('short form: edit and remove a guard chip', () => {
  const src = 'main = [what @q|that] is [@q: ?|@else: .]';
  const g = groups(src)[1]!;
  assert.equal(run(src, editGuard(src, g.options[0]!.guard!, { kind: 'tag', name: 'q', negate: true })), 'main = [what @q|that] is [@!q: ?|@else: .]');
  assert.equal(run(src, editGuard(src, g.options[1]!.guard!, null)), 'main = [what @q|that] is [@q: ?|.]');
  assert.equal(run(src, editGuard(src, g.options[1]!.guard!, { kind: 'tag', name: 'q', negate: false, value: '1' })), 'main = [what @q|that] is [@q: ?|@q=1: .]');
});

test('short form: add a tag and a guard from the hover toolbar', () => {
  const src = 'main = [a|b c|] x';
  const g = groups(src)[0]!;
  assert.equal(run(src, addTag(src, g, 0, { name: 'q' })), 'main = [a @q|b c|] x');
  assert.equal(run(src, addTag(src, g, 1, { name: 'q', value: '3' })), 'main = [a|b c @q=3|] x');
  assert.equal(run(src, addTag(src, g, 2, { name: 'q' })), 'main = [a|b c|@q] x');
  assert.equal(run(src, addGuard(src, g, 1, { kind: 'else' })), 'main = [a|@else: b c|] x');
  assert.equal(run(src, addGuard(src, g, 2, { kind: 'tag', name: 'q', negate: false })), 'main = [a|b c|@q:] x');
  const withGuard = 'main = [@q: a|b]';
  assert.equal(addGuard(withGuard, groups(withGuard)[0]!, 0, { kind: 'else' }), undefined);
  // the edited program still means what it should
  const tagged = run('main = [a|b] [@q: x|y]', addTag('main = [a|b] [@q: x|y]', groups('main = [a|b] [@q: x|y]')[0]!, 0, { name: 'q' }));
  assert.equal(tagged, 'main = [a @q|b] [@q: x|y]');
  assert.deepEqual(analyze(tagged).program.sample(10).map((o) => o.text).sort(), ['a x', 'a y', 'b y'].sort());
});

test('short form: add to a bare definition choice', () => {
  const src = 'main = $g\ng = x | y\n';
  const g = groups(src).find((n) => n.bare)!;
  assert.equal(run(src, addTag(src, g, 1, { name: 'q' })), 'main = $g\ng = x | y @q\n');
});

test('tags and guards are refused for any-order items', () => {
  const src = 'main = [a & b]';
  assert.equal(addTag(src, choices(src)[0]!, 0, { name: 'q' }), undefined);
  assert.equal(addGuard(src, choices(src)[0]!, 0, { kind: 'else' }), undefined);
});

test('long form: add a tag to a plain line, a sequence, a quoted line and a block', () => {
  const src = 'branch main\n  one of\n    plain\n    sequence\n      a\n      b\n    "quoted"\n    nothing\n    any order\n      x\n      y\n';
  const g = groups(src)[0]!;
  const plain = run(src, addTag(src, g, 0, { name: 'q' }));
  assert.ok(plain.includes('    plain @q\n'));
  const seq = run(src, addTag(src, g, 1, { name: 'q' }));
  assert.ok(seq.includes('    sequence\n      a\n      b\n      tag q\n'));
  const quoted = run(src, addTag(src, g, 2, { name: 'q', value: '4' }));
  assert.ok(quoted.includes('    sequence\n      "quoted"\n      tag q = 4\n'));
  const nothing = run(src, addTag(src, g, 3, { name: 'q' }));
  assert.ok(nothing.includes('    sequence\n      nothing\n      tag q\n'));
  const anyOrder = run(src, addTag(src, g, 4, { name: 'q' }));
  assert.ok(anyOrder.includes('    sequence\n      any order\n        x\n        y\n      tag q\n'));
  for (const out of [plain, seq, quoted, nothing, anyOrder]) {
    const a = analyze(out);
    assert.equal(a.program.count, analyze(src).program.count);
    assert.ok(a.program.sample(50).some((o) => 'q' in o.tags));
  }
});

test('long form: add a guard to a line, a sequence and a quoted line', () => {
  const src = 'branch main\n  one of\n    plain\n    sequence\n      a\n      b\n    "quoted"\n    any order\n      x\n      y\n';
  const g = groups(src)[0]!;
  const plain = run(src, addGuard(src, g, 0, { kind: 'tag', name: 'q', negate: false }));
  assert.ok(plain.includes('    @q: plain\n'));
  const seq = run(src, addGuard(src, g, 1, { kind: 'else' }));
  assert.ok(seq.includes('    otherwise\n      a\n      b\n'));
  const quoted = run(src, addGuard(src, g, 2, { kind: 'tag', name: 'q', negate: true }));
  assert.ok(quoted.includes('    when not q\n      "quoted"\n'));
  const anyOrder = run(src, addGuard(src, g, 3, { kind: 'else' }));
  assert.ok(anyOrder.includes('    otherwise\n      any order\n        x\n        y\n'));
  for (const out of [plain, seq, quoted, anyOrder]) analyze(out);
});

test('long form: edit and remove tag and guard chips', () => {
  const g = groups(LONG);
  const tag = g[0]!.options[0]!.tags[0]!;
  assert.equal(run(LONG, editTag(LONG, tag, { name: 'ask', value: '1' })), LONG.replace('tag q', 'tag ask = 1'));
  assert.equal(run(LONG, editTag(LONG, tag, null)), LONG.replace('      tag q\n', ''));
  const guard = g[1]!.options[0]!.guard!;
  assert.equal(run(LONG, editGuard(LONG, guard, { kind: 'tag', name: 'q', negate: true })), LONG.replace('when q', 'when not q'));
  assert.equal(run(LONG, editGuard(LONG, guard, null)), LONG.replace('when q', 'sequence'));
  const other = g[1]!.options[1]!.guard!;
  assert.equal(run(LONG, editGuard(LONG, other, { kind: 'tag', name: 'q', negate: false, value: '2' })), LONG.replace('otherwise', 'when q = 2'));
  analyze(run(LONG, editGuard(LONG, guard, null)));
});

test('long form chips: a tag inline in a plain line is edited like a short tag', () => {
  const src = 'branch main\n  one of\n    hello @q\n    bye\n';
  const tag = groups(src)[0]!.options[0]!.tags[0]!;
  assert.equal(run(src, editTag(src, tag, { name: 'z' })), 'branch main\n  one of\n    hello @z\n    bye\n');
  assert.equal(run(src, editTag(src, tag, null)), 'branch main\n  one of\n    hello\n    bye\n');
});

test('offsets follow their text when alternatives are swapped', async () => {
  const { mapAfterMove } = await import('../src/patch');
  const src = 'main = [red|green|blue]';
  const g = groups(src)[0]!;
  const r = moveAlternative(src, g, 2, -1)!;
  const out = applyPatches(src, r.patches);
  assert.equal(out, 'main = [red|blue|green]');
  const blueAt = src.indexOf('blue');
  assert.equal(out.slice(mapAfterMove(r.patches, blueAt), mapAfterMove(r.patches, blueAt) + 4), 'blue');
  const greenAt = src.indexOf('green');
  assert.equal(out.slice(mapAfterMove(r.patches, greenAt), mapAfterMove(r.patches, greenAt) + 5), 'green');
  const r2 = moveAlternative(src, g, 0, 1)!;
  const out2 = applyPatches(src, r2.patches);
  assert.equal(out2.slice(mapAfterMove(r2.patches, 8), mapAfterMove(r2.patches, 8) + 3), 'red');
});
