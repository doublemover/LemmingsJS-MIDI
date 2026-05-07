import { expect } from 'chai';
import { ShortcutOverlay } from '../js/app/shortcutOverlay.js';

class FakeClassList {
  constructor() {
    this._set = new Set();
  }

  add(name) {
    this._set.add(name);
  }

  remove(name) {
    this._set.delete(name);
  }

  contains(name) {
    return this._set.has(name);
  }
}

class FakeElement {
  constructor(doc, tagName = 'div') {
    this.ownerDocument = doc;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.textContent = '';
    this.className = '';
    this.type = '';
    this.isConnected = true;
    this._selectors = new Map();
  }

  querySelector(selector) {
    return this._selectors.get(selector) || null;
  }

  setSelector(selector, element) {
    this._selectors.set(selector, element);
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    const handlers = this.listeners.get(event.type) || [];
    for (const handler of handlers) {
      handler({ target: this, ...event });
    }
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

const createOverlayDom = () => {
  const doc = {
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(doc, tagName);
    }
  };
  const root = new FakeElement(doc, 'div');
  const content = new FakeElement(doc, 'div');
  const close = new FakeElement(doc, 'button');
  const title = new FakeElement(doc, 'div');
  root.setSelector('.shortcut-overlay__content', content);
  root.setSelector('.shortcut-overlay__close', close);
  root.setSelector('.shortcut-overlay__title', title);
  root.setAttribute('aria-hidden', 'true');
  return { doc, root, content, close, title };
};

describe('ShortcutOverlay', () => {
  it('focuses the close button on show and restores previous focus on hide', () => {
    const { doc, root, close, title } = createOverlayDom();
    const opener = new FakeElement(doc, 'button');
    doc.activeElement = opener;
    const overlay = new ShortcutOverlay({
      root,
      title: 'Editor Shortcuts',
      sections: [{
        title: 'General',
        entries: [{ action: 'toggle', label: 'Toggle shortcuts' }]
      }],
      getBindings: () => ['F1']
    });

    overlay.show();

    expect(root.classList.contains('is-visible')).to.equal(true);
    expect(root.getAttribute('aria-hidden')).to.equal('false');
    expect(title.textContent).to.equal('Editor Shortcuts');
    expect(doc.activeElement).to.equal(close);

    overlay.hide();

    expect(root.classList.contains('is-visible')).to.equal(false);
    expect(root.getAttribute('aria-hidden')).to.equal('true');
    expect(doc.activeElement).to.equal(opener);
  });

  it('closes on Escape and prevents the key event default', () => {
    const { root } = createOverlayDom();
    const overlay = new ShortcutOverlay({ root });
    let prevented = false;

    overlay.show();
    root.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault() {
        prevented = true;
      }
    });

    expect(prevented).to.equal(true);
    expect(root.getAttribute('aria-hidden')).to.equal('true');
  });

  it('keeps close-button clicks wired to hide the overlay', () => {
    const { root, close } = createOverlayDom();
    const overlay = new ShortcutOverlay({ root });

    overlay.show();
    close.dispatchEvent({ type: 'click' });

    expect(root.classList.contains('is-visible')).to.equal(false);
    expect(root.getAttribute('aria-hidden')).to.equal('true');
  });
});
