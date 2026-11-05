import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { generateDeliveryTrace, replayDeliveryTrace, shrinkDeliveryTrace } from '../test/support/export-delivery-model.js';
import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';
const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
for (const argument of process.argv.slice(2)) { const match = /^--(seed|runs|steps|max-ms|max-heap-mib|out-dir|replay|name)=(.+)$/.exec(argument); if (!match || options[match[1]]) throw new Error('Unknown/repeated delivery-model option.'); options[match[1]] = match[2]; }
const integer = (key, fallback, low, high) => { const value = options[key] == null ? fallback : Number(options[key]); if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error('Invalid delivery-model ' + key); return value; };
const seed = integer('seed', 1979, 0, 0xffffffff), runs = integer('runs', 128, 1, 4096), steps = integer('steps', 32, 1, 128), maximumMs = integer('max-ms', 60000, 1000, 900000);
const maximumHeapBytes = integer('max-heap-mib', 256, 64, 1024) * 1048576; let peakMeasuredHeapBytes = 0;
if (!options['out-dir']) throw new Error('Select a new --out-dir=temp/... for the source-bound campaign.');
const inside = value => { const resolved = path.resolve(root, value); if (!resolved.startsWith(path.join(root, 'temp') + path.sep)) throw new Error('Model artifacts must stay under project temp.'); return resolved; };
const output = inside(options['out-dir']); await fs.mkdir(path.dirname(output), { recursive: true }); inside(path.join(await fs.realpath(path.dirname(output)), path.basename(output))); await fs.mkdir(output);
const started = performance.now(), deadline = started + maximumMs, checkBudget = () => {
  peakMeasuredHeapBytes = Math.max(peakMeasuredHeapBytes, process.memoryUsage().heapUsed);
  if (performance.now() > deadline) throw Object.assign(new Error('Declared delivery-model wall budget exhausted.'), { code: 'model-wall-budget' });
  if (peakMeasuredHeapBytes > maximumHeapBytes) throw Object.assign(new Error('Declared observed Node heap budget exhausted.'), { code: 'model-heap-budget' });
};
const closure = await collectRuntimeSourceClosure({ rootDir: root, entries: ['js/app/export/ExportArtifact.js'], maxFiles: 32, maxBytes: 512 * 1024 });
if (closure.dependencies.length) throw new Error('Delivery model needs a complete owned export source closure.');
const source = [...closure.files];
for (const filename of ['scripts/profile-export-delivery-model.mjs', 'scripts/RuntimeSourceClosure.js', 'test/support/export-delivery-model.js', 'test/fixtures/export-delivery-premature-release.json']) { const bytes = await fs.readFile(path.join(root, filename)); source.push({ path: filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
let replay = null;
if (options.replay) { const filename = await fs.realpath(inside(options.replay)); inside(filename); if ((await fs.stat(filename)).size > 262144) throw new Error('Replay input exceeds its bound.'); replay = JSON.parse(await fs.readFile(filename, 'utf8')).trace; }
const report = { schema: 'export-delivery-model-campaign/v1', status: 'running', agent: options.name || null, node: process.version, seed, runs: replay ? 1 : runs, maximumSteps: steps, maximumMs, maximumHeapBytes,
  source, scope: 'Actual export artifact/delivery owners with controlled native file promises and a separate serial reference. No browser filesystem, disk durability or process-memory qualification.', cases: [], failure: null };
try {
  for (let index = 0; index < report.runs; index++) {
    checkBudget(); const selectedSeed = (seed + Math.imul(index, 0x9e3779b9)) >>> 0, trace = replay || generateDeliveryTrace(selectedSeed, { steps });
    try {
      const result = await replayDeliveryTrace(trace, { checkBudget }); if (!result.valid) throw new Error('Campaign produced an invalid command precondition.');
      report.cases.push({ seed: selectedSeed, transitions: result.transitions, trace, logicalOutcome: result.receipt?.state || 'pending-prefix', completeInTrace: result.reference.settled && !Object.values(result.reference.pending).some(Boolean),
        sourceHash: result.sourceHash, finalSourceRetained: result.reference.retained, neighborLeaseRetained: result.reference.neighbor });
    } catch (error) {
      const signature = /delivery-model:([a-z-]+)/.exec(error.message)?.[1] || error.code || error.message;
      const fails = async candidate => { try { const result = await replayDeliveryTrace(candidate, { checkBudget }); return false; } catch (failure) { return (/delivery-model:([a-z-]+)/.exec(failure.message)?.[1] || failure.code || failure.message) === signature; } };
      report.failure = { seed: selectedSeed, signature, message: error.message, originalTrace: error.modelTrace || trace, minimalTrace: error.modelTrace || trace, shrinkAttempts: 0, shrinkExhausted: true, observations: error.modelObservations || [] };
      if (!/^model-(wall|heap)-budget$/.test(error.code || '')) {
        try {
          const reduced = await shrinkDeliveryTrace(report.failure.originalTrace, fails, { checkBudget });
          Object.assign(report.failure, { minimalTrace: reduced.trace, shrinkAttempts: reduced.attempts, shrinkExhausted: reduced.exhausted });
        } catch (shrinkingError) { report.failure.shrinkError = shrinkingError.message; }
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
report.wallMs = performance.now() - started;
report.peakMeasuredHeapBytes = peakMeasuredHeapBytes;
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report));
console.log(JSON.stringify({ path: path.relative(root, path.join(output, 'report.json')), status: report.status, completed: report.cases.length, transitions: report.cases.reduce((sum, value) => sum + value.transitions, 0), wallMs: report.wallMs, failure: report.failure?.signature || null }));
if (report.status !== 'passed') process.exitCode = 1;
