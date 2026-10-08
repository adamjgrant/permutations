import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  convertForms, createDefinition, deleteDefinition, extractToBranch, nameProblem, referencesTo, renameDefinition, retargetReference, skippedNotice,
  uniqueName, ExtractSelection,
} from '../src/defs';
import { analyze } from '../src/model';
import { alternatives, applyPatches } from '../src/patch';
import { choices, count, groups, meaning, refs, run, texts } from './helpers';

const SHORT = 'main = [Hello|Oh, Hi] $greeting\ngreeting = [How [are you|\'s it]|What $topic]\ntopic = [up|new]\n';

// --- names ---------------------------------------------------------------------

test('name checks: invalid, duplicate, reserved', () => {
  assert.match(nameProblem(SHORT, '9lives')!, /not a valid name/);
  assert.match(nameProblem(SHORT, 'has space')!, /not a valid name/);
  assert.match(nameProblem(SHORT, 'topic')!, /already exists/);
  assert.match(nameProblem(SHORT, 'delimiter')!, /reserved/);
  assert.match(nameProblem(SHORT, 'use')!, /reserved/);
  assert.equal(nameProblem(SHORT, 'topic', 'topic'), undefined);
  assert.equal(nameProblem(SHORT, 'fresh_name2'), undefined);
  assert.equal(nameProblem(SHORT, 'ns.fresh'), undefined);
  assert.equal(uniqueName(SHORT), 'phrase');
  assert.equal(uniqueName('branch = x\nbranch2 = y\nmain = $branch', 'branch'), 'branch3');
});

// --- rename --------------------------------------------------------------------

test('rename patches the definition and every reference', () => {
  const out = run(SHORT, renameDefinition(SHORT, 'topic', 'subject'));
  assert.equal(out, SHORT.replace('$topic', '$subject').replace('topic = ', 'subject = '));
  assert.equal(meaning(out), meaning(SHORT));
});

test('rename touches only the references, not text that looks like the name', () => {
  const src = 'main = topic $topic topics $topics\ntopic = a\ntopics = b\n';
  const out = run(src, renameDefinition(src, 'topic', 'theme'));
  assert.equal(out, 'main = topic $theme topics $topics\ntheme = a\ntopics = b\n');
});

test('rename a long-form definition and its ref lines', () => {
  const src = 'branch main\n  ref greeting\n  ", friend."\n\nbranch greeting\n  one of\n    Hello\n    Hi\n';
  const out = run(src, renameDefinition(src, 'greeting', 'salute'));
  assert.equal(out, 'branch main\n  ref salute\n  ", friend."\n\nbranch salute\n  one of\n    Hello\n    Hi\n');
  assert.equal(meaning(out), meaning(src));
});

test('rename across mixed forms and inside nested references', () => {
  const src = 'main = [$a|$b] $a:upper $a{2}\nbranch b\n  one of\n    ref a\n    z\na = x | y\n';
  const out = run(src, renameDefinition(src, 'a', 'alpha'));
  assert.equal(out, 'main = [$alpha|$b] $alpha:upper $alpha{2}\nbranch b\n  one of\n    ref alpha\n    z\nalpha = x | y\n');
  assert.equal(meaning(out), meaning(src));
});

test('rename a namespaced definition, and dotted paths that start with the name', () => {
  const src = 'main = $letters.A $letters.B\nletters.A = a\nletters.B = b\n';
  const out = run(src, renameDefinition(src, 'letters.A', 'letters.Z'));
  assert.equal(out, 'main = $letters.Z $letters.B\nletters.Z = a\nletters.B = b\n');
  assert.equal(meaning(out), meaning(src));
  // a dotted path that begins with the old name but is not itself a definition follows the rename
  const hits = referencesTo('main = $ns.x\nns = q\n', 'ns');
  assert.equal(hits.length, 1);
  // a dotted path that is its own definition does not
  assert.equal(referencesTo(src, 'letters').length, 0, 'letters.A is its own definition, not a path into a namespace');
  const own = 'main = $a.b\na = x\na.b = y\n';
  assert.equal(referencesTo(own, 'a').length, 0);
  assert.equal(run(own, renameDefinition(own, 'a', 'c')), 'main = $a.b\nc = x\na.b = y\n');
});

test('rename refuses invalid, duplicate, reserved and main', () => {
  for (const bad of ['9x', 'a b', '', 'greeting', 'main', 'delimiter', 'branch']) {
    const r = renameDefinition(SHORT, 'topic', bad);
    assert.ok('error' in r, `should refuse "${bad}"`);
  }
  const m = renameDefinition(SHORT, 'main', 'start');
  assert.ok('error' in m && /entry point/.test(m.error));
  const missing = renameDefinition(SHORT, 'nope', 'x');
  assert.ok('error' in missing);
  const same = renameDefinition(SHORT, 'topic', 'topic');
  assert.ok(!('error' in same) && same.patches.length === 0);
});

test('rename works when the program is an unnamed expression with a branch', () => {
  const src = '[a|b] $x\nx = q\n';
  assert.equal(run(src, renameDefinition(src, 'x', 'y')), '[a|b] $y\ny = q\n');
});

// --- create --------------------------------------------------------------------

test('create a definition in the form of the surrounding code', () => {
  const short = run(SHORT, createDefinition(SHORT, 'fresh'));
  assert.equal(short, SHORT + 'fresh = text\n');
  analyze(short);
  const long = 'main = $a\nbranch a\n  one of\n    x\n    y\n';
  const out = run(long, createDefinition(long, 'fresh'));
  assert.equal(out, long + '\nbranch fresh\n  text\n');
  analyze(out);
  assert.equal(run('main = x', createDefinition('main = x', 'k')), 'main = x\nk = text\n');
  assert.equal(run('main = x', createDefinition('main = x', 'k', 'long')), 'main = x\n\nbranch k\n  text\n');
  const refused = createDefinition(SHORT, 'topic');
  assert.ok('error' in refused);
});

// --- delete --------------------------------------------------------------------

test('delete a definition nothing refers to', () => {
  const src = 'main = $a\na = x\nspare = y\n\nmore = z\n';
  assert.equal(run(src, deleteDefinition(src, 'spare')), 'main = $a\na = x\nmore = z\n');
  assert.equal(run(src, deleteDefinition(src, 'more')), 'main = $a\na = x\nspare = y\n');
  const long = 'main = $a\nbranch a\n  one of\n    x\n    y\n\nbranch spare\n  one of\n    p\n    q\n';
  const out = run(long, deleteDefinition(long, 'spare'));
  assert.equal(out, 'main = $a\nbranch a\n  one of\n    x\n    y\n');
  analyze(out);
});

test('delete refuses while something refers to it and says what', () => {
  const r = deleteDefinition(SHORT, 'topic');
  assert.ok('error' in r);
  assert.match(r.error, /greeting/);
  const r2 = deleteDefinition(SHORT, 'greeting');
  assert.ok('error' in r2 && /main/.test(r2.error));
  const m = deleteDefinition(SHORT, 'main');
  assert.ok('error' in m && /entry point/.test(m.error));
  assert.equal(referencesTo(SHORT, 'topic').map((h) => h.from).join(), 'greeting');
});

// --- retarget ---------------------------------------------------------------------

test('retarget a pill to another definition', () => {
  const src = SHORT;
  const pill = refs(src).find((r) => r.path === 'topic')!;
  const out = run(src, retargetReference(src, pill, 'main2'.replace('main2', 'greeting')));
  assert.ok(out.includes('What $greeting'));
  const bad = retargetReference(src, pill, 'nowhere');
  assert.ok('error' in bad && /nowhere/.test(bad.error));
  const invalid = retargetReference(src, pill, '1x');
  assert.ok('error' in invalid);
  const ok = run('main = $a\na = x\nb = y\n', retargetReference('main = $a\na = x\nb = y\n', refs('main = $a\na = x\nb = y\n')[0]!, '$b'));
  assert.equal(ok, 'main = $b\na = x\nb = y\n');
});

test('retarget a long-form ref line', () => {
  const src = 'branch main\n  ref a\n\nbranch a\n  x\n\nbranch b\n  y\n';
  const r = refs(src)[0]!;
  assert.equal(run(src, retargetReference(src, r, 'b')), src.replace('ref a', 'ref b'));
});

// --- extract -------------------------------------------------------------------------

const sel = (src: string, which: number, indices: number[]): ExtractSelection => ({ kind: 'alts', node: choices(src)[which]!, indices });

test('extract one alternative into a new definition', () => {
  const src = 'main = [Hello|Oh, Hi|Hey] there\n';
  const out = run(src, extractToBranch(src, sel(src, 0, [1]), 'casual'));
  assert.equal(out, 'main = [Hello|$casual|Hey] there\ncasual = Oh, Hi\n');
  assert.equal(meaning(out), meaning(src));
});

test('extract several alternatives, also non-adjacent ones', () => {
  const src = 'main = [a|b|c|d] x\n';
  const out = run(src, extractToBranch(src, sel(src, 0, [0, 2]), 'odd'));
  assert.equal(out, 'main = [$odd|b|d] x\nodd = a | c\n');
  assert.equal(count(out), 4n);
  assert.equal([...analyze(out).program.all()].map((o) => o.text).sort().join(','), 'a x,b x,c x,d x');
  const adj = run(src, extractToBranch(src, sel(src, 0, [1, 2, 3]), 'tail'));
  assert.equal(adj, 'main = [a|$tail] x\ntail = b | c | d\n');
  assert.equal(meaning(adj), meaning(src));
  const front = run(src, extractToBranch(src, sel(src, 0, [0, 1]), 'head'));
  assert.equal(front, 'main = [$head|c|d] x\nhead = a | b\n');
  assert.equal(meaning(front), meaning(src));
});

test('extract all alternatives extracts the whole choice', () => {
  const src = 'main = Say [a|b] now\n';
  const out = run(src, extractToBranch(src, sel(src, 0, [0, 1]), 'word'));
  assert.equal(out, 'main = Say $word now\nword = [a|b]\n');
  assert.equal(meaning(out), meaning(src));
});

test('extract keeps tags with their alternatives', () => {
  const src = 'main = [what @q|that|who @q] is [@q: ?|@else: .]\n';
  const out = run(src, extractToBranch(src, sel(src, 0, [0, 2]), 'wh'));
  assert.equal(out, 'main = [$wh|that] is [@q: ?|@else: .]\nwh = what @q | who @q\n');
  assert.equal(meaning(out), meaning(src));
});

test('extract from a bare definition choice', () => {
  const src = 'main = $g\ng = x | y | z\n';
  const bare = choices(src).find((c) => c.kind === 'group' && c.bare)!;
  const out = run(src, extractToBranch(src, { kind: 'alts', node: bare, indices: [0, 1] }, 'xy'));
  assert.equal(out, 'main = $g\ng = $xy | z\nxy = x | y\n');
  assert.equal(meaning(out), meaning(src));
});

test('extract a node: text, group, reference', () => {
  const src = 'main = Say [a|b] to $who\nwho = me\n';
  const group = choices(src)[0]!;
  const out = run(src, extractToBranch(src, { kind: 'node', node: group }, 'word'));
  assert.equal(out, 'main = Say $word to $who\nwho = me\nword = [a|b]\n');
  assert.equal(meaning(out), meaning(src));
  const t = texts(src).find((n) => n.value === 'Say')!;
  const out2 = run(src, extractToBranch(src, { kind: 'node', node: t }, 'say'));
  assert.equal(out2, 'main = $say [a|b] to $who\nwho = me\nsay = Say\n');
  assert.equal(meaning(out2), meaning(src));
  const r = refs(src)[0]!;
  const out3 = run(src, extractToBranch(src, { kind: 'node', node: r }, 'person'));
  assert.equal(out3, 'main = Say [a|b] to $person\nwho = me\nperson = $who\n');
  assert.equal(meaning(out3), meaning(src));
});

test('extract when the replaced text is the very end of the file', () => {
  const src = 'main = Say [a|b]';
  const out = run(src, extractToBranch(src, { kind: 'node', node: choices(src)[0]! }, 'word'));
  assert.equal(out, 'main = Say $word\nword = [a|b]\n');
  assert.equal(meaning(out), meaning(src));
  const src2 = 'main = [a|b|c]';
  const out2 = run(src2, extractToBranch(src2, sel(src2, 0, [1, 2]), 'bc'));
  assert.equal(out2, 'main = [a|$bc]\nbc = b | c\n');
  assert.equal(meaning(out2), meaning(src2));
});

test('extract in long form: alternatives become a ref line and a branch with one of', () => {
  const src = 'branch main\n  Say\n  one of\n    Hello\n    Hi\n    Hey\n  now\n';
  const out = run(src, extractToBranch(src, sel(src, 0, [0, 2]), 'warm'));
  assert.equal(out, 'branch main\n  Say\n  one of\n    ref warm\n    Hi\n  now\n\nbranch warm\n  one of\n    Hello\n    Hey\n');
  assert.equal(meaning(out), meaning(src));
});

test('extract in long form: one block alternative, with its children', () => {
  const src = 'branch main\n  one of\n    sequence\n      what\n      tag q\n    that\n    other\n';
  const out = run(src, extractToBranch(src, sel(src, 0, [0]), 'wh'));
  assert.equal(out, 'branch main\n  one of\n    ref wh\n    that\n    other\n\nbranch wh\n  sequence\n    what\n    tag q\n');
  assert.equal(meaning(out), meaning(src));
});

test('extract in long form: a whole block node', () => {
  const src = 'branch main\n  Hello\n  one of\n    a\n    b\n  there\n';
  const out = run(src, extractToBranch(src, { kind: 'node', node: choices(src)[0]! }, 'ab'));
  assert.equal(out, 'branch main\n  Hello\n  ref ab\n  there\n\nbranch ab\n  one of\n    a\n    b\n');
  assert.equal(meaning(out), meaning(src));
});

test('extract from a short expression inside a long definition uses the long form', () => {
  const src = 'branch main\n  How [are you|is it] today\n';
  const out = run(src, extractToBranch(src, { kind: 'node', node: choices(src)[0]! }, 'q'));
  assert.equal(out, 'branch main\n  How $q today\n\nbranch q\n  [are you|is it]\n');
  assert.equal(meaning(out), meaning(src));
});

test('extract a guarded alternative', () => {
  const src = 'main = what @q $x [@q: yes|@else: no]\nx = [a|b]\n';
  const g = choices(src).find((c) => c.kind === 'group' && c.options[0]?.guard !== undefined)!;
  const out = run(src, extractToBranch(src, { kind: 'alts', node: g, indices: [1] }, 'nope'));
  analyze(out);
  assert.equal(meaning(out), meaning(src));
});

test('extract refuses bad names, any-order items, and the definition choice itself', () => {
  const src = 'main = [a|b] [c & d]\nx = p | q\n';
  assert.ok('error' in extractToBranch(src, sel(src, 0, [0]), 'main'));
  assert.ok('error' in extractToBranch(src, sel(src, 1, [0]), 'k'));
  const bare = choices(src).find((c) => c.kind === 'group' && c.bare)!;
  assert.ok('error' in extractToBranch(src, { kind: 'node', node: bare }, 'k'));
  assert.ok('error' in extractToBranch(src, sel(src, 0, []), 'k'));
});

test('extract a range alternative as one unit', () => {
  const src = 'main = #[0..9|A..F]\n';
  const out = run(src, extractToBranch(src, sel(src, 0, [0]), 'digit'));
  assert.equal(out, 'main = #[$digit|A..F]\ndigit = [0..9]\n');
  assert.equal(meaning(out), meaning(src));
  assert.equal(alternatives(groups(src)[0]!).length, 2);
});

// --- Expand / Collapse -------------------------------------------------------------

test('expand and collapse one definition, or the whole file, as a single patch', () => {
  const src = '# hi\nmain = [a|b] $x\nx = [c|d]\n';
  const one = convertForms(src, 'long', ['x']);
  assert.equal(one.patches.length, 1);
  assert.deepEqual(one.changed, ['x']);
  const expanded = applyPatches(src, one.patches);
  assert.ok(expanded.includes('branch x\n  one of\n    c\n    d'));
  assert.ok(expanded.startsWith('# hi\nmain = [a|b] $x\n'));
  assert.equal(meaning(expanded), meaning(src));
  const all = convertForms(src, 'long');
  assert.equal(all.patches.length, 1);
  assert.deepEqual(all.changed.sort(), ['main', 'x']);
  const back = convertForms(applyPatches(src, all.patches), 'short');
  assert.equal(back.patches.length, 1);
  assert.equal(meaning(applyPatches(applyPatches(src, all.patches), back.patches)), meaning(src));
  assert.deepEqual(convertForms(src, 'short').patches, [], 'nothing to collapse');
});

test('skipped definitions are reported with the core reasons', () => {
  const src = 'main = $a $b\nbranch a\n  # note\n  one of\n    x\n    y\nb = [p|q]\n';
  const r = convertForms(src, 'short');
  assert.deepEqual(r.skipped.map((s) => s.name), ['a']);
  assert.match(r.skipped[0]!.reason, /comment/);
  assert.match(skippedNotice(r.skipped), /^Skipped 1 branch: a \(contains a comment/);
  const none = convertForms('main = x', 'long', ['main']);
  assert.equal(skippedNotice(none.skipped), '');
});

test('suggested names are never taken or reserved', () => {
  assert.equal(uniqueName('main = x'), 'phrase');
  assert.equal(uniqueName('main = x\nphrase = y'), 'phrase2');
  assert.equal(uniqueName('main = x', 'branch'), 'branch2');
  assert.equal(uniqueName('main = x', 'main'), 'main2');
});
