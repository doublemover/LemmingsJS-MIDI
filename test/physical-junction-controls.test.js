import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createPhysicalJunctionControls } from '../js/app/procgen/workstation/PhysicalJunctionControls.js';
import { createPhysicalJunctionView } from '../js/app/procgen/workstation/PhysicalJunctionView.js';
import { createProcgenPresentationSnapshot, overlapsProcgenPresentation } from '../js/app/procgen/ProcgenPresentationSnapshot.js';
import { junctionPresentationWorld } from './helpers/junctionPresentationWorld.js';

const fixture = () => {
  const f = junctionPresentationWorld(), dom = new JSDOM('<body><div id="procgenPresentationRoot"><button id="opener">Open</button><aside class="studio-inspector"></aside></div></body>');
  const { document } = dom.window, subscriptions = new Set(), calls = [], saved = [], schedules = [];
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  let available = true, authoring = true, frame = createProcgenPresentationSnapshot({ worldId: f.world.worldId, generation: 1, tick: 0, terrainRevision: 0, revision: 1, projectionRevision: 1,
    rect: { left: 20, top: 100, width: 800, height: 240 }, backingSize: { width: 800, height: 240 }, logicalSize: { width: 800, height: 240 }, originX: 0, viewWidth: 400, laneHeight: 96, layoutKey: 'test',
    rows: [{ lane: 0, sourceY: 0, sourceHeight: 96, destinationY: 0, destinationHeight: 240 }], entities: [{ id: 'actor', kind: 'actor', bounds: { x: 94, y: 58, width: 6, height: 12 } }] });
  const renderer = { world: f.world, resources: f.resources, viewWidth: 400, follow: true, render() {}, camera: { getState: () => ({ cameraX: 0, cameraY: 0, scale: 2, follow: renderer.follow }), applyState(value) { renderer.follow = value.follow; } },
    presentation: { getSnapshot: () => frame, subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn); } } };
  let runtime = { world: f.world, lanes: { renderer } };
  const options = { document, window: dom.window, displayScheduler: { register(spec) { const scope = { spec, disposed: false, invalidate() {}, dispose() { this.disposed = true; } }; schedules.push(scope); return scope; } },
    getRuntime: () => runtime, getDefinitions: () => f.world.physicalJunctions.definitions,
    save: values => saved.push(values), canRequest: () => available, canAuthor: () => authoring,
    request: (id, desired, policy) => { calls.push({ id, desired, policy }); f.state.pending = [{ requestId: 'request:' + calls.length, desiredConfiguration: desired, state: 'waiting', reason: 'actor-footprint', expiryTick: 120 }]; return { status: 'queued' }; },
    cancel: () => { f.state.pending = []; return true; }, onRevealLane: lane => calls.push({ reveal: lane }), onStatus() {} };
  const controls = createPhysicalJunctionControls(options), opener = document.getElementById('opener'); opener.focus();
  const dock = () => document.querySelector('.studio-junction-controls'), floating = () => document.querySelector('.studio-junction-floating');
  const button = (root, label) => [...root.querySelectorAll('button')].find(value => value.textContent === label);
  return { ...f, dom, document, renderer, controls, options, opener, calls, saved, subscriptions, schedules, dock, floating, button,
    busy(value) { available = !value; }, protect(value) { authoring = !value; }, loseFrame() { frame = null; }, replace(next) { runtime = next; }, get frame() { return frame; },
    dispose() { controls.dispose(); dom.window.close(); } };
};

describe('owned physical switchyard controls', () => {
  it('shares one requested destination without moving its applied lever or inventing travel', () => {
    const f = fixture(); try {
      f.controls.open(); const dockSelect = f.dock().querySelector('[aria-label="Dock junction destination"]'), worldSelect = f.floating().querySelector('[aria-label="World junction destination"]');
      dockSelect.value = 'closed'; dockSelect.dispatchEvent(new f.dom.window.Event('change')); expect(worldSelect.value).to.equal('closed');
      f.button(f.floating(), 'Switch request').click(); const submitted = f.calls.filter(value => value.id);
      expect(submitted).to.deep.equal([{ id: 'switch', desired: 'closed', policy: 'waitForSafeBoundary' }]);
      expect(f.dock().querySelector('[data-configuration="open"]').dataset.applied).to.equal('true');
      expect(f.dock().querySelector('[data-configuration="closed"]').dataset.requested).to.equal('true');
      expect(f.dock().textContent).to.include('120 eligible ticks remain').and.include('0 observed inlet-to-outlet');
      f.state.receipts.push({ status: 'superseded', supersededBy: 'request:new', reason: 'uncommitted-last-wins' }); f.controls.refresh(); expect(f.dock().textContent).to.include('superseded').and.include('request:new');
      f.state.actual = { ...f.state.actual, configurationId: 'closed', commandId: 'applied:two' }; f.state.pending = []; f.controls.refresh();
      expect(f.dock().querySelector('[data-configuration="closed"]').dataset.applied).to.equal('true'); expect(f.document.querySelectorAll('.junction-observed')).to.have.length(0);
    } finally { f.dispose(); }
  });
  it('draws only qualified crossings and retains old applied trails separately after a switch', () => {
    const f = fixture(); try {
      f.controls.open(); f.emit([{ from: 89, to: 95 }]); f.emit([{ from: 95, to: 111 }]); f.controls.refresh();
      expect(f.dock().textContent).to.include('1 observed inlet-to-outlet'); expect(f.document.querySelectorAll('.junction-observed')).to.have.length(1);
      expect(f.dock().querySelector('ol').textContent).to.include('Committed movement');
      f.state.actual = { ...f.state.actual, commandId: 'applied:new', configurationId: 'closed' }; f.controls.refresh();
      expect(f.dock().textContent).to.include('0 observed inlet-to-outlet'); expect(f.document.querySelectorAll('.junction-historical')).to.have.length(1);
    } finally { f.dispose(); }
  });
  it('keeps anchor hit rectangles clear of actor selection and owns camera focus until leaving its controls', () => {
    const f = fixture(); try {
      const other = f.document.createElement('section'); f.document.querySelector('.studio-inspector').append(other);
      f.controls.open(); expect(f.renderer.junctionInspectionOwner).to.exist;
      expect(other.hidden).to.equal(true); expect(other.inert).to.equal(true);
      const anchor = f.document.querySelector('.studio-junction-anchor'); expect(anchor.hidden).to.equal(false);
      expect(overlapsProcgenPresentation(f.frame, { left: parseFloat(anchor.style.left) - 22, top: parseFloat(anchor.style.top) - 22, width: 44, height: 44 })).to.equal(false);
      f.dock().querySelector('select').focus(); expect(f.renderer.junctionInspectionOwner).to.exist;
      f.opener.focus(); expect(f.renderer.junctionInspectionOwner).to.equal(undefined);
      f.controls.suspend(); expect(other.hidden).to.equal(false); expect(other.inert).to.equal(false); expect(f.resources.held.size).to.equal(0); expect(f.subscriptions.size).to.equal(0); expect(f.world.soundEvents.onBatch.handlers.size).to.equal(0); expect(f.document.activeElement).to.equal(f.opener);
    } finally { f.dispose(); }
  });
  it('disables busy or unpresented requests, keeps paused eligibility tick-based, and protects Stage authoring', () => {
    const f = fixture(); try {
      f.controls.open(); f.state.pending = [{ requestId: 'waiting', desiredConfiguration: 'closed', state: 'waiting', reason: 'unknown-actor-footprint', expiryTick: 120 }];
      f.controls.refresh(); const before = f.dock().textContent; f.controls.refresh(); expect(f.dock().textContent).to.equal(before);
      f.busy(true); f.protect(true); f.controls.refresh(); expect(f.button(f.dock(), 'Switch request').disabled).to.equal(true); expect(f.button(f.dock(), 'Edit definitions…').disabled).to.equal(true);
      f.busy(false); f.loseFrame(); f.controls.refresh(); expect(f.button(f.dock(), 'Switch request').disabled).to.equal(true); expect(f.dock().textContent).to.include('coherent world display');
    } finally { f.dispose(); }
  });
  it('fences detached JSON editor commands and cancels uncommitted requests without changing applied geometry', () => {
    const f = fixture(); try {
      f.controls.open(); f.button(f.dock(), 'Edit definitions…').click(); const old = f.document.querySelector('dialog'); const oldSave = f.button(old, 'Save definitions'); f.button(old, 'Cancel').click();
      f.button(f.dock(), 'Edit definitions…').click(); oldSave.click(); expect(f.saved).to.have.length(0); f.button(f.document.querySelector('dialog'), 'Save definitions').click(); expect(f.saved).to.have.length(1);
      f.state.pending = [{ requestId: 'pending', desiredConfiguration: 'closed', state: 'requested', expiryTick: 120 }]; f.controls.refresh(); f.button(f.dock(), 'Cancel pending').click();
      expect(f.state.pending).to.have.length(0); expect(f.state.actual.configurationId).to.equal('open');
      const oldRequest = f.button(f.dock(), 'Switch request'); f.controls.suspend(); const count = f.calls.length; oldRequest.click(); expect(f.calls).to.have.length(count);
    } finally { f.dispose(); }
  });
  it('retires old source observers and refuses detached world anchors after replacement', () => {
    const f = fixture(); try {
      f.controls.open(); const old = f.document.querySelector('.studio-junction-anchor'), next = junctionPresentationWorld(); next.world.generation = 2;
      const renderer = { ...f.renderer, world: next.world, resources: next.resources }; f.replace({ world: next.world, lanes: { renderer } }); f.controls.refresh();
      const count = f.calls.length; old.click(); expect(f.calls).to.have.length(count); expect(f.resources.held.size).to.equal(0); expect(f.world.soundEvents.onBatch.handlers.size).to.equal(0);
      f.controls.dispose(); expect(next.resources.held.size).to.equal(0); expect(next.world.soundEvents.onBatch.handlers.size).to.equal(0);
    } finally { f.dispose(); }
  });
  it('refuses a held request after a source transition and clears applied labels while the world is absent', () => {
    const f = fixture(); try {
      f.controls.open(); const request = f.button(f.dock(), 'Switch request');
      request.dispatchEvent(new f.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      f.replace({ world: null, lanes: {} }); f.controls.refresh(); expect(f.dock().textContent).to.include('Waiting for a committed world'); expect(f.dock().querySelectorAll('[data-applied=true]')).to.have.length(0);
      f.replace({ world: f.world, lanes: { renderer: f.renderer } }); f.controls.refresh(); const count = f.calls.filter(value => value.id).length;
      request.click(); expect(f.calls.filter(value => value.id)).to.have.length(count); expect(f.dock().textContent).to.include('reviewed switch control changed');
      request.dispatchEvent(new f.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0 })); request.click(); expect(f.calls.filter(value => value.id)).to.have.length(count + 1);
    } finally { f.dispose(); }
  });
  it('cancels a lazy open before allocation and reopens only for its committed source', async () => {
    const f = fixture(), view = createPhysicalJunctionView(f.options); try {
      const pending = view.open(); view.suspend(); expect(await pending).to.equal(false); expect(f.resources.held.size).to.equal(0);
      expect(await view.open()).to.equal(true); view.dispose(); expect(f.resources.held.size).to.equal(0); expect(f.world.soundEvents.onBatch.handlers.size).to.equal(0);
    } finally { view.dispose(); f.dispose(); }
  });
});
