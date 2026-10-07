import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, decodeShare, DEFAULT_PROGRAM, encodeShare } from '../src/model';
import { Box, LEAF_KINDS, layout } from '../src/layout';

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function build(src: string, collapsed: string[] = []) {
  const a = analyze(src);
  return { a, l: layout({ main: a.main, others: a.others, source: src, collapsed: new Set(collapsed) }) };
}

const find = (boxes: Box[], pred: (b: Box) => boolean): Box => {
  const b = boxes.find(pred);
  assert.ok(b, 'box not found');
  return b;
};

function assertNoOverlap(boxes: Box[]): void {
  const leaves = boxes.filter((b) => LEAF_KINDS.has(b.kind));
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      assert.ok(!overlap(leaves[i] as Box, leaves[j] as Box), `overlap: ${leaves[i]!.label} / ${leaves[j]!.label}`);
    }
  }
}

test('sketch: no overlapping boxes, everything inside the canvas', () => {
  const { l } = build(DEFAULT_PROGRAM);
  assertNoOverlap(l.boxes);
  for (const b of l.boxes) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= l.width && b.y + b.h <= l.height, `outside canvas: ${b.kind} ${b.label}`);
  }
});

test('sketch: Hello and Oh, Hi are two ordered rows of the first choice', () => {
  const { l } = build(DEFAULT_PROGRAM);
  const hello = find(l.boxes, (b) => b.kind === 'text' && b.label === 'Hello');
  const ohhi = find(l.boxes, (b) => b.kind === 'text' && b.label === 'Oh, Hi');
  assert.ok(ohhi.y > hello.y + hello.h - 1, 'Oh, Hi sits below Hello');
  assert.equal(hello.x, ohhi.x, 'rows are left aligned');
  const rows = l.boxes.filter((b) => b.kind === 'row' && b.range && b.range[0] <= hello.range![0] && b.range[1] >= hello.range![1]);
  assert.ok(rows.length >= 1);
  const mainDef = find(l.boxes, (b) => b.kind === 'def' && b.name === 'main');
  assert.ok(hello.y >= mainDef.y && hello.y + hello.h <= mainDef.y + mainDef.h, 'rows live inside main');
});

test('sketch: main on top, BRANCHES divider, greeting below it', () => {
  const { l } = build(DEFAULT_PROGRAM);
  const main = find(l.boxes, (b) => b.kind === 'def' && b.name === 'main');
  const greeting = find(l.boxes, (b) => b.kind === 'def' && b.name === 'greeting');
  assert.ok(l.dividerY !== undefined);
  assert.ok(main.y + main.h < l.dividerY!);
  assert.ok(greeting.y > l.dividerY!);
  const label = find(l.boxes, (b) => b.kind === 'sectionLabel');
  assert.equal(label.label, 'BRANCHES');
  assert.ok(l.edges.some((e) => e.kind === 'divider'));
});

test('sketch: the greeting pill has a dashed ref edge to the greeting definition', () => {
  const { l } = build(DEFAULT_PROGRAM);
  const pill = find(l.boxes, (b) => b.kind === 'ref' && b.target === 'greeting');
  const def = find(l.boxes, (b) => b.kind === 'def' && b.name === 'greeting');
  const e = l.edges.find((x) => x.kind === 'ref');
  assert.ok(e);
  assert.equal(e.from, pill.id);
  assert.equal(e.to, def.id);
  assert.equal(e.points.length, 4);
  // starts on the pill, ends on the definition box edge
  assert.ok(Math.abs(e.points[0]!.y - (pill.y + pill.h)) < 1e-6);
  assert.ok(Math.abs(e.points[3]!.y - def.y) < 1e-6);
  assert.ok(e.points[3]!.x >= def.x && e.points[3]!.x <= def.x + def.w);
});

test('sketch: greeting tree has the expected shape', () => {
  const { l } = build(DEFAULT_PROGRAM);
  const t = (s: string): Box => find(l.boxes, (b) => b.kind === 'text' && b.label === s);
  const how = t('How');
  const what = t('What');
  assert.ok(what.y > how.y, 'What is a row below How');
  assert.equal(how.x, what.x);
  const are = t('are you');
  const its = t("'s");
  const it = t('it');
  const everything = t('everything');
  assert.ok(its.y > are.y, "'s alternative is below 'are you'");
  assert.ok(it.x > its.x && everything.x > its.x);
  assert.ok(everything.y > it.y);
  assert.ok(are.x > how.x);
});

test('sketch: flow edges join siblings left to right', () => {
  const { l } = build(DEFAULT_PROGRAM);
  const byId = new Map(l.boxes.map((b) => [b.id, b]));
  const hello = find(l.boxes, (b) => b.kind === 'text' && b.label === 'Hello');
  // the choice frame links on to the greeting pill
  const pill = find(l.boxes, (b) => b.kind === 'ref');
  const toPill = l.edges.find((e) => e.kind === 'flow' && e.to === pill.id);
  assert.ok(toPill, 'something flows into the pill');
  const from = byId.get(toPill.from!)!;
  assert.equal(from.kind, 'frame');
  assert.ok(from.x + from.w <= pill.x + 1e-6);
  // How -> frame holding 'are you' / "'s ..."
  const how = find(l.boxes, (b) => b.kind === 'text' && b.label === 'How');
  const out = l.edges.find((e) => e.kind === 'flow' && e.from === how.id);
  assert.ok(out);
  assert.equal(byId.get(out.to!)!.kind, 'frame');
  // every flow edge has endpoints at its two boxes' vertical middle or on their frame sides
  for (const e of l.edges) {
    if (e.kind !== 'flow') continue;
    assert.ok(e.from && e.to && byId.has(e.from) && byId.has(e.to));
    assert.equal(e.points.length, 2);
    assert.ok(e.points[1]!.x >= e.points[0]!.x - 1e-6, 'flow edges point right');
  }
  assert.ok(hello);
});

test('markers: tags, guards, transforms, repeat, any order, delimiter, empty', () => {
  const src = [
    'main = [Warning @severity=5|Notice @q|] [@q: a|@else: b] $x:upper $y{3} [p & q; delimiter="-"]',
    'x = hi',
    'y = z',
  ].join('\n');
  const { l } = build(src);
  const kinds = new Set(l.boxes.map((b) => b.kind));
  for (const k of ['tag', 'guard', 'transform', 'repeat', 'anyorder', 'delimiter', 'empty'] as const) {
    assert.ok(kinds.has(k), `missing marker ${k}`);
  }
  assert.ok(l.boxes.some((b) => b.kind === 'tag' && b.label === '@severity=5'));
  assert.ok(l.boxes.some((b) => b.kind === 'guard' && b.label === '@else:'));
  assert.ok(l.boxes.some((b) => b.kind === 'repeat' && b.label === '×3'));
  assert.ok(l.boxes.some((b) => b.kind === 'transform' && b.label === ':upper'));
  assertNoOverlap(l.boxes);
});

test('namespaced branches group under a header and collapse', () => {
  const src = 'main = $letters.A $letters.B $c\nletters.A = a\nletters.B = b\nc = c';
  const open = build(src);
  const hdr = find(open.l.boxes, (b) => b.kind === 'nsHeader');
  assert.equal(hdr.ns, 'letters');
  assert.ok(open.l.boxes.some((b) => b.kind === 'def' && b.name === 'letters.A'));
  const shut = build(src, ['letters']);
  assert.ok(!shut.l.boxes.some((b) => b.kind === 'def' && b.name === 'letters.A'));
  const hdr2 = find(shut.l.boxes, (b) => b.kind === 'nsHeader');
  const toHdr = shut.l.edges.filter((e) => e.kind === 'ref' && e.to === hdr2.id);
  assert.equal(toHdr.length, 2, 'both pills point at the collapsed header');
  assertNoOverlap(open.l.boxes);
  assertNoOverlap(shut.l.boxes);
});

test('unreferenced definitions still appear under BRANCHES', () => {
  const { l } = build('main = hi\nlonely = x | y');
  assert.ok(l.boxes.some((b) => b.kind === 'def' && b.name === 'lonely'));
});

test('anonymous main program lays out', () => {
  const { l } = build('[a|b] c');
  assert.ok(l.boxes.some((b) => b.kind === 'defLabel' && b.label === 'main'));
  assert.equal(l.dividerY, undefined);
});

test('long text is shortened, never wider than the cap', () => {
  const { l } = build('main = ' + 'word '.repeat(80).trim());
  const t = find(l.boxes, (b) => b.kind === 'text');
  assert.ok(t.label.endsWith('…'));
  assert.equal(t.full.length, 80 * 5 - 1);
});

test('share links round trip unicode', () => {
  const s = 'main = [héllo|日本語] $x\nx = ✓';
  assert.equal(decodeShare(encodeShare(s)), s);
});
