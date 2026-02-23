const registerElement = (doc, tag, id, className = '') => {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  doc.registerElement(id, el);
  return el;
};

const findElement = (root, predicate) => {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
};

const findRowInputByLabel = (root, labelText) => {
  const row = findElement(root, el => (
    el.tagName === 'LABEL' && el.children?.[0]?.textContent === labelText
  ));
  return row?.children?.[1] || null;
};

const installRichSelectors = (doc) => {
  doc.querySelectorAll = (selector) => {
    const all = doc._all || [];
    if (selector === 'details[data-section-key]') {
      return all.filter(el => el.tagName === 'DETAILS' && el.dataset?.sectionKey);
    }
    const tabMatch = selector.match(/^\.(tab-button|tab-panel)\[data-tab-group(?:="([^"]*)")?\]$/);
    if (tabMatch) {
      const className = tabMatch[1];
      const group = tabMatch[2];
      return all.filter(el => (
        el.classList?.contains(className) &&
        el.dataset?.tabGroup &&
        (!group || el.dataset.tabGroup === group)
      ));
    }
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return all.filter(el => el.classList?.contains(className));
    }
    return [];
  };
};

const registerRangeInput = (doc, id) => {
  const wrapper = doc.createElement('div');
  const minLabel = doc.createElement('span');
  minLabel.className = 'range-label';
  const input = doc.createElement('input');
  const maxLabel = doc.createElement('span');
  maxLabel.className = 'range-label';
  wrapper.appendChild(minLabel);
  wrapper.appendChild(input);
  wrapper.appendChild(maxLabel);
  doc.registerElement(id, input);
  return { wrapper, input, minLabel, maxLabel };
};

export {
  findElement,
  findRowInputByLabel,
  installRichSelectors,
  registerElement,
  registerRangeInput
};
