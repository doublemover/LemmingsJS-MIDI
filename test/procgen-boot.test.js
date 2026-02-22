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

  it('prefers a non-last style when no file provider is available', async function () {
    resetStyleRegistry();
    registerStyle('alpha', { groundSet: 0 });
    registerStyle('beta', { groundSet: 1 });
    const writes = new Map();
    globalThis.window = {
      localStorage: {
        getItem(key) {
          if (key === 'procgen.style') return 'alpha';
          return null;
        },
        setItem(key, value) {
          writes.set(key, value);
        }
      }
    };

    const style = await procgenBoot.pickProcgenStyle(null, { path: 'lemmings' }, () => 0);
    expect(style).to.equal('beta');
    expect(writes.get('procgen.style')).to.equal('beta');
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
      () => 0.999
    );
    expect(style).to.equal('beta');
    expect(calls.some(name => name.includes('VGAGR0'))).to.equal(true);
    expect(calls.some(name => name.includes('VGAGR1'))).to.equal(true);
    expect(writes.get('procgen.style')).to.equal('beta');
  });

  it('disposes active procgen runtime once and clears references', function () {
    const calls = [];
    procgenBoot.setActiveProcgenRuntimeForTest({
      controller: { stop() { calls.push('controller'); } },
      stageAdapter: { dispose() { calls.push('stageAdapter'); } },
      game: { stop() { calls.push('game'); } },
      view: { dispose() { calls.push('view'); } }
    });

    procgenBoot.disposeProcgenRuntime();
    procgenBoot.disposeProcgenRuntime();

    expect(calls).to.deep.equal(['controller', 'stageAdapter', 'game', 'view']);
  });
});
