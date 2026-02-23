import { expect } from 'chai';
import { bindCanvasFocusBlur } from '../js/app/canvasFocusBlur.js';

const createListenerHost = () => ({
  listeners: new Map(),
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  },
  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    const next = handlers.filter(entry => entry !== handler);
    if (next.length) {
      this.listeners.set(type, next);
    } else {
      this.listeners.delete(type);
    }
  }
});

const countHandlers = (host, type) => (host.listeners.get(type) || []).length;

describe('canvasFocusBlur', function () {
  it('deduplicates repeated binds and supports teardown/rebind', function () {
    const documentRef = {
      ...createListenerHost(),
      activeElement: null,
      body: { tabIndex: 0, focus() {} }
    };
    const canvas = {
      ...createListenerHost(),
      dataset: {}
    };
    const windowRef = { setTimeout(fn) { fn(); } };

    const cleanupA = bindCanvasFocusBlur(canvas, { documentRef, windowRef });
    const cleanupB = bindCanvasFocusBlur(canvas, { documentRef, windowRef });

    expect(cleanupA).to.equal(cleanupB);
    expect(countHandlers(documentRef, 'pointerdown')).to.equal(1);
    expect(countHandlers(canvas, 'pointerdown')).to.equal(1);

    cleanupA();
    expect(countHandlers(documentRef, 'pointerdown')).to.equal(0);
    expect(countHandlers(canvas, 'pointerdown')).to.equal(0);

    const cleanupC = bindCanvasFocusBlur(canvas, { documentRef, windowRef });
    expect(cleanupC).to.not.equal(cleanupA);
    expect(countHandlers(documentRef, 'pointerdown')).to.equal(1);
    cleanupC();
  });

  it('blurs active form inputs only for non-form interaction targets', function () {
    let blurred = 0;
    let bodyFocusCount = 0;
    let documentRef;
    const activeInput = {
      tagName: 'INPUT',
      isContentEditable: false,
      blur() {
        blurred += 1;
        if (documentRef) {
          documentRef.activeElement = null;
        }
      }
    };
    documentRef = {
      ...createListenerHost(),
      activeElement: activeInput,
      body: {
        tabIndex: 0,
        focus() {
          bodyFocusCount += 1;
        }
      }
    };
    const canvas = {
      ...createListenerHost(),
      dataset: {}
    };
    const windowRef = { setTimeout(fn) { fn(); } };

    const cleanup = bindCanvasFocusBlur(canvas, { documentRef, windowRef });
    const handler = documentRef.listeners.get('pointerdown')[0];

    handler({ target: { tagName: 'DIV', isContentEditable: false } });
    expect(blurred).to.equal(1);
    expect(bodyFocusCount).to.equal(1);

    blurred = 0;
    documentRef.activeElement = activeInput;
    handler({ target: { tagName: 'INPUT', isContentEditable: false } });
    expect(blurred).to.equal(0);

    cleanup();
  });
});
