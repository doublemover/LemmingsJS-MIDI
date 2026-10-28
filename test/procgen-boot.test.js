import { expect } from 'chai';
import { normalizeSeed } from '../js/core/seededRandom.js';
import {
  registerStyle,
  registerClassicStyles,
  resetStyleRegistry
} from '../js/editor/StyleRegistry.js';

describe('procgenBoot helpers', function () {
  let procgenBoot;
  let previousWindow;
  let previousDocument;
  let previousAutoBootFlag;

  before(async function () {
    previousWindow = globalThis.window;
    previousDocument = globalThis.document;
    previousAutoBootFlag = globalThis.__LEMMINGS_PROCGEN_NO_AUTO_BOOT__;
    globalThis.__LEMMINGS_PROCGEN_NO_AUTO_BOOT__ = true;
    globalThis.window = {};
    globalThis.document = {};
    procgenBoot = await import(`../js/app/procgenBoot.js?procgen_boot_test=${Date.now()}`);
  });

  after(function () {
    if (previousAutoBootFlag === undefined) {
      delete globalThis.__LEMMINGS_PROCGEN_NO_AUTO_BOOT__;
    } else {
      globalThis.__LEMMINGS_PROCGEN_NO_AUTO_BOOT__ = previousAutoBootFlag;
    }
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    resetStyleRegistry();
    registerClassicStyles();
  });

  afterEach(function () {
    procgenBoot.disposeProcgenRuntime();
    resetStyleRegistry();
    registerClassicStyles();
  });

  it('honors an explicit seed and otherwise starts fresh without reading the prior seed', function () {
    globalThis.window = {
      localStorage: {
        getItem() {
          throw new Error('Previous seed must not be read');
        }
      },
      crypto: { getRandomValues(values) { values[0] = 123456789; } }
    };

    expect(procgenBoot.resolveProcgenSeed(new URLSearchParams('seed=42')))
      .to.equal(normalizeSeed('42'));
    expect(procgenBoot.resolveProcgenSeed(new URLSearchParams(''))).to.equal(123456789);
  });

  it('selects one deterministic compatible style without reading the previous run', async function () {
    resetStyleRegistry();
    registerStyle('alpha', { groundSet: 0 });
    registerStyle('beta', { groundSet: 1 });
    const writes = new Map();
    let readCount = 0;
    globalThis.window = {
      localStorage: {
        getItem() {
          readCount += 1;
          return null;
        },
        setItem(key, value) {
          writes.set(key, value);
        }
      }
    };

    const style = await procgenBoot.pickProcgenStyle(null, { path: 'lemmings' }, () => 0);
    expect(style).to.equal('alpha');
    expect(readCount).to.equal(0);
    expect(writes.get('procgen.style')).to.equal('alpha');
  });

  it('falls through style candidates when assets are missing', async function () {
    resetStyleRegistry();
    registerStyle('alpha', { groundSet: 0 });
    registerStyle('beta', { groundSet: 1 });
    const writes = new Map();
    const calls = [];
    globalThis.window = {
      localStorage: {
        getItem() {
          return null;
        },
        setItem(key, value) {
          writes.set(key, value);
        }
      }
    };

    const provider = {
      async loadBinary(_path, filename) {
        calls.push(filename);
        if (filename.includes('1')) {
          return new Uint8Array([1]);
        }
        throw new Error('missing asset');
      }
    };

    const style = await procgenBoot.pickProcgenStyle(
      provider,
      { path: 'lemmings' },
      () => 0
    );
    expect(style).to.equal('beta');
    expect(calls.some(name => name.includes('VGAGR0'))).to.equal(true);
    expect(calls.some(name => name.includes('VGAGR1'))).to.equal(true);
    expect(writes.get('procgen.style')).to.equal('beta');
  });

  it('builds a selected theme contract for debug state', function () {
    resetStyleRegistry();
    registerStyle('alpha', { groundSet: 3 });

    const contract = procgenBoot.buildProcgenThemeContract('alpha', { path: 'lemmings' });

    expect(contract).to.deep.equal({
      selectedTheme: 'alpha',
      styleName: 'alpha',
      groundSet: 3,
      packPath: 'lemmings'
    });
  });

  it('builds deterministic debug controller options from query params', function () {
    const options = procgenBoot.buildProcgenControllerOptions(
      new URLSearchParams([
        ['gapChance', '1'],
        ['gapMinWidth', '5'],
        ['gapMaxWidth', '5'],
        ['recentCertificateLimit', '8'],
        ['procgenCertificateVerification', 'false']
      ]),
      {
        gapChance: 0.08,
        gapMinWidth: 3,
        gapMaxWidth: 9,
        recentCertificateLimit: 32,
        procgenCertificateVerification: true
      }
    );

    expect(options).to.include({
      gapChance: 1,
      gapMinWidth: 5,
      gapMaxWidth: 5,
      recentCertificateLimit: 8,
      procgenCertificateVerification: false
    });

    const fallback = procgenBoot.buildProcgenControllerOptions(
      new URLSearchParams('gapChance=not-a-number&procgenCertificateVerification=maybe'),
      {
        gapChance: 0.25,
        procgenCertificateVerification: true
      }
    );

    expect(fallback).to.include({
      gapChance: 0.25,
      procgenCertificateVerification: true
    });
  });

  it('disposes active procgen runtime once and clears references', function () {
    const calls = [];
    procgenBoot.setActiveProcgenRuntimeForTest({
      focusBlurCleanup() { calls.push('focusBlur'); },
      controller: { stop() { calls.push('controller'); } },
      stageAdapter: { dispose() { calls.push('stageAdapter'); } },
      game: { stop() { calls.push('game'); } },
      view: { dispose() { calls.push('view'); } }
    });

    procgenBoot.disposeProcgenRuntime();
    procgenBoot.disposeProcgenRuntime();

    expect(calls).to.deep.equal(['focusBlur', 'controller', 'stageAdapter', 'game', 'view']);
  });

  it('retires the asset provider only after the active runtime releases its resources', function () {
    const calls = [];
    procgenBoot.setActiveProcgenRuntimeForTest({
      lanes: { stop() { calls.push('lanes'); } },
      view: { dispose() { calls.push('view'); } },
      providerLease: { release() { calls.push('lease'); } },
      fileProvider: { dispose() { calls.push('provider'); } }
    });
    procgenBoot.disposeProcgenRuntime();
    expect(calls).to.deep.equal(['lanes', 'view', 'lease', 'provider']);
  });

  it('releases game resource readers before the provider on runtime retirement', function () {
    const calls = [];
    procgenBoot.setActiveProcgenRuntimeForTest({
      game: { stop() { calls.push('game'); } },
      resources: { dispose() { calls.push('resources'); } },
      providerLease: { release() { calls.push('lease'); } },
      fileProvider: { dispose() { calls.push('provider'); } }
    });
    procgenBoot.disposeProcgenRuntime();
    expect(calls).to.deep.equal(['game', 'resources', 'lease', 'provider']);
  });

  it('continues runtime retirement after a throwing early owner', function () {
    const calls = [];
    procgenBoot.setActiveProcgenRuntimeForTest({
      focusBlurCleanup() { calls.push('focusBlur'); throw new Error('detach failed'); },
      lanes: { stop() { calls.push('lanes'); } },
      controller: { stop() { calls.push('controller'); } },
      stageAdapter: { dispose() { calls.push('stageAdapter'); } },
      game: { stop() { calls.push('game'); } },
      view: { dispose() { calls.push('view'); } }
    });
    const receipt = procgenBoot.disposeProcgenRuntime();
    expect(procgenBoot.disposeProcgenRuntime()).to.equal(receipt);
    expect(calls).to.deep.equal(['focusBlur', 'lanes', 'controller', 'stageAdapter', 'game', 'view']);
    expect(receipt.resources.find(resource => resource.name === 'runtime-readers').retirement.resources.find(resource => resource.name === 'focus-blur-listener')).to.include({ status: 'failed', error: 'detach failed' });
  });

  it('installs and disposes procgen boot listeners', function () {
    const windowListeners = new Map();
    const documentListeners = new Map();
    globalThis.window = {
      addEventListener(type, handler) {
        windowListeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (windowListeners.get(type) === handler) windowListeners.delete(type);
      }
    };
    globalThis.document = {
      readyState: 'loading',
      addEventListener(type, handler) {
        documentListeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (documentListeners.get(type) === handler) documentListeners.delete(type);
      }
    };

    procgenBoot.installProcgenBootListeners();
    expect(windowListeners.has('resize')).to.equal(true);
    expect(windowListeners.has('beforeunload')).to.equal(false);
    expect(windowListeners.has('pagehide')).to.equal(true);
    expect(windowListeners.has('pageshow')).to.equal(true);
    expect(documentListeners.has('DOMContentLoaded')).to.equal(true);

    procgenBoot.disposeProcgenBootListeners();
    expect(windowListeners.size).to.equal(0);
    expect(documentListeners.size).to.equal(0);
  });

  it('resizes canvas and updates stage using explicit runtime handles', function () {
    const canvas = {
      width: 0,
      height: 0,
      style: {}
    };
    let adapterResizeCalls = 0;
    globalThis.window = {
      devicePixelRatio: 1.5,
      innerWidth: 640,
      innerHeight: 360
    };
    globalThis.document = {
      getElementById(id) {
        if (id === 'gameCanvas') return canvas;
        return null;
      }
    };

    procgenBoot.setActiveProcgenRuntimeForTest({
      stageAdapter: {
        updateStageSize() {
          adapterResizeCalls += 1;
        }
      }
    });

    procgenBoot.resizeCanvas();

    expect(canvas.width).to.equal(960);
    expect(canvas.height).to.equal(540);
    expect(canvas.style.width).to.equal('640px');
    expect(canvas.style.height).to.equal('360px');
    expect(adapterResizeCalls).to.equal(1);
  });

  it('reserves the persistent topbar height and caps backing pixel density', function () {
    const canvas = { width: 0, height: 0, style: {} };
    globalThis.window = { devicePixelRatio: 3, innerWidth: 390, innerHeight: 800 };
    globalThis.document = { getElementById: id => id === 'gameCanvas' ? canvas : id === 'procgenTopbar' ? { getBoundingClientRect: () => ({ height: 120 }) } : null };
    procgenBoot.resizeCanvas(); expect(canvas.width).to.equal(780); expect(canvas.height).to.equal(1360);
    expect(canvas.style.height).to.equal('680px');
  });
  it('sizes the workstation canvas from its stage instead of covering headers and inspector', function () {
    const canvas = { width: 0, height: 0, style: {} };
    globalThis.window = { devicePixelRatio: 2, innerWidth: 1440, innerHeight: 1000 };
    globalThis.document = { getElementById: id => id === 'gameCanvas' ? canvas : id === 'procgenStudioStage' ? { clientWidth: 954, clientHeight: 786 } : null };
    procgenBoot.resizeCanvas(); expect(canvas.width).to.equal(1908); expect(canvas.height).to.equal(1572);
    expect(canvas.style.width).to.equal('954px'); expect(canvas.style.height).to.equal('786px');
  });

  it('falls back to finite canvas dimensions when viewport metrics are invalid', function () {
    const canvas = {
      width: 0,
      height: 0,
      clientWidth: 320,
      clientHeight: 200,
      style: {}
    };
    globalThis.window = {
      devicePixelRatio: Number.NaN,
      innerWidth: undefined,
      innerHeight: Number.NaN
    };
    globalThis.document = {
      getElementById(id) {
        if (id === 'gameCanvas') return canvas;
        return null;
      }
    };

    procgenBoot.resizeCanvas();

    expect(canvas.width).to.equal(320);
    expect(canvas.height).to.equal(200);
    expect(canvas.style.width).to.equal('320px');
    expect(canvas.style.height).to.equal('200px');
  });

  it('delegates workstation backing allocation to its renderer without clearing a budgeted surface', function () {
    let assignments = 0;
    const canvas = { style: {}, get width() { return 960; }, set width(_value) { assignments++; }, get height() { return 540; }, set height(_value) { assignments++; } };
    const requests = [];
    globalThis.window = { devicePixelRatio: 2, innerWidth: 1920, innerHeight: 1080 };
    globalThis.document = { getElementById: id => id === 'gameCanvas' ? canvas : id === 'procgenStudioStage' ? { clientWidth: 1714, clientHeight: 776 } : null };
    const runtime = { lanes: { renderer: { canvas, resize: request => requests.push(request) } } };
    procgenBoot.resizeCanvas(runtime); procgenBoot.resizeCanvas(runtime);
    expect(requests).to.deep.equal([{ width: 3428, height: 1552 }, { width: 3428, height: 1552 }]);
    expect(assignments).to.equal(0); expect(canvas.style.width).to.equal('1714px');
  });

  it('leaves unchanged fallback backing dimensions intact on repeated resize observations', function () {
    let assignments = 0;
    const canvas = { style: {}, get width() { return 1920; }, set width(_value) { assignments++; }, get height() { return 1080; }, set height(_value) { assignments++; } };
    globalThis.window = { devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080 };
    globalThis.document = { getElementById: id => id === 'gameCanvas' ? canvas : null };
    procgenBoot.resizeCanvas(); procgenBoot.resizeCanvas(); expect(assignments).to.equal(0);
  });
});
