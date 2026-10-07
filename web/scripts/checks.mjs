// Behaviour checks for the finishing pass that do not need screenshots.
import { chromium } from 'playwright-core';
const url = process.env.URL ?? 'http://127.0.0.1:5183/';
const browser = await chromium.connectOverCDP(process.env.CDP ?? 'http://127.0.0.1:9333');
const page = await (browser.contexts()[0] ?? (await browser.newContext())).newPage();
await page.setViewportSize({ width: 1400, height: 900 });
page.setDefaultTimeout(6000);
setTimeout(() => { console.error('global timeout'); process.exit(2); }, 90000).unref();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const code = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
const settle = () => page.waitForTimeout(450);
let failures = 0;
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); if (!ok) failures++; };
async function setCode(text) { await page.click('.cm-content'); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(text); await settle(); }
await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.goto(url); await settle();

await setCode('main = $a [x|y]\na = [p|q]\nspare = z\n');
// delete: refused while referenced
await page.locator('.defctl[data-def="a"][data-action="delete"]').click();
check('delete refused with reason', /main/.test(await page.textContent('.popover .pop-message')), await page.textContent('.popover'));
await page.keyboard.press('Escape');
check('code unchanged after refused delete', (await code()).includes('a = [p|q]'));
// delete: allowed when unreferenced
await page.locator('.defctl[data-def="spare"][data-action="delete"]').click();
await page.locator('.popover button', { hasText: 'Delete' }).click(); await settle();
check('unreferenced branch deleted', !(await code()).includes('spare'), await code());
// new branch
await page.click('#t-new');
check('new branch name suggested', (await page.inputValue('.popover input')) === 'branch');
await page.keyboard.press('Meta+a'); await page.keyboard.type('shape'); await page.keyboard.press('Enter'); await settle();
check('new branch appended', (await code()).trim().endsWith('shape = text'), await code());
await page.click('#t-new'); await page.keyboard.press('Meta+a'); await page.keyboard.type('a'); await page.keyboard.press('Enter');
check('duplicate name refused', /already exists/.test(await page.textContent('.pop-error')));
await page.keyboard.press('Escape');
// retarget a pill
await page.locator('.k-ref', { hasText: '$a' }).dblclick();
await page.keyboard.press('Meta+a'); await page.keyboard.type('shape'); await page.keyboard.press('Enter'); await settle();
check('pill retargeted', (await code()).startsWith('main = $shape'), await code());
await page.locator('.k-ref', { hasText: '$shape' }).dblclick();
await page.keyboard.press('Meta+a'); await page.keyboard.type('nowhere'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
check('retarget to unknown name refused, field stays open', (await page.$$('.inline-edit')).length === 1 && /nowhere/.test(await page.textContent('#notice-text')));
await page.keyboard.press('Escape');

// keyboard: tag and guard, space-select, extract
await setCode('main = Say [red|green|blue] now\n');
await page.focus('.k-text >> nth=1');
await page.keyboard.press('t'); await page.keyboard.type('warm'); await page.keyboard.press('Enter'); await settle();
check('t adds a tag', (await code()).includes('red @warm'), await code());
await page.keyboard.press('ArrowDown');
await page.keyboard.press('g'); await page.keyboard.type('warm'); await page.keyboard.press('Enter'); await settle();
check('g adds a guard', (await code()).includes('@warm: green'), await code());
await page.focus('.k-text >> nth=2'); await page.keyboard.press('Space');
await page.focus('.k-text >> nth=3'); await page.keyboard.press('Space');
check('space selects rows', (await page.$$('.k-row.sel')).length >= 1);
check('extract enabled', !(await page.$eval('#t-extract', (b) => b.disabled)));
// guard hint
await setCode('main = [@zz: a|b]\n');
check('hint for unset tag', /zz/.test(await page.textContent('#chart-hints')) && !(await page.$eval('#chart-hints', (e) => e.hidden)));

// help insert
await setCode('main = hi\n');
await page.click('#b-help');
await page.locator('#help-list li', { hasText: 'Any order' }).locator('button').click(); await settle();
check('help snippet inserted', (await code()).includes('[foo & bar & baz]'), await code());
await page.locator('#help-list li', { hasText: 'Reference' }).first().locator('button').click(); await settle();
check('help end snippet appended as a line', (await code()).includes('\ngreeting = [Hello|Hi]'), await code());
await page.keyboard.press('Escape');
check('Escape closes help', await page.$eval('#help', (e) => e.hidden));

// range unit actions through the toolbar
await setCode('main = #[0..9|A..F]\n');
await page.locator('.k-range', { hasText: 'A..F' }).click();
await page.click('#t-up'); await settle();
check('range moves as a unit', (await code()).includes('[A..F|0..9]'), await code());
await page.locator('.k-range', { hasText: 'A..F' }).click();
await page.click('#t-del'); await settle();
check('range deletes as a unit', (await code()).includes('#[0..9]'), await code());

// errors
await setCode('main = [oops');
check('error shown', /Unclosed/.test(await page.textContent('#error')));
await setCode('main = [ok]');
check('error cleared', await page.$eval('#error', (e) => e.hidden));
// unrelated runtime error is shown, page survives
await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('boom') })));
check('non-Perm error shown', /boom/.test(await page.textContent('#error')) && (await page.$$('.pane')).length === 3);
// reduced motion
await page.emulateMedia({ reducedMotion: 'reduce' });
check('reduced motion removes toast transition', await page.$eval('#toast', (e) => getComputedStyle(e).transitionDuration.startsWith('0')));
console.log('page errors:', errors);
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await page.close(); await browser.close();
process.exit(failures ? 1 : 0);
