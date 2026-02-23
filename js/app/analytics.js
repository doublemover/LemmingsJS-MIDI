import { DEFAULT_RUNTIME_PROFILE, normalizeRuntimeProfile } from '../core/runtimeProfiles.js';

const ANALYTICS_SCHEMA_VERSION = 1;
const DEFAULT_ANALYTICS_BUFFER_CAPACITY = 256;
const MAX_ANALYTICS_BUFFER_CAPACITY = 4096;
const MAX_ANALYTICS_IMPORT_EVENTS = 4096;

const analyticsStorageKeys = Object.freeze({
  consent: 'lemmings.analytics.consent.v1',
  buffer: 'lemmings.analytics.buffer.v1'
});

const ANALYTICS_EVENT_TYPES = Object.freeze({
  VISITOR_PAGE_VIEW: 'visitor.page_view',
  GAMEPLAY_LEVEL_SELECT: 'gameplay.level_select',
  GAMEPLAY_MIDI_TOGGLE: 'gameplay.midi_toggle',
  GAMEPLAY_SAVED_LEVEL: 'gameplay.saved_level',
  EDITOR_ACTION: 'editor.action',
  RUNTIME_BOOT_ERROR: 'runtime.boot_error'
});

const ALLOWED_SURFACES = new Set(['game', 'editor', 'procgen']);
const ALLOWED_LEVEL_SELECT_CONTROLS = new Set(['gameType', 'levelGroup', 'levelIndex']);
const ALLOWED_SAVED_LEVEL_ACTIONS = new Set(['save', 'export', 'import', 'load']);
const ALLOWED_EDITOR_ACTIONS = new Set(['new', 'save', 'export', 'import', 'playtest']);
const ALLOWED_BOOT_ERROR_CODES = new Set(['boot_error', 'midi_error', 'resource_error']);

const BOOL_TRUE_VALUES = new Set(['', '1', 'true', 'yes', 'on', 'enabled', 'enable', 'granted', 'grant']);
const BOOL_FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled', 'disable', 'denied', 'deny']);

const clampInt = (value, min, max, fallback = null) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const truncated = Math.trunc(num);
  if (truncated < min) return min;
  if (truncated > max) return max;
  return truncated;
};

const parseBoolish = (value) => {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (BOOL_TRUE_VALUES.has(normalized)) return true;
  if (BOOL_FALSE_VALUES.has(normalized)) return false;
  return null;
};

const parseSampleRate = (value, fallback = 1) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return num;
};

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const sanitizeSurface = (value, fallback = 'game') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (ALLOWED_SURFACES.has(normalized)) return normalized;
  return fallback;
};

const sanitizeProfile = (value, fallback = DEFAULT_RUNTIME_PROFILE) => {
  return normalizeRuntimeProfile(value || fallback);
};

const sanitizePath = (value, fallback = '/') => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const withoutQuery = raw.split('?')[0].split('#')[0];
  const path = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return path.slice(0, 120) || fallback;
};

const sanitizeBootErrorCode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (ALLOWED_BOOT_ERROR_CODES.has(normalized)) return normalized;
  return 'boot_error';
};

const sanitizeBeaconEndpoint = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.slice(0, 512);
};

const readQueryValue = (params, names = []) => {
  if (!params) return null;
  for (const name of names) {
    if (!params.has(name)) continue;
    return params.get(name);
  }
  return null;
};

const readMetaContent = (documentRef, name) => {
  if (!documentRef?.querySelector) return null;
  const node = documentRef.querySelector(`meta[name="${name}"]`);
  const content = node?.getAttribute?.('content');
  return content == null ? null : String(content);
};

const isDevLocation = (locationRef) => {
  if (!locationRef) return false;
  if (String(locationRef.protocol || '').toLowerCase() === 'file:') return true;
  const host = String(locationRef.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
};

const isHardDisabledByMeta = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'off' || normalized === 'disabled' || normalized === 'hard-off' || normalized === 'hard_disabled';
};

const safeStorageGet = (storage, key) => {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
};

const safeStorageSet = (storage, key, value) => {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // ignored
  }
};

const safeStorageRemove = (storage, key) => {
  try {
    storage?.removeItem?.(key);
  } catch {
    // ignored
  }
};

const readStoredConsent = (storage) => {
  const value = safeStorageGet(storage, analyticsStorageKeys.consent);
  if (value == null) return null;
  if (value === 'granted') return true;
  if (value === 'denied') return false;
  const parsed = parseBoolish(value);
  return parsed == null ? null : parsed;
};

const writeStoredConsent = (storage, granted) => {
  if (granted === true) {
    safeStorageSet(storage, analyticsStorageKeys.consent, 'granted');
    return;
  }
  if (granted === false) {
    safeStorageSet(storage, analyticsStorageKeys.consent, 'denied');
    return;
  }
  safeStorageRemove(storage, analyticsStorageKeys.consent);
};

const createSessionId = (now, random) => {
  const nowPart = clampInt(now(), 0, Number.MAX_SAFE_INTEGER, 0).toString(36);
  const randPart = Math.trunc(Math.max(0, Math.min(1, random())) * 0x7fffffff).toString(36);
  return `${nowPart}-${randPart}`;
};

const createRingBuffer = (capacity = DEFAULT_ANALYTICS_BUFFER_CAPACITY) => {
  const cap = clampInt(capacity, 1, MAX_ANALYTICS_BUFFER_CAPACITY, DEFAULT_ANALYTICS_BUFFER_CAPACITY);
  const entries = new Array(cap);
  let start = 0;
  let count = 0;

  const push = (value) => {
    if (!value) return;
    const writeIndex = (start + count) % cap;
    entries[writeIndex] = value;
    if (count < cap) {
      count += 1;
      return;
    }
    start = (start + 1) % cap;
  };

  const clear = () => {
    for (let i = 0; i < count; i += 1) {
      entries[(start + i) % cap] = undefined;
    }
    start = 0;
    count = 0;
  };

  const values = () => {
    const out = new Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = entries[(start + i) % cap];
    }
    return out;
  };

  const replace = (list) => {
    clear();
    if (!Array.isArray(list)) return;
    for (const item of list) {
      push(item);
    }
  };

  return {
    capacity: cap,
    size: () => count,
    push,
    clear,
    values,
    replace
  };
};

const sanitizeEventPayload = (type, payload, defaults = {}) => {
  const data = asObject(payload);
  switch (type) {
  case ANALYTICS_EVENT_TYPES.VISITOR_PAGE_VIEW:
    return {
      surface: sanitizeSurface(data.surface, sanitizeSurface(defaults.surface, 'game')),
      profile: sanitizeProfile(data.profile, sanitizeProfile(defaults.profile, DEFAULT_RUNTIME_PROFILE)),
      embedMode: !!data.embedMode,
      path: sanitizePath(data.path, sanitizePath(defaults.path || '/'))
    };
  case ANALYTICS_EVENT_TYPES.GAMEPLAY_LEVEL_SELECT: {
    const control = String(data.control || '').trim();
    if (!ALLOWED_LEVEL_SELECT_CONTROLS.has(control)) return null;
    const value = clampInt(data.value, 0, 9999, null);
    if (value == null) return null;
    return { control, value };
  }
  case ANALYTICS_EVENT_TYPES.GAMEPLAY_MIDI_TOGGLE:
    return { enabled: !!data.enabled };
  case ANALYTICS_EVENT_TYPES.GAMEPLAY_SAVED_LEVEL: {
    const action = String(data.action || '').trim().toLowerCase();
    if (!ALLOWED_SAVED_LEVEL_ACTIONS.has(action)) return null;
    return { action };
  }
  case ANALYTICS_EVENT_TYPES.EDITOR_ACTION: {
    const action = String(data.action || '').trim().toLowerCase();
    if (!ALLOWED_EDITOR_ACTIONS.has(action)) return null;
    const output = { action };
    if (typeof data.enabled === 'boolean') {
      output.enabled = data.enabled;
    }
    return output;
  }
  case ANALYTICS_EVENT_TYPES.RUNTIME_BOOT_ERROR:
    return {
      code: sanitizeBootErrorCode(data.code),
      surface: sanitizeSurface(data.surface, sanitizeSurface(defaults.surface, 'game')),
      profile: sanitizeProfile(data.profile, sanitizeProfile(defaults.profile, DEFAULT_RUNTIME_PROFILE)),
      embedMode: !!data.embedMode
    };
  default:
    return null;
  }
};

const sanitizeEnvelopeEvents = (value, max = MAX_ANALYTICS_IMPORT_EVENTS) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const limit = clampInt(max, 1, MAX_ANALYTICS_IMPORT_EVENTS, MAX_ANALYTICS_IMPORT_EVENTS);
  for (let i = 0; i < value.length && out.length < limit; i += 1) {
    const entry = asObject(value[i]);
    const type = String(entry.type || '').trim();
    const payload = sanitizeEventPayload(type, entry.data || entry.payload || {}, {
      surface: entry.surface,
      profile: entry.profile,
      path: entry.path
    });
    if (!payload) continue;
    const event = {
      v: ANALYTICS_SCHEMA_VERSION,
      id: String(entry.id || `import-${out.length + 1}`).slice(0, 128),
      ts: clampInt(entry.ts, 0, Number.MAX_SAFE_INTEGER, 0),
      type,
      surface: sanitizeSurface(entry.surface, 'game'),
      profile: sanitizeProfile(entry.profile, DEFAULT_RUNTIME_PROFILE),
      data: payload
    };
    out.push(event);
  }
  return out;
};

const readStoredBuffer = (storage) => {
  const raw = safeStorageGet(storage, analyticsStorageKeys.buffer);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return sanitizeEnvelopeEvents(parsed?.events || []);
  } catch {
    return [];
  }
};

const writeStoredBuffer = (storage, events) => {
  if (!storage) return;
  safeStorageSet(
    storage,
    analyticsStorageKeys.buffer,
    JSON.stringify({
      version: ANALYTICS_SCHEMA_VERSION,
      events
    })
  );
};

const createAnalyticsService = (options = {}) => {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const windowRef = options.window || null;
  const documentRef = options.document || windowRef?.document || null;
  const navigatorRef = options.navigator || windowRef?.navigator || null;
  const locationRef = options.location || windowRef?.location || null;
  const storage = options.localStorage || null;
  const queryParams = typeof URLSearchParams === 'function'
    ? new URLSearchParams(locationRef?.search || '')
    : null;

  let surface = sanitizeSurface(options.surface, 'game');
  let profile = sanitizeProfile(options.profile, DEFAULT_RUNTIME_PROFILE);
  let hardDisabled = options.hardDisabled === true || isHardDisabledByMeta(readMetaContent(documentRef, 'lemmings-analytics'));
  let runtimeDisabled = options.runtimeDisabled === true;

  const queryDisable = parseBoolish(readQueryValue(queryParams, ['analyticsOff', 'noAnalytics']));
  if (queryDisable === true) runtimeDisabled = true;
  if (queryDisable === false) runtimeDisabled = false;

  const queryHardDisable = parseBoolish(readQueryValue(queryParams, ['analyticsHardOff']));
  if (queryHardDisable === true) hardDisabled = true;

  let consentGranted = readStoredConsent(storage);
  const queryConsent = parseBoolish(readQueryValue(queryParams, ['analytics', 'analyticsConsent']));
  if (queryConsent != null) {
    consentGranted = queryConsent;
    writeStoredConsent(storage, consentGranted);
  }
  if (typeof options.consent === 'boolean') {
    consentGranted = options.consent;
  }
  if (consentGranted == null) {
    consentGranted = false;
  }

  // Development hosts stay opt-in by default.
  if (isDevLocation(locationRef) && queryConsent == null && readStoredConsent(storage) !== true) {
    consentGranted = false;
  }

  const metaEndpoint = readMetaContent(documentRef, 'lemmings-analytics-endpoint');
  let beaconEndpoint = sanitizeBeaconEndpoint(options.managedBeaconEndpoint || metaEndpoint || '');
  let managedBeaconRequested = options.enableManagedBeacon === true;
  const queryBeacon = parseBoolish(readQueryValue(queryParams, ['analyticsBeacon']));
  if (queryBeacon != null) managedBeaconRequested = queryBeacon;
  let sampleRate = parseSampleRate(options.sampleRate, 1);
  const querySampleRate = readQueryValue(queryParams, ['analyticsSample']);
  if (querySampleRate != null) {
    sampleRate = parseSampleRate(querySampleRate, sampleRate);
  }

  const ringBuffer = createRingBuffer(options.maxEvents);
  ringBuffer.replace(readStoredBuffer(storage));
  let pendingBeaconEvents = [];
  const sessionId = createSessionId(now, random);
  let sequence = 0;

  const isEnabled = () => !hardDisabled && !runtimeDisabled && consentGranted === true;
  const isBeaconEnabled = () => isEnabled() && managedBeaconRequested && !!beaconEndpoint;

  const persist = () => {
    writeStoredBuffer(storage, ringBuffer.values());
  };

  const flushManagedBeacon = () => {
    const attempted = pendingBeaconEvents.length;
    if (!attempted) return { ok: false, attempted: 0, sent: 0 };
    if (!isBeaconEnabled()) return { ok: false, attempted, sent: 0 };
    if (typeof navigatorRef?.sendBeacon !== 'function') return { ok: false, attempted, sent: 0 };
    const payload = JSON.stringify({
      version: ANALYTICS_SCHEMA_VERSION,
      sessionId,
      surface,
      profile,
      sentAt: clampInt(now(), 0, Number.MAX_SAFE_INTEGER, 0),
      events: pendingBeaconEvents.slice()
    });
    const ok = !!navigatorRef.sendBeacon(beaconEndpoint, payload);
    if (ok) {
      pendingBeaconEvents = [];
    }
    return { ok, attempted, sent: ok ? attempted : 0 };
  };

  const maybeQueueForBeacon = (event) => {
    if (!event || !isBeaconEnabled()) return;
    if (sampleRate < 1 && random() > sampleRate) return;
    pendingBeaconEvents.push(event);
    if (pendingBeaconEvents.length >= 10) {
      flushManagedBeacon();
    }
  };

  const track = (type, payload = {}) => {
    if (!isEnabled()) return null;
    const sanitized = sanitizeEventPayload(type, payload, {
      surface,
      profile,
      path: locationRef?.pathname || '/'
    });
    if (!sanitized) return null;
    const event = {
      v: ANALYTICS_SCHEMA_VERSION,
      id: `${sessionId}:${sequence + 1}`,
      ts: clampInt(now(), 0, Number.MAX_SAFE_INTEGER, 0),
      type,
      surface,
      profile,
      data: sanitized
    };
    sequence += 1;
    ringBuffer.push(event);
    persist();
    maybeQueueForBeacon(event);
    return event;
  };

  const trackPageView = (payload = {}) => track(
    ANALYTICS_EVENT_TYPES.VISITOR_PAGE_VIEW,
    {
      surface,
      profile,
      path: locationRef?.pathname || '/',
      ...asObject(payload)
    }
  );

  const getStatus = () => ({
    version: ANALYTICS_SCHEMA_VERSION,
    enabled: isEnabled(),
    hardDisabled,
    runtimeDisabled,
    consentGranted: consentGranted === true,
    surface,
    profile,
    devLocation: isDevLocation(locationRef),
    managedBeacon: {
      requested: managedBeaconRequested,
      enabled: isBeaconEnabled(),
      endpoint: beaconEndpoint || null,
      sampleRate,
      pending: pendingBeaconEvents.length
    },
    ringBuffer: {
      size: ringBuffer.size(),
      capacity: ringBuffer.capacity
    }
  });

  const setConsent = (granted, { persistConsent = true } = {}) => {
    consentGranted = granted === true;
    if (persistConsent) {
      writeStoredConsent(storage, consentGranted);
    }
    if (!isEnabled()) {
      pendingBeaconEvents = [];
    }
    return getStatus();
  };

  const setContext = (next = {}) => {
    surface = sanitizeSurface(next.surface, surface);
    profile = sanitizeProfile(next.profile, profile);
    return getStatus();
  };

  const configureManagedBeacon = ({
    enabled,
    endpoint,
    sample
  } = {}) => {
    if (typeof enabled === 'boolean') {
      managedBeaconRequested = enabled;
    }
    if (endpoint != null) {
      beaconEndpoint = sanitizeBeaconEndpoint(endpoint);
    }
    if (sample != null) {
      sampleRate = parseSampleRate(sample, sampleRate);
    }
    return getStatus();
  };

  const exportBuffer = () => ({
    version: ANALYTICS_SCHEMA_VERSION,
    exportedAt: clampInt(now(), 0, Number.MAX_SAFE_INTEGER, 0),
    sessionId,
    surface,
    profile,
    events: ringBuffer.values()
  });

  const importBuffer = (value, { replace = false } = {}) => {
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = null;
      }
    }
    const events = sanitizeEnvelopeEvents(parsed?.events || []);
    if (replace) {
      ringBuffer.clear();
    }
    for (const event of events) {
      ringBuffer.push(event);
    }
    persist();
    return {
      imported: events.length,
      total: ringBuffer.size()
    };
  };

  const clearBuffer = () => {
    ringBuffer.clear();
    pendingBeaconEvents = [];
    persist();
  };

  const installWindowApi = (targetWindow = windowRef) => {
    if (!targetWindow) return null;
    const api = {
      version: ANALYTICS_SCHEMA_VERSION,
      getStatus,
      track,
      trackPageView,
      exportBuffer,
      importBuffer,
      clearBuffer,
      setConsent,
      setContext,
      configureManagedBeacon,
      flushManagedBeacon
    };
    targetWindow.__LEMMINGS_ANALYTICS__ = api;
    return api;
  };

  return {
    track,
    trackPageView,
    getStatus,
    setConsent,
    setContext,
    configureManagedBeacon,
    exportBuffer,
    importBuffer,
    clearBuffer,
    flushManagedBeacon,
    installWindowApi
  };
};

export {
  ANALYTICS_SCHEMA_VERSION,
  DEFAULT_ANALYTICS_BUFFER_CAPACITY,
  ANALYTICS_EVENT_TYPES,
  analyticsStorageKeys,
  createAnalyticsService,
  sanitizeEventPayload,
  sanitizeEnvelopeEvents
};
