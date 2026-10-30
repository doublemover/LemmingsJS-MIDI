import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { FrictionModalKernel } from '../js/app/midi-ui/worklet/FrictionModalKernel.js';
import { FRICTION_MODEL_KINDS, FRICTION_PRESSURE_DOMAINS, FRICTION_MODEL_REVISION } from '../js/midi/content/FrictionModel.js';

const args = Object.fromEntries(process.argv.slice(2).map(argument => { const at = argument.indexOf('='); return at < 0 ? [argument.replace(/^--/, ''), true] : [argument.slice(2, at), argument.slice(at + 1)]; }));
if (Object.keys(args).some(key => !['name', 'out'].includes(key))) throw new TypeError('Use --name=NAME and optionally --out=REPORT.json. This qualification always includes sixty seconds of observed motion.');
const blockSize = 128, reports = [];
const autocorrelationPitch = (samples, rate, root) => {
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(rate / (root * 1.25)); lag <= Math.ceil(rate / (root * 0.75)); lag++) {
    let dot = 0, a = 0, b = 0;
    for (let frame = lag; frame < samples.length; frame++) { dot += samples[frame] * samples[frame - lag]; a += samples[frame] ** 2; b += samples[frame - lag] ** 2; }
    const similarity = a && b ? dot / Math.sqrt(a * b) : 0;
    if (similarity > best) { best = similarity; bestLag = lag; }
  }
  return { estimateHz: bestLag ? rate / bestLag : null, correlation: best, method: 'bounded-autocorrelation-near-intended-root;not-a-tuning-or-timbre-verdict' };
};
for (const rate of [44100, 48000, 96000]) for (let kind = 0; kind < FRICTION_MODEL_KINDS.length; kind++) {
  const source = new FrictionModalKernel(rate), pressures = FRICTION_PRESSURE_DOMAINS[kind], root = 220, durations = [], window = new Float64Array(8192);
  let frame = 0, position = 0, sum = 0, sumSquares = 0, peak = 0, windowWrite = 0, finite = true, restInputWork = 0, previousWork = 0;
  const runUntil = end => {
    while (frame < end) {
      const stop = Math.min(end, frame + blockSize), started = performance.now();
      while (frame < stop) {
        source.sample(frame++); const sample = (source.leftSample + source.rightSample) * 0.5;
        finite &&= Number.isFinite(sample); sum += sample; sumSquares += sample * sample; peak = Math.max(peak, Math.abs(sample));
        if (frame > rate * 57 && frame <= rate * 60) window[windowWrite++ % window.length] = sample;
      }
      durations.push(performance.now() - started);
    }
  };
  for (let second = 0; second < 60; second++) {
    const atRest = second === 20 || second === 21 || second === 40, speed = atRest ? 0 : second < 10 ? 16 + second * 48 : second < 30 ? 120 : -120;
    const endPosition = position + speed, end = (second + 1) * rate;
    if (!second) { if (!source.begin(kind, root, 0x12345678, 0.5, pressures[1], 0.18, kind === 1 ? 0.05 : 0.12, position, endPosition, frame, end)) throw new Error('Qualification source was not admitted.'); }
    else if (!source.setSpan(position, endPosition, frame, end)) throw new Error('Qualification motion was not contiguous.');
    source.setPressure(second < 10 ? 1 : 0.25 + 0.75 * ((second - 10) % 10) / 9); previousWork = source.state[18]; runUntil(end);
    if (atRest) restInputWork += Math.abs(source.state[18] - previousWork); position = endPosition;
  }
  source.end(frame); const endWork = source.state[18]; runUntil(frame + rate * 3);
  const orderedWindow = Float64Array.from({ length: window.length }, (_, index) => window[(windowWrite + index) % window.length]);
  durations.sort((a, b) => a - b); const diagnostics = source.diagnostics(), balanceDefect = Math.abs(diagnostics.energy + diagnostics.frictionLoss + diagnostics.linearLoss - diagnostics.inputWork);
  const passed = finite && diagnostics.faults === 0 && peak > 0 && restInputWork === 0 && source.state[18] === endWork && balanceDefect <= 1e-8 * (1 + diagnostics.inputWork);
  reports.push({ rate, kind: FRICTION_MODEL_KINDS[kind], intendedRootHz: root, motionSeconds: 60, tailSeconds: 3, testedPressureRange: pressures.map(value => value * 0.25).concat(pressures[1]), passed, finite, peak, dc: sum / frame, rms: Math.sqrt(sumSquares / frame), restInputWork, tailInputWork: source.state[18] - endWork, balanceDefect,
    pitchObservation: autocorrelationPitch(orderedWindow, rate, root), renderCostMs: { blockSize, median: durations[Math.floor(durations.length / 2)], p99: durations[Math.floor(durations.length * 0.99)], maximum: durations.at(-1), environment: 'this-process;excludes-device-worklet-host-and-UI' }, diagnostics });
}
const report = { schema: 'lemmings-friction-source-qualification/v1', revision: FRICTION_MODEL_REVISION, agent: typeof args.name === 'string' ? args.name : null, status: reports.every(report => report.passed) ? 'observed-numerical-cases' : 'failed-numerical-cases', acousticQualification: false,
  remaining: ['full-parameter-stability-region', 'alias-spectrum-and-pitch-drift-review', 'two-actor-worklet-device-cost', 'checkpoint-PCM-equivalence', 'physical-Bow-Orchard-playback', 'matched-level-listening'], reports };
if (args.out) { if (typeof args.out !== 'string') throw new TypeError('Choose an output report path.'); await writeFile(args.out, JSON.stringify(report, null, 2) + '\n'); }
else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!reports.every(report => report.passed)) process.exitCode = 1;
