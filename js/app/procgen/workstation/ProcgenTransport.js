import { createProcgenTimingDriver } from './ProcgenTimingDriver.js';
import { clearProcgenMidiQueue, sendProcgenMidiBytes, songPositionBytes } from './ProcgenMidiBytes.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const finite = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

export function createProcgenTransport(options = {}) {
  const now = options.now || (() => performance.now());
  const driver = options.driver || createProcgenTimingDriver();
  const onPosition = options.onPosition || (() => {}), onBeat = options.onBeat || (() => {});
  const onStop = options.onStop || (() => {}), onSpeed = options.onSpeed || (() => {});
  const onFlush = options.onFlush || (() => {});
  let baseBpm = finite(options.baseBpm ?? options.bpm, 120, 20, 400);
  let gameSpeed = finite(options.gameSpeed, 1, 0.05, Number.MAX_VALUE);
  let speedMode = options.speedMode === 'game' ? 'game' : 'bpm';
  let linked = options.linked !== false, clockSource = options.clockSource === 'external' ? 'external' : 'internal';
  let bpm = speedMode === 'game' && linked && clockSource !== 'external' ? Math.min(Number.MAX_VALUE, baseBpm * gameSpeed) : baseBpm;
  const lookaheadMs = finite(options.lookaheadMs, 30, 0, 100);
  const suspensionMs = finite(options.suspensionMs, 250, 100, 2000);
  const clockLossMs = finite(options.clockLossMs, 750, 100, 5000);
  let playing = false, disposed = false, anchorBeat = 0, anchorMs = now(), nextPulse = 0;
  const retirement = createProcgenRetirementScope();
  let lastWake = anchorMs, lastClock = null, waitingSince = anchorMs, intervals = [];
  let clockOutput = options.clockOutput || null, reason = 'ready', clockStatus = 'stopped';
  let outputAdmission = null, clockHorizon = 0, clockStopFailure = null, clockRetirement = null;
  const beatAt = timestamp => playing && clockSource === 'internal'
    ? Math.min(Number.MAX_SAFE_INTEGER / 24, anchorBeat + Math.max(0, timestamp - anchorMs) * (bpm / 60000)) : anchorBeat;
  const getState = () => ({ version: 1, playing, timestamp: now(), beat: beatAt(now()), bpm, baseBpm, gameSpeed, speedMode, linked, clockSource,
    effectiveSpeed: playing && (clockSource !== 'external' || clockStatus === 'locked')
      ? (linked && (speedMode === 'bpm' || clockSource === 'external') ? bpm / 120 : gameSpeed) : 0,
    tempoLocked: clockSource === 'external', clockStatus, reason });
  const report = () => { const state = getState(); onPosition(state); return state; };
  const speed = () => onSpeed(getState().effectiveSpeed);
  const send = (bytes, timestamp = now(), cleanup = false) => {
    if (clockSource === 'external' || !clockOutput) return true;
    const admission = outputAdmission, guard = admission ? () => admission(cleanup) === true : null;
    try {
      if (guard && !guard()) return false;
      clockHorizon = Math.max(clockHorizon, timestamp);
      const accepted = sendProcgenMidiBytes(clockOutput, bytes, timestamp, guard);
      if (!accepted && cleanup) clockStopFailure = 'clock-stop-submission-unconfirmed'; return accepted;
    } catch (error) { if (cleanup && !error?.midiSubmissionRejected) clockStopFailure = 'clock-stop-submission-unconfirmed'; return false; }
  };
  const flush = why => {
    const admission = outputAdmission;
    if ((!admission || clockHorizon > now()) && clearProcgenMidiQueue(clockOutput, admission ? () => admission(true) === true : null)) clockHorizon = 0;
    onFlush(why);
  };
  function halt(why, reset = false) {
    anchorBeat = reset ? 0 : beatAt(now()); anchorMs = now();
    if (reset) nextPulse = 0;
    const wasPlaying = playing;
    playing = false; reason = why; driver.stop(); flush(why);
    if (wasPlaying) send([0xfc], now(), true);
    clockStatus = why === 'clock-lost' || why === 'suspended' ? why : 'stopped';
    lastClock = null; intervals = []; speed(); report(); onStop(why, getState());
    return getState();
  }
  function pump(signal) {
    if (!playing || disposed) return getState();
    const timestamp = now();
    if (signal?.suspended || timestamp - lastWake > suspensionMs) return halt('suspended');
    lastWake = timestamp;
    if (clockSource === 'external') {
      if (timestamp - (lastClock ?? waitingSince) > clockLossMs) return halt('clock-lost');
      return report();
    }
    const horizonBeat = beatAt(timestamp + lookaheadMs);
    if (horizonBeat * 24 - nextPulse > 256) return halt('clock-overload');
    while (playing && nextPulse / 24 <= horizonBeat + 1e-9) {
      const beat = nextPulse++ / 24;
      const scheduled = anchorMs + (beat - anchorBeat) * 60000 / bpm;
      if (!send([0xf8], Math.max(timestamp, scheduled))) return halt('output-disconnected');
      onBeat({ beat, timestamp: Math.max(timestamp, scheduled), bpm, source: 'internal' });
    }
    return report();
  }
  function play() {
    if (disposed || playing) return getState();
    playing = true; reason = 'playing'; anchorMs = now(); lastWake = anchorMs; waitingSince = anchorMs;
    lastClock = null; intervals = [];
    if (clockSource === 'internal') nextPulse = Math.ceil(anchorBeat * 24 - 1e-9);
    clockStatus = clockSource === 'external' ? 'waiting' : 'internal';
    if (anchorBeat === 0) send([0xfa]);
    else { send(songPositionBytes(anchorBeat)); send([0xfb]); }
    speed(); driver.start(pump); return pump();
  }
  function seek(beat) {
    if (disposed) return getState();
    flush('seek'); anchorBeat = finite(beat, 0, 0, 1e9); anchorMs = now();
    nextPulse = Math.ceil(anchorBeat * 24 - 1e-9); lastClock = null; intervals = [];
    waitingSince = anchorMs;
    send(songPositionBytes(anchorBeat));
    return playing ? pump() : report();
  }
  function configure(settings = {}) {
    if (disposed) return getState();
    const nextSource = settings.clockSource === 'external' ? 'external' : settings.clockSource === 'internal' ? 'internal' : clockSource;
    if (nextSource !== clockSource) { halt('clock-source-changed'); nextPulse = Math.ceil(anchorBeat * 24 - 1e-9); }
    const current = beatAt(now());
    const nextLinked = settings.linked === undefined ? linked : !!settings.linked;
    const nextMode = settings.speedMode === 'game' ? 'game' : settings.speedMode === 'bpm' ? 'bpm' : speedMode;
    let nextBpm = bpm, nextSpeed = gameSpeed, nextBase = baseBpm;
    if (settings.gameSpeed !== undefined) nextSpeed = finite(settings.gameSpeed, gameSpeed, 0.05, Number.MAX_VALUE);
    if (nextSource !== 'external') {
      if (settings.baseBpm !== undefined || settings.bpm !== undefined) nextBase = finite(settings.baseBpm ?? settings.bpm, baseBpm, 20, 400);
      else if (settings.gameSpeed !== undefined && nextLinked && nextMode === 'bpm') nextBase = finite(nextSpeed * 120, baseBpm, 20, 400);
      nextBpm = nextMode === 'game' && nextLinked ? Math.min(Number.MAX_VALUE, nextBase * nextSpeed) : nextBase;
    }
    const changedTempo = nextBpm !== bpm;
    clockSource = nextSource; linked = nextLinked; gameSpeed = nextSpeed; baseBpm = nextBase; speedMode = nextMode;
    if (changedTempo) {
      flush('tempo'); anchorBeat = current; anchorMs = now(); bpm = nextBpm;
      nextPulse = Math.ceil(current * 24 - 1e-9);
    }
    speed(); return playing ? pump() : report();
  }
  function receiveMidi(data, timestamp = now()) {
    if (disposed || clockSource !== 'external' || !data?.length) return false;
    timestamp = Number.isFinite(timestamp) ? timestamp : now();
    if (data[0] === 0xfa) { halt('midi-start', true); play(); return true; }
    if (data[0] === 0xfb) { play(); return true; }
    if (data[0] === 0xfc) { halt('midi-stop'); return true; }
    if (data[0] === 0xf2 && data.length >= 3) { seek(((data[2] & 127) * 128 + (data[1] & 127)) / 4); return true; }
    if (data[0] !== 0xf8 || !playing) return false;
    if (now() - timestamp > suspensionMs || now() - lastWake > suspensionMs) { halt('suspended'); return false; }
    if (lastClock !== null && timestamp - lastClock > clockLossMs) { halt('clock-lost'); return false; }
    if (lastClock !== null && timestamp <= lastClock) return false;
    // Accepted clock input also wakes musical scheduling, independently of the
    // worker. Check for a real delivery gap before refreshing that deadline.
    lastWake = now();
    if (lastClock !== null) {
      intervals.push(timestamp - lastClock);
      if (intervals.length > 24) intervals.shift();
      if (intervals.length >= 3) {
        const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
        bpm = finite(60000 / (average * 24), bpm, 0.1, Number.MAX_VALUE);
      }
    }
    lastClock = timestamp; clockStatus = 'locked'; anchorBeat = nextPulse++ / 24; anchorMs = timestamp; speed();
    onBeat({ beat: anchorBeat, timestamp, bpm, source: 'external' }); report(); return true;
  }
  const snapshot = () => ({ ...getState(), playing: false, nextPulse });
  return {
    configure, update: configure, play, pause: () => halt('paused'), stop: () => halt('stopped', true),
    seek, receiveMidi, pump, getState, snapshot,
    diagnostics: () => Object.freeze({ driver: driver.diagnostics?.() ?? null, reason, clockStatus,
      lastWake, lastClock, waitingSince, clockOutputHorizon: clockHorizon, clockStopFailure }),
    panic: () => halt('panic'),
    suspend: () => halt('suspended'),
    setClockOutput(port, { preserveExternal = false } = {}) {
      if (clockOutput === port) return;
      if (clockRetirement && clockRetirement.outcome !== 'complete') return false;
      if (!preserveExternal || clockSource !== 'external') halt('output-replaced');
      clockOutput = port || null; clockRetirement = null; clockStopFailure = null;
    },
    setClockOutputAdmission(admission = null) {
      if (admission != null && typeof admission !== 'function') throw new TypeError('Invalid clock output admission predicate.');
      outputAdmission = admission;
    },
    retireClockOutput() {
      if (clockRetirement) return clockRetirement;
      let horizon = 0, failure = null;
      clockRetirement = createProcgenRetirementScope().retire([
        { name: 'clock-halt', run: () => { halt('performance-stopped'); horizon = clockHorizon; failure = clockStopFailure; clockOutput = null; } },
        { name: 'submitted-clock-frontier', run: () => {
          if (failure) throw new Error('MIDI clock stop was not acknowledged.');
          if (horizon <= now()) return;
          return new Promise(resolve => {
            const wait = () => { const delay = Math.max(0, horizon - now()); if (delay) (options.setTimer || setTimeout)(wait, Math.min(101, Math.max(1, delay))); else resolve(); }; wait();
          });
        } }
      ]); return clockRetirement;
    },
    restore(state = {}) {
      halt('restored'); configure(state);
      if (clockSource === 'external') {
        baseBpm = finite(state.baseBpm ?? state.bpm, baseBpm, 20, 400);
        bpm = finite(state.bpm, bpm, 0.1, Number.MAX_VALUE);
      }
      seek(state.beat || 0);
      if (clockSource === 'external' && Number.isSafeInteger(state.nextPulse) && state.nextPulse >= nextPulse) nextPulse = state.nextPulse;
      return getState();
    },
    dispose() {
      if (disposed) return retirement.retire();
      disposed = true;
      return retirement.retire([
        { name: 'transport-halt', run: () => halt('disposed') },
        { name: 'timing-driver', run: () => driver.dispose?.() },
        { name: 'clock-output', run: () => { clockOutput = null; } }
      ]);
    }
  };
}
