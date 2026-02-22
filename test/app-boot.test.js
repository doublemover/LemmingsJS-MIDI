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
  it('applies responsive canvas sizing and jQuery resize binding', async function () {
    const restore = preserveGlobals(['window', 'document', '$', 'jQuery', '__LEMMINGS_BOOT_NO_AUTO_START__']);
    const classSet = new Set();
    const container = {
      styles: {},
      classes: new Set(),
      css(name, value) { this.styles[name] = value; return this; },
      addClass(name) { this.classes.add(name); return this; },
      removeClass(name) { this.classes.delete(name); return this; },
      width(value) { this._width = value; return this; },
      height(value) { this._height = value; return this; }
    };
    const windowBindings = [];

    try {
      const windowStub = {
        visualViewport: { width: 1600, height: 800 },
        innerWidth: 1600,
        innerHeight: 800,
        addEventListener() {},
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
        getElementById() {
          return null;
        }
      };
      const jqueryStub = (target) => {
        if (target === '.game_container') return container;
        if (target === windowStub) {
          return {
            on: (events, handler) => {
              windowBindings.push({ events, handler });
            }
          };
        }
        return null;
      };

      globalThis.window = windowStub;
      globalThis.document = documentStub;
      globalThis.$ = jqueryStub;
      globalThis.jQuery = jqueryStub;
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

      expect(container.classes.has('small')).to.equal(false);
      expect(canvas.style.width).to.equal('1333.3333333333335px');
      expect(canvas.style.height).to.equal('800px');
      expect(stageResizeCalls).to.equal(1);
      expect(classSet.has('portrait-small')).to.equal(false);
      expect(windowBindings).to.have.lengthOf(1);
      expect(windowBindings[0].events).to.equal('resize orientationchange');
    } finally {
      restore();
    }
  });

  it('falls back to native resize listeners when jQuery is unavailable', async function () {
    const restore = preserveGlobals(['window', 'document', '$', 'jQuery', '__LEMMINGS_BOOT_NO_AUTO_START__']);
    try {
      const listeners = [];
      globalThis.window = {
        visualViewport: { width: 500, height: 700 },
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
        getElementById() {
          return null;
        }
      };
      delete globalThis.$;
      delete globalThis.jQuery;
      globalThis.__LEMMINGS_BOOT_NO_AUTO_START__ = true;

      const boot = await import(`../js/app/boot.js?boot_test_nojq=${Date.now()}`);
      boot.bindResize();
      expect(listeners.map((entry) => entry.type)).to.deep.equal(['resize', 'orientationchange']);
    } finally {
      restore();
    }
  });
});
