class TestClassList {
  constructor(el) {
    this.el = el;
  }

  _getSet() {
    const raw = this.el.className || '';
    return new Set(raw.split(/\s+/).filter(Boolean));
  }

  _setFrom(set) {
    this.el.className = Array.from(set).join(' ');
  }

  add(...names) {
    const set = this._getSet();
    names.forEach(name => set.add(name));
    this._setFrom(set);
  }

  remove(...names) {
    const set = this._getSet();
    names.forEach(name => set.delete(name));
    this._setFrom(set);
  }

  contains(name) {
    return this._getSet().has(name);
  }
}

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.classList = new TestClassList(this);
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.type = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    const handlers = this.listeners.get(event.type) || [];
    handlers.forEach(handler => handler(event));
  }
}

class TestDocument {
  constructor() {
    this._elementsById = new Map();
    this._all = [];
    this.documentElement = { clientWidth: 800, clientHeight: 600 };
  }

  createElement(tagName) {
    const el = new TestElement(tagName);
    this._all.push(el);
    return el;
  }

  registerElement(id, el) {
    if (!el) return;
    el.id = id;
    this._elementsById.set(id, el);
    if (!this._all.includes(el)) this._all.push(el);
  }

  getElementById(id) {
    return this._elementsById.get(id) || null;
  }

  querySelectorAll(selector) {
    if (!selector || selector[0] !== '.') return [];
    const className = selector.slice(1);
    return this._all.filter(el => el.classList.contains(className));
  }
}

const createTestWindow = () => {
  const store = new Map();
  return {
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    },
    setInterval() { return 1; },
    clearInterval() {},
    requestAnimationFrame(cb) { cb(); return 1; },
    setTimeout(cb) { cb(); return 1; }
  };
};

export { TestDocument, TestElement, createTestWindow };
