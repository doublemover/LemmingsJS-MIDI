import { expect } from 'chai';
import { ProcgenPresentationHost } from '../js/app/procgen/ProcgenPresentationHost.js';
import { createProcgenWorldInspector } from '../js/app/procgen/workstation/ProcgenWorldInspector.js';
import { procgenWorldToScreen } from '../js/app/procgen/ProcgenPresentationSnapshot.js';
import { EventHandler } from '../js/util/EventHandler.js';
import { TestDocument } from './helpers/test-dom.js';

const fixture = () => {
  const document = new TestDocument(), originalCreate = document.createElement.bind(document);
  document.createElement = tag => { const element = originalCreate(tag); element.removeEventListener = (name, fn) => element.listeners.set(name, (element.listeners.get(name) || []).filter(value => value !== fn)); return element; };
  const canvas = document.createElement('canvas'), parent = document.createElement('aside'), reservations = new Map(), actors = new Map(), reveals = [];
  let rect = { left: 20, top: 30, width: 400, height: 304 }, denied = false;
  canvas.width = 1200; canvas.height = 912; canvas.getBoundingClientRect = () => rect;
  const renderer = { canvas, window: { devicePixelRatio: 1.5 }, lifecycleState: 'ready', presentationDpr: 1.5, originX: 100, viewWidth: 400, laneHeight: 96,
    workstationLayout: { mode: 'strip', firstLane: 2, count: 2, rowHeight: 304, stripHeight: 16 },
    workstationRows: [{ lane: 2, sourceY: 210, sourceHeight: 72, destinationY: 0, destinationHeight: 288 }, { lane: 3, sourceY: 300, sourceHeight: 72, destinationY: 304, destinationHeight: 288 }],
    world: { worldId: 'world', generation: 1, tickIndex: 5, laneCount: 8, terrainRevision: 0, soundEvents: { onBatch: new EventHandler() } },
    resources: { retain(key, bytes) { if (denied) throw new Error('Budget denied'); reservations.set(key, bytes); }, release(key) { reservations.delete(key); } },
    camera: { state: { cameraX: 100, cameraY: 192, scale: 2, follow: false }, getState() { return this.state; }, applyState(state) { this.state = state; }, viewport: () => ({ width: 400, height: 192 }) }
  };
  renderer.actorVisibility = { world: renderer.world, actorById: id => actors.get(id) || null };
  renderer.entities = [2, 9].map(actorId => ({ id: `1:actor:${actorId}`, kind: 'actor', actorId, lane: 2, label: `Actor ${actorId}`, action: 'Walking', bounds: { x: 200, y: 230, width: 10, height: 10 } }));
  for (const actorId of [2, 9]) actors.set(actorId, { id: actorId, x: 205, y: 235, laneIndex: 2, action: { actionName: 'Walking' } });
  const host = new ProcgenPresentationHost(renderer); renderer.presentation = host;
  renderer.render = () => host.publish(renderer.entities); renderer.setWorldSelection = (id, { render = true } = {}) => { renderer.selectedWorldEntityId = id; if (render) renderer.render(); };
  const inspector = () => createProcgenWorldInspector({ renderer, document, parent, getLaneInfo: lane => ({ name: `Music ${lane}`, role: 'melody', family: 'classic', mode: 'physical' }), onRevealLane: lane => reveals.push(lane) });
  return { document, canvas, parent, renderer, host, reservations, actors, reveals, inspector, rect: value => { rect = value; }, deny: value => { denied = value; }, point: () => procgenWorldToScreen(host.getSnapshot(), 205, 235, 2) };
};

describe('ProcGen presentation admission and retention', () => {
  it('requests geometry-only repaint when the last retained entity inspection lease retires', () => {
    const f = fixture(), geometry = f.host.subscribe(() => {}, { entities: false }), inspect = f.host.subscribe(() => {}); f.renderer.render();
    const lease = f.host.acquire('held-inspection'); inspect(); expect(f.host.entitiesDemanded).to.equal(true); const before = f.host.demandRevision;
    lease.release(); expect(f.host.entitiesDemanded).to.equal(false); expect(f.host.demandRevision).to.be.greaterThan(before); geometry(); f.host.dispose(); expect(f.reservations.size).to.equal(0);
  });
  it('supports geometry-only consumers without demanding entities and requires a fresh frame before full inspection', () => {
    const f = fixture(), geometry = f.host.subscribe(() => {}, { entities: false });
    expect(f.host.demanded).to.equal(true); expect(f.host.entitiesDemanded).to.equal(false); f.host.publish([]);
    expect(f.host.getSnapshot().entities).to.have.length(0); expect(f.host.acquire('entity-inspector')).to.equal(null);
    const inspect = f.host.subscribe(() => {}); expect(f.host.entitiesDemanded).to.equal(true); expect(f.host.getSnapshot()).to.equal(null);
    f.renderer.render(); expect(f.host.getSnapshot().entities).to.have.length(2); const lease = f.host.acquire('entity-inspector'); expect(lease).not.to.equal(null);
    lease.release(); inspect(); expect(f.host.entitiesDemanded).to.equal(false); geometry(); expect(f.reservations.size).to.equal(0); f.host.dispose();
  });
  it('requires accepted visible paint and rejects every edit lease', () => {
    const f = fixture(); expect(f.host.acquire('tool')).to.equal(null);
    const release = f.host.subscribe(() => {}); f.renderer.render();
    expect(f.host.acquire('field-editor', { purpose: 'edit' })).to.equal(null);
    const lease = f.host.acquire('inspect'); expect(f.host.accepts(lease)).to.equal(true);
    expect(f.host.valid(lease.snapshot, { edit: true })).to.equal(false); lease.release(); release();
    expect(f.reservations.size).to.equal(0); f.host.dispose();
  });
  it('retains an immutable frozen inspection mapping across ordinary actor/camera motion', () => {
    const f = fixture(), release = f.host.subscribe(() => {}); f.renderer.render();
    const point = f.point(), lease = f.host.acquire('pointer'), old = lease.snapshot;
    f.renderer.originX = 400; f.renderer.entities = []; f.renderer.world.tickIndex++; f.renderer.render();
    expect(f.host.accepts(lease)).to.equal(true); expect(f.host.pick(point.x, point.y, lease)[0].actorId).to.equal(2);
    expect(old.originX).to.equal(100); expect(f.reservations.size).to.equal(2);
    lease.release(); expect(f.reservations.size).to.equal(1); release(); f.host.dispose(); expect(f.reservations.size).to.equal(0);
  });
  it('cancels stale DOM extent, page, backing, generation, and display-loss leases', () => {
    const mutations = [f => f.rect({ left: 21, top: 30, width: 400, height: 304 }), f => { f.renderer.workstationLayout.firstLane = 3; },
      f => { f.canvas.width++; }, f => { f.renderer.world.generation++; }, f => { f.renderer.lifecycleState = 'lost'; }];
    for (const mutate of mutations) {
      const f = fixture(), release = f.host.subscribe(() => {}); f.renderer.render(); const lease = f.host.acquire('pointer'); mutate(f);
      expect(f.host.accepts(lease)).to.equal(false); expect(f.host.pick(220, 80, lease)).to.deep.equal([]); expect(f.host.getSnapshot()).to.equal(null);
      expect(lease.active).to.equal(false); expect(f.reservations.size).to.equal(0); release(); f.host.dispose();
    }
  });
  it('suspends nested transition owners until a complete post-transition frame is accepted', () => {
    const f = fixture(), release = f.host.subscribe(() => {}); f.renderer.render();
    const lease = f.host.acquire('pointer'), fullscreen = f.host.suspend('fullscreen', 'Fullscreen transition'), dock = f.host.suspend('dock', 'Dock transition');
    expect(lease.active).to.equal(false); expect(f.host.getStatus()).to.include({ available: false, suspended: true });
    expect(f.renderer.render()).to.equal(null); expect(f.host.acquire('pointer')).to.equal(null);
    fullscreen(); fullscreen(); expect(f.host.getStatus().suspended).to.equal(true); expect(f.renderer.render()).to.equal(null);
    f.rect({ left: 0, top: 0, width: 800, height: 608 }); dock();
    expect(f.host.getStatus()).to.include({ available: false, suspended: false }); expect(f.renderer.lastFrameKey).to.equal(null);
    f.renderer.render(); expect(f.host.getSnapshot().rect.width).to.equal(800); expect(f.host.acquire('pointer').active).to.equal(true);
    f.host.dispose(); release(); fullscreen(); dock(); expect(f.reservations.size).to.equal(0);
  });
  it('bounds suspension owners and permits late releases after disposal', () => {
    const f = fixture(), releases = Array.from({ length: 8 }, (_, id) => f.host.suspend(`owner${id}`));
    expect(f.host.suspend('overflow')).to.equal(null); f.host.dispose(); for (const release of releases) expect(release).not.to.throw();
  });
  it('caps retained gestures and fails inspection admission without breaking rendering', () => {
    const f = fixture(), release = f.host.subscribe(() => {}); f.renderer.render();
    const leases = Array.from({ length: 32 }, () => f.host.acquire('pointer'));
    expect(f.host.acquire('overflow')).to.equal(null); for (const lease of leases) lease.release();
    f.deny(true); expect(() => f.renderer.render()).not.to.throw(); expect(f.host.getStatus().reason).to.include('budget');
    expect(f.host.acquire('pointer')).to.equal(null); expect(f.reservations.size).to.equal(0); release(); f.host.dispose();
  });
});

describe('ProcGen world inspector selection', () => {
  it('cycles overlaps and exposes the same identities through native keyboard buttons', () => {
    const f = fixture(), ui = f.inspector(), point = f.point();
    ui.cycle(point.x, point.y); expect(ui.getState().selection.actorId).to.equal(2);
    ui.cycle(point.x, point.y); expect(ui.getState().selection.actorId).to.equal(9);
    const buttons = f.parent.querySelectorAll('.studio-world-entities')[0].children;
    expect(buttons.map(element => element.dataset.entityId)).to.deep.equal(['1:actor:2', '1:actor:9']);
    buttons[0].dispatchEvent({ type: 'click' }); expect(ui.getState().selection.actorId).to.equal(2);
    expect(f.renderer.camera.getState().follow).to.equal(false); expect(f.reveals).to.deep.equal([]);
    expect(f.renderer.world.tickIndex).to.equal(5); ui.dispose(); expect(f.reservations.size).to.equal(0);
  });
  it('keeps offscreen identity pinned and only pages on explicit Reveal', () => {
    const f = fixture(), ui = f.inspector(); ui.select('1:actor:2');
    f.actors.get(2).x = 900; f.actors.get(2).y = 610; f.actors.get(2).laneIndex = 6;
    f.renderer.entities = []; f.renderer.render();
    expect(ui.getState().selection.actorId).to.equal(2); expect(f.reveals).to.deep.equal([]);
    expect(f.parent.querySelectorAll('.studio-world-selection')[0].textContent).to.include('Offscreen');
    expect(ui.reveal()).to.equal(true); expect(f.reveals).to.deep.equal([6]); expect(f.renderer.inspectionRowAnchor).to.deep.equal({ lane: 6, worldY: 610 });
    expect(f.renderer.camera.getState().follow).to.equal(false); ui.dispose();
  });
  it('keeps final identity with terminal reason and offers a survivor explicitly', () => {
    const f = fixture(), ui = f.inspector(); ui.select('1:actor:2');
    f.renderer.world.soundEvents.onBatch.trigger({ worldId: 'world', generation: 1, facts: [{ kind: 'ActorTerminated', actorId: 2, terminationReason: 'drowned' }] });
    f.actors.delete(2); f.renderer.entities = f.renderer.entities.filter(entity => entity.actorId !== 2); f.renderer.render();
    expect(ui.getState().selection.actorId).to.equal(2); expect(ui.getState().selection.finalReason).to.equal('drowned'); expect(ui.getState().nearestId).to.equal('1:actor:9');
    expect(ui.reveal()).to.equal(false); expect(f.parent.querySelectorAll('.studio-world-selection')[0].textContent).to.include('drowned');
    ui.select(ui.getState().nearestId); expect(ui.getState().selection.actorId).to.equal(9); ui.dispose();
  });
  it('uses one owning pointer and cancels dragged or stale-rect inspection gestures', () => {
    const f = fixture(), ui = f.inspector(), point = f.point();
    const down = pointerId => f.canvas.dispatchEvent({ type: 'pointerdown', button: 0, pointerId, clientX: point.x, clientY: point.y });
    const up = pointerId => f.canvas.dispatchEvent({ type: 'pointerup', pointerId, clientX: point.x, clientY: point.y });
    down(1); up(2); expect(ui.getState().selection).to.equal(null); up(1); expect(ui.getState().selection.actorId).to.equal(2);
    ui.clear(); down(1); f.canvas.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: point.x + 5, clientY: point.y }); up(1); expect(ui.getState().selection).to.equal(null);
    down(1); f.rect({ left: 22, top: 30, width: 400, height: 304 }); up(1); expect(ui.getState().selection).to.equal(null); expect(f.host.getStatus().leases).to.equal(0); ui.dispose();
  });
  it('clears generation identities and removes every owned listener on repeated disposal', () => {
    const f = fixture(), ui = f.inspector(); ui.select('1:actor:2');
    f.renderer.world.generation = 2; f.renderer.render(); expect(ui.getState().selection).to.equal(null); expect(f.renderer.selectedWorldEntityId).to.equal(null);
    ui.dispose(); ui.dispose(); expect(f.parent.children.length).to.equal(0); expect(f.renderer.world.soundEvents.onBatch.handlers.size).to.equal(0);
    expect([...f.canvas.listeners.values()].every(values => values.length === 0)).to.equal(true); expect(f.host.getStatus().leases).to.equal(0); expect(f.reservations.size).to.equal(0);
  });
  it('bounds visible keyboard DOM nodes and reports unavailable inspection clearly', () => {
    const f = fixture(); f.renderer.entities = Array.from({ length: 200 }, (_, actorId) => ({ id: `1:actor:${actorId}`, kind: 'actor', actorId, label: `Actor ${actorId}`, bounds: { x: 200, y: 230, width: 2, height: 2 } }));
    const ui = f.inspector(); expect(f.parent.querySelectorAll('.studio-world-entities')[0].children.length).to.equal(32);
    f.host.invalidate('Display lost.'); expect(f.parent.querySelectorAll('.studio-world-capability')[0].textContent).to.include('Display lost.');
    expect(ui.getState().available).to.equal(false); ui.dispose();
  });
});
