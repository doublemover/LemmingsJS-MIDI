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

  it('resolves procgen seed with query -> storage -> timestamp precedence', function () {
    globalThis.window = {
      localStorage: {
        getItem() {
          return 'from-storage';
        }
      }
    };

    expect(procgenBoot.resolveProcgenSeed(new URLSearchParams('seed=42')))
      .to.equal(normalizeSeed('42'));
    expect(procgenBoot.resolveProcgenSeed(new URLSearchParams('')))
      .to.equal(normalizeSeed('from-storage'));

    const originalNow = Date.now;
    Date.now = () => 123456789;
    globalThis.window.localStorage.getItem = () => {
      throw new Error('storage blocked');
    };
    try {
      expect(procgenBoot.resolveProcgenSeed(new URLSearchParams('')))
        .to.equal(normalizeSeed(123456789));
    } finally {
      Date.now = originalNow;
    }
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
    expect(windowListeners.has('beforeunload')).to.equal(true);
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
});
