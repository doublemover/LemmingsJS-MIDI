import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { setup } from './helpers/workstation-fixture.js';
import { createProcgenOperationView } from '../js/app/procgen/workstation/ProcgenOperationView.js';
import { createProcgenOperationalView } from '../js/app/procgen/workstation/ProcgenOperationalView.js';
import { createProcgenOperationalSnapshot } from '../js/app/procgen/workstation/ProcgenOperationalState.js';
import { deferredRead } from './support/workstation-read-schedules.js';

describe('canonical operation phase and cancellation presentation', () => {
  for (const phase of ['reading', 'validating', 'loading-assets', 'preparing', 'committing', 'finalizing', 'connecting', 'loading-sounds', 'canceling']) it('exposes honest indeterminate ' + phase + ' without a fabricated denominator', () => {
    const value = createProcgenOperationView({ id: 'one', kind: 'import', phase, cancelable: true, blockingScopes: ['project-io'] });
    expect(value).to.include({ progressKind: 'indeterminate', completed: null, total: null, cancelable: !['committing', 'finalizing', 'canceling'].includes(phase) }); expect(Object.isFrozen(value.blockingScopes)).to.equal(true);
  });
  it('keeps current operation IDs and canonical cancellation through actual controller retirement', async () => {
    const f = setup(); f.studio.bindRuntime(); const release = f.holdRestart(), oldWorld = f.runtime.world, pending = f.studio.handlers.new();
    try {
      await Promise.resolve(); await Promise.resolve(); const current = f.studio.getOperationalSnapshot().operations[0]; expect(current).to.include({ kind: 'rebuild', phase: 'preparing', cancelable: true });
      expect(f.viewProps.canCommand('save')).to.equal(false); expect(f.viewProps.canCommand('panicOutput')).to.equal(true);
      expect(f.studio.handlers.cancelOperation('obsolete')).to.equal(false); expect(f.studio.handlers.cancelOperation(current.id)).to.equal(true);
      expect(f.studio.getOperationalSnapshot().operations[0]).to.include({ phase: 'canceling', cancelable: false }); release(); expect(await pending).to.equal(false); expect(f.runtime.world).to.equal(oldWorld); expect(f.studio.getOperationalSnapshot().operations).to.have.length(0);
    } finally { release(); await pending; await f.studio.dispose().completion; }
  });
  it('removes Cancel when the actual publication owner enters commit and refuses a stale button', async () => {
    const dom = new JSDOM('<body><button id="procgenPanic">Panic</button></body>'), document = dom.window.document, canceled = [];
    let current = createProcgenOperationalSnapshot({ operations: [createProcgenOperationView({ id: 'one', kind: 'load', phase: 'preparing', cancelable: true })] });
    const view = createProcgenOperationalView({ document, readSnapshot: () => current, performAction() {}, cancelOperation: id => canceled.push(id) }); document.body.append(view.element); view.render(current);
    try {
      const cancel = view.element.querySelector('[data-operation-id] button'); expect(cancel.hidden).to.equal(false); expect(view.element.querySelector('[role=progressbar]').hasAttribute('aria-valuenow')).to.equal(false);
      current = createProcgenOperationalSnapshot({ operations: [createProcgenOperationView({ id: 'one', kind: 'load', phase: 'committing', cancelable: true })] }); cancel.click(); expect(canceled).to.have.length(0); expect(cancel.hidden).to.equal(true); expect(document.getElementById('procgenPanic').disabled).to.equal(false);
    } finally { view.dispose(); dom.window.close(); }
  });
  it('rejects cancellation after the controller publication owner reports commit', async () => {
    const f = setup(); f.studio.bindRuntime(); const release = f.holdRestart(), pending = f.studio.handlers.new();
    try {
      while (!f.restarts.length) await new Promise(resolve => setImmediate(resolve));
      const lease = f.restarts[0].lease; lease.reportPhase('committing');
      expect(f.studio.getOperationalSnapshot().operations[0]).to.include({ phase: 'committing', cancelable: false }); expect(f.studio.handlers.cancelOperation(lease.id)).to.equal(false);
      release(); expect(await pending).to.equal(true); expect(f.studio.getOperationalSnapshot().operations).to.have.length(0);
    } finally { release(); await pending; await f.studio.dispose().completion; }
  });
  it('reports Save phases from the actual pending prompt and write and never reuses their IDs', async () => {
    const prompt = deferredRead(), write = deferredRead(), f = setup({ storageOverride: { save: () => write.promise, close() {} } }); f.studio.bindRuntime(); f.view.requestProjectName = () => prompt.promise;
    const saving = f.studio.handlers.save();
    try {
      const naming = f.studio.getOperationalSnapshot().operations[0]; expect(naming).to.include({ phase: 'naming', cancelable: false }); expect(f.viewProps.canCommand('save')).to.equal(false);
      prompt.resolve('Operation source');
      while (f.studio.getOperationalSnapshot().operations[0]?.phase !== 'finalizing') await new Promise(resolve => setImmediate(resolve));
      expect(f.studio.getOperationalSnapshot().operations[0]).to.include({ id: naming.id, phase: 'finalizing', cancelable: false }); write.resolve(); expect(await saving).to.equal(true);
      expect(f.studio.getOperationalSnapshot().operations).to.have.length(0);
      const next = f.studio.handlers.save(); expect(f.studio.getOperationalSnapshot().operations[0].id).not.to.equal(naming.id); await next;
    } finally { prompt.resolve('Cleanup'); write.resolve(); await saving; await f.studio.dispose().completion; }
  });
  it('does not publish an old durable-write error into a replacement document', async () => {
    const write = deferredRead(); let entered = false;
    const f = setup({ storageOverride: { save() { entered = true; return write.promise; }, close() {} } }); f.studio.bindRuntime(); const saving = f.studio.handlers.save();
    try {
      while (!entered) await new Promise(resolve => setImmediate(resolve));
      expect(await f.studio.handlers.new()).to.equal(true); const world = f.runtime.world, statuses = f.statuses.length, document = f.studio.getDocumentState();
      write.reject(new Error('Earlier document quota refusal')); expect(await saving).to.equal(false);
      expect(f.statuses).to.have.length(statuses); expect(f.runtime.world).to.equal(world); expect(f.studio.getDocumentState()).to.deep.equal(document);
    } finally { write.resolve(); await saving; await f.studio.dispose().completion; }
  });
});
