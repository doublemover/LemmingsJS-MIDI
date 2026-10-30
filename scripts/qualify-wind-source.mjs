import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { WindModalKernel, WIND_STATE as S } from '../js/app/midi-ui/worklet/WindModalKernel.js';
import { WIND_MODEL_KINDS, WIND_MODEL_REVISION, WIND_PRESSURE_DOMAINS, WIND_PITCH_DOMAINS } from '../js/midi/content/WindModel.js';

const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return at < 0 ? [value.replace(/^--/, ''), true] : [value.slice(2, at), value.slice(at + 1)]; }));
if (Object.keys(args).some(key => !['name', 'out'].includes(key))) throw new TypeError('Use --name=NAME and optionally --out=REPORT.json; this run includes the complete authored grid and sixty-second sustains.');
const reports = [], pitchObservation = (values, rate, root) => {
  let best = 0, bestLag = 0;
  for (let lag = Math.max(1, Math.floor(rate / (root * 1.25))); lag <= Math.ceil(rate / (root * 0.75)); lag++) { let dot = 0, a = 0, b = 0; for (let frame = lag; frame < values.length; frame++) { dot += values[frame] * values[frame - lag]; a += values[frame] ** 2; b += values[frame - lag] ** 2; } const similarity = a && b ? dot / Math.sqrt(a * b) : 0; if (similarity > best) { best = similarity; bestLag = lag; } }
  return { estimateHz: bestLag ? rate / bestLag : null, correlation: best, method: 'bounded-autocorrelation-near-authored-register;not-a-tuning-or-dropout-verdict' };
};
const run = (rate, kind, root, air, bite, seconds, purpose) => {
  const source = new WindModalKernel(rate), bodyFrames = Math.round(seconds * rate), tailFrames = Math.round(rate * 0.5), cost = new Float64Array(Math.ceil((bodyFrames + tailFrames) / 128) + 1), window = new Float64Array(8192);
  if (!source.begin(kind, root, 0x12345678, air, bite, 1, 0.25, 0.35, 0)) throw new Error('Authored wind case is not admitted.');
  let frame = 0, sum = 0, sumSquares = 0, peak = 0, finite = true, blocks = 0, writes = 0, endWork = 0, tailSilentWork = 0;
  const renderUntil = end => { while (frame < end) { const stop = Math.min(frame + 128, end), started = performance.now(); while (frame < stop) { source.sample(frame++); const sample = (source.leftSample + source.rightSample) * 0.5; finite &&= Number.isFinite(sample); sum += sample; sumSquares += sample * sample; peak = Math.max(peak, Math.abs(sample)); if (frame <= bodyFrames) window[writes++ % window.length] = sample; } cost[blocks++] = performance.now() - started; } };
  renderUntil(bodyFrames); const voiced = source.diagnostics(); source.end(frame); renderUntil(bodyFrames + Math.round(rate * 0.35)); endWork = source.state[S.inputWork]; renderUntil(bodyFrames + tailFrames); tailSilentWork = source.state[S.inputWork] - endWork;
  const d = source.diagnostics(), sorted = cost.subarray(0, blocks).sort(), ordered = Float64Array.from({ length: Math.min(writes, window.length) }, (_, index) => window[writes >= window.length ? (writes + index) % window.length : index]);
  const balanceDefect = Math.abs(d.energy + d.linearLoss - d.inputWork), passed = finite && d.faults === 0 && peak > 0 && tailSilentWork === 0 && balanceDefect <= 1e-8 * (1 + Math.abs(d.inputWork));
  reports.push({ purpose, rate, kind: WIND_MODEL_KINDS[kind], rootHz: root, air01: air, bite01: bite, heldSeconds: seconds, tailSeconds: 0.5, passed, finite, peak, dc: sum / frame, rms: Math.sqrt(sumSquares / frame), tailSilentWork, balanceDefect, pitch: pitchObservation(ordered, rate, root * (voiced.register ? 2 : 1)), registerChanges: d.registerTransitions, renderCostMs: { blockSize: 128, median: sorted[Math.floor(blocks / 2)], p99: sorted[Math.floor(blocks * 0.99)], maximum: sorted[blocks - 1], scope: 'this-process-render-and-observation;not-device-worklet-capacity' }, diagnostics: d });
};
for (const rate of [44100, 48000, 96000]) for (let kind = 0; kind < 3; kind++) {
  const pressure = WIND_PRESSURE_DOMAINS[kind], pitch = WIND_PITCH_DOMAINS[kind];
  for (const root of [pitch[0], (pitch[0] + pitch[1]) * 0.5, pitch[1]]) for (const air of [pressure[0], (pressure[0] + pressure[1]) * 0.5, pressure[1]]) for (const bite of [0.35, 0.5, 0.65]) run(rate, kind, root, air, bite, 0.5, 'sampled-pressure-pitch-bite-map;not-continuous-region-qualification');
  run(rate, kind, kind === 1 ? 440 : 220, kind === 1 ? 0.3 : kind === 2 ? 0.5 : 0.35, 0.5, 60, 'sixty-second-held-gesture');
}
const report = { schema: 'lemmings-wind-source-qualification/v1', revision: WIND_MODEL_REVISION, agent: typeof args.name === 'string' ? args.name : null, status: reports.every(value => value.passed) ? 'observed-numerical-cases' : 'failed-numerical-cases', acousticQualification: false,
  remaining: ['review-sampled-stability-and-unwanted-register/dropout-regions', 'pitch-drift-and-alias-spectrum', 'held-physical-gesture-worklet-device-cost', 'exact-cut-PCM-equivalence', 'Breathing-Stairwell-physical-playback', 'levelmatched-listening'], reports };
if (args.out) { if (typeof args.out !== 'string') throw new TypeError('Choose an output report path.'); await writeFile(args.out, JSON.stringify(report, null, 2) + '\n'); } else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!reports.every(value => value.passed)) process.exitCode = 1;
