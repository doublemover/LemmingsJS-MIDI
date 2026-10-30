import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { inspectLane } from './helpers/workstationDock.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('future instrument controls remain opaque through visible save and a fresh browser realm reopen @boundary', async ({ page, context }, testInfo) => {
  test.setTimeout(150000);
  await context.addInitScript(() => {
    window.__compatAudioOpens = 0; window.__compatMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__compatAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__compatMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  const boot = async target => {
    await target.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
    await target.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
    await target.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
    await target.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
    return inspectLane(target, 'Lane');
  };
  let dock = await boot(page);
  await dock.getByRole('button', { name: 'Select Soft triangle fallback', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].instrumentRef?.patchId)).toBe('foundation.soft-triangle');
  const source = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, root = new URL('./', location.href), { hashData, canonicalDataText } = await import(new URL('js/core/CanonicalData.js', root));
    const { resolveSoundContentReference } = await import(new URL('js/midi/content/SoundContentReference.js', root));
    const { getNativeInstrumentCatalog } = await import(new URL('js/app/midi-ui/NativeInstrumentSchema.js', root));
    const supported = studio.getProject().procgen.lanes[0].instrumentRef, catalog = await getNativeInstrumentCatalog();
    if ((await resolveSoundContentReference(supported, { engineDescriptors: catalog.descriptors })).status !== 'ready') throw new Error('Supported definition did not resolve against the executing engine.');
    const future = structuredClone(supported); future.patchId = 'future-foundry'; future.revision = 99; future.definition.id = future.patchId; future.definition.revision = 99;
    future.definition.schemaVersion = 99; future.definition.name = 'Opaque future instrument'; future.definition.macros = { futureOnly: ['opaque', 99] }; future.definition.variation = { futureOnly: true }; future.definition.causalBindings = { futureOnly: true };
    future.definitionHash = await hashData(future.definition); future.packHash = await hashData({ futurePack: future.definitionHash });
    const session = structuredClone(studio.capture('Future instrument source')); session.project.procgen.lanes[0].instrumentRef = future; session.project.procgen.lanes[0].instrumentPatchId = future.patchId;
    const original = JSON.stringify(session); if (!await studio.loadSession(session)) throw new Error('Future data did not load for inspection.');
    if (JSON.stringify(session) !== original) throw new Error('Imported future session was mutated.');
    if (canonicalDataText(studio.getProject().procgen.lanes[0].instrumentRef).text !== canonicalDataText(future).text) throw new Error('Future definition was changed during publication.');
    if ((await resolveSoundContentReference(future, { engineDescriptors: catalog.descriptors })).status !== 'patch-schema-unavailable') throw new Error('Future data became playable.');
    return { future, supportedHash: supported.definitionHash, importedSourceUnchanged: true, sourceRealm: catalog.executionIdentity.realmId };
  });
  await expect(dock.locator('.studio-sound-compatibility')).toContainText('Unsupported patch schema 99');
  await expect(dock.getByRole('button', { name: 'Commit performed macros', exact: true })).toHaveCount(0);
  await expect(dock.getByRole('button', { name: 'Reroll timbre', exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.__compatSave = window.__PROCGEN_STUDIO__.handlers.saveAs(); });
  const dialog = page.getByRole('dialog', { name: 'Save project copy', exact: true });
  await dialog.getByRole('textbox', { name: 'Save project copy', exact: true }).fill('Opaque future instrument'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => window.__compatSave)).toBe(true);
  const document = await page.evaluate(() => window.__PROCGEN_STUDIO__.getDocumentState());
  await page.close(); const reopened = await context.newPage(); dock = await boot(reopened);
  const restored = await reopened.evaluate(async ({ id, future }) => {
    const studio = window.__PROCGEN_STUDIO__, root = new URL('./', location.href), { createProcgenSessionStorage } = await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root));
    const { getActiveExecutionIdentity } = await import(new URL('js/runtime/ActiveExecutionIdentity.js', root));
    const { canonicalDataText } = await import(new URL('js/core/CanonicalData.js', root));
    const storage = createProcgenSessionStorage(); let stored;
    try { stored = await storage.loadDocument(id); } finally { storage.close(); }
    if (canonicalDataText(stored.session.project.procgen.lanes[0].instrumentRef).text !== canonicalDataText(future).text || !await studio.loadSession(stored.session)) throw new Error('Stored future reference did not survive reopen.');
    if (canonicalDataText(studio.getProject().procgen.lanes[0].instrumentRef).text !== canonicalDataText(future).text) throw new Error('Reopened future source was defaulted.');
    const exported = studio.capture('Unchanged future export');
    if (canonicalDataText(exported.project.procgen.lanes[0].instrumentRef).text !== canonicalDataText(future).text) throw new Error('Snapshot export changed future bytes.');
    return { reference: exported.project.procgen.lanes[0].instrumentRef, revision: stored.revision, realm: getActiveExecutionIdentity().realmId,
      audioContexts: window.__compatAudioOpens, midiRequests: window.__compatMidiRequests, output: studio.getPlaybackState(), transport: studio.transport.getState() };
  }, { id: document.id, future: source.future });
  await expect(dock.locator('.studio-sound-compatibility')).toContainText('retained read-only');
  expect(restored.realm).not.toBe(source.sourceRealm); expect(restored.audioContexts).toBe(0); expect(restored.midiRequests).toBe(0); expect(restored.output.enabled).toBe(false); expect(restored.transport.playing).toBe(false);
  await testInfo.attach('future-definition-native-save-reopen', { body: JSON.stringify({ source, restored, document }), contentType: 'application/json' });
});

test('legacy physical conversion reports discarded steps once and preserves the imported source through native reopen @boundary', async ({ page }, testInfo) => {
  test.setTimeout(150000); const messages = [];
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  page.once('dialog', async dialog => { messages.push(dialog.message()); await dialog.dismiss(); });
  const canceled = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    const source = structuredClone(studio.capture('Legacy source'));
    source.project.procgen.version = 1; source.project.procgen.lanes[0].mode = 'game'; source.project.procgen.lanes[0].patterns = [{ steps: [{ enabled: true }, { enabled: false }, { enabled: true }] }];
    window.__legacyInstrumentSource = source; window.__legacyInstrumentOriginal = JSON.stringify(source);
    const world = window.__PROCGEN_LANES__.world, project = JSON.stringify(studio.getProject()), result = await studio.loadSession(source);
    if (result !== false || window.__PROCGEN_LANES__.world !== world || JSON.stringify(studio.getProject()) !== project || JSON.stringify(source) !== window.__legacyInstrumentOriginal)
      throw new Error('Canceled conversion changed its source or current project.'); return { canceled: true, unchanged: true };
  });
  page.once('dialog', async dialog => { messages.push(dialog.message()); await dialog.accept(); });
  const accepted = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; if (!await studio.loadSession(window.__legacyInstrumentSource)) throw new Error('Explicit conversion failed.');
    const project = studio.getProject(), converted = studio.capture('Converted physical source');
    if (project.procgen.version !== 2 || project.procgen.lanes.some(lane => lane.mode !== 'physical' || lane.patterns.length) || JSON.stringify(window.__legacyInstrumentSource) !== window.__legacyInstrumentOriginal)
      throw new Error('Conversion did not preserve the original and remove only the declared legacy path.');
    const { createProcgenSessionStorage } = await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', new URL('./', location.href)));
    const store = createProcgenSessionStorage();
    try { await store.saveDocument('doc:explicit-conversion', 0, converted, 'commit:explicit-conversion'); } finally { store.close(); }
    const reopened = createProcgenSessionStorage(); let stored;
    try { stored = await reopened.loadDocument('doc:explicit-conversion'); } finally { reopened.close(); }
    if (!await studio.loadSession(stored.session) || JSON.stringify(studio.getProject().procgen) !== JSON.stringify(project.procgen)) throw new Error('Converted project did not reopen without reinterpretation.');
    return { version: project.procgen.version, lanes: project.procgen.lanes.length, removedSteps: 2, originalUnchanged: true, reopened: true };
  });
  expect(canceled.unchanged).toBe(true); expect(messages).toHaveLength(2); expect(messages.every(message => /2 enabled phrase steps.*2 lanes/.test(message))).toBe(true);
  expect(accepted).toMatchObject({ version: 2, originalUnchanged: true, reopened: true });
  await testInfo.attach('explicit-one-time-physical-conversion', { body: JSON.stringify({ canceled, accepted, messages }), contentType: 'application/json' });
});
