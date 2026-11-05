import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';
import { shrinkModelTrace } from '../test/support/model-trace.js';

export async function runModelTraceCampaign({ schema, failurePrefix, entry, sourceEntries, fixtures = [], defaultSteps = 32, maximumSteps = 128,
  generate, replay, summarize, scope } = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
  for (const argument of process.argv.slice(2)) { const match = /^--(seed|runs|steps|max-ms|max-heap-mib|out-dir|replay|name)=(.+)$/.exec(argument); if (!match || options[match[1]]) throw new Error('Unknown/repeated lifecycle-model option.'); options[match[1]] = match[2]; }
  const integer = (key, fallback, low, high) => { const value = options[key] == null ? fallback : Number(options[key]); if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error('Invalid lifecycle-model ' + key); return value; };
  const seed = integer('seed', 1979, 0, 0xffffffff), runs = integer('runs', 128, 1, 4096), steps = integer('steps', defaultSteps, 1, maximumSteps), maximumMs = integer('max-ms', 60000, 1000, 900000);
  const maximumHeapBytes = integer('max-heap-mib', 256, 64, 1024) * 1048576; let peakMeasuredHeapBytes = 0;
  if (!options['out-dir']) throw new Error('Select a new --out-dir=temp/... for the source-bound campaign.');
  const inside = value => { const resolved = path.resolve(root, value); if (!resolved.startsWith(path.join(root, 'temp') + path.sep)) throw new Error('Model artifacts must stay under project temp.'); return resolved; };
  const output = inside(options['out-dir']); await fs.mkdir(path.dirname(output), { recursive: true }); inside(path.join(await fs.realpath(path.dirname(output)), path.basename(output))); await fs.mkdir(output);
  const started = performance.now(), deadline = started + maximumMs, checkBudget = () => {
    peakMeasuredHeapBytes = Math.max(peakMeasuredHeapBytes, process.memoryUsage().heapUsed);
    if (performance.now() > deadline) throw Object.assign(new Error('Declared model wall budget exhausted.'), { code: 'model-wall-budget' });
    if (peakMeasuredHeapBytes > maximumHeapBytes) throw Object.assign(new Error('Declared observed Node heap budget exhausted.'), { code: 'model-heap-budget' });
  };
  const closure = await collectRuntimeSourceClosure({ rootDir: root, entries: sourceEntries, maxFiles: 512, maxBytes: 16 * 1048576 });
  if (closure.dependencies.length) throw new Error('Model requires a complete owned source closure: ' + closure.dependencies.join(', '));
  const source = [...closure.files], known = new Set(source.map(row => row.path));
  for (const filename of [entry, 'scripts/ModelTraceCampaign.js', 'scripts/RuntimeSourceClosure.js', 'test/support/model-trace.js', ...fixtures]) if (!known.has(filename)) {
    const bytes = await fs.readFile(path.join(root, filename)); source.push({ path: filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); known.add(filename);
  }
  let selectedReplay = null;
  if (options.replay) { const filename = await fs.realpath(inside(options.replay)); inside(filename); if ((await fs.stat(filename)).size > 262144) throw new Error('Replay input exceeds its bound.'); selectedReplay = JSON.parse(await fs.readFile(filename, 'utf8')).trace; if (!Array.isArray(selectedReplay)) throw new Error('Replay requires a trace array.'); }
  const report = { schema, status: 'running', agent: options.name || null, node: process.version, seed, runs: selectedReplay ? 1 : runs, maximumSteps: steps, maximumMs, maximumHeapBytes,
    source, scope, cases: [], failure: null };
  const signatureFor = error => new RegExp(failurePrefix + ':([a-z-]+)').exec(error.message)?.[1] || error.code || error.message;
  try {
    for (let index = 0; index < report.runs; index++) {
      checkBudget(); const selectedSeed = (seed + Math.imul(index, 0x9e3779b9)) >>> 0, trace = selectedReplay || generate(selectedSeed, { steps });
      try {
        const result = await replay(trace, { checkBudget }); if (!result.valid) throw new Error('Campaign produced an invalid command precondition.');
        report.cases.push({ seed: selectedSeed, transitions: result.transitions, trace, ...summarize(result) });
      } catch (error) {
        const signature = signatureFor(error);
        const fails = async candidate => { try { await replay(candidate, { checkBudget }); return false; } catch (failure) { return signatureFor(failure) === signature; } };
        report.failure = { seed: selectedSeed, signature, message: error.message, originalTrace: error.modelTrace || trace, minimalTrace: error.modelTrace || trace, shrinkAttempts: 0, shrinkExhausted: true, observations: error.modelObservations || [] };
        if (!/^model-(wall|heap)-budget$/.test(error.code || '')) {
          try { const reduced = await shrinkModelTrace(report.failure.originalTrace, fails, { checkBudget }); Object.assign(report.failure, { minimalTrace: reduced.trace, shrinkAttempts: reduced.attempts, shrinkExhausted: reduced.exhausted }); }
          catch (shrinkingError) { report.failure.shrinkError = shrinkingError.message; }
        }
        report.status = 'failed'; break;
      }
    }
    if (report.status === 'running') report.status = 'passed';
  } catch (error) { report.status = /^model-(wall|heap)-budget$/.test(error.code || '') ? 'budget-exhausted' : 'failed'; report.failure ||= { message: error.message }; }
  for (const input of source) {
    const bytes = await fs.readFile(path.join(root, input.path));
    if (bytes.length !== input.bytes || createHash('sha256').update(bytes).digest('hex') !== input.sha256) { report.status = 'source-changed'; report.failure ||= { message: 'Campaign source changed: ' + input.path }; }
  }
  report.wallMs = performance.now() - started; report.peakMeasuredHeapBytes = peakMeasuredHeapBytes;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report));
  console.log(JSON.stringify({ path: path.relative(root, path.join(output, 'report.json')), status: report.status, completed: report.cases.length, transitions: report.cases.reduce((sum, value) => sum + value.transitions, 0), wallMs: report.wallMs, failure: report.failure?.signature || null }));
  if (report.status !== 'passed') process.exitCode = 1;
  return report;
}
