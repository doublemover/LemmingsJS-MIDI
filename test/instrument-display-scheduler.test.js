import { expect } from 'chai';
import { createInstrumentDisplayScheduler } from '../js/app/resources/InstrumentDisplayScheduler.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const fixture = ({ observerFailure = false, ...options } = {}) => {
  let time = 0, serial = 0, intersect; const frames = new Map(), timers = new Map(), listeners = new Map(), budget = createResourceBudget();
  const document = { hidden: false, addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
  const window = { performance: { now: () => time }, requestAnimationFrame: callback => { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), setTimeout: (callback, delay) => { const id = ++serial; timers.set(id, { callback, due: time + delay }); return id; }, clearTimeout: id => timers.delete(id),
    IntersectionObserver: class { constructor(callback) { intersect = callback; } observe() {} unobserve() {} disconnect() { if (observerFailure) throw new Error('unknown observer retirement'); } } };
  const scheduler = createInstrumentDisplayScheduler({ document, window, resourceBudget: budget, ...options });
  return { scheduler, document, budget, frames, timers, listeners, intersect: (element, visible) => intersect([{ target: element, isIntersecting: visible }]),
    frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(time); },
    advance(milliseconds) { time += milliseconds; const ready = [...timers].filter(([, value]) => value.due <= time); for (const [id, value] of ready) { timers.delete(id); value.callback(); } } };
};

describe('bounded demand-driven instrument display scheduler', () => {
  it('coalesces a burst to the latest immutable snapshot and remains idle after delivery', () => {
    const f = fixture(), values = [], surface = f.scheduler.register({ id: 'oled', write: (_read, packet) => values.push(packet.value.beat) });
    for (let beat = 0; beat < 2048; beat++) surface.publish(Object.freeze({ beat }), 'document:generation:projection');
    expect(f.frames.size).to.equal(1); expect(f.timers.size).to.equal(0); f.frame(); expect(values).to.deep.equal([2047]);
    const state = f.scheduler.diagnostics(); expect(state.surfaces[0].coalesced).to.equal(2047); expect(state.totalFrames).to.equal(1);
    expect(f.frames.size + f.timers.size).to.equal(0); surface.dispose(); f.scheduler.dispose(); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('reads all layout inputs before any write and isolates a failing display', () => {
    const f = fixture(), order = [];
    f.scheduler.register({ id: 'broken', read: () => { order.push('read:broken'); throw new Error('canvas unavailable'); }, write: () => order.push('write:broken') }).invalidate();
    f.scheduler.register({ id: 'a', read: () => order.push('read:a'), write: () => order.push('write:a') }).invalidate();
    f.scheduler.register({ id: 'b', read: () => order.push('read:b'), write: () => order.push('write:b') }).invalidate();
    f.frame(); expect(order).to.deep.equal(['read:broken', 'read:a', 'read:b', 'write:a', 'write:b']);
    expect(f.scheduler.diagnostics().surfaces[0]).to.include({ errors: 1, lastError: 'canvas unavailable' }); f.scheduler.dispose();
  });
  it('drops hidden animation history, resynchronizes once, and bounds registration independently of lane count', () => {
    const f = fixture({ maxSurfaces: 8 }), element = {}, received = [], surface = f.scheduler.register({ id: 'visible', element, write: (_read, packet) => received.push(packet.value.tick) });
    surface.publish(Object.freeze({ tick: 1 })); f.document.hidden = true; f.listeners.get('visibilitychange')();
    for (let tick = 2; tick <= 1024; tick++) surface.publish(Object.freeze({ tick }));
    expect(f.frames.size + f.timers.size).to.equal(0); f.document.hidden = false; f.listeners.get('visibilitychange')(); f.frame(); expect(received).to.deep.equal([1024]);
    f.intersect(element, false); surface.publish(Object.freeze({ tick: 1025 })); expect(f.frames.size + f.timers.size).to.equal(0);
    f.intersect(element, true); f.advance(32); f.frame(); expect(received).to.deep.equal([1024, 1025]);
    for (let index = 1; index < 8; index++) f.scheduler.register({ id: String(index), write() {} });
    expect(() => f.scheduler.register({ id: 'excess', write() {} })).to.throw('unavailable'); f.scheduler.dispose();
    expect(surface.publish(Object.freeze({ tick: 1026 }))).to.equal(false); expect(f.frames.size + f.timers.size).to.equal(0); expect(f.listeners.size).to.equal(0);
  });
  it('retains accounting when a native observer cannot acknowledge retirement', async () => {
    const f = fixture({ observerFailure: true }); f.scheduler.register({ id: 'detail', write() {} }).invalidate();
    const receipt = f.scheduler.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('partial');
    expect(f.frames.size + f.timers.size).to.equal(0); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
});
