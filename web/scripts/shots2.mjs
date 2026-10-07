// Drives the finishing-pass features in headless Chrome: long form, rename, extract, chips,
// range boxes, any-order warning, expand and collapse, keyboard focus, dark mode.
// Start Chrome with --remote-debugging-port=9333 and a dev server first (see shots.mjs).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.env.URL ?? 'http://127.0.0.1:5183/';
const out = process.env.OUT ?? '/tmp/perm-shots2';
mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP ?? 'http://127.0.0.1:9333');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1400, height: 900 });
page.setDefaultTimeout(8000);
setTimeout(() => { console.error('global timeout'); process.exit(2); }, 120000).unref();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const code = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
const settle = () => page.waitForTimeout(500);
const shot = async (n) => { await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
async function setCode(text) {
  await page.click('.cm-content');
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText(text);
  await settle();
}
const box = (sel, text) => page.locator(sel, { hasText: text }).first();

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.goto(url);
await settle();

// 1. long form program
await setCode(`branch main
  Excuse me,
  one of
    sequence
      what
      tag q
    that
  is really neat
  one of
    when q
      ?
    otherwise
      .

branch spare
  one of
    x
    y
`);
await shot('01-long-form');
console.log('count', await page.textContent('#count'), 'error hidden', await page.$eval('#error', (e) => e.hidden));
// long-form chart edits
await box('.k-text', 'that').dblclick();
await page.keyboard.press('Meta+a');
await page.keyboard.type('this');
await page.keyboard.press('Enter');
await settle();
await box('.k-text', 'this').hover();
await page.locator('.overlay .ctl[aria-label="Add an alternative"]').click();
await page.waitForTimeout(200);
await page.keyboard.press('Meta+a');
await page.keyboard.type('those');
await page.keyboard.press('Enter');
await settle();
console.log('long add/edit:\n' + (await code()));
await box('.k-text', 'those').click();
await page.click('#t-up');
await settle();
console.log('long move up:\n' + (await code()));
await box('.k-text', 'those').click();
await page.click('#t-del');
await settle();
console.log('long delete:\n' + (await code()));
await shot('02-long-edited');

// 2. rename
await setCode(`main = [Hello|Oh, Hi] $greeting $greeting:upper
greeting = [How [are you|'s it]|What $topic]
topic = [up|new]
`);
await page.locator('.defctl[data-def="topic"][data-action="rename"]').click();
await page.keyboard.press('Meta+a');
await page.keyboard.type('subject');
await shot('03-rename-dialog');
await page.keyboard.press('Enter');
await settle();
console.log('after rename:\n' + (await code()));
await page.locator('.defctl[data-def="subject"][data-action="rename"]').click();
await page.keyboard.press('Meta+a');
await page.keyboard.type('9bad');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await shot('04-rename-refused');
console.log('refusal:', await page.textContent('.pop-error'));
await page.keyboard.press('Escape');

// 3. extract to branch
await setCode(`main = Say [red|green|blue|gold] now
`);
await box('.k-text', 'red').click();
await box('.k-text', 'blue').click({ modifiers: ['Shift'] });
await page.waitForTimeout(150);
await shot('05-extract-selected');
await page.click('#t-extract');
await page.keyboard.press('Meta+a');
await page.keyboard.type('cool');
await shot('06-extract-dialog');
await page.keyboard.press('Enter');
await settle();
console.log('after extract:\n' + (await code()));
await shot('07-extract-done');
// undo is one step
await page.click('.cm-content');
await page.keyboard.press('Meta+z');
await settle();
console.log('after one undo:\n' + (await code()));

// 4. chips
await setCode(`main = [what @q|that] is [@q: ?|@else: .] [@zz: a|b]
`);
await box('.k-tag', '@q').click();
await page.waitForTimeout(200);
await shot('08-chip-popover');
await page.keyboard.press('Meta+a');
await page.keyboard.type('ask=2');
await page.keyboard.press('Enter');
await settle();
console.log('after chip edit:', (await code()).trim());
await box('.k-guard', '@else:').click();
await page.locator('.popover button', { hasText: 'Remove' }).click();
await settle();
console.log('after guard removal:', (await code()).trim());
await box('.k-text', 'that').hover();
await shot('09-hover-toolbar');
await page.locator('.overlay .ctl[aria-label="Add a tag to this alternative"]').click();
await page.keyboard.type('z');
await page.keyboard.press('Enter');
await settle();
console.log('after add tag:', (await code()).trim());
await shot('10-guard-hint');

// 5. range box
await setCode(`hex = [0..9|A..F]
main = #$hex{6}
other = #[0..9|A..F]
`);
await shot('11-range-box');
console.log('range boxes:', await page.$$eval('.k-range text', (n) => n.map((x) => x.textContent)), 'text boxes for digits:', await page.$$eval('.k-text', (n) => n.length));
await page.locator('.k-range').first().dblclick();
await page.keyboard.press('Meta+a');
await page.keyboard.type('0..4');
await page.keyboard.press('Enter');
await settle();
console.log('after range edit:\n' + (await code()));

// 6. any-order warning and delimiter labels
await setCode(`main = [a & b & c & d & e & f & g & h; delimiter="-"] [$x $y $z; delimiter=" / "]
x = 1
y = 2
z = 3
`);
await shot('12-anyorder-warning');
console.log('anyorder label:', await page.$$eval('.k-anyorder text', (n) => n.map((x) => x.textContent)), 'edge labels:', await page.$$eval('.edge-label', (n) => n.length));

// 7. expand and collapse
await setCode(`# the greeting
main = [Hello|Hi] $thing
thing = [a|b|c]
note = [x|y]
branch commented
  # explain
  one of
    p
    q
`);
await page.locator('.defctl[data-def="thing"][data-action="convert"]').click();
await settle();
console.log('after expand one:\n' + (await code()));
await shot('13-expand-one');
await page.click('#b-collapse');
await settle();
console.log('after collapse all:\n' + (await code()));
console.log('notice:', await page.textContent('#notice-text'));
await shot('14-collapse-all-skipped');
await page.click('#b-expand');
await settle();
console.log('after expand all:\n' + (await code()));
await page.click('.cm-content');
await page.keyboard.press('Meta+z');
await settle();
console.log('one undo reverts expand all:\n' + (await code()));

// 8. keyboard
await setCode(`main = Say [red|green|blue] to $who
who = [me|you]
`);
await page.focus('.k-text >> nth=0');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowDown');
await settle();
console.log('focused:', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')));
await shot('15-keyboard-focus');
await page.keyboard.press('Alt+ArrowUp');
await settle();
console.log('after Alt+Up:', (await code()).split('\n')[0]);
await page.keyboard.press('Delete');
await settle();
console.log('after Delete:', (await code()).split('\n')[0]);
await page.keyboard.press('Enter');
await page.keyboard.press('Meta+a');
await page.keyboard.type('zinc');
await page.keyboard.press('Enter');
await settle();
console.log('after Enter edit:', (await code()).split('\n')[0], '| focus kept:', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')));
// tab stops
console.log('tabindex=0 boxes:', await page.$$eval('.box[tabindex="0"]', (n) => n.length));

// 9. dark mode
await setCode(`main = [Warn @sev=5|Fine|] [@sev=5: !|@else: .] #[0..9|A..F]{2} [p & q; delimiter="-"] $s
s = [one|two]
`);
await page.emulateMedia({ colorScheme: 'dark' });
await page.locator('.k-text', { hasText: 'Fine' }).hover();
await shot('16-dark');
await page.click('#b-help');
await shot('17-dark-help');
await page.emulateMedia({ colorScheme: 'light' });
await shot('18-light-help');
await page.click('#help-close');

// 10. errors never white-screen
await setCode('main = [oops');
await shot('19-error');
console.log('error:', await page.textContent('#error'));
console.log('page errors:', errors);
await page.close();
await browser.close();
