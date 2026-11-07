import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { inspectLane } from './helpers/workstationDock.js';

test.use({ permissions: [], viewport: { width: 1920, height: 1080 } });
test.setTimeout(240000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
const compose = page => page.getByRole('region', { name: 'Physical musical composition', exact: true });
test('desktop Compose searches an authored finite crew, keeps selection private and queues one reversible command transaction', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, info) => {
  await page.addInitScript(() => { window.composeMidiRequests = 0; window.navigator.requestMIDIAccess = async () => { window.composeMidiRequests++; throw new Error('Composition must not request MIDI.'); }; });
  await page.goto('/dist/browser/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await inspectLane(page, 'Compose');
  await compose(page).getByRole('button', { name: 'Prepare two-wall starter for review', exact: true }).click();
  const scenes = page.getByRole('dialog', { name: 'Playable physical scores', exact: true }), load = scenes.getByRole('button', { name: 'Load fresh · stopped replacement', exact: true });
  await expect(scenes.getByRole('region', { name: 'Selected physical score' })).toContainText('Two Walls'); await expect(load).toBeEnabled({ timeout: 90000 }); await load.click();
  const review = page.getByRole('region', { name: 'Review project replacement', exact: true });
  await expect.poll(async () => await review.isVisible() || await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.sceneOrigin?.manifest.id === 'physical-composition.two-walls')).toBe(true);
  if (await review.isVisible()) await review.getByRole('button', { name: /^(?:Discard changes and replace|Replace project)$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.sceneOrigin?.manifest.id), { timeout: 90000 }).toBe('physical-composition.two-walls');
  await scenes.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, runtime = window.__PROCGEN_LANES__; studio.transport.play();
    for (let tick = 0; tick < 32; tick++) runtime.world.step(0);
    studio.transport.pause(); runtime.pause(); window.composeSource = { actors: [...runtime.world.actors], world: runtime.world, project: studio.getProject(), tick: runtime.world.tickIndex, history: studio.handlers.historyState() };
  });
  await inspectLane(page, 'Compose'); await compose(page).getByRole('button', { name: 'Use120/160 goal · three wall samples', exact: true }).click();
  const draft = compose(page).getByRole('textbox', { name: 'Complete physical music goal JSON', exact: true }); const originalDraft = await draft.inputValue();
  await compose(page).getByRole('button', { name: 'Search physical candidates', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.physicalMusicStudyState()?.study?.status), { timeout: 120000 }).toBe('qualified');
  const evidence = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, state = studio.handlers.physicalMusicStudyState(), chosen = state.study.rows.find(row => row.id === state.study.selected.candidateId);
    return { selected: state.selectedId, candidateIds: state.study.rows.map(row => row.id), periods: chosen.metrics.periods.map(period => period.meanTicks), work: state.study.work, verified: chosen.verification,
      unchanged: window.composeSource.world === window.__PROCGEN_LANES__.world && window.composeSource.project === studio.getProject() && window.composeSource.tick === window.__PROCGEN_LANES__.world.tickIndex,
      history: studio.handlers.historyState(), originalHistory: window.composeSource.history, midiRequests: window.composeMidiRequests };
  });
  expect(evidence.periods).toEqual([120, 160]); expect(evidence.verified.matched).toBe(true); expect(evidence.unchanged).toBe(true); expect(evidence.history).toEqual(evidence.originalHistory); expect(evidence.midiRequests).toBe(0);
  const picker = compose(page).getByRole('combobox', { name: 'Candidate ghost · selection does not edit the world', exact: true }), apply = compose(page).getByRole('button', { name: 'Apply verified candidate · one undo step', exact: true });
  await picker.focus(); await picker.selectOption(evidence.candidateIds.find(id => id !== evidence.selected)); await expect(apply).toBeDisabled(); await expect(picker).toBeFocused();
  expect(await page.evaluate(() => window.composeSource.world === window.__PROCGEN_LANES__.world)).toBe(true);
  await picker.selectOption(evidence.selected); await expect(apply).toBeEnabled();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await draft.focus(); await expect(draft).toBeFocused(); expect(await draft.inputValue()).toBe(originalDraft);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await apply.click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.physicalMusicStudyState()?.applied), { timeout: 90000 }).toBe(true);
  const applied = await page.evaluate(() => ({ history: window.__PROCGEN_STUDIO__.handlers.historyState(), paused: !window.__PROCGEN_STUDIO__.transport.getState().playing, preserved: window.composeSource.world === window.__PROCGEN_LANES__.world && window.composeSource.actors.every((actor, index) => actor === window.__PROCGEN_LANES__.world.actors[index]), queued: window.__PROCGEN_LANES__.world.interventionState.pending.length, tick: window.__PROCGEN_LANES__.world.tickIndex }));
  expect(applied.preserved && applied.paused).toBe(true); expect(applied.queued).toBeGreaterThan(0); expect(applied.tick).toBe(await page.evaluate(() => window.composeSource.tick)); expect(applied.history.undo).toBe(evidence.history.undo + 1);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.undo());
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex), { timeout: 90000 }).toBe(await page.evaluate(() => window.composeSource.tick));
  await expect(apply).toBeDisabled(); expect(await draft.inputValue()).toBe(originalDraft);
  await info.attach('actual-physical-composition', { body: JSON.stringify({ evidence, applied }), contentType: 'application/json' });
});
