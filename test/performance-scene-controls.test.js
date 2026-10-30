import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createPerformanceSceneControlView } from '../js/app/procgen/workstation/PerformanceSceneControlView.js';

const fixture = ({ macros = false, cavity = false } = {}) => {
  const dom = new JSDOM('<body></body>'), document = dom.window.document, calls = [], schedule = { retired: 0 }, state = { actual: { configurationId: 'direct', status: 'applied' }, pending: [], receipts: [], authoringRevision: 1 };
  const scene = { title: 'A finite authored score', physicalControls: [{ id: 'spacing', label: 'SPACING', minimum: 12, maximum: 192, step: 6, initial: 54, target: 'release-gesture:nominalGapTicks;next-cohort' }, { id: 'return', label: 'RETURN', target: 'junction:return-path;explicit-request' }, { id: 'snap', label: 'SNAP · next onset', unit: 'normalized', minimum: 0, maximum: 1, step: 0.01, target: 'patch-macro:snap;next-onset-only' }] };
  const world = { generation: 1, population: { releaseGesture: { id: 'original', revision: 1, nominalGapTicks: 54, finiteBurstCount: 3, paused: false }, pendingReleaseGesture: null }, physicalJunctions: { definitions: [{ id: 'return-path', revision: 1, configurations: [{ id: 'direct' }, { id: 'stepped' }] }] }, queryJunction: () => state };
  if (cavity) scene.physicalControls = [{ id: 'size', label: 'Chamber side', minimum: 8, maximum: 16, step: 8, initial: 8, scope: 'geometry', target: 'cavity-square:96:80:8:16' }];
  world.interventionState = { receipts: [] };
  let currentScene = scene, currentWorld = world; const macroState = { sceneHash: 'a'.repeat(64), value01: 0.5, targets: [{ laneId: 'one' }, { laneId: 'two' }], error: null };
  const view = createPerformanceSceneControlView({ document, parent: document.body, displayScheduler: { register() { return { invalidate() {}, dispose() { schedule.retired++; } }; } }, getScene: () => currentScene, getWorld: () => currentWorld,
    ...(cavity ? { performCavityEdit: input => { calls.push(['cavity', input]); return { status: 'queued', transactionId: 'cavity:1' }; } } : {}),
    ...(macros ? { getSceneMacroState: () => { if (macroState.error) throw new Error(macroState.error); return macroState; }, performSceneMacro: input => { calls.push(['macro', input]); macroState.value01 = input.value01; return { status: 'committed' }; } } : {}),
    performReleaseGesture: gesture => { calls.push(['spacing', gesture]); return { status: 'queued' }; }, requestJunction: (...args) => { calls.push(['junction', ...args]); state.pending = [{ desiredConfiguration: args[1], state: 'waiting-safe-boundary' }]; return { status: 'queued' }; }, openControl: (...args) => calls.push(['editor', ...args]) });
  const button = text => [...view.element.querySelectorAll('button')].find(value => value.textContent === text);
  return { dom, view, world, scene, state, calls, schedule, button, document, macroState, replace(scene, world) { currentScene = scene; currentWorld = world; }, dispose() { const receipt = view.dispose(); dom.window.close(); return receipt; } };
};

describe('active physical score controls (UI fixtures authored; runtime acceptance deferred)', () => {
  it('uses the captured chamber input owner and reports a queued edit separately from authoritative application', () => {
    const f = fixture({ cavity: true }); try { const before = JSON.stringify(f.world), input = f.view.element.querySelector('input'); input.value = '16'; const oldButton = f.button('Request chamber edit'); oldButton.click(); expect(f.calls[0]).to.deep.equal(['cavity', { scene: f.scene, world: f.world, controlId: 'size', value: 16 }]); expect(JSON.stringify(f.world)).to.equal(before); f.view.refresh(); expect(f.view.element.textContent).to.include('Waiting for physical commit'); f.world.interventionState.receipts.push({ transactionId: 'cavity:1', status: 'rejected', reason: 'occupied' }); f.view.refresh(); expect(f.view.element.textContent).to.include('rejected · occupied'); f.world.generation++; oldButton.click(); expect(f.calls).to.have.length(1); } finally { f.dispose(); }
  });
  it('disables chamber editing without a captured input owner instead of directly mutating the world', () => {
    const f = fixture(); try { f.replace({ ...f.scene, physicalControls: [{ id: 'size', label: 'Chamber side', minimum: 8, maximum: 16, step: 8, initial: 8, target: 'cavity-square:96:80:8:16' }] }, f.world); f.view.refresh(); expect(f.button('Request chamber edit').disabled).to.equal(true); f.button('Request chamber edit').click(); expect(f.calls).to.have.length(0); } finally { f.dispose(); }
  });
  it('applies the complete authored macro through its canonical transaction and projects mixed or unavailable values honestly', () => {
    const f = fixture({ macros: true }); try {
      const original = JSON.stringify(f.world), input = [...f.view.element.querySelectorAll('input')].find(input => input.getAttribute('aria-label').startsWith('SNAP')); input.value = '0.8'; f.button('Apply to later onsets').click(); f.view.refresh();
      expect(f.calls[0]).to.deep.equal(['macro', { sceneHash: 'a'.repeat(64), controlId: 'snap', value01: 0.8 }]); expect(JSON.stringify(f.world)).to.equal(original); expect(f.view.element.textContent).to.include('Saved value: 0.8');
      f.macroState.value01 = null; f.view.refresh(); expect(f.view.element.textContent).to.include('Mixed saved values'); f.macroState.error = 'The authored patch was replaced.'; f.view.refresh(); expect(f.button('Apply to later onsets').disabled).to.equal(true); expect(f.view.element.textContent).to.include('patch was replaced');
    } finally { f.dispose(); }
  });
  it('performs only the requested next-cohort spacing and projects the actual policy separately', () => {
    const f = fixture(); try {
      const input = f.view.element.querySelector('input'), original = JSON.stringify(f.world.population.releaseGesture); input.value = '108'; f.button('Request spacing').click();
      expect(f.calls[0]).to.deep.equal(['spacing', { ...f.world.population.releaseGesture, nominalGapTicks: 108 }]); expect(JSON.stringify(f.world.population.releaseGesture)).to.equal(original); expect(f.view.element.textContent).to.include('Realized spacing: 54 ticks');
      f.world.population.pendingReleaseGesture = { ...f.world.population.releaseGesture, nominalGapTicks: 108 }; f.view.refresh(); expect(f.view.element.textContent).to.include('pending: 108 ticks'); input.value = '999'; f.button('Request spacing').click(); expect(f.calls).to.have.length(1);
    } finally { f.dispose(); }
  });
  it('uses exact configuration IDs and a safe request without reporting the pending route as realized', () => {
    const f = fixture(); try {
      const select = f.view.element.querySelector('select'); select.value = 'stepped'; f.button('Request safe route').click(); f.view.refresh(); expect(f.calls[0]).to.deep.equal(['junction', 'return-path', 'stepped', 'waitForSafeBoundary']); expect(f.view.element.textContent).to.include('Realized: direct'); expect(f.view.element.textContent).to.include('pending: stepped');
      f.state.actual.configurationId = 'stepped'; f.state.pending = []; f.view.refresh(); expect(f.view.element.textContent).to.include('Realized: stepped'); expect(f.view.element.textContent).not.to.include('pending: stepped');
    } finally { f.dispose(); }
  });
  it('performs entry spread independently from nominal spacing and keeps the finite actor promise', () => {
    const f = fixture(); try { f.scene.physicalControls[0].target = 'release-gesture:spreadTicks;next-cohort'; f.world.population.releaseGesture.spreadTicks = 0; f.replace({ ...f.scene }, f.world); f.view.refresh(); f.view.element.querySelector('input').value = '24'; f.button('Request spread').click(); expect(f.calls[0][1]).to.deep.equal({ ...f.world.population.releaseGesture, spreadTicks: 24 }); expect(f.calls[0][1].finiteBurstCount).to.equal(3); expect(f.calls[0][1].nominalGapTicks).to.equal(54); expect(f.view.element.textContent).to.include('Realized spread: 0 ticks'); } finally { f.dispose(); }
  });
  it('refuses stale world generations and definitions before dispatch and refreshes an explicitly changed definition', () => {
    const f = fixture(); try {
      const oldButton = f.button('Request safe route'); f.world.generation++; oldButton.click(); expect(f.calls).to.have.length(0); f.view.refresh(); f.world.physicalJunctions.definitions[0] = { ...f.world.physicalJunctions.definitions[0], revision: 2 }; f.button('Request safe route').click(); expect(f.calls).to.have.length(0); f.state.authoringRevision = 2; f.view.refresh(); expect(f.button('Request safe route').disabled).to.equal(false); oldButton.click(); expect(f.calls).to.have.length(0);
    } finally { f.dispose(); }
  });
  it('opens deep controls through their existing editor and leaves source history and world state untouched', () => {
    const f = fixture(); try { f.button('Open SNAP').click(); expect(f.calls[0]).to.deep.equal(['editor', f.scene.physicalControls[2], f.scene]); expect(f.world.population.pendingReleaseGesture).to.equal(null); expect(f.state.pending).to.have.length(0); } finally { f.dispose(); }
  });
  it('removes all accepted listeners and display ownership when the active score changes or the view retires', async () => {
    const f = fixture(), oldButton = f.button('Request spacing'); f.replace(null, null); f.view.refresh(); expect(f.view.element.hidden).to.equal(true); oldButton.click(); expect(f.calls).to.have.length(0); const receipt = f.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.schedule.retired).to.equal(1); expect(f.document.querySelector('.studio-scene-controls')).to.equal(null);
  });
});
