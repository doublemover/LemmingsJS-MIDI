import {
  ActionDiggSystem,
  DisplayImage,
  EventHandler,
  Frame,
  GameGui,
  GamepadInputController,
  HistoryStore,
  Level,
  Mask,
  MidiEventRouter,
  MidiScheduler,
  MiniMap,
  ObjectManager,
  SkillTypes,
  Stage,
  estimateBytes,
  fileURLToPath,
  makeCanvas,
  makeContext,
  makePalette,
  measureN,
  nsToMs,
  parseArgs,
  path,
  percentile,
  setupRenderEnvironment,
  summarizeSamples,
  toNumberOrNaN,
  toPositiveInt,
  withGlobalStubs
} from './shared.js';
const makeMidiOutput = (channelCount = 16) => {
  const channels = {};
  for (let i = 1; i <= channelCount; i += 1) {
    channels[i] = {
      sendNoteOn() {},
      sendNoteOff() {},
      sendPitchBend() {},
      sendPitchBendRange() {},
      sendControlChange() {},
      sendAllNotesOff() {}
    };
  }
  return { channels };
};
const runMidiRouterBench = ({ iterations, eventsPerIter, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const router = new MidiEventRouter({
    enabled: true,
    noteRange: { min: 36, max: 96 },
    durationTicks: { min: 0, max: 0, default: 0 },
    timing: { bpmBase: 120, scheduleAheadMs: 0 },
    repeat: { enabled: false },
    limits: {
      maxPerTick: 128,
      maxPerSecond: 1000,
      maxBytesPerSecond: 100000000
    }
  });
  router.context = {
    game: {
      getGameTimer() {
        return { tps: 60, speedFactor: 1 };
      }
    }
  };
  router.setOutput(makeMidiOutput(16));

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      const tick = i + 1;
      for (let eventIndex = 0; eventIndex < eventsPerIter; eventIndex += 1) {
        router._onEvent({
          tick,
          sfxId: 1,
          x: (eventIndex * 7) % 320,
          y: (eventIndex * 11) % 200
        });
      }
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  router.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations * Math.max(1, eventsPerIter));
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations * Math.max(1, eventsPerIter));
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});
const runMidiSchedulerBench = ({ iterations, notesPerIter, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const scheduler = new MidiScheduler({
    defaultChannel: 1,
    limits: {
      maxActiveNotes: 32,
      maxEventsPerSecond: 1000,
      maxBytesPerSecond: 100000000
    },
    mpe: { enabled: false }
  });
  scheduler.setTickMs(1000 / 60);
  scheduler.setOutput(makeMidiOutput(16));

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      for (let noteIndex = 0; noteIndex < notesPerIter; noteIndex += 1) {
        scheduler.sendNote({
          note: 48 + ((i + noteIndex) % 24),
          velocity: 96,
          durationTicks: 0,
          channel: 1
        }, {
          sfxId: 1,
          priority: 1
        });
      }
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  scheduler.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations * Math.max(1, notesPerIter));
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations * Math.max(1, notesPerIter));
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});
export {
  makeMidiOutput,
  runMidiRouterBench,
  runMidiSchedulerBench
};