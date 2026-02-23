/**
 * @typedef {object} CapabilityMatrix
 * @property {{supported: boolean, enabled: boolean, fallbackPath: string}} webMidi
 * @property {{supported: boolean, ctorSupported: boolean, transferControlSupported: boolean, fallbackPath: string}} offscreenCanvas
 * @property {{supported: boolean, fallbackPath: string}} imageBitmap
 * @property {{supported: boolean, fallbackPath: string}} worker
 * @property {{offscreenPresentSupported: boolean, workerOffscreenSupported: boolean, deterministicFallback: string}} renderPaths
 */

/** @type {CapabilityMatrix} */
const DEFAULT_CAPABILITY_MATRIX = Object.freeze({
  webMidi: Object.freeze({
    supported: false,
    enabled: false,
    fallbackPath: 'audio_only'
  }),
  offscreenCanvas: Object.freeze({
    supported: false,
    ctorSupported: false,
    transferControlSupported: false,
    fallbackPath: 'canvas2d_main_thread'
  }),
  imageBitmap: Object.freeze({
    supported: false,
    fallbackPath: 'drawimage_main_thread'
  }),
  worker: Object.freeze({
    supported: false,
    fallbackPath: 'main_thread'
  }),
  renderPaths: Object.freeze({
    offscreenPresentSupported: false,
    workerOffscreenSupported: false,
    deterministicFallback: 'canvas2d_main_thread'
  })
});

const hasFunction = (value) => typeof value === 'function';

/**
 * @returns {CapabilityMatrix}
 */
const detectRuntimeCapabilities = ({
  windowRef = (typeof window !== 'undefined' ? window : null),
  navigatorRef = windowRef?.navigator || (typeof navigator !== 'undefined' ? navigator : null),
  webMidi = windowRef?.WebMidi || null
} = {}) => {
  const requestMidiAccessSupported = hasFunction(navigatorRef?.requestMIDIAccess);
  const webMidiSupported = requestMidiAccessSupported
    || !!(webMidi && (hasFunction(webMidi.enable) || webMidi.enabled === true));
  const webMidiEnabled = !!webMidi?.enabled;

  const offscreenCtorSupported = hasFunction(windowRef?.OffscreenCanvas);
  const transferControlSupported = hasFunction(windowRef?.HTMLCanvasElement?.prototype?.transferControlToOffscreen);
  const offscreenSupported = offscreenCtorSupported || transferControlSupported;
  const canvas2dSupported = hasFunction(windowRef?.document?.createElement)
    || (typeof document !== 'undefined' && hasFunction(document?.createElement));

  const imageBitmapSupported = hasFunction(windowRef?.createImageBitmap)
    || (typeof createImageBitmap === 'function');
  const workerSupported = hasFunction(windowRef?.Worker);

  const offscreenPresentSupported = canvas2dSupported || (offscreenSupported && imageBitmapSupported);
  const workerOffscreenSupported = offscreenSupported && imageBitmapSupported && workerSupported;

  const renderFallback = workerOffscreenSupported
    ? 'worker_offscreen'
    : offscreenPresentSupported
      ? 'offscreen_present'
      : 'canvas2d_main_thread';

  return {
    webMidi: {
      supported: webMidiSupported,
      enabled: webMidiEnabled,
      fallbackPath: webMidiSupported ? 'webmidi' : 'audio_only'
    },
    offscreenCanvas: {
      supported: offscreenSupported,
      ctorSupported: offscreenCtorSupported,
      transferControlSupported,
      fallbackPath: offscreenSupported ? 'offscreen_canvas' : 'canvas2d_main_thread'
    },
    imageBitmap: {
      supported: imageBitmapSupported,
      fallbackPath: imageBitmapSupported ? 'imagebitmap' : 'drawimage_main_thread'
    },
    worker: {
      supported: workerSupported,
      fallbackPath: workerSupported ? 'worker' : 'main_thread'
    },
    renderPaths: {
      offscreenPresentSupported,
      workerOffscreenSupported,
      deterministicFallback: renderFallback
    }
  };
};

/**
 * @param {{offscreenPresent?: boolean, workerOffscreen?: boolean}} [requestedFlags]
 * @param {CapabilityMatrix} [capabilities]
 */
const resolveRenderExperimentState = (requestedFlags = {}, capabilities = DEFAULT_CAPABILITY_MATRIX) => {
  const requestedOffscreen = !!requestedFlags.offscreenPresent;
  const requestedWorker = !!requestedFlags.workerOffscreen;
  const cap = capabilities || DEFAULT_CAPABILITY_MATRIX;
  const offscreenSupported = !!cap.renderPaths?.offscreenPresentSupported;
  const workerOffscreenSupported = !!cap.renderPaths?.workerOffscreenSupported;

  const offscreenActive = requestedOffscreen && offscreenSupported;
  const workerActive = requestedWorker && offscreenActive && workerOffscreenSupported;

  let rollbackReason = null;
  if (requestedOffscreen && !offscreenActive) {
    rollbackReason = cap.renderPaths?.offscreenPresentSupported
      ? 'offscreen_present_unavailable'
      : (cap.offscreenCanvas?.supported
        ? 'imagebitmap_unavailable'
        : 'offscreen_canvas_unavailable');
  } else if (requestedWorker && !workerActive) {
    if (!cap.offscreenCanvas?.supported) {
      rollbackReason = 'offscreen_canvas_unavailable';
    } else if (!cap.imageBitmap?.supported) {
      rollbackReason = 'imagebitmap_unavailable';
    } else if (!cap.worker?.supported) {
      rollbackReason = 'worker_unavailable';
    } else {
      rollbackReason = 'worker_offscreen_unavailable';
    }
  }

  return {
    offscreenPresentRequested: requestedOffscreen,
    offscreenPresentActive: offscreenActive,
    workerOffscreenRequested: requestedWorker,
    workerOffscreenActive: workerActive,
    rollbackReason,
    capabilityFallback: cap.renderPaths?.deterministicFallback || 'canvas2d_main_thread'
  };
};

export {
  DEFAULT_CAPABILITY_MATRIX,
  detectRuntimeCapabilities,
  resolveRenderExperimentState
};
