import { expect } from 'chai';

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

    try {
      const windowStub = {
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
      const canvas = { style: {}, width: 0, height: 0 };
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
      expect(container.style.width).to.equal('1333.3333333333335px');
      expect(container.style.height).to.equal('800px');
      expect(canvas.style.width).to.equal('1333.3333333333335px');
      expect(canvas.style.height).to.equal('800px');
      expect(stageResizeCalls).to.equal(1);
      expect(classSet.has('portrait-small')).to.equal(false);
      expect(listeners.map((entry) => entry.type)).to.deep.equal(['resize', 'orientationchange', 'resize']);
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
