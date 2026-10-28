import { inspectLane } from './helpers/workstationDock.js';
import { expect, test } from '@playwright/test';

test.setTimeout(120000);
test('stored-take comparison and explicit branch stepping use real detached worlds without enabling output', async ({ page }) => {
  await page.addInitScript(() => {
    window.takeAudioOpens = 0; window.takeMidiRequests = 0; const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext { constructor(options) { window.takeAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.takeMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.renderer?.getDisplayState().state === 'ready');
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await inspectLane(page, 'Physical');
  await page.getByLabel('Take name', { exact: true }).fill('Isolated branch fixture'); await page.getByLabel('Take name', { exact: true }).blur();
  await page.getByRole('button', { name: 'Record causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().recording)).toBe(true);
  await page.evaluate(() => window.__PROCGEN_LANES__.step(24));
  await page.getByRole('button', { name: 'Stop causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.__PROCGEN_STUDIO__.handlers.causalTakeState().last?.takeId)).toBe(true);
  const before = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex,
    takeId: window.__PROCGEN_STUDIO__.handlers.causalTakeState().last.takeId }));
  await page.getByRole('button', { name: 'Compare in isolated world', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().workbench?.phase), { timeout: 60000 }).toBe('compared');
  const compared = await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().workbench.receipt);
  expect(compared).toMatchObject({ compatibilityMatch: true, exactQualified: false, finalWorldParity: 'matched-at-captured-component-checkpoint' });
  await page.getByRole('button', { name: 'Prepare physical branch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Step branch 32 ticks', exact: true })).toBeEnabled({ timeout: 60000 });
  await page.getByRole('button', { name: 'Step branch 32 ticks', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().workbench?.active?.completedBatches)).toBe(32);
  const stepped = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex,
    disposed: window.__PROCGEN_LANES__.world._disposed === true, branch: window.__PROCGEN_STUDIO__.handlers.causalTakeState().workbench.active }));
  expect(stepped.project).toBe(before.project); expect(stepped.tick).toBe(before.tick); expect(stepped.disposed).toBe(false);
  expect(stepped.branch.tick).toBe(before.tick + 32); expect(stepped.branch.interpretationPlaying).toBe(false);
  await page.getByRole('button', { name: 'Save and close branch', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().workbench?.phase)).toBe('saved');
  const after = await page.evaluate(() => ({ saved: window.__PROCGEN_STUDIO__.handlers.causalTakeState().last,
    project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex, audio: window.takeAudioOpens, midi: window.takeMidiRequests }));
  expect(after.saved.takeId).not.toBe(before.takeId); expect(after.project).toBe(before.project); expect(after.tick).toBe(before.tick);
  expect(after.audio).toBe(0); expect(after.midi).toBe(0);
});
