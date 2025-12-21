import './bootstrap.js';
import { GameView } from '../GameView.js';

const $ = globalThis.$ || globalThis.jQuery;
const jQuery = globalThis.jQuery || $;

const midiStorageKeys = {
  inputId: 'lemmings.midi.inputId',
  outputId: 'lemmings.midi.outputId',
  viewPan: 'lemmings.midi.viewPan'
};
let activeMidiInput = null;
let activeMidiInputListener = null;
let midiUiBound = false;
let midiViewPanEnabled = false;

function readStoredMidiId(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function storeMidiId(key, value) {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch (e) {
    // Ignore storage failures (private mode, blocked access, etc.).
  }
}

function resolveMidiId(devices, preferredId) {
  if (!devices || !devices.length) return null;
  if (preferredId && devices.some(device => device.id === preferredId)) {
    return preferredId;
  }
  return devices[0].id;
}

function populateMidiSelect(select, devices, emptyLabel) {
  if (!select) return;
  select.innerHTML = '';
  if (!devices || !devices.length) {
    const opt = document.createElement('option');
    opt.textContent = emptyLabel;
    opt.value = '';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (let device of devices.values()) {
    const opt = document.createElement('option');
    opt.textContent = device.name;
    opt.value = device.id;
    select.appendChild(opt);
  }
}

function setActiveMidiInput(inputId) {
  if (activeMidiInput && activeMidiInputListener) {
    activeMidiInput.removeListener('midimessage', activeMidiInputListener);
  }
  activeMidiInput = null;
  activeMidiInputListener = null;
  if (!inputId || !globalThis.WebMidi?.enabled) return;
  const input = globalThis.WebMidi.getInputById(inputId);
  if (!input) return;
  activeMidiInputListener = (event) => {
    window.lastMidiInputMessage = event?.data ? Array.from(event.data) : null;
  };
  input.addListener('midimessage', activeMidiInputListener);
  activeMidiInput = input;
}

function setActiveMidiOutput(outputId) {
  if (!globalThis.WebMidi?.enabled) return;
  const output = outputId ? globalThis.WebMidi.getOutputById(outputId) : null;
  if (window.lemmings?.midiRouter?.scheduler?.allNotesOff) {
    window.lemmings.midiRouter.scheduler.allNotesOff();
  }
  if (window.lemmings) {
    window.lemmings.midiOut = output || null;
  }
}

function applyViewPanSetting(enabled) {
  midiViewPanEnabled = !!enabled;
  if (typeof globalThis !== 'undefined') {
    globalThis.lemmingsMidiViewPan = midiViewPanEnabled;
  }
  const mapping = window.lemmings?.midiRouter?.mapping?.config;
  if (mapping) {
    if (!mapping.position) mapping.position = {};
    mapping.position.viewPan = midiViewPanEnabled;
  }
}

function onEnabled() {
  const inputSelect = document.getElementById('midiInSelect');
  const outputSelect = document.getElementById('midiOutSelect');
  const viewPanToggle = document.getElementById('midiViewPanToggle');
  const inputs = globalThis.WebMidi?.inputs || [];
  const outputs = globalThis.WebMidi?.outputs || [];
  // Display available MIDI input devices
  if (inputs.length < 1) {
    $('#errorDisplay').innerHTML += 'No input device detected. <br />';
  }
  populateMidiSelect(inputSelect, inputs, 'No input devices');

  if (outputs.length < 1) {
    $('#errorDisplay').innerHTML += 'No output device detected. <br />';
  }
  populateMidiSelect(outputSelect, outputs, 'No output devices');

  const storedInputId = readStoredMidiId(midiStorageKeys.inputId);
  const storedOutputId = readStoredMidiId(midiStorageKeys.outputId);
  const resolvedInputId = resolveMidiId(inputs, storedInputId);
  const resolvedOutputId = resolveMidiId(outputs, storedOutputId);

  if (resolvedInputId && inputSelect) {
    inputSelect.value = resolvedInputId;
    storeMidiId(midiStorageKeys.inputId, resolvedInputId);
    setActiveMidiInput(resolvedInputId);
  } else {
    setActiveMidiInput(null);
  }

  if (resolvedOutputId && outputSelect) {
    outputSelect.value = resolvedOutputId;
    storeMidiId(midiStorageKeys.outputId, resolvedOutputId);
    setActiveMidiOutput(resolvedOutputId);
  } else {
    setActiveMidiOutput(null);
  }

  const storedViewPan = readStoredMidiId(midiStorageKeys.viewPan);
  const resolvedViewPan = storedViewPan === 'true';
  if (viewPanToggle) {
    viewPanToggle.checked = resolvedViewPan;
  }
  applyViewPanSetting(resolvedViewPan);

  if (!midiUiBound) {
    if (inputSelect) {
      inputSelect.addEventListener('change', (event) => {
        const selectedId = event.target.value || null;
        storeMidiId(midiStorageKeys.inputId, selectedId);
        setActiveMidiInput(selectedId);
      });
    }
    if (outputSelect) {
      outputSelect.addEventListener('change', (event) => {
        const selectedId = event.target.value || null;
        storeMidiId(midiStorageKeys.outputId, selectedId);
        setActiveMidiOutput(selectedId);
      });
    }
    if (viewPanToggle) {
      viewPanToggle.addEventListener('change', (event) => {
        const enabled = !!event.target.checked;
        storeMidiId(midiStorageKeys.viewPan, enabled ? 'true' : null);
        applyViewPanSetting(enabled);
      });
    }
    midiUiBound = true;
  }
}

globalThis.onEnabled = onEnabled;

let lemmings;
function init() {
  lemmings = new GameView();
  lemmings.elementSelectGameType = document.getElementById('gameTypeSelect');
  lemmings.elementSelectLevelGroup = document.getElementById('levelGroupSelect');
  lemmings.elementSelectLevel = document.getElementById('levelIndexSelect');
  lemmings.gameCanvas = document.getElementById('gameCanvas');
  lemmings.setup();
  // use GameView.strToNum to parse dropdown values
  lemmings.elementSelectGameType.addEventListener('change', (e) => {
    lemmings.selectGameType(lemmings.strToNum(e.target.value));
  });
  lemmings.elementSelectLevelGroup.addEventListener('change', (e) => {
    lemmings.selectLevelGroup(lemmings.strToNum(e.target.value));
  });
  lemmings.elementSelectLevel.addEventListener('change', (e) => {
    lemmings.selectLevel(lemmings.strToNum(e.target.value));
  });
}

function setSize() {
  const baseW = 800;
  const baseH = 480;
  const ratio = baseW / baseH;
  const gameContainer = jQuery('.game_container');
  const docEl = document.documentElement;
  const width = Math.max(1, docEl.clientWidth || window.innerWidth);
  const height = Math.max(1, docEl.clientHeight || window.innerHeight);
  let containerWidth, containerHeight;

  if (width >= height * ratio) {
    containerWidth = height * ratio;
    containerHeight = height;
    gameContainer.css('margin-top', '');
    gameContainer.css('margin-left', (width - containerWidth) / 2);
    gameContainer.removeClass('small');
  } else {
    containerWidth = width;
    containerHeight = width / ratio;
    gameContainer.css('margin-top', (height - containerHeight) / 2);
    gameContainer.css('margin-left', '');
    gameContainer.addClass('small');
  }

  if (containerWidth > width) containerWidth = width;
  if (containerHeight > height) containerHeight = height;

  gameContainer.width(containerWidth);
  gameContainer.height(containerHeight);

  const canvas = document.getElementById('gameCanvas');
  if (canvas) {
    canvas.width = baseW;
    canvas.height = baseH;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = containerHeight + 'px';
  }

  if (window.lemmings && window.lemmings.stage) {
    window.lemmings.stage.updateStageSize();
  }
}

function bindResize() {
  if (typeof $ === 'function' && $(window)?.on) {
    $(window).on('resize orientationchange', function() {
      setSize();
    });
  } else {
    window.addEventListener('resize', setSize);
    window.addEventListener('orientationchange', setSize);
  }
}

function start() {
  init();
  setSize();
  bindResize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
