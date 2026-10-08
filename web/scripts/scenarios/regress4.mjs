// Regression checks for the fifth round of work: line breaks, wrapped sentences, typing to
// edit, the start form, fix buttons, faded alternatives, warning underlines, a new alternative
// in the examples, inline tags, guarded ranges, plain-word picks, and chained transforms.
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
  const line = async (i = 0) => (await t.code()).split('\n')[i];

  // Line breaks are shown, and survive an edit.
  await t.setCode('main = Dear Sam,\\n\\nThanks.\n');
  const box = page.locator('.k-text').first();
  check((await box.locator('text').first().textContent()).includes('↵'), 'a line break shows as ↵ in the chart');
  await box.click();
  await page.keyboard.press('Enter');
  await t.settle(150);
  await page.keyboard.press('End');
  await page.keyboard.type(' Bye.');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await line()) === 'main = Dear Sam,\\n\\nThanks. Bye.', 'editing text keeps its line breaks');

  // Typing on a selected text box starts editing it; Escape puts it back.
  await t.setCode('main = [Hello|Hi] there\n');
  await txt('Hello').click();
  await page.keyboard.type('Howdy');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await line()) === 'main = [Howdy|Hi] there', 'typing on a text box replaces its text');
  await txt('Hi').click();
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await t.settle();
  check((await line()) === 'main = [Howdy|Hi] there', 'Escape puts the text back');

  // A long sentence wraps, and Right goes on to the next line.
  const names = Array.from({ length: 14 }, (_, i) => `part${i + 1}`);
  await t.setCode(`main = ${names.map((n) => '$' + n).join(' ')}\n${names.map((n) => `${n} = [x|y]`).join('\n')}\n`);
  const tops = await page.$$eval('.k-ref', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))].length);
  check(tops > 1, 'a long sentence wraps onto more lines');
  await page.locator('.k-ref').first().click();
  for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowRight');
  check((await t.state()).active?.includes('part14'), 'Right goes from the end of one line to the start of the next');

  // Fix buttons.
  await t.setCode('main = Hello [world|friend\n');
  await page.locator('#error button', { hasText: 'Add ]' }).click();
  await t.settle();
  check((await line()) === 'main = Hello [world|friend]', 'Add ] fixes an unclosed bracket');

  // Faded alternatives and underlined warnings.
  await t.setCode('main = [@q: hi|hey] [what @q|that] is it\n');
  check((await page.$$('.box.dead')).length === 1, 'an alternative that can never be picked is faded');
  check((await page.$$('.cm-warn')).length >= 1, 'the warning is underlined in the code');

  // Inline tags and guarded ranges.
  await t.setCode('main = Hi @casual there, [@casual: mate|@else: sir]. Age [@casual: 20..29|@else: 30..39].\n');
  check((await page.$$('.k-tag')).length === 1 && (await page.$$('.f-group')).length === 2, 'a mid-sentence tag is an inline chip, not a choice');
  await page.locator('.k-range').first().dblclick();
  await t.settle(150);
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('21..28');
  await page.keyboard.press('Enter');
  await t.settle();
  check((await line()).includes('[@casual: 21..28|@else: 30..39]'), 'editing a guarded range leaves the guard alone');

  // Plain-word picks in Add a guard.
  await t.setCode('main = [what @q|that] is [it|this]\n');
  await txt('this').click();
  await act('guard').click();
  await t.settle(150);
  const picks = await page.$$eval('.popover .pick', (els) => els.map((e) => e.textContent));
  check(picks.includes('Only when q') && picks.includes('Otherwise'), 'Add a guard offers plain-word picks');
  await page.keyboard.press('Escape');

  // A just-added alternative shows in the examples.
  await t.setCode('main = Dear [Sam|Alex|Jordan|Robin|Kim|Lee], thanks for [writing|getting in touch]. [Cheers|Best]!\n');
  await txt('Lee').click();
  await page.keyboard.press('+');
  await t.settle(150);
  await page.keyboard.type('Zed');
  await page.keyboard.press('Enter');
  await t.settle(400);
  const rows = await page.$$eval('#samples .ex-row .t', (els) => els.map((e) => e.textContent));
  check(rows.some((r) => r.includes('Zed')), 'a just-added alternative shows in the examples');

  // Chained transforms share a frame, in the order they apply.
  await t.setCode('main = [hELLO]:lower:capitalize\n');
  const chips = await page.$$eval('.k-transform', (els) => els.map((e) => e.textContent.replace(/\s+/g, '')));
  check(chips.length === 2 && chips[0].startsWith(':lower') && chips[1].startsWith(':capitalize'), 'chained transforms read in the order they apply');

  // The start form on an empty chart.
  await t.setCode('');
  await t.settle(300);
  await page.locator('.start-form input').fill('Thanks for writing.');
  await page.locator('.start-form button').click();
  await t.settle(300);
  check((await line()) === 'main = Thanks for writing.' && (await t.state()).popover === 'Vary words', 'Start makes main from a sentence and opens Vary words');
  await page.keyboard.press('Escape');
};
