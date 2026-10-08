// End-to-end checks of the chart's main flows. Run with `npm run e2e` against a running app.
// Each check throws on failure, so a passing run prints only "ok" lines.
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
  const line1 = async () => (await t.code()).split('\n')[0];
  const strip = () => page.$eval('#selbar', (e) => e.innerText);

  check((await strip()).includes('Click any box'), 'the strip shows the hint when nothing is selected');
  await txt('Oh, Hi').click();
  check((await strip()).includes('alternative 2 of 2'), 'clicking a box names it in the strip');
  check(await act('add').isVisible(), 'alternative actions are visible without hovering');

  await act('add').click();
  await t.settle(250);
  check(!!(await page.$('.inline-edit')), 'Add alternative opens an inline editor');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Hey');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await line1()) === 'main = [Hello|Oh, Hi|Hey] $greeting', 'the new alternative goes after the selected one');
  check((await strip()).includes('“Hey”'), 'the selection moves to the new alternative');

  await act('up').click();
  await t.settle();
  await act('up').click();
  await t.settle();
  check((await line1()) === 'main = [Hey|Hello|Oh, Hi] $greeting', 'Move up twice keeps working on the same alternative');
  check(await act('up').isDisabled(), 'Move up is disabled at the top');

  await act('delete').click();
  await t.settle();
  check((await line1()) === 'main = [Hello|Oh, Hi] $greeting', 'Delete removes the alternative');

  await page.locator('.k-ref').first().click();
  check(await act('goto').isVisible(), 'a reference offers Go to');
  check((await page.$$('.edge.ref.active')).length === 1, 'a selected reference highlights its edge');
  await act('goto').click();
  await t.settle(200);
  check((await strip()).includes('Branch greeting'), 'Go to selects the branch');
  check(await act('rename').isVisible(), 'a branch offers Rename');

  const chart = await page.locator('#chart').boundingBox();
  await page.mouse.click(chart.x + chart.width - 20, chart.y + 20);
  await t.settle(150);
  check((await strip()).includes('Click any box'), 'clicking empty space clears the selection');

  await txt('everything').click();
  await page.waitForTimeout(450);
  await txt('everything').click();
  await t.settle(200);
  check(!!(await page.$('.inline-edit')), 'a second click on selected text edits it');
  await page.keyboard.press('Escape');
  await t.settle(150);

  await page.keyboard.press('ArrowDown');
  await t.settle(150);
  check((await strip()).includes('“is new”') || (await strip()).includes('“What”'), 'arrow keys move the selection');
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => !!document.activeElement?.closest('.selbar-actions')), 'Tab moves from the chart into the strip');
  await page.keyboard.press('Escape');
  await t.settle(150);
  check((await strip()).includes('Click any box'), 'Escape in the strip clears the selection');
  check(await page.evaluate(() => !!document.activeElement?.closest('.chart-svg')), 'and returns focus to the chart');

  await txt('is new').click();
  await txt('is going on').click({ modifiers: ['Shift'] });
  await t.settle(150);
  check(await act('extract').isVisible(), 'Shift-click selects several alternatives for Extract');
  await act('clear').click();
  await t.settle(100);

  await page.locator('.k-defLabel', { hasText: 'greeting' }).dblclick();
  await t.settle(150);
  check((await t.state()).popover === 'Rename greeting', 'double-clicking a branch name opens Rename');
  await page.keyboard.press('Escape');

  await page.click('.cm-content');
  await page.keyboard.press('Meta+End');
  await page.keyboard.type(' ]');
  await t.settle();
  await txt('Hello').click();
  check((await strip()).includes('Fix the error'), 'with an error in the code the strip explains why nothing can be edited');

  // Building structure from plain text, references, undo from the chart, error fixes.
  await t.setCode('main = Hello there\npets = [cat|dog]\n');
  await txt('Hello there').click();
  await act('optional').click();
  await t.settle();
  check((await line1()) === 'main = [Hello there|]', 'Make optional wraps plain text with an empty alternative');
  await page.keyboard.press('Meta+z');
  await t.settle();
  check((await line1()) === 'main = Hello there', 'Cmd+Z in the chart undoes a chart edit');
  await txt('Hello there').click();
  await act('wrap').click();
  await t.settle(300);
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Hi there');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await line1()) === 'main = [Hello there|Hi there]', '+ Alternative on plain text makes a choice');
  await txt('Hi there').click();
  await act('insert-ref').click();
  await page.keyboard.type('pets');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await line1()) === 'main = [Hello there|Hi there $pets]', 'Insert reference adds $name after the piece');
  await page.locator('.k-text', { hasText: 'dog' }).first().click();
  await act('delete').click();
  await t.settle();
  await page.locator('.k-text', { hasText: 'cat' }).first().click();
  await t.settle(100);
  check(!(await page.$('.inline-edit')), 'the first click after an edit selects instead of editing');
  await t.setCode('main = Copyright $year\n');
  check((await page.$eval('#error', (e) => e.innerText)).includes('There is no branch named year'), 'unknown references get a web-friendly message');
  await page.locator('.error-fix').click();
  await t.settle();
  check(await page.$eval('#error', (e) => e.hidden), 'the Create branch fix resolves the error');

  // Tracing an example through the chart.
  await t.setCode("main = [Hello|Oh, Hi] $greeting\ngreeting = [How [are you|'s [it|everything]]|What [is new|is going on]]\n");
  await page.locator('#samples .ex-row').first().click();
  await t.settle(150);
  check((await page.$$('.chart-svg.tracing')).length === 1, 'clicking an example traces it through the chart');
  const lit = await page.$$eval('.box.on-path.k-text', (b) => b.map((x) => x.textContent));
  const shown = await page.$eval('#samples .ex-row', (e) => e.querySelector('.t').textContent);
  check(lit.every((w) => shown.includes(w.replace(/^'s$/, "'s"))) && lit.length >= 2, 'the lit text boxes are the words of that example');
  await page.locator('#samples .ex-row').first().click();
  check((await page.$$('.chart-svg.tracing')).length === 0, 'clicking it again stops');

  // Delimiter from the chart.
  await t.setCode('main = Pets: [cat & dog & fox]\n');
  await page.locator('.k-anyorder').first().click();
  await act('delimiter').click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type(', ');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await line1()) === 'main = Pets: [cat & dog & fox; delimiter=", "]', 'Delimiter sets what joins an any-order group');
  // Inline a branch.
  await t.setCode('main = Say $g\ng = [hi|yo]\n');
  await page.locator('.k-ref').first().click();
  await act('inline').click();
  await t.settle();
  check((await line1()) === 'main = Say [hi|yo]', 'Inline replaces a reference with the branch content');

  // An Undo toast never outlives its change.
  await t.setCode('main = [a|b|c]\n');
  await page.locator('.k-text', { hasText: 'b' }).first().click();
  await act('delete').click();
  await t.settle(200);
  check(await page.$eval('#toast', (e) => e.classList.contains('show')), 'deleting shows an Undo toast');
  await page.click('.cm-content');
  await page.keyboard.press('Meta+End');
  await page.keyboard.type(' x');
  await t.settle(100);
  check(!(await page.$eval('#toast', (e) => e.classList.contains('show'))), 'a later change hides the Undo toast');

  // A shared link never wins over later edits.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: t.url });
  await t.setCode('main = shared version\n');
  await page.click('#b-share');
  await t.settle(150);
  check(page.url().includes('#code='), 'Share puts the code in the link');
  await t.setCode('main = edited after sharing\n');
  check(!page.url().includes('#code='), 'editing afterwards drops the shared code from the address bar');
  await page.reload();
  await t.settle(500);
  check((await line1()) === 'main = edited after sharing', 'a reload keeps the latest edit');

  // Delete removes exactly the selected piece.
  await t.setCode('main = Hello [big|small] world $tail\ntail = and more\n');
  await txt('world').click();
  await page.keyboard.press('Delete');
  await t.settle();
  check((await line1()) === 'main = Hello [big|small] $tail', 'the Delete key removes just the selected word');
  await t.setCode("main = [How [are you|'s it]|What]\n");
  await txt('How').click();
  check(await act('delete').isVisible() && (await act('delete').textContent()) === 'Delete alternative', 'a piece among others offers Delete alternative separately');
  await act('delete-piece').click();
  await t.settle();
  check((await line1()) === "main = [[are you|'s it]|What]", 'Delete on one word keeps the rest of its alternative');
};
