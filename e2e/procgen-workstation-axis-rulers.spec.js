import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';
import { inspectLane } from './helpers/workstationDock.js';

const ready = async page => {
  await installWebMidiStub(page, { trackOutput: true });
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.renderer.render(true); });
  await expect(page.locator('.studio-causal-summary')).toHaveAttribute('data-axis-domain', 'world-distance');
};
const sourceState = page => page.evaluate(async () => {
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
  const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)), sent: window.__WEBMIDI_STUB__.metrics().sent };
});

test('accepted world ruler follows native pan and zoom while paused musical position and physical history stay fixed', { tag: '@boundary' }, async ({ page }, info) => {
  await ready(page); const before = await sourceState(page), ruler = page.locator('.studio-causal-summary'), clock = page.getByLabel('Musical bar and denominator-note beat', { exact: true });
  await expect(clock).toHaveAttribute('title', /Transport paused/); const musical = await clock.textContent(), original = await ruler.textContent();
  const canvas = page.locator('#gameCanvas'), bounds = await canvas.boundingBox(); await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.7); await page.mouse.wheel(320, 0);
  await expect.poll(() => ruler.textContent()).not.toBe(original); const panned = await ruler.textContent(); await useWorkstationControl(page, page.locator('#procgenZoomIn'), {}, 'click');
  await expect.poll(() => ruler.textContent()).not.toBe(panned); await expect(clock).toHaveText(musical); await expect(ruler).toContainText('World distance'); await expect(ruler).toContainText('px'); await expect(page.locator('.studio-world-axis [data-axis-value]')).toHaveCount(5);
  expect(await sourceState(page)).toEqual(before); const accepted = await page.evaluate(() => { const value = window.__PROCGEN_LANES__.renderer.presentation.getSnapshot(); return { origin: value.originX, extent: value.viewWidth, generation: value.generation }; });
  await expect(ruler).toHaveAttribute('title', new RegExp('Generation ' + accepted.generation));
  await info.attach('world-axis-snapshot', { body: JSON.stringify({ accepted, text: await ruler.textContent(), title: await ruler.getAttribute('title') }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('axis-rulers-desktop.png'), fullPage: true });
});

test('meter-aware musical ruler retains denominator-note boundaries under 7/8, 5/4, 3/8 and 4/4 changes', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); const clock = page.getByLabel('Musical bar and denominator-note beat', { exact: true });
  for (const [beats, unit] of [[7, 8], [5, 4], [3, 8], [4, 4]]) {
    const length = beats * 4 / unit;
    await page.evaluate(({ beats, unit, beat }) => { const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'transport.set', transport: { timeSignature: { beats, unit } } }); studio.transport.seek(beat); }, { beats, unit, beat: length - 0.0001 });
    await expect(clock).toHaveText('1 : ' + beats); await expect(clock).toHaveAttribute('title', new RegExp(beats + '/' + unit));
    await page.evaluate(beat => window.__PROCGEN_STUDIO__.transport.seek(beat), length); await expect(clock).toHaveText('2 : 1');
    await expect(clock).toHaveAttribute('title', /Internal musical transport/); await expect(clock).toHaveAttribute('title', /Transport paused/); await expect(clock).toHaveAttribute('data-axis-domain', 'musical-beat');
  }
  await useWorkstationControl(page, page.getByLabel('Clock source', { exact: true }), {}, 'selectOption', 'external');
  await expect(clock).toHaveAttribute('title', /Authority unavailable/); await expect(clock).toHaveAttribute('title', /Selected MIDI clock phase/);
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false'); expect(await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().sent)).toBe(0);
});

test('recorded source and ordinal rulers remain historical after live tempo and camera changes', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); await inspectLane(page, 'Physical'); await page.getByRole('button', { name: 'Record causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().recording)).toBe(true);
  await page.evaluate(() => window.__PROCGEN_LANES__.step(24)); await page.getByRole('button', { name: 'Stop causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.__PROCGEN_STUDIO__.handlers.causalTakeState().last?.takeId)).toBe(true);
  await page.getByRole('button', { name: 'Read causal score', exact: true }).click();
  const ruler = page.locator('.studio-physical-score .studio-axis-ruler'); await expect(ruler).toHaveAttribute('data-axis-domain', 'simulation-time'); await expect(ruler).toHaveAttribute('title', /Captured history/);
  await page.locator('.studio-physical-score button').first().click(); const correspondence = page.getByLabel('Recorded coordinate correspondence', { exact: true }); await expect(correspondence).toContainText('Co-observed at this recorded cause'); const coordinates = await correspondence.textContent();
  const captured = await ruler.textContent(), state = await sourceState(page);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.handlers.transport({ bpm: 193, linked: false, gameSpeed: 5 }); }); await useWorkstationControl(page, page.locator('#procgenZoomIn'), {}, 'click');
  await expect(ruler).toHaveText(captured); await expect(ruler).toHaveAttribute('title', /Historical marks/); await expect(correspondence).toHaveText(coordinates);
  const after = await sourceState(page); expect(after.hash).toBe(state.hash); expect(after.sent).toBe(state.sent);
  await page.getByLabel('Physical score time axis').selectOption('causal-order'); await expect(ruler).toHaveAttribute('data-axis-domain', 'event-ordinal'); await expect(ruler).toContainText('events');
  const unchanged = await sourceState(page); expect(unchanged.project).toBe(after.project); expect(unchanged.hash).toBe(after.hash); expect(unchanged.sent).toBe(after.sent);
});
