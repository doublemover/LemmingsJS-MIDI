import { expect, test } from '@playwright/test';

test('production project imports reject malformed graphs without changing the live world, history, route or stored checkpoint @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, { timeout: 60000 });
  await page.evaluate(() => window.__PROCGEN_STUDIO__.play());
  await page.waitForFunction(() => window.__PROCGEN_LANES__.world.actors.length > 0);
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause();
    const controlAccepted = await studio.handlers.import(new File([JSON.stringify(studio.capture())], 'valid-control.json', { type: 'application/json' }));
    if (!controlAccepted) throw new Error('The unmodified control checkpoint did not import.');
    const world = window.__PROCGEN_LANES__.world;
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    const storage = createProcgenSessionStorage(), original = studio.capture();
    await storage.saveDocument('doc:import-preserved', 0, original, 'original');
    const stored = JSON.stringify(await storage.loadDocument('doc:import-preserved')), checkpoint = JSON.stringify(original.world), project = studio.getProject();
    const documentState = JSON.stringify(studio.getDocumentState()), history = JSON.stringify(studio.handlers.historyState());
    const readRoute = () => {
      const state = studio.ports.getState();
      return JSON.stringify({ inputId: state.inputId, noteOutputId: state.noteOutputId, clockOutputId: state.clockOutputId, thru: state.thru,
        noteOutputIds: state.noteOutputIds, activeNoteOutputIds: state.activeNoteOutputIds, authorizedNoteOutputIds: state.authorizedNoteOutputIds, mpeZone: state.mpeZone });
    };
    const route = readRoute();
    const owner = session => session.world.graph.owners.find(entry => entry.name === 'world').props;
    const actor = session => session.world.graph.nodes.find(entry => entry.type === 'Lemming');
    const cases = [
      ['null-node', session => session.world.graph.nodes.push(null)],
      ['unknown-tag', session => session.world.graph.nodes.push({ type: 'QualificationUnknown', props: {} })],
      ['unknown-owner', session => session.world.graph.owners[0].name = 'qualification-unknown'],
      ['duplicate-owner', session => session.world.graph.owners.push(structuredClone(session.world.graph.owners[0]))],
      ['missing-owner', session => session.world.graph.owners.pop()],
      ['invalid-reference', session => { owner(session).actors = { ref: 2000000 }; }],
      ['unknown-external', session => { owner(session).checkpointHazardFixture = { external: 'qualification-missing' }; }],
      ['method-shadow', session => { owner(session).step = 'private qualification sentinel'; }],
      ['unknown-owner-property', session => { owner(session).qualificationUnknownField = 1; }],
      ['owner-timer-resource', session => { owner(session).timer = { ref: 0 }; }],
      ['owner-stall-resource', session => { owner(session).stall = { ref: 0 }; }],
      ['owner-trigger-resource', session => { owner(session).triggerManager = { ref: 0 }; }],
      ['owner-runtime-resource', session => { owner(session).runtime = { external: 'stall' }; }],
      ['scalar-typed-array', session => session.world.graph.nodes.push({ type: 'Float64Array', values: 64 })],
      ['array-shape', session => { session.world.graph.nodes.find(entry => entry.type === 'Array').props = { length: 1000000000 }; }],
      ['lane-envelope', session => { owner(session).laneCount++; }],
      ['lane-array-length', session => { session.world.graph.nodes[owner(session).laneSeeds.ref].values.pop(); }],
      ['lane-array-type', session => { const node = session.world.graph.nodes[owner(session).laneSeeds.ref]; node.type = 'Array'; }],
      ['nonfinite-frontier', session => { session.world.graph.nodes[owner(session).frontiers.ref].values[0] = { special: 'Infinity' }; }],
      ['exhausted-tick', session => { owner(session).tickIndex = Number.MAX_SAFE_INTEGER; }],
      ['exhausted-actor', session => { owner(session).nextActorId = Number.MAX_SAFE_INTEGER; }],
      ['actor-frontier', session => { owner(session).nextActorId = 0; }],
      ['actor-method-shadow', session => { actor(session).props.process = 'private qualification sentinel'; }],
      ['actor-runtime', session => { actor(session).props.runtime = { ref: 0 }; }],
      ['actor-null-runtime', session => { actor(session).props.runtime = null; }],
      ['actor-action', session => { actor(session).props.action = { ref: 0 }; }],
      ['duplicate-actor', session => { session.world.graph.nodes.push(structuredClone(actor(session))); }],
      ['exhausted-causal-sequence', session => { session.world.physicalIdentity.causalSequence = Number.MAX_SAFE_INTEGER; }]
    ];
    const outcomes = [];
    for (const [name, mutate] of cases) {
      const session = structuredClone(original); mutate(session); const start = performance.now();
      const accepted = await studio.handlers.import(new File([JSON.stringify(session)], name + '.json', { type: 'application/json' }));
      const status = document.querySelector('.studio-status')?.textContent || '';
      outcomes.push({ name, accepted, durationMs: performance.now() - start, sameWorld: window.__PROCGEN_LANES__.world === world,
        sameProject: studio.getProject() === project, sameDocument: JSON.stringify(studio.getDocumentState()) === documentState,
        sameCheckpoint: JSON.stringify(studio.capture().world) === checkpoint, sameHistory: JSON.stringify(studio.handlers.historyState()) === history,
        sameRoute: readRoute() === route, boundedError: status.length > 0 && status.length < 1000 && !status.includes('private qualification sentinel'), status });
    }
    let reads = 0;
    const oversized = await studio.handlers.import({ size: 64 * 1048576 + 1, text() { reads++; throw new Error('unadmitted read'); }, stream() { reads++; throw new Error('unadmitted stream'); } });
    const sameStored = JSON.stringify(await storage.loadDocument('doc:import-preserved')) === stored; storage.close();
    return { controlAccepted, outcomes, oversized, reads, sameStored };
  });
  expect(result.outcomes).toHaveLength(28);
  for (const outcome of result.outcomes) {
    expect(outcome, outcome.name).toMatchObject({ accepted: false, sameWorld: true, sameProject: true, sameDocument: true,
      sameCheckpoint: true, sameHistory: true, sameRoute: true, boundedError: true });
    expect(outcome.durationMs, outcome.name).toBeLessThan(10000);
  }
  expect(result).toMatchObject({ controlAccepted: true, oversized: false, reads: 0, sameStored: true });
  console.log('PROJECT_IMPORT_ADMISSION_RECEIPT ' + JSON.stringify(result));
  await testInfo.attach('project-import-admission-receipt', { contentType: 'application/json', body: JSON.stringify(result, null, 2) });
});
