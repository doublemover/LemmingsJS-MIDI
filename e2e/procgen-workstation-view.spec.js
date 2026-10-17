import { expect, test } from '@playwright/test';

const ready = async (page, count = 8) => {
  await page.goto('/README.md');
  await page.setContent('<style>.studio-stage{position:relative;width:800px;height:608px}.studio-cell{min-width:24px}.studio-sequences{position:absolute;inset:0}.studio-sequence{position:absolute;display:grid;width:100%}</style><header id="procgenTopbar"></header><canvas id="gameCanvas"></canvas>');
  await page.evaluate(async count => {
    const { createProcgenWorkstationView } = await import('/js/app/procgen/workstation/ProcgenWorkstationView.js');
    const { createProcgenWorkstationProject, createProcgenLane } = await import('/js/app/procgen/workstation/ProcgenWorkstationProject.js');
    const { createMidiProject, reduceMidiProject } = await import('/js/midi/project/MidiProject.js');
    let project = createProcgenWorkstationProject(createMidiProject(), { lanes: Array.from({ length: count }, (_, index) => createProcgenLane(index)) });
    const state = { laneId: 'lane-1', slot: 0, step: 0 }, calls = [], actions = [];
    const handlers = Object.fromEntries(['copy', 'paste', 'undo', 'redo', 'observe', 'record'].map(name => [name, value => calls.push({ name, value })]));
    const view = createProcgenWorkstationView({ document, window, getProject: () => project, getRuntime: () => ({}), state, handlers,
      dispatch: action => { actions.push(action); project = reduceMidiProject(project, action); view.render(); } });
    view.render();
    window.workstationViewTest = { view, state, calls, actions, getProject: () => project };
  }, count);
};

test('selecting another lane edits its displayed phrase and supports fixed note zero', async ({ page }) => {
  await ready(page);
  await page.locator('.studio-lane-header').nth(0).getByTitle('Launch phrase 3 on next bar').click();
  await page.locator('.studio-sequence').nth(1).locator('.studio-cell').nth(5).click();
  expect(await page.evaluate(() => ({ lane: window.workstationViewTest.state.laneId, slot: window.workstationViewTest.state.slot, step: window.workstationViewTest.state.step }))).toEqual({ lane: 'lane-2', slot: 0, step: 5 });
  await page.getByLabel('Fixed MIDI note').fill('0'); await page.getByLabel('Fixed MIDI note').dispatchEvent('change');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[1].patterns[0].steps[5].note)).toBe(0);
  await page.getByLabel('Fixed MIDI note').fill(''); await page.getByLabel('Fixed MIDI note').dispatchEvent('change');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[1].patterns[0].steps[5].note)).toBeNull();
});

test('palette changes preserve global key and expose direct CC editing and event masks', async ({ page }) => {
  await ready(page);
  await page.getByLabel('Global key').selectOption('9');
  await page.getByLabel('Sound collection').selectOption('dirt');
  await expect(page.getByLabel('Global key')).toHaveValue('9');
  await page.getByLabel('build', { exact: true }).uncheck();
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].eventMask.build)).toBe(false);
  await page.getByRole('button', { name: 'Automation', exact: true }).click();
  await page.getByRole('button', { name: 'Add CC curve' }).click();
  await page.getByLabel('Points', { exact: true }).fill('0:10, 2:120, 4:10'); await page.getByLabel('Points', { exact: true }).dispatchEvent('change');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].ccAutomation[0].points[1])).toEqual({ beat: 2, value: 120 });
  await page.getByRole('button', { name: 'Remove curve' }).click();
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].ccAutomation)).toEqual([]);
});

test('keyboard editing excludes text inputs and transport pulses keep existing rows', async ({ page }) => {
  await ready(page);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z');
  expect(await page.evaluate(() => window.workstationViewTest.calls.map(call => call.name))).toEqual(['copy', 'paste', 'undo', 'redo']);
  await page.getByLabel('Name', { exact: true }).focus(); await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.workstationViewTest.calls.length)).toBe(4);
  expect(await page.evaluate(() => {
    const first = document.querySelector('.studio-sequence');
    for (let index = 0; index < 24; index++) window.workstationViewTest.view.transport({ beat: index / 24, bpm: 120, clockSource: 'internal', linked: true, speedMode: 'bpm' });
    return first === document.querySelector('.studio-sequence');
  })).toBe(true);
});

test('virtualizes 1024 lanes and exposes observer controls without losing the canvas on disposal', async ({ page }) => {
  await ready(page, 1024);
  await expect(page.locator('.studio-lane-header')).toHaveCount(8);
  await expect(page.getByLabel('Visible lane range')).toHaveText('1–8 of 1024');
  await page.getByTitle('Show next lanes').click();
  await expect(page.getByLabel('Visible lane range')).toHaveText('9–16 of 1024');
  await page.locator('.studio-lane-headers').focus(); await page.keyboard.press('PageUp');
  await expect(page.getByLabel('Visible lane range')).toHaveText('1–8 of 1024');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await page.getByLabel('Observer mode').selectOption('director');
  expect(await page.evaluate(() => window.workstationViewTest.calls.at(-1))).toEqual({ name: 'observe', value: { mode: 'director' } });
  await page.locator('.studio-lane-headers').dispatchEvent('wheel', { deltaY: 50 });
  await expect(page.locator('.studio-lane-title').first()).toContainText('2');
  await page.evaluate(() => window.workstationViewTest.view.dispose());
  await expect(page.locator('#gameCanvas')).toHaveCount(1);
  await expect(page.locator('#procgenStudio')).toHaveCount(0);
});

test('draw and erase gestures commit one reducer action for an entire stroke', async ({ page }) => {
  await ready(page);
  const stroke = async tool => {
    await page.getByLabel('Step editing tool').selectOption(tool);
    await page.locator('.studio-sequence').first().locator('.studio-cell').first().scrollIntoViewIfNeeded();
    const first = await page.locator('.studio-sequence').first().locator('.studio-cell').nth(0).boundingBox();
    const last = await page.locator('.studio-sequence').first().locator('.studio-cell').nth(3).boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 10 }); await page.mouse.up();
  };
  await stroke('draw');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].patterns[0].steps.slice(0, 4).every(step => step.enabled))).toBe(true);
  expect(await page.evaluate(() => window.workstationViewTest.actions.map(action => action.type))).toEqual(['procgen/pattern']);
  await stroke('erase');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].patterns[0].steps.slice(0, 4).every(step => !step.enabled))).toBe(true);
  expect(await page.evaluate(() => window.workstationViewTest.actions.length)).toBe(2);
});
