function optionalElement(doc, id) {
  if (!doc || typeof doc.getElementById !== 'function') return null;
  return doc.getElementById(id);
}

function requireElement(doc, id, options = {}) {
  const element = optionalElement(doc, id);
  if (!element) {
    const context = options.context ? ` (${options.context})` : '';
    throw new Error(`Missing required DOM element: #${id}${context}`);
  }
  return element;
}

function detectEmbedMode({ windowRef = null, documentRef = null } = {}) {
  const params = windowRef?.location?.search
    ? new URLSearchParams(windowRef.location.search)
    : null;
  if (params?.has('embed')) return true;
  if (params?.has('embedded')) return true;
  if (documentRef?.documentElement?.dataset?.embedMode === 'true') return true;
  if (documentRef?.body?.dataset?.embedMode === 'true') return true;
  return false;
}

function createDomResolutionError({ missingIds = [], embedMode = false, context = 'boot' } = {}) {
  const ids = Array.isArray(missingIds) ? missingIds.filter(Boolean) : [];
  const suffix = ids.length ? `: ${ids.map(id => `#${id}`).join(', ')}` : '';
  const embedHint = embedMode
    ? ' Embed mode requires explicit container wiring.'
    : '';
  const error = new Error(`Missing required DOM elements for ${context}${suffix}.${embedHint}`.trim());
  error.name = 'DomResolutionError';
  error.missingIds = ids;
  error.embedMode = embedMode === true;
  error.context = context;
  return error;
}

function resolveRequiredElements(doc, ids, options = {}) {
  const missing = [];
  const resolved = {};
  const entries = Array.isArray(ids) ? ids : [];
  for (const id of entries) {
    const element = optionalElement(doc, id);
    if (!element) {
      missing.push(id);
      continue;
    }
    resolved[id] = element;
  }
  if (missing.length) {
    throw createDomResolutionError({
      missingIds: missing,
      embedMode: options.embedMode === true,
      context: options.context || 'boot'
    });
  }
  return resolved;
}

export {
  createDomResolutionError,
  detectEmbedMode,
  optionalElement,
  requireElement,
  resolveRequiredElements
};
