import { expect, test } from '@playwright/test';
import { surveyCanonicalVectors } from '../test/helpers/surveyCanonicalVectors.js';
import { canonicalSurveyJson, hashSurveyValue } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';

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
