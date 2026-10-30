import { expect, test } from '@playwright/test';
import { surveyCanonicalVectors } from '../test/helpers/surveyCanonicalVectors.js';
import { canonicalSurveyJson, hashSurveyValue } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

test('desktop survey canonical numeric vectors match Node and ignore spoofed typed view properties', { tag: '@boundary' }, async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2');
  const expected = surveyCanonicalVectors().map(([name, value]) => ({ name, text: canonicalSurveyJson(value), hash: hashSurveyValue(value) }));
  const result = await page.evaluate(async () => {
    const { surveyCanonicalVectors } = await import('/test/helpers/surveyCanonicalVectors.js');
    const { canonicalSurveyJson, hashSurveyValue } = await import('/js/app/procgen/survey/ProcgenSurveyCanonical.js');
    const { ProcgenSurveyTerrain, captureControlledSurveyTerrain } = await import('/js/app/procgen/survey/ProcgenSurveyTerrain.js');
    const { ProcgenTerrainEdits } = await import('/js/app/procgen/ProcgenTerrainRetention.js');
    const { captureTerrainEditIdentity } = await import('/js/app/procgen/ProcgenTerrainEditIdentity.js');
    const vectors = surveyCanonicalVectors().map(([name, value]) => ({ name, text: canonicalSurveyJson(value), hash: hashSurveyValue(value) }));
    const value = new Float64Array([-0, NaN, Infinity]); const original = canonicalSurveyJson(value); let getters = 0;
    for (const key of ['constructor', 'byteOffset', 'length', Symbol.iterator]) Object.defineProperty(value, key, { get() { getters++; throw new Error('Spoofed view'); } });
    const array = [1]; Object.defineProperty(array, '0', { get() { getters++; throw new Error('Accessor invoked'); } }); let rejected = false;
    try { canonicalSurveyJson(array); } catch (error) { rejected = error.message.includes('getters'); }
    const terrain = new ProcgenSurveyTerrain({ solid: [{ x: 8, y: 72, width: 1024, height: 24 }], steel: [] });
    terrain.registerLanes(Uint32Array.of(7)); const cold = hashSurveyValue(captureControlledSurveyTerrain(terrain));
    const chunk = terrain.getChunk(7, 4); terrain.getChunk(7, 2);
    const warm = hashSurveyValue(captureControlledSurveyTerrain(terrain)); chunk.solid[0] ^= 1;
    const changed = hashSurveyValue(captureControlledSurveyTerrain(terrain));
    const edits = new ProcgenTerrainEdits(16, 1), patch = new Uint8Array(16); patch.fill(2, 2, 6); edits.set(3, patch);
    const resident = hashSurveyValue(captureTerrainEditIdentity(edits)); edits.compactExcept(new Set(), 1);
    const packed = hashSurveyValue(captureTerrainEditIdentity(edits)); const restored = edits.get(3); restored[0] = 1;
    return { vectors, original, actual: canonicalSurveyJson(value), getters, rejected, cache: { equivalent: warm === cold, changed: changed !== cold },
      edits: { equivalent: packed === resident, changed: hashSurveyValue(captureTerrainEditIdentity(edits)) !== resident } };
  });
  expect(result.vectors).toEqual(expected); expect(result.actual).toBe(result.original); expect(result.getters).toBe(0); expect(result.rejected).toBe(true);
  expect(result.cache).toEqual({ equivalent: true, changed: true });
  expect(result.edits).toEqual({ equivalent: true, changed: true });
});

test('authored scene source evidence preserves prepared ownership through physical byte refusal and recovery @boundary', async ({ page }, testInfo) => {
  test.setTimeout(150000); await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 60000 });
  await page.evaluate(async () => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); await window.__PROCGEN_STUDIO__.handlers.scenes(); });
  const dialog = page.getByRole('dialog', { name: 'Playable physical scores', exact: true });
  await dialog.getByRole('searchbox', { name: 'Search physical scores' }).fill('Builder-Miner Workshop');
  await dialog.getByRole('listbox', { name: 'Scene versions' }).getByRole('option').first().click({ timeout: 10000 });
  await dialog.getByRole('button', { name: 'Prepare fresh', exact: true }).click();
  const load = dialog.getByRole('button', { name: 'Load fresh · stopped replacement', exact: true }); await expect(load).toBeEnabled({ timeout: 90000 });
  page.once('dialog', prompt => prompt.accept()); await load.click();
  await expect.poll(() => page.evaluate(() => !!window.__PROCGEN_LANES__.world.terrain.views), { timeout: 60000 }).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world, terrain = world.terrain, tick = world.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href);
    const { captureGeneratedTerrainEvidence } = await import(new URL('js/app/procgen/ProcgenTerrainCacheEvidence.js', root)), { hashSurveyValue } = await import(new URL('js/app/procgen/survey/ProcgenSurveyCanonical.js', root));
    const hash = () => hashSurveyValue(captureGeneratedTerrainEvidence(terrain)), before = hash(), seed = world.laneSeeds[0], chunk = terrain.getChunk(seed, 0), failures = [];
    terrain.base.getChunk(seed, 40, true); if (hash() !== before) throw new Error('Fallback cache warmth changed the authored score identity.');
    for (const field of ['solid', 'steel', 'pixels', 'topProfile']) {
      chunk[field][0] ^= 1;
      try { hash(); throw new Error('Altered authored ' + field + ' was accepted'); }
      catch (error) { if (error.code !== 'changed-generated-terrain-cache') throw error; failures.push({ field, code: error.code, kind: error.cacheKind }); }
      finally { chunk[field][0] ^= 1; }
      if (hash() !== before) throw new Error('Authored source repair did not recover.');
    }
    return { before, recovered: hash(), failures, source: terrain.sourceReceipt(), sameWorld: world === window.__PROCGEN_LANES__.world,
      sameTick: tick === world.tickIndex, sameProject: project === JSON.stringify(studio.getProject()), output: studio.getPlaybackState().enabled,
      scope: 'Actual catalog Prepare/Load, admitted worker compiled authored source, immutable seed bindings and read-only local integrity checks. No archived exact-execution or acoustic claim.' };
  });
  expect(result.failures).toHaveLength(4); expect(result.recovered).toBe(result.before); expect(result.sameWorld && result.sameTick && result.sameProject).toBe(true); expect(result.output).toBe(false);
  expect(result.source.activeExecution).toBe('bound'); expect(result.source.method).toBe('dedicated-worker');
  await testInfo.attach('authored-scene-source-evidence', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('browser physical projection preserves real continuation differences and rejects nested accessor evidence @boundary', async ({ page }, testInfo) => {
  test.setTimeout(90000); await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); const root = new URL('./', location.href);
    const { surveyProjectionContinuations } = await import('/test/helpers/surveyProjectionContinuations.js');
    const { createSurveyTrial } = await import(new URL('js/app/procgen/survey/ProcgenSurveyCore.js', root));
    const { BinaryReader } = await import(new URL('js/data/BinaryReader.js', root)), { FileContainer } = await import(new URL('js/data/FileContainer.js', root)), { MaskProvider } = await import(new URL('js/render/MaskProvider.js', root));
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Source masks unavailable');
    const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    return surveyProjectionContinuations(scenario => createSurveyTrial({ scenario, masks }));
  });
  expect(result.map(row => row.kind)).toEqual(['speed', 'intervention', 'contact', 'intrinsic-and-accessor']);
  await testInfo.attach('browser-projection-continuations', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('production generated pack evidence ignores query warmth and refuses altered physical caches @boundary', async ({ page }, testInfo) => {
  test.setTimeout(90000); await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const api = window.__PROCGEN_LANES__, studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); api.pause();
    const world = api.world, terrain = world.terrain, root = new URL('./', location.href);
    const { captureGeneratedTerrainEvidence } = await import(new URL('js/app/procgen/ProcgenTerrainCacheEvidence.js', root));
    const { hashSurveyValue, SURVEY_STATE_SCHEMA } = await import(new URL('js/app/procgen/survey/ProcgenSurveyCanonical.js', root));
    const hash = () => hashSurveyValue(captureGeneratedTerrainEvidence(terrain)), before = hash(), tick = world.tickIndex, project = JSON.stringify(studio.getProject());
    const counts = () => terrain.themes.map(theme => ({ collision: theme.terrain.collision.size, descriptions: theme.terrain.descriptions.size, growth: theme.terrain.growthPlans.size }));
    const initialCounts = counts();
    for (const seed of world.laneSeeds) for (const chunk of [40, 4, 17, 41, 23]) { terrain.getChunk(seed, chunk, true); terrain.growthPlan(seed, chunk); }
    const warm = hash(), warmCounts = counts(); hash(); if (JSON.stringify(warmCounts) !== JSON.stringify(counts())) throw new Error('Evidence capture changed cache residency.');
    const seed = world.laneSeeds[0], owner = terrain.forSeed(seed), chunk = terrain.getChunk(seed, 4), descriptor = owner.describe(seed, 4), plan = owner.growthPlan(seed, 4), refusals = [];
    const refuse = (kind, mutate, restore) => {
      mutate(); try { hash(); throw new Error('Altered ' + kind + ' was accepted.'); }
      catch (error) { if (!['changed-generated-terrain-cache', 'unverified-generated-terrain-cache'].includes(error.code)) throw error; refusals.push({ kind, code: error.code, cacheKind: error.cacheKind, cacheKey: error.cacheKey }); }
      finally { restore(); }
      if (hash() !== before) throw new Error('Repaired ' + kind + ' did not recover.');
    };
    for (const field of ['solid', 'steel', 'topProfile']) refuse(field, () => { chunk[field][0] ^= 1; }, () => { chunk[field][0] ^= 1; });
    refuse('descriptor', () => { descriptor.left++; }, () => { descriptor.left--; });
    refuse('growth-plan', () => { plan.foundationByColumn[0] ^= 1; }, () => { plan.foundationByColumn[0] ^= 1; });
    const key = seed + ':4'; refuse('unproved-collision', () => owner.collision.set(key, { ...chunk }), () => owner.collision.set(key, chunk));
    return { stateSchema: SURVEY_STATE_SCHEMA, before, warm, recovered: hash(), initialCounts, warmCounts, refusals,
      sameWorld: api.world === world, sameTick: world.tickIndex === tick, sameProject: JSON.stringify(studio.getProject()) === project,
      output: studio.getPlaybackState().enabled, scope: 'Production generated pack and owned cache content; no cache queries during evidence capture, immutable source assets retain their separate provenance contract.' };
  });
  expect(result.warm).toBe(result.before); expect(result.recovered).toBe(result.before); expect(result.stateSchema).toBe(7); expect(result.refusals).toHaveLength(6);
  expect(result.sameWorld && result.sameTick && result.sameProject).toBe(true); expect(result.output).toBe(false);
  await testInfo.attach('generated-pack-cache-evidence', { body: JSON.stringify(result), contentType: 'application/json' });
});
