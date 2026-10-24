import { expect } from 'chai';
import { createProcgenPageLifecycle } from '../js/app/procgen/workstation/ProcgenPageLifecycle.js';
const target = () => { const handlers = new Map(); return { hidden: false, handlers,
  addEventListener: (name, listener) => handlers.set(name, listener), removeEventListener: name => handlers.delete(name),
  emit: (name, event = {}) => handlers.get(name)?.(event) }; };
describe('explicit page suspension policy', () => {
  it('suspends once across hidden/freeze/BFCache, never resumes output implicitly and revokes late callbacks', () => {
    const document = target(), window = target(), suspended = [], restored = [];
    const lifecycle = createProcgenPageLifecycle({ document, window, suspend: value => suspended.push(value), restore: value => restored.push(value) });
    document.hidden = true; document.emit('visibilitychange'); document.emit('freeze'); window.emit('pagehide', { persisted: true });
    expect(suspended).to.have.length(1); expect(lifecycle.inspect().state).to.equal('bfcache-held'); expect(lifecycle.resumeExplicitly()).to.equal(false);
    document.hidden = false; window.emit('pageshow', { persisted: true }); expect(restored[0].paused).to.equal(true);
    expect(lifecycle.inspect().paused).to.equal(true); expect(lifecycle.resumeExplicitly()).to.equal(true);
    document.hidden = true; document.emit('visibilitychange'); expect(suspended).to.have.length(2);
    const late = window.handlers.get('pageshow'); lifecycle.dispose(); late({ persisted: true });
    expect(lifecycle.inspect().state).to.equal('disposed'); expect(document.handlers.size + window.handlers.size).to.equal(0);
  });
});
