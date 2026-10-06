import { expect } from 'chai';
import { createCanvasStub } from './support/canvas.js';

const preserveGlobals = (names) => {
  const snapshot = new Map();
  for (const name of names) {
    snapshot.set(name, {
      had: Object.prototype.hasOwnProperty.call(globalThis, name),
      value: globalThis[name]
    });
  }
  return () => {
    for (const [name, entry] of snapshot.entries()) {
      if (entry.had) {
        globalThis[name] = entry.value;
      } else {
        delete globalThis[name];
      }
    }
  };
};

describe('app boot helpers', function () {
  it('applies responsive canvas sizing and native resize binding', async function () {
    const restore = preserveGlobals(['window', 'document', '__LEMMINGS_BOOT_NO_AUTO_START__']);
    const classSet = new Set();
    const containerClasses = new Set();
    const container = {
      style: {},
      classList: {
        add(name) {
          containerClasses.add(name);
        },
        remove(name) {
          containerClasses.delete(name);
        }
      }
    };
    const listeners = [];
    const slot = { clientWidth: 1540, clientHeight: 704 };
    let resizeObserverCallback;

    try {
      const windowStub = {
        ResizeObserver: class {
          constructor(callback) { resizeObserverCallback = callback; }
          observe(target) { expect(target).to.equal(slot); }
        },
        visualViewport: {
          width: 1600,
          height: 800,
          addEventListener(type, handler) {
            listeners.push({ type, handler });
          }
        },
        innerWidth: 1600,
        innerHeight: 800,
        addEventListener(type, handler) {
          listeners.push({ type, handler });
        },
        removeEventListener() {}
      };
      const documentStub = {
        body: {
          classList: {
            toggle(name, enabled) {
              if (enabled) classSet.add(name);
              else classSet.delete(name);
            }
          }
        },
        documentElement: {
          clientWidth: 1600,
          clientHeight: 800
        },
        querySelector(selector) {
          if (selector === '.game_container') return container;
          if (selector === '.game-stage-slot') return slot;
          return null;
        },
        getElementById() {
          return null;
        }
      };

      globalThis.window = windowStub;
      globalThis.document = documentStub;
      globalThis.__LEMMINGS_BOOT_NO_AUTO_START__ = true;

      const boot = await import(`../js/app/boot.js?boot_test=${Date.now()}`);
      const canvas = createCanvasStub({ width: 0, height: 0 });
      let stageResizeCalls = 0;
      boot.setLemmingsForTest({
        gameCanvas: canvas,
        stage: {
          scheduleUpdateStageSize() {
            stageResizeCalls += 1;
          }
        }
      });

      boot.setSize();
      boot.bindResize();

      expect(containerClasses.has('small')).to.equal(false);
      expect(container.style.width).to.equal(`${704 * (800 / 480)}px`);
      expect(container.style.height).to.equal('704px');
      expect(canvas.style.width).to.equal(`${704 * (800 / 480)}px`);
      expect(canvas.style.height).to.equal('704px');
      expect(stageResizeCalls).to.equal(1);
      expect(classSet.has('portrait-small')).to.equal(false);
      expect(listeners.map((entry) => entry.type)).to.deep.equal(['resize', 'orientationchange', 'resize']);
      for (const [width, height] of [[340, 640], [794, 286], [270, 370], [1540, 704]]) {
        slot.clientWidth = width;
        slot.clientHeight = height;
        resizeObserverCallback();
        const drawnWidth = parseFloat(canvas.style.width);
        const drawnHeight = parseFloat(canvas.style.height);
        expect(drawnWidth).to.be.at.most(width);
        expect(drawnHeight).to.be.at.most(height);
        expect(drawnWidth / drawnHeight).to.be.closeTo(800 / 480, 0.00001);
        expect(container.style.marginTop).to.equal('');
        expect(container.style.marginLeft).to.equal('');
      }

    } finally {
      restore();
    }
  });

  it('registers resize listeners only once', async function () {
    const restore = preserveGlobals(['window', 'document', '__LEMMINGS_BOOT_NO_AUTO_START__']);
    try {
      const listeners = [];
      globalThis.window = {
        visualViewport: {
          width: 500,
          height: 700,
          addEventListener(type, handler) {
            listeners.push({ type, handler });
          }
        },
        innerWidth: 500,
        innerHeight: 700,
        addEventListener(type, handler) {
          listeners.push({ type, handler });
        },
        removeEventListener() {}
      };
      globalThis.document = {
        body: { classList: { toggle() {} } },
        documentElement: { clientWidth: 500, clientHeight: 700 },
        querySelector() {
          return null;
        },
        getElementById() {
          return null;
        }
      };
      globalThis.__LEMMINGS_BOOT_NO_AUTO_START__ = true;

      const boot = await import(`../js/app/boot.js?boot_test_nojq=${Date.now()}`);
      boot.bindResize();
      boot.bindResize();
      expect(listeners.map((entry) => entry.type)).to.deep.equal(['resize', 'orientationchange', 'resize']);
    } finally {
      restore();
    }
  });

  it('surfaces embed-mode boot failures without throwing', async function () {
    const restore = preserveGlobals(['window', 'document', '__LEMMINGS_BOOT_NO_AUTO_START__']);
    try {
      const appended = [];
      globalThis.window = {
        location: { search: '?embed=1' },
        visualViewport: null,
        innerWidth: 800,
        innerHeight: 480,
        addEventListener() {},
        removeEventListener() {}
      };
      globalThis.document = {
        readyState: 'complete',
        body: {
          appendChild(node) {
            appended.push(node);
          },
          classList: { toggle() {} }
        },
        documentElement: {
          setAttribute() {}
        },
        querySelector() {
          return this.body;
        },
        createElement() {
          return { id: '', textContent: '', className: '' };
        },
        getElementById() {
          return null;
        }
      };
      globalThis.__LEMMINGS_BOOT_NO_AUTO_START__ = true;

      const boot = await import(`../js/app/boot.js?boot_embed=${Date.now()}`);
      expect(() => boot.start()).to.not.throw();
      expect(appended).to.have.lengthOf(1);
      expect(appended[0].id).to.equal('bootFailureNotice');
    } finally {
      restore();
    }
  });
});
