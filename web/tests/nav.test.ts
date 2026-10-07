import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layout } from '../src/layout';
import { navigate, readingOrder, rowContext } from '../src/nav';
import { analyze } from '../src/model';

function build(src: string) {
  const a = analyze(src);
  return layout({ main: a.main, others: a.others, source: src, defaultDelimiter: a.delimiter, knownTags: a.knownTags }).boxes;
}
const text = (boxes: ReturnType<typeof build>, s: string) => boxes.find((b) => b.kind === 'text' && b.full === s)!;

test('arrow keys move between sibling alternatives and along a sequence', () => {
  const boxes = build('main = Say [red|green|blue] now');
  const red = text(boxes, 'red');
  const green = text(boxes, 'green');
  assert.equal(navigate(boxes, red, 'down')!.id, green.id);
  assert.equal(navigate(boxes, green, 'up')!.id, red.id);
  assert.equal(navigate(boxes, text(boxes, 'blue'), 'down'), undefined);
  assert.equal(navigate(boxes, text(boxes, 'Say'), 'right')!.id, green.id, 'enters the choice on its centre line');
  assert.equal(navigate(boxes, red, 'right')!.id, text(boxes, 'now').id);
  assert.equal(navigate(boxes, text(boxes, 'now'), 'left')!.id, green.id);
});

test('arrows reach chips and work in long form', () => {
  const boxes = build('branch main\n  one of\n    sequence\n      what\n      tag q\n    that\n');
  const what = text(boxes, 'what');
  const tag = boxes.find((b) => b.kind === 'tag')!;
  assert.equal(navigate(boxes, what, 'right')!.id, tag.id);
  assert.equal(navigate(boxes, what, 'down')!.id, text(boxes, 'that').id);
});

test('every focusable box can be reached by reading order, and rows know their frame', () => {
  const boxes = build('main = [a|b @q] $x\nx = [c|d]');
  const order = readingOrder(boxes);
  assert.ok(order.length >= 8);
  const ctx = rowContext(boxes, text(boxes, 'a'));
  assert.ok(ctx.row && ctx.frame);
  assert.equal(ctx.row!.index, 0);
});
