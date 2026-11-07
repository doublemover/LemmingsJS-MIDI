import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { collectInstrumentArtifactProfiles } from './InstrumentArtifactClosure.js';
import { computeInstrumentArtifacts } from '../js/runtime/InstrumentArtifactManifest.js';

const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
for (const arg of process.argv.slice(2)) { const match = /^--(out-dir|name|browser|traces|execute)=(.+)$/.exec(arg); if (!match || Object.hasOwn(options, match[1])) throw new Error('Unknown/repeated engine comparison option.'); options[match[1]] = match[2]; }
if (options.execute != null && !['true', 'false'].includes(options.execute)) throw new Error('Use explicit --execute=true for the deferred runtime campaign.');
const candidates = [
  { id: 'native-baseline', input: 'content/sounds/native.json', patch: 'foundation.soft-triangle' },
  { id: 'owned-sine', input: 'content/sounds/native.json', patch: 'foundation.held-sine' },
  { id: 'fm', input: 'content/sounds/fm-forge.json', patch: 'forge.glass-rivet' },
  { id: 'modal', input: 'content/sounds/struck-materials.json', patch: 'material.timber' },
  { id: 'pluck', input: 'content/sounds/plucked-garden.json', patch: 'pluck.burrow-thumb' },
  { id: 'spectrum', input: 'content/sounds/liquid-drawbars.json', patch: 'spectrum.bubble-reed' }
], plan = { schema: 'lemmings-engine-stack-comparison-plan/v1', agent: options.name || 'rook', workloadRevision: 'identical-owned-semantic-workloads-v1', voiceCounts: [16, 32, 64],
  fixtureKinds: ['pluck', 'sustained-bend', 'drum-burst', 'per-note-expression', 'effect-tail'], candidates, sampleRates: [48000], browser: options.browser || 'chromium',
  physicalFixtures: options.traces || null, execution: options.execute === 'true' ? 'explicit-runtime-campaign' : 'plan-only;no-rendering', currentResults: 'not-yet-measured',
  unsupportedCandidates: [{ id: 'faust-stock-poly', sourceCommit: '1c0d17a7bb4a047a4a08cb34a0bc6a3ee2019b67', decision: 'not-selected;independent-owned-voice-adapter-required' },
    { id: 'spessasynth-stock-midi', sourceCommit: '40f9be2014a0312bc2fec14f215cb90510876a4e', decision: 'not-selected;channel-key-controls-do-not-establish-required-local-voice-contract' },
    { id: 'tone-helpers', decision: 'not-selected;no-required-additional-role-demonstrated;no-global-transport' }],
  unmeasuredColumns: ['real-time-block-and-queue-p99', 'first-usable-live-note', 'actual-live-memory', 'device-latency', 'subjective-quality'] };
if (options.execute !== 'true') { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
if (!options['out-dir']) throw new Error('Provide a new --out-dir= beneath temp/ for exact campaign artifacts.');
const temp = path.join(await fs.realpath(root), 'temp'), output = path.resolve(root, options['out-dir']), relative = path.relative(temp, output);
if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Engine comparison output must be a new directory inside workspace temp/.');
await fs.mkdir(path.dirname(output), { recursive: true }); const parent = await fs.realpath(path.dirname(output)), resolved = path.relative(temp, path.join(parent, path.basename(output)));
if (!resolved || resolved === '..' || resolved.startsWith('..' + path.sep) || path.isAbsolute(resolved)) throw new Error('Engine comparison output ancestor escapes temp/.');
await fs.mkdir(output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), source = await collectInstrumentArtifactProfiles({ rootDir: root }), artifacts = await computeInstrumentArtifacts(source.files, source.profiles),
  inventory = new Map(source.files.map(file => [file.path, file])), compressed = new Map();
for (const file of source.files) { const bytes = await fs.readFile(path.join(root, file.path)); if (bytes.byteLength !== file.bytes || hash(bytes) !== file.sha256) throw new Error('Engine source changed during transfer inventory.'); compressed.set(file.path, gzipSync(bytes, { level: 9 }).length); }
const transfer = source.profiles.map(profile => ({ engineId: profile.engineId, engineVersion: profile.engineVersion, artifactHash: artifacts.find(artifact => artifact.engineId === profile.engineId).artifactHash,
  files: profile.files.length, sourceBytes: profile.files.reduce((sum, name) => sum + inventory.get(name).bytes, 0), independentFileGzipBytes: profile.files.reduce((sum, name) => sum + compressed.get(name), 0),
  scope: 'complete-source-module-closure;shared-files-counted-per-candidate;HTTP-headers-generated-banks-and-cache-reuse-excluded' }));
await fs.writeFile(path.join(output, 'plan.json'), JSON.stringify({ ...plan, transfer, node: process.version, platform: process.platform }, null, 2), { flag: 'wx' });
const run = args => new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); }), results = [];
for (const candidate of candidates) {
  const directory = path.join(output, candidate.id), args = ['scripts/qualify-sound-content.mjs', '--input=' + candidate.input, '--patch=' + candidate.patch, '--out-dir=' + path.relative(root, directory), '--sample-rates=48000', '--include-macro-grid=false', '--include-engine-stack=true', '--browser=' + plan.browser];
  if (options.traces) args.push('--traces=' + options.traces);
  const exit = await run(args); let report = null, snapshot = null;
  try { report = JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8')).report; snapshot = JSON.parse(await fs.readFile(path.join(directory, 'source-snapshot.json'), 'utf8')); } catch { /* Missing producer results remain explicit and fail the aggregate campaign. */ }
  const engine = report?.results?.find(row => row.engineRequirement)?.engineRequirement;
  if (engine && engine.artifactHash !== artifacts.find(artifact => artifact.engineId === engine.engineId)?.artifactHash) throw new Error('The compared engine changed after source inventory.');
  results.push({ id: candidate.id, patch: candidate.patch, exit, reportHash: report?.reportHash || null, applicationBuildId: report?.applicationBuildId || null, sourceSnapshotHash: snapshot ? hash(Buffer.from(JSON.stringify(snapshot))) : null,
    engineRequirement: engine || null, coverage: report?.coverage || null, acceptance: report?.acceptance || null,
    workloads: (report?.results || []).filter(row => row.sourceFixture.id.startsWith('engine-stack-')).map(row => ({ fixtureId: row.sourceFixture.id, fixtureHash: row.sourceFixture.hash, state: row.state,
      failure: row.failure, admission: row.admissionReceipt?.commands || null, offlineResourceMeasurement: row.admissionReceipt?.resourceMeasurement || null, digitalFindings: row.digitalReceipt?.findings || [], metrics: row.digitalReceipt ? { rms: row.digitalReceipt.metrics.rms, peak: row.digitalReceipt.metrics.peak, nonfiniteSamples: row.digitalReceipt.metrics.nonfiniteSamples } : null })) });
}
const result = { schema: 'lemmings-engine-stack-comparison-result/v1', plan, transfer, results, completed: results.every(row => row.exit.code === 0 && row.coverage?.complete), acousticReceipt: false, automaticSelection: false,
  interpretation: 'actual-common-offline-workloads-and-transfer-inventory;separate-live-device-and-real-physical-qualification-remains-required' };
await fs.writeFile(path.join(output, 'comparison.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
if (!result.completed) process.exitCode = 1;
