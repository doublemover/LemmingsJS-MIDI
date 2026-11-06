import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import { withBoundaryServer } from './run-browser-boundaries.js';
import { collectBrowserRuntimeClosure } from './BrowserRuntimeClosure.js';
import { createBrowserProcessCpuObserver, compareBrowserProcessCpu, summarizeProfileSamples } from './BrowserProcessCpu.js';

const root = fileURLToPath(new URL('../', import.meta.url)), engines = { chromium, firefox, webkit };
const harnessFiles = ['scripts/qualify-audio-profiles.mjs', 'scripts/BrowserProcessCpu.js', 'scripts/run-browser-boundaries.js', 'scripts/BrowserRuntimeClosure.js', 'scripts/RuntimeSourceClosure.js',
  'e2e-portable/fixtures/pcm-evidence.html', 'package.json', 'package-lock.json'];
const harness = () => Promise.all(harnessFiles.map(async name => { const bytes = await fs.readFile(path.join(root, name)); return { path: name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }; }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function qualifyAudioProfileReport(report) {
  const parameters = report?.parameters;
  if (report?.schema !== 'lemmings-native-audio-profiles/v1' || !parameters || !Number.isInteger(parameters.samples) || parameters.samples < 3 || parameters.samples > 8 ||
      !Number.isInteger(parameters.sampleMs) || parameters.sampleMs < 1000 || parameters.sampleMs > 5000 || !Number.isInteger(parameters.voices) || parameters.voices < 1 || parameters.voices > 64 ||
      !Array.isArray(parameters.engines) || !parameters.engines.length || parameters.engines.length > 3 || new Set(parameters.engines).size !== parameters.engines.length || parameters.engines.some(engine => !Object.hasOwn(engines, engine)) ||
      !Array.isArray(report.engines) || report.engines.length !== parameters.engines.length ||
      new Set(report.engines.map(value => value.engine)).size !== report.engines.length) throw new Error('Incomplete audio profile matrix.');
  for (const entry of report.engines) {
    if (!report.parameters.engines.includes(entry.engine) || typeof entry.version !== 'string' || !entry.version || typeof entry.available !== 'boolean' || !Array.isArray(entry.profiles) ||
        !(entry.viewport?.width >= 1920) || !(entry.viewport?.height >= 1080)) throw new Error('Unknown profile engine.');
    if (!entry.available) {
      if (entry.available !== false || entry.reason !== 'native-AudioContext-absent' || entry.profiles.length || entry.final !== null) throw new Error('Contradictory profile capability.');
      continue;
    }
    if (entry.profiles.length !== 3 || entry.final?.retirement?.state !== 'retired' || entry.final.retirement.outcome !== 'complete' || !Array.isArray(entry.final.contexts) || entry.final.contexts.length !== 3 || entry.final.contexts.some(context => context.closed !== true)) throw new Error('Unretired audio profile context.');
    for (const [index, profile] of entry.profiles.entries()) {
      if (profile.name !== ['performance', 'balanced', 'robust'][index] || profile.requested.latencyHint !== ['interactive', 'balanced', 'playback'][index] || profile.requested.sampleRate !== 48000 ||
          profile.observation?.config?.latencyProfile !== profile.name || profile.observation.config.preferredSampleRate !== 48000 || !Number.isFinite(profile.actualSampleRate) || !(profile.actualSampleRate > 0) || profile.actualSampleRate !== profile.observation.actualSampleRate || entry.final.contexts[index].actualSampleRate !== profile.actualSampleRate || profile.observation.acousticMeasurement !== false || profile.observation.estimatesAreAdditive !== false ||
          !Array.isArray(profile.samples) || profile.samples.length !== report.parameters.samples || !profile.samples.every(sample => sample.cpu?.populationStable === true && Number.isFinite(sample.cpu.coreEquivalent) && sample.cpu.coreEquivalent >= 0 &&
            sample.cpu.matchedProcesses > 0 && sample.before.activeVoices === report.parameters.voices && sample.after.activeVoices === report.parameters.voices &&
            sample.before.contextState === 'running' && sample.after.contextState === 'running' && Number.isFinite(sample.before.audioSeconds) && Number.isFinite(sample.after.audioSeconds) && sample.after.audioSeconds > sample.before.audioSeconds)) throw new Error('Incomplete measured audio profile: ' + entry.engine + '/' + profile.name);
      for (const sample of profile.samples) {
        const measured = compareBrowserProcessCpu(sample.processCounters?.before, sample.processCounters?.after);
        if (sample.processCounters.before.rootPid !== entry.processRootPid || sample.processCounters.before.platform !== report.platform ||
            ['cpuMs', 'wallMs', 'coreEquivalent', 'matchedProcesses', 'populationStable', 'samplingUncertaintyMs'].some(key => measured[key] !== sample.cpu[key])) throw new Error('Profile CPU report differs from its raw process counters.');
      }
      const distributions = { coreEquivalent: summarizeProfileSamples(profile.samples.map(sample => sample.cpu.coreEquivalent)),
        observationReadWallMs: summarizeProfileSamples(profile.samples.flatMap(sample => [sample.before.observationReadWallMs, sample.after.observationReadWallMs])),
        samplerUncertaintyMs: summarizeProfileSamples(profile.samples.map(sample => sample.cpu.samplingUncertaintyMs)) };
      if (JSON.stringify(distributions) !== JSON.stringify(profile.distributions)) throw new Error('Profile CPU distribution differs from its samples.');
    }
  }
  return { engines: report.engines.length, available: report.engines.filter(entry => entry.available).length,
    profiles: report.engines.reduce((count, entry) => count + entry.profiles.length, 0), scope: 'fixed-semantic-native-workload-observed-browser-process-cpu-and-independent-latency-estimates' };
}

async function measureEngine(engine, baseURL, parameters, publish) {
  const result = { engine, version: '', available: false, reason: null, profiles: [], final: null };
  publish(result);
  const server = await engines[engine].launchServer({ headless: true, host: '127.0.0.1', ...(engine === 'firefox' ? { firefoxUserPrefs: { 'layers.acceleration.disabled': true, 'gfx.webrender.software': true } } : {}) });
  let browser = null, page = null;
  try {
    browser = await engines[engine].connect(server.wsEndpoint()); result.version = browser.version();
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: [] }); page = await context.newPage();
    await page.goto(baseURL + '/e2e-portable/fixtures/pcm-evidence.html');
    result.viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    result.available = await page.evaluate(() => typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === 'function');
    if (!result.available) { result.reason = 'native-AudioContext-absent'; return result; }
    await page.evaluate(async voices => {
      const { BrowserNotePreview } = await import('/js/app/midi-ui/browserNotePreview.js'), Native = globalThis.AudioContext || globalThis.webkitAudioContext, contexts = [];
      const preview = new BrowserNotePreview({ maxVoices: voices, volume: 0.1, performanceCoordinator: null, runtimeConfig: { preferredSampleRate: 48000 },
        createAudioContext: options => { const context = new Native(options); contexts.push({ context, options }); return context; } });
      const session = preview.createSession('profile-qualification'), backend = session.createInstrumentBackend({ gateMode: 'owned', traceLimit: 0 });
      const button = document.createElement('button'); button.textContent = 'Enable profile workload'; button.onclick = () => { globalThis.profileEnable = session.enable(); }; document.body.append(button);
      globalThis.profileProbe = { preview, session, backend, contexts, voices };
    }, parameters.voices);
    const observer = createBrowserProcessCpuObserver(), rootPid = server.process().pid; result.processRootPid = rootPid;
    for (const name of ['performance', 'balanced', 'robust']) {
      if (name !== 'performance') {
        const change = await page.evaluate(async latencyProfile => { const p = globalThis.profileProbe; return p.preview.configureAudioRuntime({ ...p.preview.getAudioRuntimeConfig(), latencyProfile }); }, name);
        if (change.status !== 'rebuild-ready') throw new Error('Profile replacement was not acknowledged: ' + name);
      }
      await page.getByRole('button', { name: 'Enable profile workload', exact: true }).click();
      if (!await page.evaluate(() => globalThis.profileEnable)) throw new Error('Native profile output did not enable.');
      const start = await page.evaluate(async () => {
        const p = globalThis.profileProbe, context = p.preview.getAudioContext();
        const prepared = await p.backend.prepare({ status: 'ready', patch: { id: 'profile-reference', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
          parameters: { waveform: 1, gain01: 0.02, attackSeconds: 0.008, decaySeconds: 0.05, sustain01: 0.7, releaseSeconds: 0.04 }, sampleRefs: [], voicePolicy: { maxVoices: p.voices, steal: 'reject' }, mix: { gain01: 0.1, pan01: 0 } },
        receipt: { patchId: 'profile-reference', revision: 1 } });
        if (prepared.status !== 'ready') throw new Error('Profile patch did not prepare.');
        const registered = p.backend.registerExecution({ executionEpoch: 'profile-' + p.contexts.length, generation: 0 });
        if (registered.status !== 'accepted') throw new Error('Profile execution did not register.');
        const execution = registered.execution, rate = context.sampleRate, frame = Math.ceil((context.currentTime + 0.25) * rate);
        p.execution = execution; p.leaseUntilSeconds = context.currentTime + 110;
        if (p.backend.renewExecutionLease(0, execution, Math.ceil(p.leaseUntilSeconds * rate)).status !== 'accepted') throw new Error('Profile lease did not admit.');
        for (let index = 0; index < p.voices; index++) {
          const intent = { version: 1, kind: 'begin', voiceId: 'profile-voice-' + index, onsetId: 'profile-onset-' + index, generation: 0, actorId: index,
            sourceEventIds: ['synthetic-profile-probe-' + index], pitch: { cents: 4800 + (index % 24) * 100 }, velocity01: 0.4,
            expression: { pressure01: 1, pan01: p.voices === 1 ? 0 : index / (p.voices - 1) * 1.6 - 0.8 } };
          if (p.backend.begin(intent, frame, execution).status !== 'accepted') throw new Error('Profile voice did not admit: ' + index);
        }
        return { requested: p.contexts.at(-1).options, actualSampleRate: rate, startupAdmissionLeadMs: 250, engineId: 'native-oscillator', engineVersion: 1, voices: p.voices };
      });
      await pause(600);
      const read = () => page.evaluate(() => {
        const p = globalThis.profileProbe, context = p.preview.getAudioContext();
        if (p.leaseUntilSeconds - context.currentTime < 60) {
          p.leaseUntilSeconds = context.currentTime + 110;
          if (p.backend.renewExecutionLease(0, p.execution, Math.ceil(p.leaseUntilSeconds * context.sampleRate)).status !== 'accepted') throw new Error('Profile execution lease could not renew.');
        }
        const started = performance.now();
        for (let i = 0; i < 32; i++) p.preview.getAudioRuntimeObservation();
        const observationReadWallMs = (performance.now() - started) / 32;
        return { audioSeconds: context.currentTime, contextState: context.state, activeVoices: p.backend.renderDiagnostics().activeVoices, observationReadWallMs, observation: p.preview.getAudioRuntimeObservation() };
      });
      const profile = { name, ...start, samples: [], rejectedIntervals: [], observation: null, distributions: null }; result.profiles.push(profile);
      for (let attempt = 0; attempt < parameters.samples * 2 && profile.samples.length < parameters.samples; attempt++) {
        const before = await read(), cpuBefore = await observer.sample(rootPid); await pause(parameters.sampleMs);
        const cpuAfter = await observer.sample(rootPid), after = await read(), cpu = compareBrowserProcessCpu(cpuBefore, cpuAfter);
        const sample = { cpu, before, after, processCounters: { before: cpuBefore, after: cpuAfter } }; profile.observation = after.observation;
        if (cpu.populationStable) profile.samples.push(sample); else profile.rejectedIntervals.push(sample);
      }
      if (profile.samples.length !== parameters.samples) throw new Error('Browser CPU process population did not stabilize.');
      profile.distributions = { coreEquivalent: summarizeProfileSamples(profile.samples.map(sample => sample.cpu.coreEquivalent)),
        observationReadWallMs: summarizeProfileSamples(profile.samples.flatMap(sample => [sample.before.observationReadWallMs, sample.after.observationReadWallMs])),
        samplerUncertaintyMs: summarizeProfileSamples(profile.samples.map(sample => sample.cpu.samplingUncertaintyMs)) };
      console.log(engine + '/' + name + ': actual ' + profile.actualSampleRate + ' Hz; browser process CPU median ' + (profile.distributions.coreEquivalent.median * 100).toFixed(2) + '% of one core; separate browser base/output estimates ' +
        (profile.observation.baseLatencySeconds ?? 'unknown') + ' / ' + (profile.observation.outputLatencySeconds ?? 'unknown') + ' seconds.');
    }
    return result;
  } catch (error) {
    result.failure = String(error?.message || error).replace(/wss?:\/\/\S+/g, '[owned-browser-endpoint]').slice(0, 2048); throw error;
  } finally {
    try {
      if (result.available && page) result.final = await page.evaluate(async () => { const p = globalThis.profileProbe; if (!p) return null; await p.preview.dispose();
        return { retirement: p.preview.getState().retirement, contexts: p.contexts.map(({ context, options }) => ({ requested: options, actualSampleRate: context.sampleRate, closed: context.state === 'closed' })) }; });
    } finally { try { await browser?.close(); } finally { await server.close(); } }
  }
}

export async function runAudioProfileQualification({ out = '.tmp/audio-profile-qualification.json', name = 'rook', samples = 3, sampleMs = 1000, voices = 64, selectedEngines = ['chromium', 'firefox', 'webkit'], capabilities = null } = {}) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name) || !Number.isInteger(samples) || samples < 3 || samples > 8 || !Number.isInteger(sampleMs) || sampleMs < 1000 || sampleMs > 5000 ||
      !Number.isInteger(voices) || voices < 1 || voices > 64 || !Array.isArray(selectedEngines) || !selectedEngines.length || selectedEngines.length > 3 || new Set(selectedEngines).size !== selectedEngines.length || selectedEngines.some(engine => !Object.hasOwn(engines, engine))) throw new TypeError('Invalid bounded audio profile parameters.');
  const report = { schema: 'lemmings-native-audio-profiles/v1', status: 'failed', agent: name, timestamp: new Date().toISOString(), platform: process.platform, node: process.version,
    configuredAudioBackend: process.env.LEMMINGS_LIFECYCLE_AUDIO_BACKEND || 'system-default-unqualified', parameters: { samples, sampleMs, voices, engines: selectedEngines }, source: null, engines: [],
    limits: ['Whole observed browser process CPU includes rendering, IPC and diagnostics; it is not exclusive DSP CPU or GPU/host total.', 'Only stable process-population intervals enter distributions. Sampling duration is reported as uncertainty; zero/coarse timer samples are not sub-resolution precision.',
      'The fixed native semantic workload and 250ms startup admission lead do not establish physical-world capacity or interactive queue latency.', 'Browser base/output/playback estimates remain separate; no microphone, loopback, hardware hotplug or acoustic total is measured.', 'Three default samples are a small empirical cohort; profile hints may be ignored and no cross-host performance ordering is guaranteed.'] };
  try {
    const before = await collectBrowserRuntimeClosure({ rootDir: root }), sourceHarness = await harness(); report.source = { closureDigest: before.closureDigest, files: before.files, harness: sourceHarness };
    await withBoundaryServer(async baseURL => { for (const engine of selectedEngines) { const entry = await measureEngine(engine, baseURL, report.parameters, entry => report.engines.push(entry)); console.log(engine + ': ' + (entry.available ? entry.profiles.length + ' measured profiles' : entry.reason)); } });
    const after = await collectBrowserRuntimeClosure({ rootDir: root });
    if (before.closureDigest !== after.closureDigest || JSON.stringify(sourceHarness) !== JSON.stringify(await harness())) throw new Error('Audio profile source changed during measurement.');
    report.qualification = qualifyAudioProfileReport(report);
    if (capabilities) {
      const bytes = await fs.readFile(path.resolve(root, capabilities)), qualification = JSON.parse(bytes), projects = { chromium: 'chromium-semantic', firefox: 'firefox-lifecycle', webkit: 'webkit-lifecycle' };
      if (qualification.status !== 'passed' || qualification.source?.closureDigest !== report.source.closureDigest) throw new Error('Profile capability source does not match the qualified native engines.');
      for (const engine of report.engines) {
        const source = qualification.qualification?.engines?.find(value => value.project === projects[engine.engine]);
        if (!source || source.browser !== engine.version || source.source.audioContextAvailable !== engine.available) throw new Error('Profile capability contradicts the qualified native engine: ' + engine.engine);
      }
      report.capabilityReference = { path: capabilities, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    report.status = 'passed';
  } catch (error) { report.error = String(error?.stack || error).replace(/wss?:\/\/\S+/g, '[owned-browser-endpoint]').slice(0, 8192); }
  const destination = path.resolve(root, out); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  console.log('Audio profiles: ' + report.status); return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const input = {}, allowed = new Set(['out', 'name', 'samples', 'sample-ms', 'voices', 'engines', 'capabilities']);
  for (const item of process.argv.slice(2)) { const match = /^--([a-z-]+)=(.+)$/.exec(item); if (!match || !allowed.has(match[1]) || Object.hasOwn(input, match[1])) throw new Error('Unknown or duplicate audio profile option.'); input[match[1]] = match[2]; }
  const result = await runAudioProfileQualification({ ...(input.out ? { out: input.out } : {}), ...(input.name ? { name: input.name } : {}),
    ...(input.samples ? { samples: Number(input.samples) } : {}), ...(input['sample-ms'] ? { sampleMs: Number(input['sample-ms']) } : {}), ...(input.voices ? { voices: Number(input.voices) } : {}), ...(input.engines ? { selectedEngines: input.engines.split(',') } : {}), ...(input.capabilities ? { capabilities: input.capabilities } : {}) });
  process.exitCode = result.status === 'passed' ? 0 : 1;
}
