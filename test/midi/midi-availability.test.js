import { expect } from 'chai';
import { resolveMidiAvailability } from '../../js/app/midiAvailability.js';
import { createMidiUiController } from '../../js/app/midiUiController.js';
import { gameViewMidiMethods } from '../../js/game/game-view/GameViewMidi.js';
import { createMidiProjectFromMidiConfig } from '../../js/midi/project/MidiProject.js';
import { PROJECT_STORAGE_KEY, TEMPLATE_STORAGE_KEY } from '../../js/midi/project/MidiProjectStorage.js';
import { TestDocument } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';

const mobileDevices = [
  ['iPhone', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }],
  ['iPad', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' }],
  ['iPod', { userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)' }],
  ['Android tablet', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36' }],
  ['generic mobile browser', { userAgent: 'Example Mobile Browser' }],
  ['desktop-mode iPad', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5 }],
  ['mobile client hint', { userAgent: 'Example Browser', userAgentData: { mobile: true } }]
];
const desktopDevices = [
  ['Windows', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' }],
  ['touchscreen Windows', { platform: 'Win32', maxTouchPoints: 10 }],
  ['Mac', { platform: 'MacIntel', maxTouchPoints: 0 }],
  ['single-touch Mac', { platform: 'MacIntel', maxTouchPoints: 1 }],
  ['desktop client hint', { userAgentData: { mobile: false } }],
  ['unknown device', {}]
];
const deniedQueries = [
  '', '?level=1', '?midi', '?midi=', '?midi=0', '?midi=false', '?midi=true',
  '?midi=yes', '?midi=01', '?midi=1.0', '?midi=+1', '?midi=1%20', '?midi=%',
  '?MIDI=1', '?midi=1&midi=1', '?midi=0&midi=1', '?midi=1&midi=0',
  '?midi=&midi=1', '?midi=1&midi='
];
const makeWindow = (navigator, search = '', innerWidth = 390) => ({
  navigator, location: { search }, innerWidth
});

describe('mobile MIDI availability policy', function() {
  for (const [name, navigator] of mobileDevices) {
    it(`requires one explicit opt-in for ${name} at every viewport width`, function() {
      const windowRef = makeWindow(navigator);
      for (const width of [390, 844, 1024, 1440, 320]) {
        windowRef.innerWidth = width;
        for (const search of deniedQueries) {
          windowRef.location.search = search;
          expect(resolveMidiAvailability({ windowRef }), `${width}px ${search}`).to.equal(false);
        }
        for (const search of ['?midi=1', '?level=2&midi=1&debug=0']) {
          windowRef.location.search = search;
          expect(resolveMidiAvailability({ windowRef }), `${width}px ${search}`).to.equal(true);
        }
      }
    });
  }

  for (const [name, navigator] of desktopDevices) {
    it(`keeps ${name} available even in a narrow viewport`, function() {
      const windowRef = makeWindow(navigator);
      for (const width of [320, 1440, 390]) {
        windowRef.innerWidth = width;
        for (const search of [...deniedQueries, '?midi=1']) {
          windowRef.location.search = search;
          expect(resolveMidiAvailability({ windowRef }), `${width}px ${search}`).to.equal(true);
        }
      }
    });
  }

  it('honors an explicit navigator reference and does not let a false client hint override a mobile UA', function() {
    const windowRef = makeWindow({ platform: 'Win32' }, '');
    const navigatorRef = { userAgent: 'android browser', userAgentData: { mobile: false } };
    expect(resolveMidiAvailability({ windowRef, navigatorRef })).to.equal(false);
    windowRef.location.search = '?midi=1';
    expect(resolveMidiAvailability({ windowRef, navigatorRef })).to.equal(true);
  });

  it('handles missing browser globals without throwing', function() {
    expect(resolveMidiAvailability()).to.equal(true);
    expect(resolveMidiAvailability({ windowRef: null, navigatorRef: null })).to.equal(true);
    expect(resolveMidiAvailability({ navigatorRef: { userAgent: 'iPhone' } })).to.equal(false);
  });
});

const createTrackedController = ({ navigator, search = '', width = 390 } = {}) => {
  const document = new TestDocument();
  document.body = document.createElement('body');
  for (const [id, tag] of [
    ['midiSequencerWorkspace', 'div'], ['midiWorkspaceToggle', 'button'],
    ['midiWorkspaceClose', 'button'], ['midiEnabledToggle', 'input'],
    ['midiLocalListenButton', 'button'], ['midiSoundPreview', 'button']
  ]) registerElement(document, tag, id);
  const savedProject = JSON.stringify(createMidiProjectFromMidiConfig({ enabled: true, sfx: { '1': { note: 60 } } }));
  const savedTemplates = JSON.stringify({ version: 1, templates: [] });
  const values = new Map([
    [PROJECT_STORAGE_KEY, savedProject], [TEMPLATE_STORAGE_KEY, savedTemplates],
    ['lemmings.midi.enabled', 'true']
  ]);
  const calls = { storage: [], device: 0, permissions: 0, audio: 0, runtime: 0, timer: 0 };
  const storage = {
    getItem(key) { calls.storage.push(['get', key]); return values.get(key) ?? null; },
    setItem(key, value) { calls.storage.push(['set', key]); values.set(key, String(value)); },
    removeItem(key) { calls.storage.push(['remove', key]); values.delete(key); }
  };
  const listeners = new Map();
  const window = {
    ...makeWindow({ ...navigator, requestMIDIAccess() { calls.permissions += 1; } }, search, width),
    get localStorage() { calls.storage.push(['access']); return storage; },
    setTimeout() { calls.timer += 1; return calls.timer; },
    clearTimeout() {},
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener() {}
  };
  const view = {
    midiEnabled: false,
    getMidiBaseConfig: () => ({ enabled: true, sfx: { '1': { note: 60 } } }),
    setMidiProjectConfig() { calls.runtime += 1; },
    setMidiEnabled(enabled) { if (enabled) calls.permissions += 1; }
  };
  document.body.classList.add('studio-open');
  const controller = createMidiUiController({
    window, document, getLemmings: () => view,
    getWebMidi() {
      calls.device += 1;
      return { enabled: false, inputs: [], outputs: [], enable() { calls.permissions += 1; } };
    },
    createPreviewAudio() { calls.audio += 1; throw new Error('Unexpected audio initialization'); }
  });
  const resize = width => {
    window.innerWidth = width;
    for (const listener of listeners.get('resize') || []) listener({ type: 'resize' });
    controller.refreshMidiUiFromConfig();
  };
  return { controller, document, window, values, calls, resize, savedProject, savedTemplates };
};

describe('mobile MIDI controller gate', function() {
  for (const [name, navigator] of mobileDevices) {
    it(`leaves ${name} inert despite a stored enabled project and later resize`, function() {
      const { controller, document, window, values, calls, resize, savedProject, savedTemplates } = createTrackedController({ navigator });
      const workspace = document.getElementById('midiSequencerWorkspace');
      const opener = document.getElementById('midiWorkspaceToggle');
      expect(controller.available).to.equal(false);
      expect(controller.getStoredEnabled()).to.equal(false);
      expect(controller.getMidiConfig().enabled).to.equal(false);
      expect(workspace.hidden).to.equal(true);
      expect(opener.hidden).to.equal(true);
      expect(document.body.classList.contains('studio-open')).to.equal(false);
      controller.bindMidiUi();
      controller.bindMidiUi();
      controller.scheduleMidiUiRefresh();
      controller.refreshMidiUiFromConfig();
      controller.applyRuntimePatch({ enabled: true });
      controller.setMidiInputController({ attach() { throw new Error('Unexpected device attach'); } });
      const handlers = controller.getMidiStatusHandlers();
      handlers.onEnabled?.();
      handlers.onError?.('Unavailable');
      for (const id of ['midiWorkspaceToggle', 'midiLocalListenButton', 'midiSoundPreview']) {
        document.getElementById(id).dispatchEvent({ type: 'click' });
      }
      const enable = document.getElementById('midiEnabledToggle');
      enable.checked = true;
      enable.dispatchEvent({ type: 'change', target: enable });
      for (const width of [1024, 1440, 320]) {
        resize(width);
        expect(controller.getStoredEnabled()).to.equal(false);
        expect(workspace.hidden).to.equal(true);
        expect(opener.hidden).to.equal(true);
      }
      controller.dispose();
      expect(window.__LEMMINGS_MIDI_UI__).to.equal(undefined);
      expect(calls).to.deep.equal({ storage: [], device: 0, permissions: 0, audio: 0, runtime: 0, timer: 0 });
      expect(values.get(PROJECT_STORAGE_KEY)).to.equal(savedProject);
      expect(values.get(TEMPLATE_STORAGE_KEY)).to.equal(savedTemplates);
      expect(values.get('lemmings.midi.enabled')).to.equal('true');
    });
  }

  for (const [name, navigator, search] of [
    ['opted-in phone', mobileDevices[0][1], '?midi=1'],
    ['opted-in tablet', mobileDevices[5][1], '?midi=1'],
    ['narrow desktop', desktopDevices[0][1], ''],
    ['desktop with midi=0', desktopDevices[0][1], '?midi=0']
  ]) {
    it(`keeps the studio and saved enabled state usable on ${name}`, function() {
      const { controller, document, resize, calls } = createTrackedController({ navigator, search });
      expect(controller.available).to.equal(true);
      expect(controller.getStoredEnabled()).to.equal(true);
      controller.bindMidiUi();
      const workspace = document.getElementById('midiSequencerWorkspace');
      const opener = document.getElementById('midiWorkspaceToggle');
      expect(opener.hidden).to.equal(false);
      for (const width of [390, 1440, 320]) {
        resize(width);
        expect(controller.getProject().enabled).to.equal(true);
        opener.dispatchEvent({ type: 'click' });
        expect(workspace.hidden).to.equal(false);
        document.getElementById('midiWorkspaceClose').dispatchEvent({ type: 'click' });
        expect(workspace.hidden).to.equal(true);
      }
      expect(calls.audio).to.equal(0);
      expect(calls.permissions).to.equal(0);
      controller.dispose();
    });
  }
});

describe('GameView mobile MIDI runtime guards', function() {
  it('refuses to enable unavailable MIDI without initializing or attaching routing', async function() {
    const calls = [];
    const view = {
      midiAvailable: false, midiEnabled: false, game: { soundEvents: {} },
      initMidiRouting() { calls.push('initialize'); },
      midiRouter: {
        attach() { calls.push('attach'); }, detach() {}, scheduler: { allNotesOff() {} }
      }
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await gameViewMidiMethods.setMidiEnabled.call(view, true);
      expect(view.midiEnabled).to.equal(false);
    }
    expect(calls).to.deep.equal([]);
  });

  it('keeps direct WebMIDI and routing initialization inert even if enabled was restored externally', async function() {
    let requests = 0;
    const view = {
      midiAvailable: false, midiEnabled: true, midiRouter: null,
      _getWebMidi() { requests += 1; return { enable() { requests += 1; } }; },
      _ensureWebMidiEnabled() { requests += 1; },
      _loadMidiMapping() { requests += 1; }
    };
    expect(await gameViewMidiMethods._ensureWebMidiEnabled.call(view)).to.equal(null);
    expect(await gameViewMidiMethods.initMidiRouting.call(view)).to.equal(null);
    expect(view.midiEnabled).to.equal(false);
    expect(view.midiRouter).to.equal(null);
    expect(requests).to.equal(0);
  });

  it('rejects a local preview router on an excluded device', function() {
    let attached = 0;
    const view = {
      ...gameViewMidiMethods, midiAvailable: false, midiPreviewRouter: null,
      game: { soundEvents: {} }, stage: {}
    };
    const router = { attach() { attached += 1; } };
    view.setMidiPreviewRouter(router);
    expect(view.midiPreviewRouter).to.equal(null);
    expect(attached).to.equal(0);
  });

  for (const available of [true, undefined]) {
    it(`preserves normal enablement when availability is ${available}`, async function() {
      const calls = [];
      const view = {
        midiAvailable: available, midiEnabled: false, game: { soundEvents: {} }, stage: {},
        async initMidiRouting() { calls.push('initialize'); },
        midiRouter: { attach() { calls.push('attach'); } }
      };
      await gameViewMidiMethods.setMidiEnabled.call(view, true);
      expect(view.midiEnabled).to.equal(true);
      expect(calls).to.deep.equal(['initialize', 'attach']);
    });
  }
});
