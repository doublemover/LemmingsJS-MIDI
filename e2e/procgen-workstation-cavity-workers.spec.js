import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { openNativeCavity, cavityEdit, enableCavity, runNativeCavity } from './helpers/nativeCavity.js';
import { inspectLane } from './helpers/workstationDock.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

async function requestAnotherActor(page) {
  const region = page.getByRole('region', { name: 'Current physical score controls', exact: true }), input = region.getByRole('spinbutton', { name: 'Contact entry gap (ticks)', exact: true });
  await input.fill('32'); await input.locator('..').getByRole('button', { name: 'Request spacing', exact: true }).click();
}

async function awaitBody(page, recipe, changed) {
  await expect.poll(() => page.evaluate(({ recipe, changed }) => {
    const state = window.__PROCGEN_STUDIO__.getPhysicalOutputDiagnostics();
    if (!state?.cavityBody?.prepared) return false;
    const bindings = state.cavityBody.bindings;
    return recipe === 'Throat duet' ? (bindings[0].componentId === bindings[1].componentId) === changed : bindings[0].frequencyHz === (changed ? 110 : 220);
  }, { recipe, changed }), { timeout: 15000 }).toBe(true);
}

for (const recipe of ['Clay chamber', 'Throat duet', 'Crumbled chimes']) test('fresh physical actors excite every recorded live cavity revision: ' + recipe, { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, info) => {
  test.setTimeout(240000); await openNativeCavity(page, recipe, { probeSources: true, step: false });
  const take = await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.startCausalTake({ takeName: 'Fresh cavity contacts' })); expect(take).toBeTruthy();
  await enableCavity(page); const phases = [];
  phases.push(await runNativeCavity(page, 120, { keepRunning: true }));
  const label = recipe === 'Throat duet' ? 'Connecting throat' : 'Left chamber side', changed = recipe === 'Throat duet' ? 1 : 16, initial = recipe === 'Throat duet' ? 0 : 8;
  for (const [isChanged, value] of [[true, changed], [false, initial]]) {
    await cavityEdit(page, label, value, { step: false }); await awaitBody(page, recipe, isChanged);
    await requestAnotherActor(page); phases.push(await runNativeCavity(page, 160, { keepRunning: true, resumePhysicalOnly: true }));
  }
  await page.evaluate(() => window.__PROCGEN_LANES__.pause());
  await info.attach('native-fresh-cavity-phases', { body: JSON.stringify({ recipe, phases, actorsPosed: false, processorsOverridden: false }), contentType: 'application/json' });
  for (const phase of phases) {
    expect(phase.failure).toBeFalsy(); expect(phase.after - phase.before).toBeGreaterThanOrEqual(120); expect(phase.body.cavityBody.prepared).toBe(true);
    expect(phase.body.rejected).toBe(0); expect(phase.pcm.peak).toBeGreaterThan(1e-8); expect(phase.wallContacts.length).toBeGreaterThan(0);
    expect(phase.energies[phase.body.cavityBody.bindings[0].bodyId]).toBeGreaterThan(0);
    expect(phase.audioOpens).toBe(1); expect(phase.midiRequests).toBe(0); expect(phase.viewport).toEqual({ width: 1920, height: 1080 });
  }
  expect(new Set(phases.map(phase => phase.body.effects.activeGraph.hash)).size).toBe(3);
  const history = await page.evaluate(async takeId => {
    const studio = window.__PROCGEN_STUDIO__, stopped = await studio.handlers.stopCausalTake(), root = new URL('./', location.href);
    const [{ createProcgenSessionStorage }, { createProcgenCausalJournal }] = await Promise.all([import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root)), import(new URL('js/app/procgen/workstation/ProcgenCausalJournal.js', root))]);
    const storage = createProcgenSessionStorage();
    try {
      const journal = createProcgenCausalJournal({ storage }), manifest = await journal.openTake(takeId), page = await journal.query({ takeId, limit: 4096 });
      const facts = page.records.filter(record => record.kind === 'physical-batch').flatMap(record => record.payload.facts).filter(fact => ['ActorBorn', 'ContactResolved', 'ContactSpanBegan', 'ContactSpanEnded', 'TerrainWorkCommitted'].includes(fact.kind));
      const intents = page.records.filter(record => record.kind === 'musical-intents').flatMap(record => record.payload.intents), outcomes = page.records.filter(record => record.kind === 'sink-outcome').flatMap(record => record.payload.outcomes || [record.payload]);
      return { stopped, manifest, nextSequence: page.nextSequence, facts, intents, graphs: outcomes.filter(outcome => outcome.schema === 'lemmings-effect-performance/v1' && outcome.operation === 'graph'), excitations: outcomes.filter(outcome => outcome.stage === 'shared-topology-body-excitation'), releaseRequests: page.records.filter(record => record.kind === 'intervention' && record.payload.command?.kind === 'set-release-gesture').map(record => record.payload) };
    } finally { storage.close(); }
  }, take.takeId);
  await info.attach('native-fresh-cavity-history', { body: JSON.stringify({ recipe, phases, history, actorsPosed: false, processorsOverridden: false }), contentType: 'application/json' });
  expect(history.stopped.complete).toBe(true); expect(history.manifest.coverage.status).toBe('complete'); expect(history.nextSequence).toBeNull(); expect(history.graphs).toHaveLength(3);
  const begins = history.intents.filter(intent => intent.kind === 'begin'), births = history.facts.filter(fact => fact.kind === 'ActorBorn'), contacts = new Map(history.facts.filter(fact => ['ContactResolved', 'ContactSpanBegan'].includes(fact.kind)).map(fact => [fact.eventId, fact]));
  expect(births).toHaveLength(3); expect(new Set(begins.map(intent => intent.generation + ':' + intent.actorId)).size).toBe(3); expect(history.releaseRequests).toHaveLength(2);
  for (const graph of history.graphs) {
    const excitations = history.excitations.filter(receipt => receipt.status === 'accepted' && receipt.topologyBody.ownerRouteRevision === graph.ownerRouteRevision && receipt.topologyBody.graphDefinitionHash === graph.graphDefinitionHash);
    expect(excitations.length).toBeGreaterThan(0);
    for (const receipt of excitations) {
      const intent = begins.find(intent => intent.intentId === receipt.intentId); expect(intent).toBeTruthy(); expect(intent.topologyBinding.boundTopologyRevision).toBe(receipt.topologyBody.boundTopologyRevision);
      expect(intent.sourceEventIds.some(id => contacts.has(id) && contacts.get(id).actorId === intent.actorId && contacts.get(id).generation === intent.generation)).toBe(true); expect(births.some(birth => birth.actorId === intent.actorId && birth.generation === intent.generation && birth.spawnTick <= intent.scoreTime.simTick)).toBe(true);
    }
  }
  await page.evaluate(async takeId => { await window.__PROCGEN_STUDIO__.handlers.selectCausalTake(takeId); }, take.takeId); await inspectLane(page, 'Physical');
  await page.getByRole('button', { name: 'Render sine WAV…', exact: true }).click(); const render = page.getByRole('dialog', { name: 'Render causal take owned-source revoice', exact: true });
  await render.getByLabel('New render effect', { exact: true }).selectOption('captured-controls'); await render.getByLabel('Include the simultaneous shared return WAV', { exact: true }).uncheck();
  const endSeconds = Number(await render.getByLabel('End seconds from capture', { exact: true }).getAttribute('max')); await render.getByLabel('End seconds from capture', { exact: true }).fill(String(endSeconds));
  await render.getByRole('button', { name: 'Prepare revoice WAV', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getCausalAudioRenderState().render.phase), { timeout: 90000 }).toMatch(/prepared|failed/);
  const state = await page.evaluate(() => window.__PROCGEN_STUDIO__.getCausalAudioRenderState()); expect(state.render.phase, JSON.stringify(state.render)).toBe('prepared');
  const downloading = page.waitForEvent('download'); await render.getByRole('button', { name: 'Download selected WAV', exact: true }).click(); const download = await downloading, filename = info.outputPath('fresh-cavity-history.wav'); await download.saveAs(filename);
  const bytes = await readFile(filename); let manifest, pcm;
  for (let at = 12; at < bytes.length;) { const tag = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4); if (tag === 'lmjs') manifest = JSON.parse(bytes.toString('utf8', at + 8, at + 8 + size)); if (tag === 'data') pcm = bytes.subarray(at + 8, at + 8 + size); at += 8 + size + size % 2; }
  expect(manifest.sourceCanonicalHash).toBe(history.manifest.canonicalHash); expect(manifest.commands.capturedBegins).toBe(begins.length); expect(manifest.commands.capturedEnds).toBe(history.intents.filter(intent => intent.kind === 'end').length); expect(manifest.commands.derivedReleases).toBe(0);
  expect(manifest.effectGraph.commandReplay.history.graphs).toHaveLength(3); expect(manifest.effectGraph.realization.peakGraphs).toBe(2); expect(manifest.effectGraph.realization.sourceRealizations).toBe(1); expect(manifest.statistics.peak).toBeGreaterThan(1e-8); expect(manifest.statistics.overFullScaleSamples).toBe(0);
  expect(createHash('sha256').update(pcm).digest('hex')).toBe(manifest.pcmHash);
  await info.attach('native-fresh-cavity-WAV', { body: JSON.stringify({ recipe, bytes: bytes.length, wavSha256: createHash('sha256').update(bytes).digest('hex'), manifest, scope: 'Actual fresh actors/contact ancestry on every published live body, followed by a new cleared-memory command revoice. Internal PCM is not listening or acoustic evidence.' }), contentType: 'application/json' });
});
