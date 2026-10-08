// Runs an ad-hoc scenario against the running app in a Chrome started with
// --remote-debugging-port. Usage: node scripts/drive.mjs path/to/scenario.mjs
// A scenario exports `default async (t) => {}` where t has page, shot(name), code(), settle(), log().
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const url = process.env.URL ?? 'http://127.0.0.1:5173/';
const out = process.env.OUT ?? '/tmp/perm-audit';
mkdirSync(out, { recursive: true });
const scenarioPath = process.argv[2];
if (!scenarioPath) {
  console.error('usage: node scripts/drive.mjs scenario.mjs');
  process.exit(2);
}

const browser = await chromium.connectOverCDP(process.env.CDP ?? 'http://127.0.0.1:9333');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
const width = Number(process.env.W ?? 1400);
const height = Number(process.env.H ?? 860);
await page.setViewportSize({ width, height });
if (process.env.DARK) await page.emulateMedia({ colorScheme: 'dark' });
page.setDefaultTimeout(6000);
setTimeout(() => {
  console.error('global timeout');
  process.exit(2);
}, Number(process.env.TIMEOUT ?? 120000)).unref();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`console.${m.type()}: ${m.text()}`));

const t = {
  page,
  url,
  out,
  log: (...a) => console.log(...a),
  settle: (ms = 450) => page.waitForTimeout(ms),
  code: () => page.evaluate(() => document.querySelector('.cm-content').innerText),
  async setCode(src) {
    await page.evaluate((s) => {
      const v = window.__permEditor;
      if (v) v.setText(s);
    }, src);
    if (!(await page.evaluate(() => !!window.__permEditor))) {
      await page.click('.cm-content');
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(src);
    }
    await page.waitForTimeout(450);
  },
  async shot(name, opts = {}) {
    const p = path.join(out, name.endsWith('.png') ? name : name + '.png');
    await page.screenshot({ path: p, ...opts });
    console.log('shot:', p);
    return p;
  },
  async state() {
    return page.evaluate(() => ({
      selected: [...document.querySelectorAll('.box.sel')].map((e) => `${e.getAttribute('class')}:${e.textContent}`),
      active: document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.getAttribute('class') ?? ''} ${document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent?.slice(0, 30) ?? ''}` : null,
      notice: document.getElementById('notice')?.hidden ? null : document.getElementById('notice-text')?.textContent,
      error: document.getElementById('error')?.hidden ? null : document.getElementById('error')?.textContent,
      popover: document.querySelector('.popover h3')?.textContent ?? null,
      overlay: [...document.querySelectorAll(".selbar-actions:not([hidden]) button")].map((e) => e.getAttribute('aria-label') ?? e.textContent),
    }));
  },
};

await page.goto(url);
if (!process.env.KEEP) await page.evaluate(() => localStorage.clear());
await page.goto(url);
await page.waitForTimeout(500);

const mod = await import(pathToFileURL(path.resolve(scenarioPath)).href);
try {
  await mod.default(t);
} catch (e) {
  console.log('SCENARIO FAILED:', e.message.split('\n').slice(0, 6).join('\n'));
  await t.shot('failure');
}
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await page.close();
process.exit(0);
