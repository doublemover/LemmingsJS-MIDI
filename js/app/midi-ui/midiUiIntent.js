const mergeDeep = (target, source) => {
  if (!source || typeof source !== 'object') return target;
  const out = { ...(target || {}) };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mergeDeep(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

const createMidiIntentState = ({ overrides = {}, learn = null } = {}) => ({
  revision: 0,
  overrides: (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) ? overrides : {},
  learn: learn && typeof learn === 'object' ? { ...learn } : null,
  lastIntentType: null
});

const reduceMidiIntent = (state, intent) => {
  const current = state || createMidiIntentState();
  const action = intent && typeof intent === 'object' ? intent : {};
  const type = String(action.type || '');
  switch (type) {
  case 'overrides.replace':
    return {
      ...current,
      revision: current.revision + 1,
      overrides: (action.overrides && typeof action.overrides === 'object' && !Array.isArray(action.overrides))
        ? action.overrides
        : {},
      lastIntentType: type
    };
  case 'overrides.merge':
    return {
      ...current,
      revision: current.revision + 1,
      overrides: mergeDeep(current.overrides || {}, action.patch || {}),
      lastIntentType: type
    };
  case 'learn.arm':
    return {
      ...current,
      revision: current.revision + 1,
      learn: {
        target: action.target || null,
        armedAt: Date.now()
      },
      lastIntentType: type
    };
  case 'learn.capture':
    return {
      ...current,
      revision: current.revision + 1,
      learn: current.learn ? {
        ...current.learn,
        lastCapture: action.value ?? null,
        capturedAt: Date.now()
      } : null,
      lastIntentType: type
    };
  case 'learn.disarm':
    return {
      ...current,
      revision: current.revision + 1,
      learn: null,
      lastIntentType: type
    };
  default:
    return current;
  }
};

export {
  createMidiIntentState,
  reduceMidiIntent
};
