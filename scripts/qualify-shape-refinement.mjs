import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { solveOriginalShapeRefinement, SHAPE_REFINEMENT_PROFILE } from '../js/app/resources/ShapeBodyRefinement.js';
import { canonicalDataText } from '../js/core/CanonicalData.js';

const root = fileURLToPath(new URL('../', import.meta.url)), args = {};
for (const argument of process.argv.slice(2)) { const match = /^--(name|output|shape|profile)=(.+)$/.exec(argument); if (!match || Object.hasOwn(args, match[1])) throw new Error('Expected unique --name=, --output=, --shape= or --profile= options.'); args[match[1]] = match[2]; }
if (args.name && !/^[a-z][a-z0-9-]{0,31}$/i.test(args.name) || args.shape && args.shape !== 'pocket-bar' || args.profile && args.profile !== SHAPE_REFINEMENT_PROFILE.id) throw new Error('Only the original pocket-bar low-eight-v1 comparison is available.');
const inside = (parent, target) => { const relative = path.relative(parent, target); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const output = path.resolve(root, args.output || 'dist/shape-refinement'); if (!inside(path.join(root, 'dist'), output)) throw new Error('Refinement output must stay inside a repository dist subdirectory.');
await fs.mkdir(output, { recursive: true }); const outputReal = await fs.realpath(output), rootReal = await fs.realpath(root);
if (!inside(path.join(rootReal, 'dist'), outputReal)) throw new Error('Refinement output resolves outside repository dist.');
const lockPath = path.join(outputReal, '.refinement.lock'), lock = await fs.open(lockPath, 'wx'), controller = new AbortController(), temporary = path.join(outputReal, '.head-' + randomUUID() + '.json');
const abort = () => controller.abort(new Error('Shape refinement comparison canceled.')); process.once('SIGINT', abort); process.once('SIGTERM', abort);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFiles = async files => { const hash = createHash('sha256'); for (const file of files) hash.update(file).update('\0').update(await fs.readFile(path.join(root, file))).update('\0'); return hash.digest('hex'); };
const writeImmutable = async (name, bytes) => {
  controller.signal.throwIfAborted(); const target = path.join(outputReal, name);
  if (path.dirname(target) !== outputReal || !/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('Invalid immutable refinement output path.');
  try { await fs.writeFile(target, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; if (!(await fs.readFile(target)).equals(bytes)) throw new Error('Immutable refinement output identity conflicts with existing bytes.'); }
  controller.signal.throwIfAborted(); return name;
};
try {
  await lock.writeFile(JSON.stringify({ pid: process.pid, agent: args.name || null }) + '\n');
  const solverFiles = ['js/app/resources/ShapeBodySolver.js', 'js/midi/content/ShapeBodyAsset.js', 'js/core/CanonicalData.js'], solverBuildHash = await hashFiles(solverFiles), comparisonBuildHash = await hashFiles(['js/app/resources/ShapeBodyRefinement.js', 'js/midi/content/OriginalShapeMeshes.js', ...solverFiles]);
  const result = await solveOriginalShapeRefinement({ shapeId: 'pocket-bar', profileId: SHAPE_REFINEMENT_PROFILE.id, solverBuildHash, comparisonBuildHash }, { signal: controller.signal, estimatedPeakBytes: 128 * 1048576 });
  const inputs = {};
  for (const kind of ['coarse', 'fine']) { const asset = result[kind], bytes = Buffer.from(canonicalDataText(asset, { maxBytes: 2 * 1048576, maxNodes: 131072 }).text + '\n'), fileHash = digest(bytes);
    inputs[kind] = { assetHash: asset.assetHash, fileHash, bytes: bytes.byteLength, path: await writeImmutable(fileHash + '.json', bytes) }; }
  const bytes = Buffer.from(canonicalDataText({ schema: 'lemmings-shape-refinement-package/v1', inputs, receipt: result.receipt }, { maxBytes: 524288, maxNodes: 32768 }).text + '\n'), reportHash = digest(bytes), filename = await writeImmutable(reportHash + '.json', bytes);
  controller.signal.throwIfAborted(); await fs.writeFile(temporary, canonicalDataText({ schema: 'lemmings-shape-refinement-head/v1', reportHash, path: filename, status: result.receipt.status, automaticTierAdmission: false }).text + '\n', { flag: 'wx' }); controller.signal.throwIfAborted(); await fs.rename(temporary, path.join(outputReal, 'current.json'));
  console.log(JSON.stringify({ agent: args.name || null, status: result.receipt.status, reportHash, receiptHash: result.receipt.receiptHash, summary: result.receipt.summary, output: path.join(outputReal, filename), acousticQualification: false, automaticTierAdmission: false }));
  if (result.receipt.status !== 'within-profile-tolerances') process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
  if (path.dirname(temporary) !== outputReal) throw new Error('Invalid refinement temporary cleanup path.');
  const errors = []; let closed = false;
  try { await fs.rm(temporary, { force: true }); } catch (error) { errors.push(error); }
  try { await lock.close(); closed = true; } catch (error) { errors.push(error); }
  if (closed) try { await fs.rm(lockPath); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'Refinement output cleanup remains incomplete.');
}
