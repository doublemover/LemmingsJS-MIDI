import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const root = process.cwd(), directory = path.resolve(root, 'temp/shared-local-audio-evidence');
const sources = ['js/app/midi-ui/browserNotePreview.js', 'js/midi/scheduler/LocalAudioVoiceBudget.js'];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, permissions: [] });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
// Fulfilled loopback URLs load the real modules without a server or external request.
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== 'http://127.0.0.1:8138') return route.abort();
  if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Muted shared local audio evidence</title>' });
  const relative = url.pathname.slice(1);
  if (!sources.includes(relative)) return route.abort();
  return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, relative), 'utf8') });
});
try {
  await page.goto('http://127.0.0.1:8138/');
  const browserModuleUrl = new URL(sources[0], 'http://127.0.0.1:8138/').href;
  const evidence = await page.evaluate(async moduleUrl => {
    const { BrowserNotePreview } = await import(moduleUrl);
    const reports = [];
    for (const masterVolume of [1, 4]) {
      const sampleRate = 48000, seconds = 0.85, raw = new globalThis.OfflineAudioContext(12, sampleRate * seconds, sampleRate);
      let contexts = 0, compressors = 0, ceilings = 0, oscillators = 0, closes = 0;
      const adapter = { state: 'running', get currentTime() { return raw.currentTime; }, sampleRate, destination: raw.destination,
        createGain: () => raw.createGain(), createStereoPanner: () => raw.createStereoPanner(),
        createDynamicsCompressor: () => { compressors++; return raw.createDynamicsCompressor(); },
        createWaveShaper: () => { ceilings++; return raw.createWaveShaper(); },
        createOscillator: () => { oscillators++; return raw.createOscillator(); }, close: () => { closes++; return Promise.resolve(); } };
      const graph = new BrowserNotePreview({ createAudioContext: () => { contexts++; return adapter; }, nowMs: () => raw.currentTime * 1000, masterVolume });
      const game = graph.createSession('game'), audition = graph.createSession('audition');
      await game.enable(); await audition.enable();
      const merger = raw.createChannelMerger(12); merger.channelInterpretation = 'discrete'; merger.connect(raw.destination);
      const tap = (node, channel) => { const split = raw.createChannelSplitter(2); node.connect(split); split.connect(merger, 0, channel); split.connect(merger, 1, channel + 1); };
      graph._limiter.disconnect(); tap(graph._master, 0); tap(graph._compressorOutput, 2); tap(graph._limiter, 4);
      let accepted = 0;
      for (let index = 0; index < 12; index++) {
        accepted += game.output.channels[1].sendNoteOn(45 + index, { rawAttack: 96, voiceToken: index + 1, priority: 4, laneIndex: index % 4, pan: -0.3, instrument: { program: 38, role: 'bass' } }) ? 1 : 0;
        accepted += audition.output.channels[1].sendNoteOn(60 + index, { rawAttack: 96, voiceToken: index + 1, priority: 4, laneIndex: index % 4, pan: 0.3, instrument: { program: 81, role: 'melody' } }) ? 1 : 0;
      }
      const gameChannel = graph._channels.get(game.getState().ownerId + ':1'), auditionChannel = graph._channels.get(audition.getState().ownerId + ':1');
      tap(gameChannel.pan || gameChannel.gain, 6); tap(auditionChannel.pan || auditionChannel.gain, 8);
      // Two representative per-voice envelopes; all 24 still reach the one normal mix.
      [...graph._voices][0].gain.connect(merger, 0, 10); [...graph._voices][1].gain.connect(merger, 0, 11);
      const peakRetainedVoices = graph.getState().activeVoices;
      const stop = raw.suspend(0.3), panic = raw.suspend(0.6), rendering = raw.startRendering();
      await stop; const auditionStopSeconds = raw.currentTime; audition.stop();
      const afterAuditionStop = { gameVoices: game.getState().activeVoices, auditionVoices: audition.getState().activeVoices, gameGate: game.output.isVoiceActive(1), enabled: graph.getState().enabled };
      await raw.resume(); await panic; const panicSeconds = raw.currentTime; graph.panic(); await raw.resume();
      const buffer = await rendering;
      const measure = (channels, fromSeconds = 0, toSeconds = seconds) => {
        const from = Math.ceil(fromSeconds * sampleRate), to = Math.min(buffer.length, Math.floor(toSeconds * sampleRate));
        let square = 0, peak = 0, fullScaleSamples = 0, aboveKneeSamples = 0;
        for (const channel of channels) {
          const values = buffer.getChannelData(channel);
          for (let index = from; index < to; index++) { const v = Math.abs(values[index]); square += v * v; peak = Math.max(peak, v); if (v >= 1) fullScaleSamples++; if (v > 0.7) aboveKneeSamples++; }
        }
        return { rms: Math.sqrt(square / ((to - from) * channels.length)), peak, fullScaleSamples, aboveKneeSamples, frames: to - from };
      };
      const report = { masterVolume, accepted, peakRetainedVoices, contexts, compressors, ceilings, oscillators, auditionStopSeconds, panicSeconds, afterAuditionStop,
        mix: measure([0, 1]), preCeiling: measure([2, 3]), final: measure([4, 5]),
        concurrent: { final: measure([4, 5], 0.05, 0.25), game: measure([6, 7], 0.05, 0.25), audition: measure([8, 9], 0.05, 0.25) },
        gameOnly: { final: measure([4, 5], auditionStopSeconds + 0.04, 0.55), game: measure([6, 7], auditionStopSeconds + 0.04, 0.55), audition: measure([8, 9], auditionStopSeconds + 0.04, 0.55) },
        postPanic: measure([4, 5], panicSeconds, seconds), perVoice: [measure([10]), measure([11])],
        panic: { activeVoices: graph.getState().activeVoices, pendingNotes: graph.getState().pendingNotes } };
      await game.dispose(); await audition.dispose(); await graph.dispose(); report.contextCloses = closes; reports.push(report);
    }
    return { backend: 'OfflineAudioContext', clock: 'audio sample clock', acousticReceipt: false, physicalMidiReceipt: false, externalMidiEnabled: !!window.WebMidi?.enabled,
      limits: { cases: 2, framesPerCase: 40800, channels: 12, voices: 24, configuredSimultaneousCap: 32, pendingCap: 64, sessions: 4 }, reports };
  }, browserModuleUrl);
  evidence.errors = errors;
  evidence.sourceHashes = Object.fromEntries(await Promise.all(sources.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'shared-mix.json'), JSON.stringify(evidence, null, 2) + '\n');
  const summary = ['Muted digital PCM only; no acoustic listening or physical MIDI receipt.',
    'One graph, one combined configured 32-gate budget, one compressor and one ceiling; 12 game + 12 audition voices share the master.',
    ...evidence.reports.map(r => 'Master ' + r.masterVolume * 100 + '%: accepted ' + r.accepted + '; mix/pre-ceiling/final peaks ' + [r.mix.peak, r.preCeiling.peak, r.final.peak].map(v => v.toFixed(6)).join('/') + '; final RMS ' + r.final.rms.toFixed(6) + '; final/pre-ceiling full-scale samples ' + r.final.fullScaleSamples + '/' + r.preCeiling.fullScaleSamples + '; game-only/audition-after-stop RMS ' + r.gameOnly.game.rms.toFixed(6) + '/' + r.gameOnly.audition.rms.toFixed(6) + '; post-Panic peak ' + r.postPanic.peak + '; context/compressor/ceiling/close ' + [r.contexts, r.compressors, r.ceilings, r.contextCloses].join('/'))].join('\n') + '\n';
  await fs.writeFile(path.join(directory, 'shared-mix-summary.txt'), summary); console.log(summary);
  if (errors.length || evidence.externalMidiEnabled || evidence.reports.some(r => r.accepted !== 24 || r.contexts !== 1 || r.compressors !== 1 || r.ceilings !== 1 || r.contextCloses !== 1 || r.final.fullScaleSamples || r.preCeiling.fullScaleSamples || r.final.peak >= 0.9 || r.concurrent.game.rms <= 0 || r.concurrent.audition.rms <= 0 || r.gameOnly.game.rms <= 0 || r.gameOnly.audition.peak > 1e-7 || r.postPanic.peak > 1e-7 || r.panic.activeVoices || r.panic.pendingNotes || !r.afterAuditionStop.gameGate)) throw new Error('Shared mix or owner lifecycle evidence failed');
} finally { await context.close(); await browser.close(); }
