const DEFAULT_RUNTIME_PROFILE = 'classic';

const RUNTIME_PROFILE_ALIASES = Object.freeze({
  gameplay: 'classic'
});

const RUNTIME_PROFILE_PRESETS = Object.freeze({
  classic: Object.freeze({
    id: 'classic',
    historyRetention: Object.freeze({
      enableHistoryCap: true,
      historyCapTicks: 20000,
      historyWarnTicks: 15000
    }),
    instrumentation: Object.freeze({
      performanceAPI: false,
      perfMetrics: false,
      perfOverlay: false
    }),
    rendering: Object.freeze({
      offscreenPresentExperiment: false,
      workerOffscreenExperiment: false
    }),
    logging: Object.freeze({
      debug: false
    })
  }),
  midi: Object.freeze({
    id: 'midi',
    historyRetention: Object.freeze({
      enableHistoryCap: true,
      historyCapTicks: 22000,
      historyWarnTicks: 16500
    }),
    instrumentation: Object.freeze({
      performanceAPI: false,
      perfMetrics: false,
      perfOverlay: false
    }),
    rendering: Object.freeze({
      offscreenPresentExperiment: false,
      workerOffscreenExperiment: false
    }),
    logging: Object.freeze({
      debug: false
    })
  }),
  editor: Object.freeze({
    id: 'editor',
    historyRetention: Object.freeze({
      enableHistoryCap: true,
      historyCapTicks: 16000,
      historyWarnTicks: 12000
    }),
    instrumentation: Object.freeze({
      performanceAPI: false,
      perfMetrics: false,
      perfOverlay: false
    }),
    rendering: Object.freeze({
      offscreenPresentExperiment: false,
      workerOffscreenExperiment: false
    }),
    logging: Object.freeze({
      debug: false
    })
  }),
  e2e: Object.freeze({
    id: 'e2e',
    historyRetention: Object.freeze({
      enableHistoryCap: true,
      historyCapTicks: 12000,
      historyWarnTicks: 9000
    }),
    instrumentation: Object.freeze({
      performanceAPI: false,
      perfMetrics: false,
      perfOverlay: false
    }),
    rendering: Object.freeze({
      offscreenPresentExperiment: false,
      workerOffscreenExperiment: false
    }),
    logging: Object.freeze({
      debug: false
    })
  }),
  perf: Object.freeze({
    id: 'perf',
    historyRetention: Object.freeze({
      enableHistoryCap: true,
      historyCapTicks: 12000,
      historyWarnTicks: 9000
    }),
    instrumentation: Object.freeze({
      performanceAPI: true,
      perfMetrics: true,
      perfOverlay: true
    }),
    rendering: Object.freeze({
      offscreenPresentExperiment: false,
      workerOffscreenExperiment: false
    }),
    logging: Object.freeze({
      debug: false
    })
  })
});

const SPECIAL_HISTORY_RETENTION_POLICIES = Object.freeze({
  endless: Object.freeze({
    enableHistoryCap: true,
    historyCapTicks: 24000,
    historyWarnTicks: 18000
  }),
  bench: Object.freeze({
    enableHistoryCap: true,
    historyCapTicks: 12000,
    historyWarnTicks: 9000
  })
});

const normalizeRuntimeProfile = (profile) => {
  const raw = String(profile || '').trim().toLowerCase();
  const normalized = RUNTIME_PROFILE_ALIASES[raw] || raw;
  if (RUNTIME_PROFILE_PRESETS[normalized]) return normalized;
  return DEFAULT_RUNTIME_PROFILE;
};

const getRuntimeProfilePreset = (profile) => {
  const normalized = normalizeRuntimeProfile(profile);
  return RUNTIME_PROFILE_PRESETS[normalized] || RUNTIME_PROFILE_PRESETS[DEFAULT_RUNTIME_PROFILE];
};

const getRuntimeProfileIds = () => Object.keys(RUNTIME_PROFILE_PRESETS);

const getProfileHistoryRetention = (profile) => {
  const preset = getRuntimeProfilePreset(profile);
  return { ...(preset.historyRetention || {}) };
};

const getSpecialHistoryRetention = (name) => {
  const policy = SPECIAL_HISTORY_RETENTION_POLICIES[name];
  if (!policy) return null;
  return { ...policy };
};

export {
  DEFAULT_RUNTIME_PROFILE,
  RUNTIME_PROFILE_ALIASES,
  RUNTIME_PROFILE_PRESETS,
  SPECIAL_HISTORY_RETENTION_POLICIES,
  getProfileHistoryRetention,
  getRuntimeProfileIds,
  getRuntimeProfilePreset,
  getSpecialHistoryRetention,
  normalizeRuntimeProfile
};
