import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../src/model';
import { appendToBranch, insertReference, insertText, pieceRange, varyWords, wordsOf, wrapInChoice } from '../src/insert';
import { locatePiece } from '../src/remove';
import { groups, meaning, refs, run, texts } from './helpers';

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
  const after = locatePiece(bodies(src), text(src, 'Hello'))!;
  assert.equal(run(src, insertReference(src, after, 'g')), 'main = Hello $g [world|friend]!\ng = hi');
  const long = 'branch main\n  Hello\n  there\ng = hi\n';
  const a2 = locatePiece(bodies(long), text(long, 'Hello'))!;
  assert.equal(run(long, insertReference(long, a2, 'g')), 'branch main\n  Hello\n  ref g\n  there\ng = hi\n');
});

test('inserting after a transformed reference goes after the transform', () => {
  const src = 'main = $x:upper now\nx = a\ny = b';
  const r = pieceRange(bodies(src), refs(src)[0]!)!;
  assert.equal(src.slice(r[0], r[1]), '$x:upper');
  assert.equal(run(src, insertReference(src, { range: r }, 'y')), 'main = $x:upper $y now\nx = a\ny = b');
});

test('vary words: some words of a text become a choice or optional, the rest stays', () => {
  const src = 'main = Hello dear world';
  const t0 = text(src, 'Hello dear world');
  assert.deepEqual(wordsOf(t0.value), ['Hello', 'dear', 'world']);
  const opt = run(src, varyWords(src, t0, 1, 1, null));
  assert.equal(opt, 'main = Hello [dear|] world');
  assert.match(meaning(opt), /"Hello world"/);
  assert.match(meaning(opt), /"Hello dear world"/);
  const r = varyWords(src, t0, 0, 1, 'Hi');
  const choice = run(src, r);
  assert.equal(choice, 'main = [Hello dear|Hi] world');
  assert.equal(choice.slice(r!.select![0], r!.select![1]), 'Hi');
  assert.equal(run(src, varyWords(src, t0, 2, 2, 'friend')), 'main = Hello dear [world|friend]');
});

test('vary words keeps specials escaped and works on a long-form line', () => {
  const src = 'main = Save 50% \\[now\\] today';
  const t0 = texts(src)[0]!;
  assert.equal(wordsOf(t0.value).length, 4);
  const out = run(src, varyWords(src, t0, 3, 3, null));
  assert.match(meaning(out), /Save 50% \[now\] today/);
  const long = 'branch main\n  Hello dear world\n';
  const lt = text(long, 'Hello dear world');
  assert.equal(run(long, varyWords(long, lt, 1, 1, null)), 'branch main\n  Hello [dear|] world\n');
});

test('inserting a reference into a long-form alternative keeps it one alternative', () => {
  const src = 'branch main\n  Hello\n  one of\n    friend\n    pal\nbranch x\n  hi\n';
  const loc = locatePiece(bodies(src), text(src, 'friend'))!;
  const out = run(src, insertReference(src, loc, 'x'));
  assert.equal(out, 'branch main\n  Hello\n  one of\n    friend $x\n    pal\nbranch x\n  hi\n');
  assert.equal(analyze(out).program.count, 2n);
  const kw = 'branch main\n  one of\n    "one of"\n    pal\nbranch x\n  hi\n';
  const out2 = run(kw, insertReference(kw, locatePiece(bodies(kw), text(kw, 'one of'))!, 'x'));
  assert.equal(analyze(out2).program.count, 2n);
  assert.match(meaning(out2), /one of hi/);
});

test('vary words keeps punctuation outside the choice, and pins spacing under another delimiter', () => {
  const src = 'main = Hi Sam, thanks for getting in touch.';
  const t0 = text(src, 'Hi Sam, thanks for getting in touch.');
  const r = varyWords(src, t0, 1, 1, 'Alex');
  const out = run(src, r);
  assert.equal(out, 'main = Hi [Sam|Alex], thanks for getting in touch.');
  assert.equal(out.slice(r!.select![0], r!.select![1]), 'Alex');
  assert.match(meaning(out), /"Hi Alex, thanks for getting in touch\."/);
  const quoted = 'main = She said (hello) twice';
  const q = run(quoted, varyWords(quoted, text(quoted, 'She said (hello) twice'), 2, 2, 'hi'));
  assert.equal(q, 'main = She said ([hello|hi]) twice');
  const dashed = 'delimiter = "-"\nmain = Hello dear world';
  const d = varyWords(dashed, text(dashed, 'Hello dear world'), 1, 1, null);
  const dout = run(dashed, d);
  assert.equal(dout.split('\n')[1], 'main = [Hello [dear|] world; delimiter=" "]');
  assert.match(meaning(dout), /"Hello world"/);
  assert.match(meaning(dout), /"Hello dear world"/);
});

test('insert text after a piece, after a whole choice, and at the end of a branch', () => {
  const src = 'main = Say [hi|hello [there|you]] now\ncl = Bye';
  const g = groups(src)[0]!;
  const after = { range: pieceRange(bodies(src), g)! };
  assert.equal(run(src, insertText(src, after, 'and then', new Set(['cl']))).split('\n')[0], 'main = Say [hi|hello [there|you]] and then now');
  assert.equal(run(src, insertText(src, after, 'see $cl', new Set(['main', 'cl']))).split('\n')[0], 'main = Say [hi|hello [there|you]] see $cl now');
  const defs = analyze(src);
  assert.equal(run(src, appendToBranch(src, defs.main, { text: 'please.' })).split('\n')[0], 'main = Say [hi|hello [there|you]] now please.');
  const bare = 'main = $g\ng = Hello | Hi';
  const gdef = analyze(bare).others[0]!;
  assert.equal(run(bare, appendToBranch(bare, gdef, { text: 'there' })).split('\n')[1], 'g = [Hello | Hi] there');
  assert.match(meaning(run(bare, appendToBranch(bare, gdef, { text: 'there' }))), /"Hi there"/);
  const long = 'branch main\n  Hello\n  one of\n    a\n    b\n';
  const ldef = analyze(long).main;
  assert.equal(run(long, appendToBranch(long, ldef, { ref: 'x' })), 'branch main\n  Hello\n  one of\n    a\n    b\n  ref x\n');
});
