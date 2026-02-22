function optionalElement(doc, id) {
  if (!doc || typeof doc.getElementById !== 'function') return null;
  return doc.getElementById(id);
}

function requireElement(doc, id) {
  const element = optionalElement(doc, id);
  if (!element) {
    throw new Error(`Missing required DOM element: #${id}`);
  }
  return element;
}

export {
  optionalElement,
  requireElement
};
