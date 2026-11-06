import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LOCAL_AUDIO_SOURCES, launchAudioEvidenceBrowser } from './audio-evidence-runtime.js';
import { installWebMidiStub } from '../e2e/helpers/webmidiStub.js';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) || fallback;
const url = option('url', 'http://127.0.0.1:8096/procgen.html?e2e=1&pack=0&seed=42&lanes=1');
const directory = option('out-dir', 'temp/local-audio-evidence');
const label = option('label', 'current');
const moduleUrls = Object.fromEntries(Object.entries({
  preview: 'js/app/midi-ui/browserNotePreview.js', fixture: 'e2e/helpers/nativeAudioFixture.js', capture: 'js/midi/capture/MidiOutputCapture.js'
}).map(([key, path]) => [key, new URL('/' + path, url).href]));
const { browser, environment } = await launchAudioEvidenceBrowser();
const context = await browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT })
  .catch(async error => { await browser.close(); throw error; });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await installWebMidiStub(page);
try {
  await page.goto(url);
  const evidence = await page.evaluate(async (moduleUrls) => {
    const { BrowserNotePreview } = await import(moduleUrls.preview);
    const { createNativeAudioFixture } = await import(moduleUrls.fixture);
    const { MidiOutputCapture } = await import(moduleUrls.capture);
    const cases = [
      { id: 'one-100', count: 1, gain: 1 }, { id: 'one-400', count: 1, gain: 4 },
      { id: 'ensemble-100', count: 4, gain: 1, ensemble: true }, { id: 'ensemble-400', count: 4, gain: 4, ensemble: true },
      { id: 'repeated-pitch', count: 2, gain: 1, samePitch: true },
      { id: 'seventeen-overlap', count: 17, gain: 1 },
      { id: 'thirty-two-default-gain', count: 32, gain: 0.7 },
      { id: 'thirty-two-overlap', count: 32, gain: 4 },
      { id: 'coherent-thirty-two', count: 32, gain: 4, samePitch: true },
      { id: 'coherent-max-velocity', count: 32, gain: 4, samePitch: true, velocity: 127 },
      { id: 'panic-mid-sustain', count: 4, gain: 4, samePitch: true, panicAtSeconds: 0.15 },
      { id: 'thirty-three-direct', count: 33, gain: 4 },
      { id: 'configured-forty-eight', count: 48, gain: 0.7, maxVoices: 48, ensemble: true },
      { id: 'configured-sixty-four', count: 64, gain: 0.7, maxVoices: 64, ensemble: true },
      { id: 'dense-eight-lane-sustains', count: 96, gain: 0.7, ensemble: true, groups: 8, lanes: 8 },
      { id: 'native-owner-overflow', count: 64, gain: 0.7, groups: 2 },
      { id: 'competing-native-lane-groups', count: 64, gain: 0.7, groups: 2, laneBalance: true },
      { id: 'native-held-admission-pressure', count: 128, gain: 0.7, groups: 4 },
      { id: 'short-native-reuse', count: 48, gain: 0.7, groups: 3, shortTone: true }
    ];
    const reports = [];
    const specs = cases.flatMap(spec => [{ ...spec, compression: true }, { ...spec, compression: false }]);
    for (const spec of specs) {
      const sampleRate = 48000, duration = 1.2, raw = new globalThis.OfflineAudioContext(32, sampleRate * duration, sampleRate);
      let oscillators = 0, noiseSources = 0;
      const wrapper = { state: 'running', get currentTime() { return raw.currentTime; }, sampleRate, destination: raw.destination,
        createDynamicsCompressor: () => raw.createDynamicsCompressor(),
        createGain: () => raw.createGain(), createWaveShaper: () => raw.createWaveShaper(),
        createOscillator: () => { oscillators++; return raw.createOscillator(); },
        createStereoPanner: () => raw.createStereoPanner(), createBuffer: (...args) => raw.createBuffer(...args),
        createBufferSource: () => { noiseSources++; return raw.createBufferSource(); }, close: () => Promise.resolve() };
      const preview = new BrowserNotePreview({ createAudioContext: () => wrapper, nowMs: () => raw.currentTime * 1000,
        masterVolume: spec.gain, maxVoices: spec.maxVoices ?? 32 });
      const capture = new MidiOutputCapture({ nowMs: () => raw.currentTime * 1000, capacity: 4096 });
      capture.start({ backend: 'OfflineAudioContext', sampleRate, durationSeconds: duration, acousticReceipt: false, label: spec.id });
      preview.setCapture(capture); await preview.enable();
      preview._limiter.disconnect();
      if (!spec.compression) { preview._master.disconnect(); preview._compressor.disconnect(); preview._compressorOutput.disconnect(); preview._master.connect(preview._limiter); }
      const merger = raw.createChannelMerger(32), beforeMaster = raw.createGain();
      merger.channelInterpretation = 'discrete'; merger.connect(raw.destination);
      beforeMaster.channelCount = 2; beforeMaster.channelCountMode = 'explicit';
      const tap = (node, first) => { const splitter = raw.createChannelSplitter(2); node.connect(splitter); splitter.connect(merger, 0, first); splitter.connect(merger, 1, first + 1); };
      tap(beforeMaster, 0); tap(preview._master, 2); tap(spec.compression ? preview._compressorOutput : preview._master, 4); tap(preview._limiter, 6);
      const session = preview.createSession('native-measurement'); await session.enable();
      const nativeFixtures = []; for (let profile = 0; profile < 5; profile++) nativeFixtures.push(await createNativeAudioFixture(session, { profile }));
      const voices = [], tappedChannels = new Set(), observations = [], admissionRefusals = Object.create(null);
      const profiles = [1, 2, 3, 4];
      let attempts = 0, accepted = 0, peakSources = 0, peakGates = 0, peakTails = 0;
      const groupCount = spec.groups || 1, perGroup = spec.count / groupCount;
      const addGroup = group => {
        for (let index = group * perGroup; index < (group + 1) * perGroup; index++) {
          const profile = spec.shortTone ? 4 : spec.ensemble ? profiles[index % 4] : 0;
          const note = spec.shortTone ? 42 : spec.samePitch ? 60 : spec.ensemble ? [45, 57, 69, 36][index % 4] : 48 + index % 24;
          const laneIndex = spec.laneBalance ? group : spec.lanes ? index % spec.lanes : 0;
          attempts++;
          const submitted = nativeFixtures[profile].begin({ id: index + 1, pitchCents: note * 100, velocity01: (spec.velocity ?? 96) / 127, laneIndex, endFrame: sampleRate });
          const result = submitted.status === 'accepted'; if (!result) admissionRefusals[submitted.reason || 'unknown-refusal'] = (admissionRefusals[submitted.reason || 'unknown-refusal'] || 0) + 1;
          if (result) accepted++;
          const voice = [...preview._voices].at(-1);
          if (result && voice && !voices.includes(voice)) {
            voices.push(voice);
            if (voices.length <= 24) voice.gain.connect(merger, 0, voices.length + 7);
          }
          for (const channel of preview._channels.values()) {
            if (!tappedChannels.has(channel)) { tappedChannels.add(channel); (channel.pan || channel.gain).connect(beforeMaster); }
          }
          const live = [...preview._voices];
          peakSources = Math.max(peakSources, live.length);
          peakGates = Math.max(peakGates, live.filter(voice => !voice.stolen && voice.releaseAt > raw.currentTime).length);
          peakTails = Math.max(peakTails, live.filter(voice => voice.releaseAt <= raw.currentTime && voice.end > raw.currentTime).length);
        }
        observations.push({ audioTime: raw.currentTime, retainedSources: preview._voices.size,
          gatesByLane: [...preview._voices].filter(voice => voice.releaseAt > raw.currentTime).reduce((byLane, voice) => { const key = voice.laneIndex ?? 0; byLane[key] = (byLane[key] || 0) + 1; return byLane; }, {}) });
      };
      addGroup(0);
      const gap = spec.shortTone ? 0.12 : 0.08;
      const suspensions = Array.from({ length: groupCount - 1 }, (_, index) => raw.suspend((index + 1) * gap));
      const panicPause = spec.panicAtSeconds == null ? null : raw.suspend(spec.panicAtSeconds);
      let panicAudioTime = null;
      const startWall = performance.now(), rendering = raw.startRendering();
      for (let group = 1; group < groupCount; group++) { await suspensions[group - 1]; addGroup(group); await raw.resume(); }
      if (panicPause) { await panicPause; panicAudioTime = raw.currentTime; preview.panic(); await raw.resume(); }
      const rendered = await rendering, renderWallMs = performance.now() - startWall;
      const measure = (channels, from = 0, to = rendered.length) => {
        let squares = 0, peak = 0, atOrAboveFullScaleCount = 0, kneeCount = 0, firstNonzeroFrame = null;
        for (const channel of channels) {
          const values = rendered.getChannelData(channel);
          for (let frame = from; frame < to; frame++) {
            const value = Math.abs(values[frame]);
            if (value > 1e-7 && (firstNonzeroFrame == null || frame < firstNonzeroFrame)) firstNonzeroFrame = frame;
            squares += value * value; peak = Math.max(peak, value);
            if (value >= 1) atOrAboveFullScaleCount++; if (value > 0.7) kneeCount++;
          }
        }
        return { rms: Math.sqrt(squares / ((to - from) * channels.length)), peak, atOrAboveFullScaleCount, aboveSoftKneeCount: kneeCount,
          frames: to - from, channels: channels.length, firstNonzeroFrame };
      };
      const records = capture.snapshot().records;
      const report = { ...spec, instrumentFixture: nativeFixtures.map(fixture => fixture.parameters), fixtureQualification: 'explicit-native-control-tones;not-GM-or-kit-content', admissionPolicy: 'native-owned-voices;reject-at-capacity', attempts, accepted, rejected: attempts - accepted,
        postPanic: panicAudioTime == null ? null : { audioTime: panicAudioTime, ...measure([6, 7], Math.ceil(panicAudioTime * sampleRate), rendered.length) },
        baseGain: preview._master.gain.value, mixMakeupCompensation: spec.compression ? preview._compressorOutput.gain.value : 1, input: measure([0, 1]), mix: measure([2, 3]), preCeiling: measure([4, 5]), final: measure([6, 7]),
        transient: { fromSeconds: 0, toSeconds: 0.05, preCeiling: measure([4, 5], 0, 2400), final: measure([6, 7], 0, 2400) },
        settled: { fromSeconds: 0.2, toSeconds: 0.8, preCeiling: measure([4, 5], 9600, 38400), final: measure([6, 7], 9600, 38400) },
        sustainWindow: { fromSeconds: 0.1, toSeconds: 0.35, input: measure([0, 1], 4800, 16800), mix: measure([2, 3], 4800, 16800), preCeiling: measure([4, 5], 4800, 16800), final: measure([6, 7], 4800, 16800) },
        perVoice: voices.slice(0, 24).map((voice, index) => ({ id: voice.id, note: voice.note, semanticVoiceId: voice.captureMeta?.semanticVoiceId || null, ...measure([index + 8]) })),
        omittedVoiceTaps: Math.max(0, voices.length - 24), observations,
        cost: { oscillatorNodesCreated: oscillators, bufferSourceNodesCreated: noiseSources, partialsPerVoice: 1, mixProcessingNodes: spec.compression ? 3 : 1,
          peakRetainedSources: peakSources, peakOwnedGates: peakGates, peakReleaseTails: peakTails,
          configuredSimultaneous: preview.getState().maxVoices, scheduledSourceCap: preview.getState().maxScheduledVoices,
          renderedAudioMs: duration * 1000, renderWallMs, renderToAudioRatio: renderWallMs / (duration * 1000),
          measurementTapChannels: 32, jsSuspendBoundaries: groupCount - 1 },
        schedules: records.filter(record => record.stage === 'synth-scheduled').length,
        prematureEnds: records.filter(record => record.stage === 'synth-end' && record.reason !== 'source-ended').map(record => ({ voiceId: record.voiceId, reason: record.reason })),
        releases: records.filter(record => record.stage === 'synth-release').map(record => ({ voiceId: record.voiceId, reason: record.reason })),
        dropReasons: admissionRefusals,
        captureTruncated: capture.getState().truncated > 0,
        capturedSourceEnds: records.filter(record => record.stage === 'synth-end').length,
        captureStages: records.reduce((counts, record) => { counts[record.stage] = (counts[record.stage] || 0) + 1; return counts; }, {}),
        scope: 'Rendered digital PCM; offline wall time includes taps/JS, not a real-time hardware guarantee; no acoustic listening or physical MIDI receipt' };
      const beforePanicSchedules = report.schedules;
      preview.panic();
      report.panic = { activeSources: preview._voices.size, activeGates: [...preview._voices].filter(voice => voice.releaseAt > raw.currentTime).length, pendingNotes: preview.getState().pendingNotes,
        laterSchedules: capture.snapshot().records.filter(record => record.stage === 'synth-scheduled').length - beforePanicSchedules };
      await preview.dispose(); reports.push(report);
    }
    return { schema: 'local-native-audio-measurement/v2', backend: 'OfflineAudioContext', clock: 'audio sample clock',
      measurementDefinitions: { input: 'Stereo channel sum before master', mix: 'After nominal/master gain before ceiling', final: 'After existing output ceiling', preCeiling: 'After shared signal-driven compressor; bypass reference uses uncompressed master',
        fullScaleCounts: 'Float samples >=1 magnitude; before ceiling these show drive, not bus truncation',
        perVoice: 'Mono envelope output before pan/channel controls', acousticReceipt: false }, limits: { cases: specs.length, framesPerCase: 57600, measuredVoiceTaps: 24, captureRecords: 4096, maxConfiguredVoices: 64, maxScheduledSources: 96 }, reports,
      externalEnabled: window.WebMidi?.enabled || false };
  }, moduleUrls);
  evidence.errors = errors;
  evidence.environment = environment;
  evidence.sourceHashes = Object.fromEntries(await Promise.all([
    ...LOCAL_AUDIO_SOURCES, 'js/midi/scheduler/MidiSchedulerChannelMethods.js',
    'js/app/midi-ui/nativeOscillatorBackend.js', 'e2e/helpers/nativeAudioFixture.js'
  ].map(async path => [path, createHash('sha256').update(await fs.readFile(path)).digest('hex')])));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(directory + '/' + label + '.json', JSON.stringify(evidence, null, 2) + '\n');
  const summary = [
    'Digital PCM measurements only; muted OfflineAudioContext, no acoustic listening or physical MIDI receipt.',
    'Input: stereo sum before master. Mix: after nominal/master gain. PreCeiling: after one signal-driven compressor. Final: after existing ceiling.',
    'Per-voice taps are mono envelope outputs before pan/channel gain; omitted taps are explicit in JSON.',
    'Native control fixtures use direct semantic begin/end and reject admission at the shared configured voice cap; no GM program or generic noise renderer is used.',
    'Explicit preview configurations allow at most 64 simultaneous voices and 96 scheduled sources including tails. Defaults remain 32/64.',
    'Compressor processing follows the existing audio clock and adds the specified 6 ms lookahead; source/API timestamps remain separate from output onset.',
    'The single compressor uses threshold -9 dB, knee 6 dB, ratio 12, attack 1 ms/release 80 ms. Fixed 0.647 cancels its measured low-level makeup; it never follows voice capacity.',
    'Offline wall time includes 32 measurement channels and bounded JS suspend callbacks; it is not a realtime guarantee.',
    '',
    ...evidence.reports.map(report => `${report.id} (compression=${report.compression}): accepted ${report.accepted}/${report.attempts}; scheduled ${report.schedules}; input peak ${report.input.peak.toFixed(6)}; mix peak ${report.mix.peak.toFixed(6)}; final peak/RMS ${report.final.peak.toFixed(6)}/${report.final.rms.toFixed(6)}; full-scale samples ${report.final.atOrAboveFullScaleCount}; pre-ceiling >=1 samples ${report.preCeiling.atOrAboveFullScaleCount} (${(1000 * report.preCeiling.atOrAboveFullScaleCount / (48000 * 2)).toFixed(3)} stereo-equivalent ms), >0.7 samples ${report.preCeiling.aboveSoftKneeCount}; settled pre-ceiling >=1 ${report.settled.preCeiling.atOrAboveFullScaleCount}; sources/gates/tails peak ${report.cost.peakRetainedSources}/${report.cost.peakOwnedGates}/${report.cost.peakReleaseTails}; offline render ${report.cost.renderWallMs.toFixed(1)}ms for ${report.cost.renderedAudioMs}ms audio; drops ${JSON.stringify(report.dropReasons)}; Panic sources/gates/later notes ${report.panic.activeSources}/${report.panic.activeGates}/${report.panic.laterSchedules}`)
  ].join('\n') + '\n';
  await fs.writeFile(directory + '/' + label + '-summary.txt', summary);
  console.log(summary);
  if (errors.length || evidence.externalEnabled || evidence.reports.some(report => report.final.atOrAboveFullScaleCount || (report.compression && report.preCeiling.atOrAboveFullScaleCount) || (report.postPanic && report.postPanic.peak > 1e-7) || report.panic.activeSources || report.panic.activeGates || report.panic.laterSchedules)) throw new Error('Unexpected output, lifecycle, page error or external MIDI activation');
} finally { await context.close(); await browser.close(); }
