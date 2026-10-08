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
  await page.keyboard.type(' [oops');
  await t.settle();
  await txt('Hello').click();
  check((await strip()).includes('Fix the error'), 'with an error in the code the strip explains why nothing can be edited');
};
