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

const isPlainObject = (value) => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const MAX_LEARN_TARGET_LENGTH = 128;

const sanitizeLearnTarget = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_LEARN_TARGET_LENGTH);
};

const sanitizeLearnCapture = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(127, Math.trunc(value)));
};

const createMidiIntentState = ({ overrides = {}, learn = null } = {}) => ({
  revision: 0,
  overrides: isPlainObject(overrides) ? overrides : {},
  learn: isPlainObject(learn) ? { ...learn } : null,
  lastIntentType: null
});

const reduceMidiIntent = (state, intent) => {
  const current = state || createMidiIntentState();
  const action = intent && typeof intent === 'object' ? intent : {};
  const type = String(action.type || '');
  switch (type) {
  case 'overrides.replace':
    if (!isPlainObject(action.overrides)) return current;
    return {
      ...current,
      revision: current.revision + 1,
      overrides: action.overrides,
      lastIntentType: type
    };
  case 'overrides.merge':
    if (!isPlainObject(action.patch)) return current;
    return {
      ...current,
      revision: current.revision + 1,
      overrides: mergeDeep(current.overrides || {}, action.patch),
      lastIntentType: type
    };
  case 'overrides.reset':
    return {
      ...current,
      revision: current.revision + 1,
      overrides: {},
      lastIntentType: type
    };
  case 'learn.arm':
  {
    const target = sanitizeLearnTarget(action.target);
    if (!target) return current;
    return {
      ...current,
      revision: current.revision + 1,
      learn: {
        target,
        armedAt: Date.now()
      },
      lastIntentType: type
    };
  }
  case 'learn.capture':
  {
    if (!current.learn) return current;
    const value = sanitizeLearnCapture(action.value);
    if (value === null) return current;
    return {
      ...current,
      revision: current.revision + 1,
      learn: {
        ...current.learn,
        lastCapture: value,
        capturedAt: Date.now()
      },
      lastIntentType: type
    };
  }
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
