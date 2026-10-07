// Drives the built app in headless Chrome and saves screenshots plus a few assertions.
// Usage: start `npm run dev` (or any static server on dist/), then `npm run shots`.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.env.URL ?? 'http://127.0.0.1:5173/';
const out = process.env.OUT ?? '/tmp/perm-shots';
mkdirSync(out, { recursive: true });

// Launch Chrome yourself (headless, with its own --user-data-dir and --remote-debugging-port) and
// connect to it. Launching through Playwright fails inside some sandboxes (Chrome's singleton socket).
const cdp = process.env.CDP ?? 'http://127.0.0.1:9333';
const browser = await chromium.connectOverCDP(cdp);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1400, height: 860 });
page.setDefaultTimeout(8000);
setTimeout(() => { console.error('global timeout'); process.exit(2); }, 90000).unref();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const code = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
const settle = () => page.waitForTimeout(450);

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.goto(url);
await settle();
await page.screenshot({ path: `${out}/1-sketch.png` });
console.log('count:', await page.textContent('#count'));
console.log('samples:', await page.$$eval('#samples .t', (n) => n.map((x) => x.textContent)));

// error state
await page.click('.cm-content');
await page.keyboard.press('Meta+a');
await page.keyboard.type('main = [Hello|Oh, Hi');
await settle();
await page.screenshot({ path: `${out}/2-error.png` });
console.log('error:', await page.textContent('#error'));
console.log('chart kept:', (await page.$$('.k-text')).length, 'text nodes');

// restore and edit through the chart
await page.click('#b-reset');
await settle();
const hello = page.locator('.k-text', { hasText: 'Hello' }).first();
await hello.dblclick();
await page.keyboard.press('Meta+a');
await page.keyboard.type('Howdy [pal]');
await page.keyboard.press('Enter');
await settle();
console.log('after text edit:\n' + (await code()));
// hover a row, add an alternative via the + control
const row = page.locator('.k-text', { hasText: 'Oh, Hi' }).first();
await row.hover();
await page.screenshot({ path: `${out}/3-hover.png` });
await page.locator('.overlay .ctl[aria-label="Add an alternative"]').click();
await page.waitForTimeout(200);
await page.keyboard.press('Meta+a');
await page.keyboard.type('Hey');
await page.keyboard.press('Enter');
await settle();
await page.screenshot({ path: `${out}/4-chart-edit.png` });
console.log('after add:\n' + (await code()));
// reorder + delete via toolbar
await page.locator('.k-text', { hasText: 'Hey' }).first().click();
await page.click('#t-up');
await settle();
console.log('after move up:\n' + (await code()));
await page.click('#t-del');
await settle();
console.log('after delete:\n' + (await code()));
await page.screenshot({ path: `${out}/5-after-delete.png` });

// code cursor highlights chart
await page.click('.cm-content');
await page.keyboard.press('Meta+ArrowDown');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('End');
await page.waitForTimeout(100);
console.log('selected in chart:', await page.$$eval('.box.sel', (n) => n.map((x) => x.textContent)));

// all view
await page.click('#tab-all');
await page.click('#b-list');
await page.screenshot({ path: `${out}/6-all.png` });
console.log('all rows:', (await page.$$('#all-list li')).length, await page.textContent('#all-note'));

// big program: truncation message, tags, repeat
await page.click('#tab-random');
await page.click('.cm-content');
await page.keyboard.press('Meta+a');
await page.keyboard.type('# hex colour\nmain = # $hex{6} @warm\nhex = [0..9|A..F]', { delay: 0 });
await settle();
console.log('big count:', await page.textContent('#count'));
await page.click('#tab-all');
await page.click('#b-list');
console.log('truncation:', await page.textContent('#all-note'));
await page.screenshot({ path: `${out}/7-truncated.png` });

// namespaces, guards, transforms, any order, delimiter, collapse
await page.click('#tab-random');
await page.click('.cm-content');
await page.keyboard.press('Meta+a');
await page.keyboard.type('main = [@q: Is it|@else: It is] [x & y & z; delimiter="-"]:upper $letters.B [Warn @sev=5|Fine|] $solo\nletters.A = a\nletters.B = [b|c] $letters.A\nsolo = [one|two]', { delay: 0 });
await settle();
await page.screenshot({ path: `${out}/8-markers.png` });
await page.locator('.k-nsHeader').click();
await settle();
await page.screenshot({ path: `${out}/9-collapsed.png` });
console.log('ns boxes after collapse:', await page.$$eval('.k-def', (n) => n.length));
await page.emulateMedia({ colorScheme: 'dark' });
await page.locator('.k-nsHeader').click();
await page.click('#z-in');
await page.screenshot({ path: `${out}/10-dark-zoom.png` });
await page.emulateMedia({ colorScheme: 'light' });
// reload keeps the program, share link round trips
await page.reload();
await settle();
console.log('persisted:', (await code()).split('\n')[0]);
await page.click('#b-share');
const hash = await page.evaluate(() => location.hash.slice(0, 20));
console.log('share hash:', hash);
const full = page.url();
await page.evaluate(() => localStorage.clear());
await page.goto('about:blank');
await page.goto(full);
await settle();
console.log('loaded from hash:', (await code()).split('\n')[0]);
console.log('page errors:', errors);
await page.close();
await browser.close();
