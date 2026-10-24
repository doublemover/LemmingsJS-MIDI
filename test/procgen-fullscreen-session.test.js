import { expect } from 'chai';
import { createProcgenFullscreenSession } from '../js/app/procgen/workstation/ProcgenFullscreenSession.js';

const fixture = () => {
  const listeners = new Map(), calls = [];
  const control = { isConnected: true, setAttribute(name, value) { calls.push([name, value]); }, focus() { calls.push('focus-control'); } };
  const prior = { isConnected: true, focus() { calls.push('focus-prior'); } };
  const root = { isConnected: true, contains: target => target === prior,
    requestFullscreen() { calls.push('request'); return Promise.resolve(); } };
  const document = { fullscreenElement: null, activeElement: prior, body: {},
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    exitFullscreen() { calls.push('exit'); this.fullscreenElement = null; listeners.get('fullscreenchange')?.(); return Promise.resolve(); } };
  const session = createProcgenFullscreenSession({ document, root, control, getGeneration: () => 7,
    onTransition: state => calls.push(state), onReflow: () => calls.push('reflow'), onStatus: message => calls.push(message), focusFallback: () => control });
  return { document, root, control, prior, session, listeners, calls };
};

describe('ProcGen fullscreen presentation session', () => {
  it('uses actual document ownership and reconciles external exit without changing the instrument', async () => {
    const f = fixture();
    expect(await f.session.enter()).to.equal(false);
    expect(f.session.getState().entered).to.equal(false);
    f.document.fullscreenElement = f.root; f.listeners.get('fullscreenchange')();
    expect(f.session.getState().state).to.equal('entered');
    f.document.activeElement = f.control;
    f.document.fullscreenElement = null; f.listeners.get('fullscreenchange')();
    expect(f.session.getState().state).to.equal('idle');
    expect(f.calls).to.include('exiting');
    expect(f.calls).to.include('focus-prior');
    f.session.dispose();
  });

  it('queues rapid exit until a pending request actually enters', async () => {
    const f = fixture();
    let resolve;
    f.root.requestFullscreen = () => new Promise(done => { resolve = done; });
    const entering = f.session.enter();
    await f.session.toggle();
    f.document.fullscreenElement = f.root; f.listeners.get('fullscreenchange')(); resolve();
    await entering;
    expect(f.calls).to.include('exit');
    expect(f.session.getState().entered).to.equal(false);
    f.session.dispose();
  });

  it('keeps request failure and disposed late completion from restoring stale focus', async () => {
    const f = fixture();
    f.root.requestFullscreen = () => Promise.reject(new Error('activation expired'));
    expect(await f.session.enter()).to.equal(false);
    expect(f.session.getState().state).to.equal('failed');
    expect(f.calls.some(value => typeof value === 'string' && value.includes('activation expired'))).to.equal(true);
    let resolve;
    f.root.requestFullscreen = () => new Promise(done => { resolve = done; });
    const entering = f.session.enter();
    f.session.dispose(); resolve(); await entering;
    expect(f.calls).not.to.include('focus-prior');
    expect(f.listeners.size).to.equal(0);
  });
});
