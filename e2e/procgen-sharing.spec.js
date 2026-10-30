import { MIN_DESKTOP_VIEWPORT } from './helpers/desktopViewports.js';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

const ready = async page => {
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.transport.pause());
};
const openShare = async page => {
  await page.locator('#procgenTab').click(); await page.locator('#procgenShare').click();
  await expect(page.getByRole('dialog', { name: 'Share this performance' })).toBeVisible();
};
const semanticState = page => page.evaluate(() => {
  const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world;
  return { options: studio.getStartupPlan().worldOptions, actual: { seed: world.seed, lanes: world.laneCount, laneHeight: world.laneHeight, speed: world.timer.speedFactor },
    output: studio.getPlaybackState().enabled, recording: studio.state.recording, thru: studio.state.thru,
    devices: [studio.state.inputId, studio.state.clockOutputId, ...studio.getProject().procgen.lanes.map(lane => lane.outputId)] };
});

test('an authored scene recipe checks exact installed content and reopens stopped with clean or unrelated preferences', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize(MIN_DESKTOP_VIEWPORT);
  await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) });
  await page.addInitScript(() => {
    window.sceneRecipeOutputRequests = { audio: 0, midi: 0 };
    for (const name of ['AudioContext', 'webkitAudioContext']) if (window[name]) {
      const Original = window[name]; window[name] = new Proxy(Original, { construct(target, args) { window.sceneRecipeOutputRequests.audio++; return Reflect.construct(target, args); } });
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.sceneRecipeOutputRequests.midi++; throw new Error('Unexpected output request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&recipe=1&seed=42&lanes=1'); await ready(page);
  const prepared = await page.evaluate(async () => {
    const root = new URL('./', location.href);
    const { createInstalledPerformanceSceneCatalog } = await import(new URL('js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js', root));
    const { createProcgenRecipeShareDescriptor } = await import(new URL('js/app/procgen/ProcgenUrlConfig.js', root));
    const catalog = await createInstalledPerformanceSceneCatalog(), row = catalog.registry.findSupported({ id: 'crossing-corridors.4' });
    const origin = await catalog.origin(catalog.registry.resolve(row));
    const descriptor = createProcgenRecipeShareDescriptor({ url: location.href + '#private-recovery', sceneOrigin: origin, includeCamera: false });
    return { url: descriptor.url, sceneHash: origin.sceneHash, sourceHash: origin.manifest.sourceVersion.hash, settings: descriptor.worldOptions,
      graph: origin.manifest.causalMappings, sounds: origin.manifest.patchRefs.map(value => value.reference.definitionHash) };
  });
  for (const populated of [false, true]) {
    await page.evaluate(async populated => {
      localStorage.clear(); if (!populated) return;
      const { createMidiProject } = await import('/js/midi/project/MidiProject.js');
      const { createProcgenWorkstationProject } = await import('/js/app/procgen/workstation/ProcgenWorkstationProject.js');
      const project = createProcgenWorkstationProject(createMidiProject(), { seed: 12, lanes: [{}, {}] });
      localStorage.setItem('lemmings.procgen.workstation.v1', JSON.stringify({ version: 1, project, transport: { bpm: 60, gameSpeed: 0.5 }, ui: { recording: true, thru: true, inputId: 'private-input' } }));
    }, populated);
    const url = new URL(prepared.url); url.searchParams.set('e2e', '1'); await page.goto(url.href);
    await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
    const actual = await page.evaluate(() => {
      const studio = window.__PROCGEN_STUDIO__, project = studio.getProject(), world = window.__PROCGEN_LANES__.world;
      return { mode: studio.getStartupPlan().mode, settings: studio.getStartupPlan().worldOptions, sourceIdentity: studio.getStartupPlan().sourceIdentity,
        sceneHash: project.procgen.sceneOrigin.sceneHash, sourceHash: project.procgen.sceneOrigin.manifest.sourceVersion.hash,
        graph: world.physicalAuthoring.graph, sounds: project.procgen.lanes.map(lane => lane.instrumentRef.definitionHash),
        tick: world.tickIndex, playing: studio.transport.getState().playing, output: studio.getPlaybackState().enabled,
        recording: studio.state.recording, thru: studio.state.thru, requests: window.sceneRecipeOutputRequests,
        devices: [studio.state.inputId, studio.state.clockOutputId, ...project.procgen.lanes.map(lane => lane.outputId)] };
    });
    expect(actual).toMatchObject({ mode: 'recipe', settings: prepared.settings, sceneHash: prepared.sceneHash, sourceHash: prepared.sourceHash,
      graph: prepared.graph, sounds: prepared.sounds, tick: 0, playing: false, output: false, recording: false, thru: false, requests: { audio: 0, midi: 0 } });
    expect(actual.devices.every(value => value == null)).toBe(true); expect(actual.sourceIdentity.hash).toBe(prepared.sceneHash);
    await openShare(page); await expect(page.getByRole('dialog')).toContainText('original authored scene');
    await expect(page.getByRole('dialog')).toContainText('exact build, scene and assets');
    expect(await page.locator('#procgenShareUrl').inputValue()).toBe(prepared.url); await page.keyboard.press('Escape');
  }
  const prior = '{"version":1,"project":{"saved":"keep-scene-recovery"}}';
  await page.evaluate(value => localStorage.setItem('lemmings.procgen.workstation.v1', value), prior);
  for (const [key, value, message] of [['sourceHash', 'f'.repeat(64), 'different application build'], ['sceneHash', 'f'.repeat(64), 'not installed'], ['sceneId', 'missing.scene', 'not installed']]) {
    const url = new URL(prepared.url); url.searchParams.set(key, value); url.searchParams.set('e2e', '1'); await page.goto(url.href);
    await expect(page.getByRole('alert')).toContainText(message);
    expect(await page.evaluate(() => ({ saved: localStorage.getItem('lemmings.procgen.workstation.v1'), world: !!window.__PROCGEN_LANES__, requests: window.sceneRecipeOutputRequests })))
      .toEqual({ saved: prior, world: false, requests: { audio: 0, midi: 0 } });
  }
});

test('unsupported, oversized and unavailable scene recipe links preserve local recovery without output activation', async ({ page }) => {
  test.setTimeout(90000); await page.goto('/README.md');
  const prior = '{"version":1,"project":{"saved":"keep-prior-recovery"}}';
  await page.evaluate(value => { localStorage.clear(); localStorage.setItem('lemmings.procgen.workstation.v1', value); window.invalidRecipeMidiCalls = 0; }, prior);
  await page.addInitScript(() => { window.invalidRecipeMidiCalls = 0; Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.invalidRecipeMidiCalls++; throw new Error('Unexpected MIDI request'); } }); });
  for (const [query, message] of [['recipe=2&seed=42', 'Unsupported recipe version'], ['recipe=1&seed=42&sceneId=missing&sceneRevision=9', 'scene recipe links are unsupported'], ['recipe=1&seed=42&extra=' + 'x'.repeat(2100), 'Recipe URL exceeds']]) {
    await page.goto('/procgen.html?e2e=1&' + query); await expect(page.getByRole('alert')).toContainText(message);
    expect(await page.evaluate(() => ({ world: !!window.__PROCGEN_LANES__, saved: localStorage.getItem('lemmings.procgen.workstation.v1'), midi: window.invalidRecipeMidiCalls }))).toEqual({ world: false, saved: prior, midi: 0 });
  }
});

test('recipe review uses real clipboard acknowledgement and all fields reopen independently of local state', { tag: '@boundary' }, async ({ page, context }) => {
  test.setTimeout(120000);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=999&lanes=3&speed=2.25&pack=4&laneHeight=192&preset=game-lydian-lanterns&musicMode=phrase&decoration=old-vegas&outputId=private-device&debug=private#private-recovery');
  await ready(page); const original = await semanticState(page);
  await page.evaluate(() => window.__PROCGEN_LANES__.renderer.camera.applyState({ cameraX: 40, cameraY: 12, scale: 2, follow: false }));
  const origin = new URL(page.url()).origin; await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await openShare(page); const dialog = page.getByRole('dialog', { name: 'Share this performance' });
  await expect(dialog).toContainText('Not included:'); await expect(dialog).toContainText('unverified');
  const plain = await page.locator('#procgenShareUrl').inputValue();
  expect(new URL(plain).hash).toBe(''); expect([...new URL(plain).searchParams.keys()]).toEqual(['recipe', 'seed', 'lanes', 'pack', 'speed', 'decoration', 'laneHeight', 'preset', 'musicMode']);
  await page.locator('#procgenShareCamera').check(); const framed = await page.locator('#procgenShareUrl').inputValue();
  expect(new URL(framed).searchParams.has('zoom')).toBe(true);
  const framing = await page.evaluate(() => window.__PROCGEN_LANES__.renderer.camera.getState());
  const identities = await page.evaluate(async ({ plain, framed }) => {
    const { resolveProcgenStartupIntent } = await import('/js/app/procgen/workstation/ProcgenStartupIntent.js');
    return [plain, framed].map(url => resolveProcgenStartupIntent({ search: new URL(url).search }).intentId);
  }, { plain, framed }); expect(identities[0]).toBe(identities[1]);
  await page.getByRole('button', { name: 'Copy link', exact: true }).click(); await expect(page.locator('#procgenShareStatus')).toContainText('link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(framed);
  await page.keyboard.press('Escape'); await expect(page.locator('#procgenShare')).toBeFocused();
  for (const populated of [false, true]) {
    await page.evaluate(async populated => {
      localStorage.clear(); if (!populated) return;
      const { createMidiProject } = await import('/js/midi/project/MidiProject.js');
      const { createProcgenWorkstationProject } = await import('/js/app/procgen/workstation/ProcgenWorkstationProject.js');
      const project = createProcgenWorkstationProject(createMidiProject(), { seed: 12, lanes: [{}, {}] });
      localStorage.setItem('lemmings.procgen.workstation.v1', JSON.stringify({ version: 1, project, transport: { bpm: 60, gameSpeed: 0.5, speedMode: 'bpm' }, ui: { recording: true, thru: true, inputId: 'private-input', clockOutputId: 'private-clock' } }));
      localStorage.setItem('lemmings.procgen.lanes.v1', JSON.stringify({ version: 1, value: 2 }));
      localStorage.setItem('lemmings.procgen.music.v1', JSON.stringify({ version: 1, preset: 'game-iron-ensemble', mode: 'steps' }));
    }, populated);
    const target = new URL(framed); target.searchParams.set('e2e', '1'); await page.goto(target.href); await ready(page);
    const opened = await semanticState(page); expect(opened.options).toEqual(original.options); expect(opened.actual).toEqual(original.actual);
    expect(await page.evaluate(() => window.__PROCGEN_LANES__.renderer.camera.getState())).toEqual(framing);
    expect(opened).toMatchObject({ output: false, recording: false, thru: false }); expect(opened.devices.every(value => value == null)).toBe(true);
  }
});

test('clipboard permission rejection retains a selected read-only URL and manual copy instructions', async ({ page, context }) => {
  test.setTimeout(60000); await page.setViewportSize(MIN_DESKTOP_VIEWPORT); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2'); await ready(page);
  await context.grantPermissions([], { origin: new URL(page.url()).origin }); await openShare(page);
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.locator('#procgenShareStatus')).toContainText('Ctrl+C'); await expect(page.locator('#procgenShareStatus')).not.toContainText('link copied');
  const input = page.locator('#procgenShareUrl'); await expect(input).toBeFocused(); await expect(input).toHaveAttribute('readonly', '');
  expect(await input.evaluate(element => element.selectionEnd - element.selectionStart)).toBe((await input.inputValue()).length);
  const bounds = await page.getByRole('dialog').boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(MIN_DESKTOP_VIEWPORT.width); expect(bounds.height).toBeLessThanOrEqual(MIN_DESKTOP_VIEWPORT.height - 24);
});

test('sharing prepares the reviewed checkpoint before focusing existing file delivery controls', async ({ page }) => {
  test.setTimeout(90000); let downloads = 0; page.on('download', () => { downloads++; });
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2'); await ready(page);
  await openShare(page); await expect(page.getByRole('dialog')).toContainText('Current project checkpoint');
  await expect(page.getByRole('dialog')).toContainText('does not contain a recorded causal take');
  await page.getByRole('button', { name: 'Prepare performance file', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeFocused();
  const result = await page.evaluate(() => ({ exported: window.__PROCGEN_STUDIO__.getExportState(), output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled }));
  expect(result.exported.artifact).toMatchObject({ retained: true, formatVersion: 'procgen-session/v1' });
  expect(result.exported.delivery).toBeNull(); expect(result.output).toBe(false); expect(downloads).toBe(0);
});

test('sharing selects the finished causal take archive and retains its source hash and coverage', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2'); await ready(page);
  const take = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; await studio.handlers.startCausalTake({ takeName: 'Shared physical source' });
    const stopped = await studio.stopCausalTake({ reason: 'sharing-fixture' });
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js'); const storage = createProcgenSessionStorage(indexedDB);
    try { const manifest = await storage.loadCausalTake(stopped.takeId); return { takeId: stopped.takeId, revision: manifest.revision, hash: manifest.canonicalHash, complete: manifest.complete }; }
    finally { storage.close(); }
  });
  await openShare(page); await expect(page.getByRole('dialog')).toContainText('Selected causal take archive');
  await page.getByRole('button', { name: 'Prepare performance file', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const exported = await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState());
  expect(exported.artifact).toMatchObject({ formatVersion: 'lemmings-causal-take-archive/v1', immutableSourceRef: `causal-take:${take.takeId}:${take.revision}:${take.hash}`,
    coverageLossReportRef: take.complete ? null : `take:${take.takeId}:partial-coverage` }); expect(exported.delivery).toBeNull();
});
