import { cloneSafeObject, isPlainObject, mergeDeepSafe } from '../../util/safeObject.js';

const sanitizeOverrides = (value) => isPlainObject(value) ? cloneSafeObject(value) : {};

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
  overrides: sanitizeOverrides(overrides),
  learn: isPlainObject(learn) ? cloneSafeObject(learn) : null,
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
      overrides: sanitizeOverrides(action.overrides),
      lastIntentType: type
    };
  case 'overrides.merge':
    if (!isPlainObject(action.patch)) return current;
    return {
      ...current,
      revision: current.revision + 1,
      overrides: mergeDeepSafe(current.overrides || {}, action.patch),
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
