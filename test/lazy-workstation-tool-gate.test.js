import { expect } from 'chai';
import { createLazyWorkstationToolGate } from '../js/app/procgen/workstation/LazyWorkstationToolGate.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const fixture = () => {
  let identity = 'document:1:lane:1:world:1', interaction = {}; const opened = [], errors = [];
  const gate = createLazyWorkstationToolGate({ getIdentity: () => identity, getInteraction: () => interaction, onError: (name, error) => errors.push([name, error.message]) });
  return { gate, opened, errors, setIdentity(value) { identity = value; }, setInteraction(value) { interaction = value; }, apply: value => { opened.push(value); return true; } };
};
describe('deferred creative tool publication', () => {
  it('publishes the loaded module only into its original live workstation context', async () => {
    const f = fixture(), pending = deferred(); const open = f.gate.open('Tool', () => pending.promise, f.apply);
    expect(f.opened).to.deep.equal([]); pending.resolve({ actual: 'module' }); expect(await open).to.equal(true);
    expect(f.opened).to.deep.equal([{ actual: 'module' }]); expect(f.errors).to.deep.equal([]);
  });
  it('lets the latest explicit tool request win without opening the earlier module', async () => {
    const f = fixture(), pending = deferred(); const older = f.gate.open('Older', () => pending.promise, f.apply);
    expect(await f.gate.open('Newer', async () => 'new module', f.apply)).to.equal(true); pending.resolve('old module');
    expect(await older).to.equal(false); expect(f.opened).to.deep.equal(['new module']);
  });
  it('does not publish a late result or error after document, lane or world identity changes', async () => {
    for (const failed of [false, true]) {
      const f = fixture(), pending = deferred(), open = f.gate.open('Tool', () => pending.promise, f.apply);
      f.setIdentity('document:2:lane:3:world:4'); if (failed) pending.reject(new Error('Old module failure')); else pending.resolve('old module');
      expect(await open).to.equal(false); expect(f.opened).to.deep.equal([]); expect(f.errors).to.deep.equal([]);
    }
  });
  it('cancels Escape or retired requests and refuses any new loading after disposal', async () => {
    for (const disposed of [false, true]) {
      const f = fixture(), pending = deferred(), open = f.gate.open('Tool', () => pending.promise, f.apply);
      if (disposed) f.gate.dispose(); else f.gate.cancel(); pending.resolve('late'); expect(await open).to.equal(false);
      expect(f.opened).to.deep.equal([]);
      if (disposed) { let loads = 0; expect(await f.gate.open('Later', async () => { loads++; }, f.apply)).to.equal(false); expect(loads).to.equal(0); }
    }
  });
  it('does not steal a newer dialog, background tab or changed connected focus', async () => {
    const originalFocus = { isConnected: true };
    for (const current of [{ hidden: true }, { dialog: {} }, { focus: { isConnected: true } }]) {
      const f = fixture(), pending = deferred(); f.setInteraction({ focus: originalFocus });
      const open = f.gate.open('Tool', () => pending.promise, f.apply); f.setInteraction(current); pending.resolve('module');
      expect(await open).to.equal(false); expect(f.opened).to.deep.equal([]);
    }
  });
  it('permits a deliberate child handoff after its originating dialog closes', async () => {
    const f = fixture(), pending = deferred(), focus = { isConnected: true }, dialog = {}, body = {};
    f.setInteraction({ focus, dialog, body }); const open = f.gate.open('Tool', () => pending.promise, f.apply);
    focus.isConnected = false; f.setInteraction({ focus: body, body }); pending.resolve('child module');
    expect(await open).to.equal(true); expect(f.opened).to.deep.equal(['child module']);
  });
  it('keeps module and view failures local without allowing a failed observer to publish', async () => {
    const f = fixture(); expect(await f.gate.open('Missing', async () => { throw new Error('Module unavailable'); }, f.apply)).to.equal(false);
    expect(await f.gate.open('Invalid', async () => 'module', () => { throw new Error('View unavailable'); })).to.equal(false);
    expect(f.errors).to.deep.equal([['Missing', 'Module unavailable'], ['Invalid', 'View unavailable']]); expect(f.opened).to.deep.equal([]);
    const gate = createLazyWorkstationToolGate({ getIdentity: () => 'current', onError() { throw new Error('Status refused'); } });
    expect(await gate.open('Tool', async () => { throw new Error('Module unavailable'); }, f.apply)).to.equal(false);
  });
});
