const registerElement = (doc, tag, id, className = '') => {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  doc.registerElement(id, el);
  return el;
};

export { registerElement };
