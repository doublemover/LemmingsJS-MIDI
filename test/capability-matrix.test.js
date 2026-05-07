import { expect } from 'chai';
import {
  detectRuntimeCapabilities,
  resolveRenderExperimentState
} from '../js/core/capabilityMatrix.js';

describe('capabilityMatrix', function () {
  it('returns deterministic fallbacks when optional APIs are unavailable', function () {
    const capabilities = detectRuntimeCapabilities({
      windowRef: {},
      navigatorRef: {},
      webMidi: null
    });

    expect(capabilities.webMidi.supported).to.equal(false);
    expect(capabilities.webMidi.fallbackPath).to.equal('audio_only');
    expect(capabilities.offscreenCanvas.supported).to.equal(false);
    expect(capabilities.imageBitmap.supported).to.equal(false);
    expect(capabilities.renderPaths.presentPathSupported).to.equal(false);
    expect(capabilities.renderPaths.workerOffscreenSupported).to.equal(false);
    expect(capabilities.renderPaths.deterministicFallback).to.equal('canvas2d_main_thread');
  });

  it('detects full capability support for WebMIDI/offscreen/imagebitmap/worker', function () {
    const windowRef = {
      OffscreenCanvas: function OffscreenCanvas() {},
      createImageBitmap() {},
      Worker: function Worker() {},
      HTMLCanvasElement: {
        prototype: {
          transferControlToOffscreen() {}
        }
      }
    };
    const navigatorRef = {
      requestMIDIAccess() {}
    };
    const webMidi = {
      enabled: true,
      enable() {}
    };

    const capabilities = detectRuntimeCapabilities({
      windowRef,
      navigatorRef,
      webMidi
    });

    expect(capabilities.webMidi.supported).to.equal(true);
    expect(capabilities.webMidi.enabled).to.equal(true);
    expect(capabilities.offscreenCanvas.supported).to.equal(true);
    expect(capabilities.imageBitmap.supported).to.equal(true);
    expect(capabilities.worker.supported).to.equal(true);
    expect(capabilities.renderPaths.presentPathSupported).to.equal(true);
    expect(capabilities.renderPaths.workerOffscreenSupported).to.equal(true);
  });

  it('keeps present-path support when only Canvas2D is available', function () {
    const capabilities = detectRuntimeCapabilities({
      windowRef: {
        document: {
          createElement() {}
        }
      },
      navigatorRef: {}
    });
    expect(capabilities.renderPaths.presentPathSupported).to.equal(true);
    expect(capabilities.renderPaths.workerOffscreenSupported).to.equal(false);
    expect(capabilities.renderPaths.deterministicFallback).to.equal('drawimage_present');
  });

  it('resolves experiment rollback reasons deterministically', function () {
    const noImageBitmap = {
      offscreenCanvas: { supported: true },
      imageBitmap: { supported: false },
      worker: { supported: true },
      renderPaths: {
        presentPathSupported: false,
        workerOffscreenSupported: false,
        deterministicFallback: 'canvas2d_main_thread'
      }
    };
    const withImageNoWorker = {
      offscreenCanvas: { supported: true },
      imageBitmap: { supported: true },
      worker: { supported: false },
      renderPaths: {
        presentPathSupported: true,
        workerOffscreenSupported: false,
        deterministicFallback: 'drawimage_present'
      }
    };

    const offscreenState = resolveRenderExperimentState({ offscreenPresent: true }, noImageBitmap);
    expect(offscreenState.presentPathActive).to.equal(false);
    expect(offscreenState.offscreenPresentActive).to.equal(false);
    expect(offscreenState.rollbackReason).to.equal('imagebitmap_unavailable');

    const workerState = resolveRenderExperimentState(
      { offscreenPresent: true, workerOffscreen: true },
      withImageNoWorker
    );
    expect(workerState.presentPathActive).to.equal(true);
    expect(workerState.offscreenPresentActive).to.equal(true);
    expect(workerState.workerOffscreenActive).to.equal(false);
    expect(workerState.rollbackReason).to.equal('worker_unavailable');
  });
});
