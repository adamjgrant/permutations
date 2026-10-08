import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, decodeShare, DEFAULT_PROGRAM, encodeShare } from '../src/model';
import { Box, LEAF_KINDS, layout } from '../src/layout';

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function build(src: string, collapsed: string[] = []) {
  const a = analyze(src);
  return { a, l: layout({ main: a.main, others: a.others, source: src, collapsed: new Set(collapsed), defaultDelimiter: a.delimiter, knownTags: a.knownTags }) };
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

test('a range is one box labelled with its source text, not one row per value', () => {
  const { l } = build('main = #[0..9|A..F]{6}');
  const ranges = l.boxes.filter((b) => b.kind === 'range');
  assert.deepEqual(ranges.map((b) => b.label), ['0..9', 'A..F']);
  assert.deepEqual(ranges.map((b) => b.values), [10, 6]);
  assert.equal(l.boxes.filter((b) => b.kind === 'row').length, 2);
  assert.ok(!l.boxes.some((b) => b.kind === 'text' && /^[0-9A-F]$/.test(b.label)));
  assert.equal(ranges[0]!.range![1] - ranges[0]!.range![0], 4);
  assertNoOverlap(l.boxes);
});

test('any order shows n! and warns above seven items', () => {
  const small = build('main = [a & b & c]').l.boxes.find((b) => b.kind === 'anyorder')!;
  assert.match(small.label, /any order . 3! = 6/);
  assert.ok(!small.warn);
  const eight = build('main = [a & b & c & d & e & f & g & h]').l.boxes.find((b) => b.kind === 'anyorder')!;
  assert.match(eight.label, /8! = 40,320/);
  assert.equal(eight.warn, true);
  const seven = build('main = [a & b & c & d & e & f & g]').l.boxes.find((b) => b.kind === 'anyorder')!;
  assert.ok(!seven.warn);
});

test('a non-default delimiter is labelled on the edges inside the group', () => {
  const { l } = build('main = [$a $b $c; delimiter="-"] x\na = 1\nb = 2\nc = 3');
  const labelled = l.edges.filter((e) => e.label !== undefined);
  assert.equal(labelled.length, 2, 'two joins inside the group, none outside it');
  assert.ok(labelled.every((e) => e.label === '"-"'));
  assert.ok(l.boxes.some((b) => b.kind === 'delimiter'), 'the header chip stays');
  const plain = build('main = [$a $b $c] x\na = 1\nb = 2\nc = 3').l;
  assert.ok(plain.edges.every((e) => e.label === undefined));
  const any = build('main = [p & q & r; delimiter=", "]').l;
  assert.equal(any.edges.filter((e) => e.label === '", "').length, 2, 'between the three rows');
  const same = build('main = [$a $b; delimiter=" "]\na = 1\nb = 2').l;
  assert.ok(same.edges.every((e) => e.label === undefined), 'the default delimiter needs no label');
});

test('long-form programs lay out like short ones, with forms recorded on the cards', () => {
  const src = 'branch main\n  Excuse me,\n  one of\n    sequence\n      what\n      tag q\n    that\n  one of\n    when q\n      ?\n    otherwise\n      .\n\nshort = [a|b]\n';
  const { l } = build(src);
  assert.equal(l.boxes.find((b) => b.kind === 'def' && b.name === 'main')!.form, 'long');
  assert.equal(l.boxes.find((b) => b.kind === 'def' && b.name === 'short')!.form, 'short');
  const tag = l.boxes.find((b) => b.kind === 'tag')!;
  assert.equal(src.slice(...tag.range!), 'tag q');
  const guard = l.boxes.find((b) => b.kind === 'guard' && b.label === '@q:')!;
  assert.equal(src.slice(...guard.range!), 'when q');
  assert.ok(l.boxes.some((b) => b.kind === 'guard' && b.label === '@else:'));
  assertNoOverlap(l.boxes);
});

test('tag and guard chips cover exactly their own source text', () => {
  const src = 'main = [what @q|that] is [@q: ? | @else: .]';
  const { l } = build(src);
  assert.equal(src.slice(...l.boxes.find((b) => b.kind === 'tag')!.range!), '@q');
  assert.equal(src.slice(...l.boxes.find((b) => b.kind === 'guard' && b.label === '@q:')!.range!), '@q:');
});

test('a guard on a tag nobody sets is flagged', () => {
  const { l } = build('main = [@zz: a|b] [x @q|y] [@q: c|d]');
  const zz = l.boxes.find((b) => b.kind === 'guard' && b.label === '@zz:')!;
  assert.equal(zz.warn, true);
  assert.match(zz.note!, /zz/);
  assert.ok(!l.boxes.find((b) => b.kind === 'guard' && b.label === '@q:')!.warn);
});

test('branch cards pack into rows that wrap at the given width, in order, without overlapping', () => {
  const src = 'main = $a $b $c $d\na = [one|two]\nb = [three|four]\nc = [five|six]\nd = [seven|eight]';
  const a = analyze(src);
  const narrow = layout({ main: a.main, others: a.others, source: src, defaultDelimiter: a.delimiter, knownTags: a.knownTags });
  const wide = layout({ main: a.main, others: a.others, source: src, defaultDelimiter: a.delimiter, knownTags: a.knownTags, wrapWidth: 900 });
  const defs = (l: typeof wide) => ['a', 'b', 'c', 'd'].map((n) => l.boxes.find((b) => b.kind === 'def' && b.name === n)!);
  const n = defs(narrow);
  const w = defs(wide);
  // Without a wrap width each card fits beside the next only within main's width.
  assert.ok(w.filter((d) => d.y === w[0]!.y).length > n.filter((d) => d.y === n[0]!.y).length, 'a wider pane puts more cards on a row');
  for (const l of [narrow, wide]) {
    const cards = l.boxes.filter((b) => b.kind === 'def');
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++) {
        const p = cards[i]!;
        const q = cards[j]!;
        assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `cards overlap: ${p.name} / ${q.name}`);
      }
    for (const b of l.boxes) assert.ok(b.x + b.w <= l.width && b.y + b.h <= l.height, `outside canvas: ${b.kind} ${b.label}`);
  }
  // Reading order: left to right, then down.
  for (let i = 1; i < w.length; i++) assert.ok(w[i]!.y > w[i - 1]!.y || (w[i]!.y === w[i - 1]!.y && w[i]!.x > w[i - 1]!.x));
});

test('a reference to a card beside it runs sideways into the card', () => {
  const src = 'main = x\na = [one|$b]\nb = [two|three]';
  const a = analyze(src);
  const l = layout({ main: a.main, others: a.others, source: src, defaultDelimiter: a.delimiter, knownTags: a.knownTags, wrapWidth: 900 });
  const da = l.boxes.find((b) => b.kind === 'def' && b.name === 'a')!;
  const db = l.boxes.find((b) => b.kind === 'def' && b.name === 'b')!;
  assert.equal(da.y, db.y, 'a and b share a row');
  const e = l.edges.find((x) => x.kind === 'ref')!;
  assert.ok(Math.abs(e.points[3]!.x - db.x) < 1e-6, 'enters the left side of the card');
  assert.ok(e.points[3]!.y > db.y && e.points[3]!.y < db.y + db.h);
});
