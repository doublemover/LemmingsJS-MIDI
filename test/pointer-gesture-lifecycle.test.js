import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { getPointerGestureArbiter } from '../js/app/controls/PointerGestureArbiter.js';
import { createProcgenCameraController } from '../js/app/procgen/ProcgenCameraController.js';

describe('desktop gesture lifetime ownership', () => {
  let dom, document, canvas, arbiter, captured, released;
  const pointer = (type, id, x = 900, y = 500) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: id }); return event;
  };
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body><canvas></canvas></body>'); document = dom.window.document; canvas = document.querySelector('canvas');
    captured = new Set(); released = [];
    canvas.hasPointerCapture = id => captured.has(id); canvas.setPointerCapture = id => captured.add(id);
    canvas.releasePointerCapture = id => { captured.delete(id); released.push(id); };
    arbiter = getPointerGestureArbiter(document);
  });
  afterEach(() => { arbiter.cancel('test-cleanup'); dom.window.close(); });
  const acquire = (overrides = {}) => arbiter.acquire({ pointerId: 1, targetKey: 'paint', identity: 'a', getIdentity: () => 'a', captureTarget: canvas, ...overrides });
  it('binds document guards only while owned and releases them across reentrant cancellation', () => {
    const listeners = new Map();
    const target = () => ({ addEventListener(type, handler) { listeners.set(type, handler); }, removeEventListener(type, handler) { expect(listeners.get(type)).to.equal(handler); listeners.delete(type); } });
    const host = target(); host.defaultView = target();
    const scoped = getPointerGestureArbiter(host), begin = onCancel => scoped.acquire({ pointerId: 1, targetKey: 'draft', identity: 'a', getIdentity: () => 'a', onCancel });
    expect(listeners.size).to.equal(0); expect(getPointerGestureArbiter(host)).to.equal(scoped);
    const first = begin(); expect(listeners.size).to.equal(7); first.finish({ pointerId: 1 }); expect(listeners.size).to.equal(0);
    let replacement;
    begin(() => { expect(listeners.size).to.equal(0); replacement = begin(); }); scoped.cancel('replace');
    expect(listeners.size).to.equal(7); replacement.finish({ pointerId: 1 }); expect(listeners.size).to.equal(0);
    begin(() => { throw Error('retired'); }); expect(() => scoped.cancel('retire')).to.throw('retired'); expect(listeners.size).to.equal(0);
  });
  it('rolls back partial listener registration when the document rejects a guard', () => {
    const handlers = new Set(), host = { addEventListener(type, handler) { if (type === 'keydown') throw Error('closed document'); handlers.add(handler); }, removeEventListener(type, handler) { handlers.delete(handler); } };
    const scoped = getPointerGestureArbiter(host);
    expect(() => scoped.acquire({ targetKey: 'draft', identity: 'a', getIdentity: () => 'a' })).to.throw('closed document');
    expect(scoped.inspect()).to.equal(null); expect(handlers.size).to.equal(0);
  });
  it('retires an unhandled owning release after pending capture disappears and ignores foreign releases', async () => {
    const reasons = []; acquire({ onCancel: reason => reasons.push(reason) });
    document.body.dispatchEvent(pointer('pointerup', 2)); await new Promise(resolve => setTimeout(resolve, 0)); expect(arbiter.inspect().pointerId).to.equal(1);
    document.body.dispatchEvent(pointer('pointerup', 1)); await new Promise(resolve => setTimeout(resolve, 0)); expect(arbiter.inspect()).to.equal(null); expect(reasons).to.deep.equal(['unhandled-pointerup']);
  });
  it('lets window handlers commit first and cannot cancel a new reentrant owner', async () => {
    const reasons = [], lease = acquire({ onCancel: reason => reasons.push(reason) });
    dom.window.addEventListener('pointerup', event => { expect(lease.finish(event)).to.equal(true); acquire({ onCancel: reason => reasons.push(reason) }); }, { once: true });
    canvas.dispatchEvent(pointer('pointerup', 1)); await new Promise(resolve => setTimeout(resolve, 0)); expect(arbiter.inspect().id).not.to.equal(lease.id); expect(reasons).to.deep.equal([]);
    arbiter.cancel('finished'); expect(reasons).to.deep.equal(['finished']);
  });
  it('ignores foreign contacts and releases the captured owner exactly once on finish', () => {
    const lease = acquire(); captured.add(1);
    canvas.dispatchEvent(pointer('pointercancel', 2)); canvas.dispatchEvent(pointer('lostpointercapture', 2));
    expect(lease.finish(pointer('pointerup', 2))).to.equal(false); expect(arbiter.inspect().pointerId).to.equal(1);
    expect(lease.finish(pointer('pointerup', 1))).to.equal(true); expect(lease.finish(pointer('pointerup', 1))).to.equal(false);
    expect(released).to.deep.equal([1]); expect(arbiter.inspect()).to.equal(null);
  });
  it('does not revive a source after A to B to A and contains missing/throwing identity reads', () => {
    let source = 'a', cancelled = 0;
    const lease = acquire({ getIdentity: () => source, onCancel: () => cancelled++ }); captured.add(1);
    source = 'b'; expect(arbiter.revalidate()).to.equal(false); source = 'a';
    expect(lease.finish(pointer('pointerup', 1))).to.equal(false); expect(cancelled).to.equal(1); expect(released).to.deep.equal([1]);
    const broken = acquire({ getIdentity: () => { if (source === 'broken') throw Error('removed'); return source; } }); source = 'broken';
    expect(broken.owns(pointer('pointermove', 1))).to.equal(false); expect(arbiter.inspect()).to.equal(null);
    expect(acquire({ getIdentity: () => { throw Error('unavailable'); } })).to.equal(null);
  });
  it('cancels Escape, window blur, hidden document and modal opening through one shared owner', () => {
    const reasons = [];
    for (const kind of ['escape', 'blur', 'hidden', 'modal-open']) {
      acquire({ onCancel: reason => reasons.push(reason) }); captured.add(1);
      if (kind === 'escape') canvas.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      if (kind === 'blur') dom.window.dispatchEvent(new dom.window.Event('blur'));
      if (kind === 'hidden') { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new dom.window.Event('visibilitychange')); }
      if (kind === 'modal-open') { const dialog = document.createElement('dialog'); document.body.append(dialog); const event = new dom.window.Event('beforetoggle', { bubbles: true }); Object.defineProperty(event, 'newState', { value: 'open' }); dialog.dispatchEvent(event); }
      expect(arbiter.inspect(), kind).to.equal(null); expect(captured.size, kind).to.equal(0);
    }
    expect(reasons).to.deep.equal(['escape', 'blur', 'hidden', 'modal-open']); expect(released).to.deep.equal([1, 1, 1, 1]);
  });
  it('releases capture even when cancellation throws and rejects detached targets', () => {
    acquire({ onCancel() { throw Error('retired control'); } }); captured.add(1);
    dom.window.dispatchEvent(new dom.window.Event('blur')); expect(arbiter.inspect()).to.equal(null); expect(captured.size).to.equal(0);
    const lease = acquire(); captured.add(1); canvas.remove(); arbiter.revalidate();
    expect(lease.owns(pointer('pointermove', 1))).to.equal(false); expect(captured.size).to.equal(0); expect(acquire()).to.equal(null);
  });
  it('preserves a new owner acquired reentrantly by an old cancellation callback', () => {
    let next;
    acquire({ onCancel() { next = acquire({ targetKey: 'next' }); captured.add(1); } }); captured.add(1);
    arbiter.cancel('replace'); expect(arbiter.inspect().targetKey).to.equal('next'); expect(captured.has(1)).to.equal(true);
    expect(next.finish(pointer('pointerup', 1))).to.equal(true); expect(captured.size).to.equal(0);
  });
  const camera = () => {
    Object.defineProperty(canvas, 'clientWidth', { value: 1920 }); Object.defineProperty(canvas, 'clientHeight', { value: 1080 });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080 });
    const renderer = { canvas, window: dom.window, world: { width: 6000, height: 4000, generation: 1, tickIndex: 0, actors: [] }, scale: 3, cameraX: 0, cameraY: 0, follow: false, render() {} };
    return { renderer, controller: createProcgenCameraController(renderer) };
  };
  it('retires camera capture on blur and permits a fresh pan without phantom movement', () => {
    const f = camera();
    try {
      canvas.dispatchEvent(pointer('pointerdown', 1)); canvas.dispatchEvent(pointer('pointermove', 1, 800)); expect(f.renderer.cameraX).to.be.greaterThan(0);
      dom.window.dispatchEvent(new dom.window.Event('blur')); const stopped = f.renderer.cameraX;
      canvas.dispatchEvent(pointer('pointermove', 1, 700)); expect(f.renderer.cameraX).to.equal(stopped); expect(captured.size).to.equal(0);
      canvas.dispatchEvent(pointer('pointerdown', 2)); canvas.dispatchEvent(pointer('pointermove', 2, 800)); canvas.dispatchEvent(pointer('pointerup', 2));
      expect(f.renderer.cameraX).to.be.greaterThan(stopped); expect(arbiter.inspect()).to.equal(null); expect(captured.size).to.equal(0);
    } finally { f.controller.dispose(); }
  });
  it('fences camera zoom A to B to A and restored presentation transforms', () => {
    const f = camera();
    try {
      canvas.dispatchEvent(pointer('pointerdown', 1)); f.controller.setZoom(4); f.controller.setZoom(3);
      const stopped = f.renderer.cameraX; canvas.dispatchEvent(pointer('pointermove', 1, 800)); expect(f.renderer.cameraX).to.equal(stopped); expect(arbiter.inspect()).to.equal(null);
      canvas.dispatchEvent(pointer('pointerdown', 2)); f.controller.applyState({ scale: 4, cameraX: 0, cameraY: 0, follow: false });
      expect(arbiter.inspect()).to.equal(null); expect(captured.size).to.equal(0);
    } finally { f.controller.dispose(); }
  });
  it('does not retain camera ownership after capture rejection, generation replacement or disposal', () => {
    const f = camera(), original = canvas.setPointerCapture;
    canvas.setPointerCapture = () => { throw Error('detached'); }; canvas.dispatchEvent(pointer('pointerdown', 1)); expect(arbiter.inspect()).to.equal(null);
    canvas.setPointerCapture = original; canvas.dispatchEvent(pointer('pointerdown', 2)); f.renderer.world.generation++; f.controller.update();
    expect(arbiter.inspect()).to.equal(null); expect(captured.size).to.equal(0);
    canvas.dispatchEvent(pointer('pointerdown', 3)); f.controller.dispose(); expect(arbiter.inspect()).to.equal(null); expect(captured.size).to.equal(0);
  });
});
