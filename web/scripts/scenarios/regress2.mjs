// More end-to-end checks: long form, rename, extract, tags and guards, Help, All, namespaces.
// Run with `npm run e2e:more` against a running app.
export default async (t) => {
  const { page } = t;
  const fail = (m) => {
    throw new Error(m);
  };
  const check = (cond, m) => {
    if (!cond) fail(m);
    t.log('ok', m);
  };
  const txt = (s) => page.locator('.k-text', { hasText: s }).first();
  const act = (a) => page.locator(`.selbar-actions button[data-action="${a}"]`);
  const code = () => t.code();

  // Long form edited from the chart keeps its shape.
  await t.setCode('branch main\n  Dear\n  one of\n    friend\n    colleague\n  ref closing\n\nbranch closing\n  one of\n    Thanks\n    Cheers\n');
  await txt('colleague').click();
  await act('add').click();
  await t.settle(250);
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('neighbour');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await code()).includes('    colleague\n    neighbour\n  ref closing'), 'long form: a new alternative goes on its own line at the right indent');
  await txt('friend').click();
  await act('tag').click();
  await page.keyboard.type('close');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await code()).includes('friend @close'), 'long form: a tag lands on the alternative');
  check((await page.$$('.k-tag')).length === 1, 'the tag shows as a chip');
  await page.locator('.k-tag').first().click();
  await t.settle(150);
  check((await t.state()).popover === 'Edit tag', 'clicking a tag chip opens Edit tag');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('near');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await code()).includes('friend @near'), 'Edit tag changes the tag');

  // Rename follows every reference.
  await page.locator('.k-defLabel', { hasText: 'closing' }).click();
  await act('rename').click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('signoff');
  await page.keyboard.press('Enter');
  await t.settle();
  const c1 = await code();
  check(c1.includes('ref signoff') && c1.includes('branch signoff'), 'Rename changes the branch and its references');

  // Extract alternatives into a new branch.
  await t.setCode('main = Pick [red|green|blue|black] now\n');
  await txt('red').click();
  await txt('green').click({ modifiers: ['Shift'] });
  await act('extract').click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('bright');
  await page.keyboard.press('Enter');
  await t.settle();
  const c2 = await code();
  check(/bright = \[?red ?\| ?green\]?/.test(c2) && c2.includes('$bright'), 'Extract moves the selected alternatives into a new branch');
  check((await page.$eval('#selbar', (e) => e.innerText)).includes('Branch bright'), 'and selects the new branch');

  // A guard with the tag suggestions.
  await t.setCode('main = Excuse me, [what @q|that] is it [?|.]\n');
  await txt('?').click();
  await act('guard').click();
  await t.settle(150);
  const sugg = await page.$$eval('#pop-suggest option', (o) => o.map((x) => x.value));
  check(sugg.includes('q') && sugg.includes('else'), 'the guard dialog suggests the tags that exist');
  await page.keyboard.type('q');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await code()).includes('[@q: ?|.]'), 'Add guard writes the guard');

  // Help inserts into main when the code was never clicked, and keeps the program valid.
  await page.reload();
  await t.settle(500);
  await t.setCode('main = Say [hi|yo]\n');
  await page.click('#b-help');
  await page.locator('#help-list li', { hasText: 'Tag' }).first().locator('button').click();
  await t.settle();
  check(!(await t.state()).error, 'a Help snippet never breaks the program');
  await page.click('#help-close');

  // All lists small programs at once, and copies them.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: t.url });
  await t.setCode('main = [a|b|c] [x|y]\n');
  await page.click('#tab-all');
  await t.settle(150);
  check((await page.$$('#all-list .ex-row')).length === 6, 'All lists a small program without a click');
  await page.click('#b-copy-all');
  await t.settle(150);
  check((await page.evaluate(() => navigator.clipboard.readText())).split('\n').length === 6, 'Copy puts every listed result on the clipboard');
  await page.locator('#all-list .ex-row').nth(2).click();
  check((await page.$$('.chart-svg.tracing')).length === 1, 'an All row can be traced too');
  await page.click('#tab-random');

  // Namespaces: collapse, then go to a member through its reference.
  await t.setCode('main = [$letters.A|$letters.B]\nletters.A = alpha\nletters.B = beta\n');
  await page.locator('.k-nsHeader').first().click();
  await t.settle(150);
  check((await page.$$('.k-def')).length === 1, 'a namespace collapses');
  await page.locator('.k-ref', { hasText: 'letters.A' }).first().dblclick();
  await t.settle(200);
  check((await page.$eval('#selbar', (e) => e.innerText)).includes('Branch letters.A'), 'going to a member opens its collapsed namespace');

  // Every example program in Help loads and runs.
  await page.click('#b-help');
  const n = await page.$$eval('#help-examples li', (l) => l.length);
  let ok = n > 0;
  for (let i = 0; i < n; i++) {
    await page.locator('#help-examples li').nth(i).locator('button').click();
    await t.settle(350);
    if ((await t.state()).error) ok = false;
  }
  check(ok, `all ${n} example programs in Help load without an error`);
  await page.click('#help-close');

  // Choices from the keyboard, and the strip never acts twice on a double-click.
  await t.setCode('main = Colors: [red|green|blue] and more\n');
  await txt('green').click();
  await page.keyboard.press('Shift+ArrowUp');
  check((await page.$eval('#selbar', (e) => e.innerText)).startsWith('Choice'), 'Shift+Up selects the choice around the selection');
  const opt = await act('optional').boundingBox();
  await page.mouse.dblclick(opt.x + opt.width / 2, opt.y + opt.height / 2);
  await t.settle();
  check((await t.code()).startsWith('main = Colors: [red|green|blue|] and more'), 'a double-click on a strip button acts once');
  await page.keyboard.press('Meta+z');
  await t.settle();
  // A fresh alternative left untouched goes away; typed, it is one undo step.
  await t.setCode('main = [Hello|Hi] there\n');
  await txt('Hi').click();
  await act('add').click();
  await t.settle(250);
  const c = await page.locator('#chart').boundingBox();
  await page.mouse.click(c.x + c.width - 30, c.y + 30);
  await t.settle();
  check((await t.code()).startsWith('main = [Hello|Hi] there'), 'clicking away from an untouched new alternative removes it');
  await txt('Hi').click();
  await act('add').click();
  await t.settle(250);
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Hey');
  await page.keyboard.press('Enter');
  await t.settle();
  await page.keyboard.press('Meta+z');
  await t.settle();
  check((await t.code()).startsWith('main = [Hello|Hi] there'), 'one undo takes back an added and named alternative');
};
