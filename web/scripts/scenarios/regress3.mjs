// Regression checks for the fourth round of work: Insert after, the More menu, last, warnings,
// fix buttons, steady examples, multi-select, chips, Vary words, Inline, New branch, arrows,
// typed references, Fit, where messages go, and placeholders and redo.
export default async (t) => {
  const { page } = t;
  const fail = (m) => {
    throw new Error(m);
  };
  const check = (cond, m) => {
    if (!cond) fail(m);
    console.log('ok', m);
  };
  const txt = (s) => page.locator('.k-text', { hasText: s }).first();
  const act = (a) => page.locator(`.selbar-actions button[data-action="${a}"]:not([hidden])`);
  const lines = async () => (await t.code()).split('\n');
  const rows = () => page.$$eval('#samples .ex-row .t', (els) => els.map((e) => e.textContent));
  const clickFrame = async (sel, i = 0) => {
    const bb = await page.locator(sel).nth(i).boundingBox();
    await page.mouse.click(bb.x + bb.width - 5, bb.y + 5);
    await t.settle(150);
  };

  // Insert after a whole choice: a bare branch name is a reference.
  await t.setCode('main = $opening, [We are on it.|A fix is on its way.]\nopening = Hi | Hello\nclosing = Cheers!\n');
  await clickFrame('.f-group', 0);
  await act('insert-ref').click();
  await page.keyboard.type('closing');
  check(/reference to the branch closing/.test(await page.$eval('.pop-preview', (e) => e.textContent)), 'Insert after previews a reference for a branch name');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await lines())[0] === 'main = $opening, [We are on it.|A fix is on its way.] $closing', 'Insert after a choice goes after the whole choice');
  // At the end of a bracket-free branch: bracketed first.
  await page.locator('.k-defLabel', { hasText: 'opening' }).click();
  await act('insert-ref').click();
  await page.keyboard.type('there');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await lines())[1] === 'opening = [Hi | Hello] there', 'Add at the end of a bare choice brackets it first');
  // Text with $branch in it.
  await txt('Cheers!').click();
  await act('insert-ref').click();
  await page.keyboard.type('and see $opening');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await lines())[2] === 'closing = Cheers! and see $opening', 'typed text keeps $branch as a reference');

  // The More menu at a narrow width keeps Delete in the row.
  await page.setViewportSize({ width: 1024, height: 760 });
  await t.setCode('main = Dear [Sam|Alex|Jordan|Robin], thanks for [writing|getting in touch].\n');
  await txt('Alex').click();
  await t.settle(200);
  check(await act('delete').count() === 1, 'Delete stays in the row at 1024 wide');
  check(await act('more').count() === 1, 'More… appears when the actions do not fit');
  await act('more').click();
  await t.settle(100);
  const menuItems = await page.$$eval('.selbar-more-menu button', (els) => els.map((e) => e.dataset.action));
  check(menuItems.includes('extract'), 'the More menu holds the actions that did not fit');
  await page.keyboard.press('Escape');
  check(await page.$eval('.selbar-more-menu', (e) => e.hidden), 'Escape closes the More menu');
  await page.setViewportSize({ width: 1400, height: 860 });

  // Delimiter dialog with last.
  await t.setCode('main = Pack [a tent & a stove & a map].\n');
  await page.locator('.k-anyorder').first().click();
  await act('delimiter').click();
  const fields = page.locator('.popover input');
  await fields.nth(0).fill(', ');
  await fields.nth(1).fill(' and ');
  check(/one, two and three/.test(await page.$eval('.pop-preview', (e) => e.textContent)), 'the Delimiter dialog previews the last join');
  await fields.nth(1).press('Enter');
  await t.settle();
  check((await lines())[0] === 'main = Pack [a tent & a stove & a map; delimiter=", " last=" and "].', 'Delimiter sets delimiter and last together');

  // Warnings and fix buttons.
  await t.setCode('main = It was very{2} good\n');
  check(/very\{2\}/.test(await page.$eval('#chart-hints', (e) => (e.hidden ? '' : e.innerText))), 'a warning shows under the chart');
  await page.locator('#chart-hints button').first().click();
  check(await page.evaluate(() => !!document.activeElement?.closest('.cm-editor')), 'the warning jumps to the code');
  await t.setCode('main = Hi $greting\ngreeting = hello | hey\n');
  await page.locator('#error button', { hasText: 'Use greeting' }).click();
  await t.settle();
  check((await lines())[0] === 'main = Hi $greeting' && (await page.$eval('#error', (e) => e.hidden)), 'Use greeting fixes a mistyped reference');

  // Steady examples: a new alternative changes only rows it wins.
  await t.setCode('main = Dear [Sam|Alex|Jordan], thanks for [writing|getting in touch]. [Cheers|Best|Thanks]!\n');
  await t.settle(300);
  const before = await rows();
  await txt('Jordan').click();
  await page.keyboard.press('+');
  await t.settle(150);
  await page.keyboard.type('Robin');
  await page.keyboard.press('Enter');
  await t.settle(400);
  const after = await rows();
  const moved = after.filter((r, i) => !r.includes('Robin') && r !== before[i]).length;
  check(moved === 0, 'adding an alternative leaves the other example rows alone');

  // Space multi-select and one-step delete.
  await t.setCode('main = Order [red|green|blue|black] now\n');
  await txt('red').click();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await page.keyboard.press('Delete');
  await t.settle();
  check((await lines())[0] === 'main = Order [blue|black] now', 'Space selects alternatives and Delete removes them all');
  check((await t.state()).active?.includes('blue'), 'focus lands on what is left');
  await page.keyboard.press('Meta+z');
  await t.settle();
  check((await lines())[0] === 'main = Order [red|green|blue|black] now', 'one undo brings both back');

  // Tag chips select first.
  await t.setCode('main = [what @q|that] is it [@q: ?|@else: .]\n');
  await page.locator('.k-tag').first().click();
  await t.settle(150);
  check(!(await t.state()).popover && (await t.state()).overlay.includes('Edit tag'), 'a tag chip click selects it');
  await page.keyboard.press('Enter');
  await t.settle(150);
  check((await t.state()).popover === 'Edit tag', 'Enter on the chip opens Edit tag');
  await page.keyboard.press('Escape');

  // Vary words keeps punctuation outside.
  await t.setCode('main = Hi Sam, thanks.\n');
  await txt('Hi Sam, thanks.').click();
  await act('vary').click();
  await t.settle(150);
  await page.locator('.popover .vary-words button', { hasText: 'Sam,' }).click();
  await page.locator('.popover button', { hasText: 'Make a choice' }).click();
  await t.settle(150);
  await page.keyboard.type('Alex');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await lines())[0] === 'main = Hi [Sam|Alex], thanks.', 'Vary words keeps the comma outside the choice');

  // Inline keeps the results.
  await t.setCode('main = Hello $g\ng = , friend\n');
  await page.locator('.k-ref').first().click();
  await act('inline').click();
  await t.settle();
  check((await lines())[0] === 'main = Hello [, friend]', 'Inline brackets text that would merge with its neighbours');

  // Arrows enter a two-alternative choice.
  await t.setCode('main = Start [Hi|Hello] there\n');
  await txt('Start').click();
  await page.keyboard.press('ArrowRight');
  check((await t.state()).active?.includes('Hi'), 'ArrowRight enters a choice with two alternatives');

  // Typing $branch into a text box makes a reference.
  await t.setCode('main = [Hi|Hello] there\nclosing = Bye\n');
  await txt('there').dblclick();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('there $closing');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await lines())[0] === 'main = [Hi|Hello] there $closing', 'typing $closing makes a reference');

  // Cancelling a new alternative leaves nothing to redo.
  await txt('Hello').click();
  await page.keyboard.press('+');
  await t.settle(150);
  await page.keyboard.press('Escape');
  await t.settle(150);
  await page.keyboard.press('Meta+Shift+z');
  await t.settle(150);
  check((await lines())[0] === 'main = [Hi|Hello] there $closing', 'Redo does not bring back a cancelled alternative');

  // Messages about chart actions show under the chart.
  await t.setCode('main = Hello\n');
  await txt('Hello').click();
  await page.keyboard.press('Delete');
  await t.settle(150);
  check(await page.evaluate(() => !!document.querySelector('.chart-pane #notice:not([hidden])')), 'a chart message shows under the chart');

  // New branch opens its text.
  await page.click('#t-new');
  await t.settle(150);
  await page.keyboard.press('Enter');
  await t.settle(300);
  check(await page.evaluate(() => !!document.querySelector('input.inline-edit')), 'New branch opens its text for editing');
  await page.keyboard.press('Escape');

  // Help inserts at your own cursor, not the chart selection.
  await t.setCode('main = [Hello|Oh, Hi] there\n');
  await page.click('.cm-content');
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('End');
  await txt('Oh, Hi').click();
  await page.click('#b-help');
  await t.settle(150);
  await page.locator('#help button[aria-label="Insert Range snippet into the code"]').click();
  await t.settle(200);
  check((await lines())[0] === 'main = [Hello|Oh, Hi] there [1..6]', 'Help inserts at your cursor in the code');
  await page.click('#help-close');
};
