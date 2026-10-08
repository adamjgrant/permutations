import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HELP_ITEMS, insertionFor } from '../src/help';
import { analyze } from '../src/model';

const item = (id: string) => HELP_ITEMS.find((h) => h.id === id)!;
const apply = (doc: string, r: { from: number; to: number; insert: string }) => doc.slice(0, r.from) + r.insert + doc.slice(r.to);

test('a snippet never glues onto the words around it', () => {
  const doc = 'main = Say$x\nx = hi';
  const at = doc.indexOf('$x');
  const r = insertionFor(item('choice'), doc, at, at);
  assert.equal(apply(doc, r), 'main = Say [red|green|blue] $x\nx = hi');
  assert.equal(apply(doc, r).slice(r.select[0], r.select[1]), '[red|green|blue]');
});

test('without a cursor of your own, a snippet goes at the end of main and the program still runs', () => {
  const doc = 'main = [Hello|Oh, Hi] $greeting\ngreeting = [How|What]\n';
  const a = analyze(doc);
  const r = insertionFor(item('tag'), doc, 0, 0, { mainEnd: a.main.range[1] });
  const out = apply(doc, r);
  assert.equal(out.split('\n')[0], 'main = [Hello|Oh, Hi] $greeting [what @q|that]');
  assert.doesNotThrow(() => analyze(out));
});

test('a definition snippet takes a free name', () => {
  const doc = 'main = $greeting\ngreeting = hi\n';
  const r = insertionFor(item('reference'), doc, 0, 0, { taken: new Set(['main', 'greeting']) });
  const out = apply(doc, r);
  assert.match(out, /\ngreeting2 = \[Hello\|Hi\]\n$/);
  assert.doesNotThrow(() => analyze(out));
  const long = insertionFor(item('long'), doc, 0, 0, { taken: new Set(['main', 'greeting', 'pick']) });
  assert.match(apply(doc, long), /\nbranch pick2\n/);
});
