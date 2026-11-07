import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { inspectLane } from './helpers/workstationDock.js';

test.use({ viewport: { width: 1920, height: 1080 }, permissions: [] });
test.setTimeout(120000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

for (const family of [
  { name: 'Liquid', prepare: 'Prepare liquid tables / drawbars', count: 7, revision: 'spectrum.acid-current@1', body: 'quarry-hollow-spring' },
  { name: 'Forge', prepare: 'Prepare FM Forge', count: 4, revision: 'forge.glass-rivet@6', body: 'quarry-crossed-gallery' }
]) test(family.name + ' browsing hands off to a saved real shared SPACE without changing physical causes', async ({ page }) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  const before = await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); const project = window.__PROCGEN_STUDIO__.getProject(); return { graph: project.procgen.physicalGraph, lanes: project.procgen.lanes, tick: window.__PROCGEN_LANES__.world.tickIndex }; });
  await inspectLane(page, 'Lane'); await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Sound library', exact: true }); await library.getByRole('button', { name: family.prepare, exact: true }).click();
  await expect(library.getByLabel('Saved instrument revision').locator('option')).toHaveCount(family.count, { timeout: 30000 });
  await library.getByLabel('Saved instrument revision').selectOption(family.revision);
  await library.getByRole('button', { name: 'Physical shared SPACE / ROOM…', exact: true }).click();
  const room = page.getByRole('dialog', { name: 'Quarry Echo · physical owner', exact: true }); await expect(room).toBeVisible(); await expect(library).not.toBeVisible();
  await expect(room.getByLabel('Quarry effect recipe')).toHaveValue(family.body); await expect(room.getByLabel('SPACE · shared send', { exact: true })).toHaveValue('0.2');
  await room.getByLabel('SPACE · shared send', { exact: true }).fill('0.31'); await room.getByLabel('RETURN · shared level', { exact: true }).fill('0.12');
  await room.getByRole('button', { name: 'Save defaults', exact: true }).click(); await expect(room.getByRole('status')).toContainText('Shared send, return and rack defaults saved');
  const after = await page.evaluate(() => { const project = window.__PROCGEN_STUDIO__.getProject(); return { graph: project.procgen.physicalGraph, lanes: project.procgen.lanes, tick: window.__PROCGEN_LANES__.world.tickIndex, rack: project.procgen.effectRack }; });
  expect({ graph: after.graph, lanes: after.lanes, tick: after.tick }).toEqual(before);
  expect(after.rack.graph.nodes.find(node => node.id === 'send').parameters.gain01).toBe(0.31); expect(after.rack.graph.nodes.find(node => node.id === 'return').parameters.gain01).toBe(0.12);
  expect(after.rack.graph.nodes.filter(node => node.kind === 'convolution-native')).toHaveLength(1); expect(after.rack.graph.nodes.find(node => node.id === 'dry').parameters.gain01).toBe(1);
  await room.getByLabel('SPACE · shared send', { exact: true }).fill('0'); await room.getByRole('button', { name: 'Load saved defaults', exact: true }).click(); await expect(room.getByLabel('SPACE · shared send', { exact: true })).toHaveValue('0.31');
  await room.getByRole('button', { name: 'Close', exact: true }).click();
});
