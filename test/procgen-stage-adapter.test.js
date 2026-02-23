import { expect } from 'chai';
import { ProcgenStageAdapter } from '../js/app/procgenStageAdapter.js';

const createWindowMock = () => {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    }
  };
};

const createCanvasMock = () => {
  const listeners = new Map();
  const added = [];
  const removed = [];
  return {
    listeners,
    added,
    removed,
    addEventListener(type, handler, options) {
      added.push({ type, handler, options });
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      removed.push({ type, handler });
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    }
  };
};

const createAdapterFixture = () => {
  const stageImageViewPoint = { x: 0, y: 0, scale: 1 };
  const guiViewPoint = {
    x: 0,
    y: 0,
    setX(v) { this.x = v; },
    setY(v) { this.y = v; }
  };
  const originalSnapScale = (rawScale) => rawScale;
  const stage = {
    gameImgProps: {
      viewPoint: stageImageViewPoint,
      canvasViewportSize: { width: 320, height: 160 },
      display: { worldDataSize: { width: 320, height: 160 } }
    },
    guiImgProps: {
      display: {},
      canvasViewportSize: { width: 1, height: 1 },
      viewPoint: guiViewPoint
    },
    snapScale: originalSnapScale,
    applyViewportCalls: [],
    redrawCalls: 0,
    updateStageSizeCalls: 0,
    applyViewport(props, x, y, scale) {
      this.applyViewportCalls.push({ props, x, y, scale });
      props.viewPoint.scale = scale;
    },
    redraw() {
      this.redrawCalls += 1;
    },
    updateStageSize() {
      this.updateStageSizeCalls += 1;
    }
  };
  const view = {
    stage,
    game: { level: { width: 320, height: 160 } }
  };
  const controller = {
    level: { width: 320, height: 160 },
    getGroundExtentX() { return 320; }
  };
  return { stage, view, controller, originalSnapScale };
};

describe('ProcgenStageAdapter', function () {
  let previousWindow;

  beforeEach(function () {
    previousWindow = globalThis.window;
    globalThis.window = createWindowMock();
  });

  afterEach(function () {
    globalThis.window = previousWindow;
  });

  it('binds listeners once and disposes them cleanly', function () {
    const canvas = createCanvasMock();
    const { stage, view, controller, originalSnapScale } = createAdapterFixture();
    const adapter = new ProcgenStageAdapter({ view, controller, canvas });

    adapter.install();
    adapter.install();

    expect(canvas.added.filter(entry => entry.type === 'wheel')).to.have.lengthOf(1);
    expect(globalThis.window.listeners.has('resize')).to.equal(true);
    expect(stage.snapScale).to.not.equal(originalSnapScale);

    adapter.dispose();
    adapter.dispose();

    expect(canvas.listeners.size).to.equal(0);
    expect(globalThis.window.listeners.size).to.equal(0);
    expect(stage.snapScale).to.equal(originalSnapScale);
  });

  it('rebinds listeners after a dispose/install cycle', function () {
    const canvas = createCanvasMock();
    const { view, controller } = createAdapterFixture();
    const adapter = new ProcgenStageAdapter({ view, controller, canvas });

    adapter.install();
    adapter.dispose();
    adapter.install();

    expect(canvas.added.filter(entry => entry.type === 'wheel')).to.have.lengthOf(2);
    expect(canvas.listeners.has('wheel')).to.equal(true);
    expect(globalThis.window.listeners.has('resize')).to.equal(true);
  });

  it('handles wheel zoom with the installed listener', function () {
    const canvas = createCanvasMock();
    const { stage, view, controller } = createAdapterFixture();
    const adapter = new ProcgenStageAdapter({ view, controller, canvas });
    adapter.install();

    const wheel = canvas.listeners.get('wheel');
    expect(typeof wheel).to.equal('function');
    let prevented = false;
    wheel({
      deltaY: -1,
      preventDefault() {
        prevented = true;
      }
    });

    expect(prevented).to.equal(true);
    expect(stage.applyViewportCalls).to.have.lengthOf(1);
    expect(stage.redrawCalls).to.equal(1);
  });

  it('ignores wheel events with zero delta to avoid accidental zoom', function () {
    const canvas = createCanvasMock();
    const { stage, view, controller } = createAdapterFixture();
    const adapter = new ProcgenStageAdapter({ view, controller, canvas });
    adapter.install();

    const wheel = canvas.listeners.get('wheel');
    wheel({
      deltaY: 0,
      preventDefault() {}
    });

    expect(stage.applyViewportCalls).to.have.lengthOf(0);
    expect(stage.redrawCalls).to.equal(0);
  });

  it('binds and unbinds resize listeners against provided window references', function () {
    const canvas = createCanvasMock();
    const win = createWindowMock();
    const { view, controller } = createAdapterFixture();
    const adapter = new ProcgenStageAdapter({ view, controller, canvas, windowRef: win });

    adapter.install();
    expect(win.listeners.has('resize')).to.equal(true);
    expect(globalThis.window.listeners.has('resize')).to.equal(false);

    adapter.dispose();
    expect(win.listeners.has('resize')).to.equal(false);
  });

  it('updates stage size through explicit adapter handles', function () {
    const canvas = createCanvasMock();
    const { stage, view, controller } = createAdapterFixture();
    const adapter = new ProcgenStageAdapter({ view, controller, canvas });

    adapter.updateStageSize();
    expect(stage.updateStageSizeCalls).to.equal(1);

    adapter.install();
    const onResize = globalThis.window.listeners.get('resize');
    expect(typeof onResize).to.equal('function');
    onResize();
    expect(stage.updateStageSizeCalls).to.equal(2);
  });
});
