const DEFAULT_RUNTIME_ROLLOUT_FLAGS = Object.freeze({
  mcpSurfaceSplit: true,
  historyCodec: true,
  renderPresentPath: true,
  midiExpressiveUi: true
});

const ROLLOUT_QUERY_KEYS = Object.freeze({
  mcpSurfaceSplit: Object.freeze({
    rollout: ['rolloutMcpSplit', 'rmcp'],
    rollback: ['rollbackMcpSplit', 'rbmcp']
  }),
  historyCodec: Object.freeze({
    rollout: ['rolloutHistoryCodec', 'rhc'],
    rollback: ['rollbackHistoryCodec', 'rbhc']
  }),
  renderPresentPath: Object.freeze({
    rollout: ['rolloutRenderPresent', 'rrp'],
    rollback: ['rollbackRenderPresent', 'rbrp']
  }),
  midiExpressiveUi: Object.freeze({
    rollout: ['rolloutMidiUi', 'rmu'],
    rollback: ['rollbackMidiUi', 'rbmu']
  })
});

const BOOL_TRUE = new Set(['', '1', 'true', 'yes', 'on', 'enabled', 'enable']);
const BOOL_FALSE = new Set(['0', 'false', 'no', 'off', 'disabled', 'disable']);

const parseBoolish = (value) => {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (BOOL_TRUE.has(normalized)) return true;
  if (BOOL_FALSE.has(normalized)) return false;
  return null;
};

const readQueryValue = (query, names = []) => {
  if (!query) return null;
  for (const name of names) {
    if (!query.has(name)) continue;
    return query.get(name);
  }
  return null;
};

const toRuntimeRolloutObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
);

const coerceRolloutFlag = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  const parsed = parseBoolish(value);
  return parsed == null ? fallback : parsed;
};

const resolveRuntimeRolloutFlags = ({
  query = null,
  search = '',
  runtimeFlags = null,
  defaults = DEFAULT_RUNTIME_ROLLOUT_FLAGS
} = {}) => {
  const activeQuery = query || (
    typeof URLSearchParams === 'function'
      ? new URLSearchParams(search || '')
      : null
  );
  const runtime = toRuntimeRolloutObject(runtimeFlags);
  const resolved = {
    ...DEFAULT_RUNTIME_ROLLOUT_FLAGS,
    ...toRuntimeRolloutObject(defaults)
  };

  for (const key of Object.keys(DEFAULT_RUNTIME_ROLLOUT_FLAGS)) {
    resolved[key] = coerceRolloutFlag(runtime[key], resolved[key]);
  }

  const rollbackAll = parseBoolish(readQueryValue(activeQuery, ['rollbackAll', 'rba']));
  if (rollbackAll === true) {
    for (const key of Object.keys(resolved)) {
      resolved[key] = false;
    }
    return resolved;
  }

  for (const [flagKey, keyConfig] of Object.entries(ROLLOUT_QUERY_KEYS)) {
    const rollbackValue = parseBoolish(readQueryValue(activeQuery, keyConfig.rollback));
    if (rollbackValue === true) {
      resolved[flagKey] = false;
      continue;
    }
    const rolloutValue = parseBoolish(readQueryValue(activeQuery, keyConfig.rollout));
    if (rolloutValue != null) {
      resolved[flagKey] = rolloutValue;
    }
  }

  return resolved;
};

export {
  DEFAULT_RUNTIME_ROLLOUT_FLAGS,
  ROLLOUT_QUERY_KEYS,
  resolveRuntimeRolloutFlags
};
