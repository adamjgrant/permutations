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

test('moving right into a nested choice lands on one of its own alternatives', () => {
  const boxes = build("main = [How [are you|'s [it|everything]]|What]");
  const next = navigate(boxes, text(boxes, 'How'), 'right')!;
  assert.ok(next.full === 'are you' || next.full === "'s", `landed on ${next.full}`);
  const back = navigate(boxes, text(boxes, "'s"), 'left')!;
  assert.equal(back.full, 'How');
});

test('left and right enter a choice with an even number of alternatives instead of skipping it', () => {
  let boxes = build('main = Start [Hi|Hello] there');
  assert.equal(navigate(boxes, text(boxes, 'Start'), 'right')!.full, 'Hi', 'right from Start enters the choice');
  assert.equal(navigate(boxes, text(boxes, 'there'), 'left')!.full, 'Hi', 'left from there enters it from the other side');
  assert.equal(navigate(boxes, text(boxes, 'Hi'), 'right')!.full, 'there', 'and leaves it again');
  assert.equal(navigate(boxes, text(boxes, 'Hello'), 'left')!.full, 'Start');
  boxes = build('main = [Hi|Hello] there');
  assert.equal(navigate(boxes, text(boxes, 'there'), 'left')!.full, 'Hi');
  boxes = build('main = [a|b] [c|d] e');
  assert.equal(navigate(boxes, text(boxes, 'e'), 'left')!.full, 'c');
  assert.equal(navigate(boxes, text(boxes, 'c'), 'left')!.full, 'a');
  assert.equal(navigate(boxes, text(boxes, 'b'), 'right')!.full, 'd');
  assert.equal(navigate(boxes, text(boxes, 'd'), 'right')!.full, 'e');
  boxes = build('main = $greeting there\ngreeting = [Hi|Hello] you');
  const ref = boxes.find((b) => b.kind === 'ref')!;
  assert.equal(navigate(boxes, text(boxes, 'there'), 'left')!.id, ref.id);
});
