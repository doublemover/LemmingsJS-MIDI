import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { expect } from 'chai';
import { createProcgenWorkstation } from '../js/app/procgen/workstation/ProcgenWorkstation.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createMidiProject } from '../js/midi/project/MidiProject.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
const events = () => { const handlers = new Map(); return { addEventListener(type, fn) { const set = handlers.get(type) || new Set(); set.add(fn); handlers.set(type, set); }, removeEventListener(type, fn) { handlers.get(type)?.delete(fn); } }; };
function fixture(masks, resourceBudget = null) {
  let project = createProcgenWorkstationProject(createMidiProject(), { seed: 7, lanes: [{}] }), paused = true;
  const makeRuntime = () => ({ world: new ProcgenLaneWorld({ masks, assists: false, seed: 7, laneCount: 1 }), lanes: { setClockDriven() {}, pump() {}, renderer: { camera: { getState: () => ({ cameraX: 0 }), applyState() {} } } }, view: {} });
  let runtime = makeRuntime(); const statuses = [], listeners = new Set(), document = { ...events(), getElementById: () => null, querySelector: () => null }, window = { ...events(), performance: { now: () => 0 }, location: { search: '' }, localStorage: { getItem: () => null, setItem() {} } };
  const legacy = { settings: { seed: 7, speed: 1, laneCount: 1, assists: false }, getProject: () => project, setProject(value) { project = value; for (const listener of listeners) listener(value); }, subscribeProject(fn) { listeners.add(fn); return () => listeners.delete(fn); }, setPaused(value) { paused = value; }, isPaused: () => paused, setSpeed(value) { this.settings.speed = value; }, local: { getState: () => ({ enabled: false, selectedBackend: 'synth' }) } };
  const studio = createProcgenWorkstation({ document, window, legacy, resourceBudget, getRuntime: () => runtime, restart: async ({ session }) => { const next = makeRuntime(); if (session) restoreProcgenCheckpoint(next.world, session.world); const prior = runtime; runtime = next; prior.world.dispose(); return true; },
    storage: { save: async () => {}, close() {} }, createView: () => ({ render() {}, renderInspector() {}, transport() {}, storage() {}, status(value) { statuses.push(value); }, dispose() {} }), transportOptions: { driver: { start() {}, stop() {} }, lookaheadMs: 0 } });
  studio.bindRuntime(); studio.beforeRestart(); return { studio, statuses, get world() { return runtime.world; } };
}
describe('physical authoring workstation integration', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  it('applies one real boundary and Undo/Redo restore complete paused worlds with pinned project identities', async () => {
    const f = fixture(masks), before = captureProcgenCheckpoint(f.world), beforeTick = f.world.tickIndex, documentId = f.studio.getDocumentState().id;
    const applied = await f.studio.handlers.applyTerrainAuthoring({ operation: 'addSolid', spans: [{ x1: 100, x2: 108, y: 10 }] });
    expect(applied.status).to.equal('accepted'); expect(f.world.hasGroundAt(100, 10)).to.equal(true); expect(f.world.tickIndex).to.equal(beforeTick + 1);
    const after = captureProcgenCheckpoint(f.world); expect(f.studio.transport.getState().playing).to.equal(false);
    expect(await f.studio.handlers.undo()).to.equal(true); expect(captureProcgenCheckpoint(f.world)).to.deep.equal(before); expect(f.studio.getDocumentState().id).to.equal(documentId);
    expect(await f.studio.handlers.redo()).to.equal(true); expect(captureProcgenCheckpoint(f.world)).to.deep.equal(after); expect(f.studio.transport.getState().playing).to.equal(false);
    await f.studio.dispose().completion; f.world.dispose();
  });
  it('refuses graph growth before project, world, or Undo history changes under pressure', async () => {
    const budget = createResourceBudget({ limitBytes: 256 * 1048576 }), f = fixture(masks, budget), before = f.studio.getProject(), tick = f.world.tickIndex, token = {};
    budget.reserve({ token, owner: 'unrelated-active-storage', bytes: budget.diagnostics().limitBytes - budget.diagnostics().accountedBytes - 4096 });
    const graph = { ...before.procgen.physicalGraph, revision: before.procgen.physicalGraph.revision + 1, pickups: [{ id: 'pressure-gate', geometry: { kind: 'segment', points: [{ x: 120, y: 0 }, { x: 120, y: 32 }] } }] };
    expect(() => f.studio.dispatch({ type: 'procgen/physicalGraph', graph })).to.throw('accounted bytes');
    expect(f.studio.getProject()).to.equal(before); expect(f.world.physicalAuthoring.graph.revision).to.equal(before.procgen.physicalGraph.revision); expect(f.world.tickIndex).to.equal(tick);
    budget.release({ token, owner: 'unrelated-active-storage' });
    f.studio.dispatch({ type: 'procgen/physicalGraph', graph }); expect(f.world.physicalAuthoring.graph.pickups[0].id).to.equal('pressure-gate');
    await f.studio.dispose().completion; f.world.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('captures, places, serializes and detaches an immutable geometry fragment without notes', async () => {
    const f = fixture(masks); const captured = f.studio.handlers.capturePhysicalFragment({ id: 'air', bounds: { x1: 100, x2: 108, y1: 10, y2: 18 } }); expect(captured.status).to.equal('captured');
    const preview = f.studio.handlers.previewPhysicalFragment('air', { namespace: 'first', x: 120, y: 10 }); expect(preview.status).to.equal('prepared'); expect(preview.previewHardwareNotes).to.equal(false);
    const receipt = await f.studio.handlers.placePhysicalFragment('air', { namespace: 'first', x: 120, y: 10 }); expect(receipt.status).to.equal('accepted');
    expect(f.studio.getProject().procgen.fragmentInstances[0].fragmentRevision).to.equal(1);
    f.studio.dispatch({ type: 'procgen/detachFragment', instanceId: 'first' }); expect(f.studio.getProject().procgen.fragmentInstances[0].detached).to.equal(true);
    expect(JSON.parse(JSON.stringify(f.studio.getProject())).procgen.fragments[0].runtimeState).to.equal('not-captured'); await f.studio.dispose().completion; f.world.dispose();
  });
});
