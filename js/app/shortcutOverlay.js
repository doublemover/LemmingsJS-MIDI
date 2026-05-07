class ShortcutOverlay {
  constructor(options = {}) {
    this.root = options.root || null;
    this.title = options.title || 'Shortcuts';
    this.sections = options.sections || [];
    this.getBindings = options.getBindings || (() => []);
    this._doc = this.root?.ownerDocument || document;
    this._content = null;
    this._close = null;
    this._previousFocus = null;
    this._bind();
    this.render();
  }

  _bind() {
    if (!this.root) return;
    this._content = this.root.querySelector('.shortcut-overlay__content');
    this._close = this.root.querySelector('.shortcut-overlay__close');
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.hide();
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.hide();
    });
    this._close?.addEventListener('click', () => this.hide());
  }

  setSections(sections) {
    this.sections = Array.isArray(sections) ? sections : [];
    this.render();
  }

  setBindingsProvider(fn) {
    this.getBindings = typeof fn === 'function' ? fn : (() => []);
    this.render();
  }

  _createRow(entry) {
    const keys = this.getBindings(entry.action);
    if (!keys.length) return null;
    const row = this._doc.createElement('div');
    row.className = 'shortcut-row';
    const label = this._doc.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = entry.label;
    const value = this._doc.createElement('span');
    value.className = 'shortcut-keys';
    value.textContent = keys.join(' / ');
    row.appendChild(label);
    row.appendChild(value);
    return row;
  }

  render() {
    if (!this.root || !this._content) return;
    const titleEl = this.root.querySelector('.shortcut-overlay__title');
    if (titleEl) titleEl.textContent = this.title;
    this._content.innerHTML = '';
    for (const section of this.sections) {
      const entries = section?.entries || [];
      const container = this._doc.createElement('div');
      container.className = 'shortcut-section';
      const header = this._doc.createElement('div');
      header.className = 'shortcut-section__title';
      header.textContent = section.title || 'Shortcuts';
      container.appendChild(header);
      let hasRow = false;
      for (const entry of entries) {
        const row = this._createRow(entry);
        if (!row) continue;
        hasRow = true;
        container.appendChild(row);
      }
      if (hasRow) {
        this._content.appendChild(container);
      }
    }
  }

  show() {
    if (!this.root) return;
    const wasVisible = this.root.classList.contains('is-visible');
    if (!wasVisible) {
      this._previousFocus = this._doc?.activeElement || null;
    }
    this.render();
    this.root.classList.add('is-visible');
    this.root.setAttribute('aria-hidden', 'false');
    this._focusInitialControl();
  }

  hide() {
    if (!this.root) return;
    const wasVisible = this.root.classList.contains('is-visible');
    this.root.classList.remove('is-visible');
    this.root.setAttribute('aria-hidden', 'true');
    if (wasVisible) {
      this._restorePreviousFocus();
    }
  }

  toggle(force = null) {
    if (!this.root) return;
    const next = force === null ? !this.root.classList.contains('is-visible') : !!force;
    if (next) this.show();
    else this.hide();
  }

  _focusInitialControl() {
    const target = this._close || this.root.querySelector('button, [href], input, select, textarea, [tabindex]');
    if (typeof target?.focus !== 'function') return;
    try {
      target.focus({ preventScroll: true });
    } catch (error) {
      target.focus();
    }
  }

  _restorePreviousFocus() {
    const target = this._previousFocus;
    this._previousFocus = null;
    if (!target || typeof target.focus !== 'function') return;
    if (target.isConnected === false) return;
    try {
      target.focus({ preventScroll: true });
    } catch (error) {
      target.focus();
    }
  }
}

export { ShortcutOverlay };
