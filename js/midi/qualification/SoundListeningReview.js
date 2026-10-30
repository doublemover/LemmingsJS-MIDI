import { hashData, canonicalDataText } from '../../core/CanonicalData.js';
import { compareSoundFeatures, matchSoundLevels } from './SoundRenderAnalysis.js';
import { decodeQualificationFloatWav } from './SharedSoundQualificationRenderer.js';
const fail = message => { throw new Error('Listening review: ' + message); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const reviewable = row => row?.state === 'listening-pending' && row.artifact && row.digitalReceipt?.state === 'technically-valid';
async function verifiedReport(report) { const { reportHash, ...value } = report; if (!hash(reportHash) || await hashData(value) !== reportHash) fail('report changed after measurement.'); return report; }
export async function findNearDuplicateSounds(reports, { maximumComparisons = 8192 } = {}) {
  if (!Array.isArray(reports) || reports.length < 2 || reports.length > 128 || !Number.isSafeInteger(maximumComparisons) || maximumComparisons < 1 || maximumComparisons > 8192) fail('comparison inventory exceeds its bound.');
  for (const report of reports) await verifiedReport(report);
  const pairs = []; let considered = 0, truncated = false;
  outer: for (let a = 0; a < reports.length; a++) for (let b = a + 1; b < reports.length; b++) {
    const right = new Map(reports[b].results.filter(row => row.case.role === 'baseline' && reviewable(row)).map(row => [row.case.fixtureHash + ':' + row.case.sampleRate, row]));
    for (const left of reports[a].results.filter(row => row.case.role === 'baseline' && reviewable(row))) {
      const other = right.get(left.case.fixtureHash + ':' + left.case.sampleRate); if (!other) continue;
      if (++considered > maximumComparisons) { truncated = true; break outer; }
      const comparison = compareSoundFeatures(left.digitalReceipt.metrics, other.digitalReceipt.metrics);
      if (comparison.nearDuplicate) pairs.push({ reportA: reports[a].reportHash, reportB: reports[b].reportHash, caseA: left.case.id, caseB: other.case.id, comparison,
        state: 'flagged-for-human-review', identityEqualityIsNotAQualityJudgment: true });
    }
  }
  return { schema: 'lemmings-sound-duplicate-review/v1', pairs, considered: Math.min(considered, maximumComparisons), truncated, automaticRejection: false };
}
function blindWav(planes, sampleRate, gain) {
  const frames = planes[0].length, bytes = new Uint8Array(44 + frames * 8), view = new DataView(bytes.buffer), write = (at, text) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true); write(36, 'data'); view.setUint32(40, frames * 8, true);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < 2; channel++) { const value = planes[channel][frame] * gain; if (!Number.isFinite(value) || Math.abs(value) > 0.800001) fail('matched-level PCM exceeds its safe comparison bound.'); view.setFloat32(44 + (frame * 2 + channel) * 4, value, true); }
  return bytes;
}
export async function createBlindSoundListeningSet({ pairs, seed, readArtifact, writeArtifact } = {}) {
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 64 || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || typeof readArtifact !== 'function' || typeof writeArtifact !== 'function') fail('invalid bounded blind comparison request.');
  const publicTrials = [], privateTrials = []; let outputBytes = 0;
  for (const [index, pair] of pairs.entries()) {
    await verifiedReport(pair.reportA); await verifiedReport(pair.reportB);
    const left = pair.reportA.results.find(row => row.case.id === pair.caseA), right = pair.reportB.results.find(row => row.case.id === pair.caseB);
    if (!reviewable(left) || !reviewable(right) || left.case.fixtureHash !== right.case.fixtureHash || left.case.sampleRate !== right.case.sampleRate || typeof pair.intendedDifference !== 'string' || !pair.intendedDifference || pair.intendedDifference.length > 512) fail('pair requires technically valid same-take/same-rate exact source versions and explicit intended differences.');
    const matching = matchSoundLevels(left.digitalReceipt.metrics, right.digitalReceipt.metrics), key = await hashData({ seed, index, a: pair.reportA.reportHash, b: pair.reportB.reportHash, caseA: pair.caseA, caseB: pair.caseB });
    const reversed = parseInt(key.slice(0, 2), 16) % 2 === 1, entries = reversed ? [[right, matching.gainB], [left, matching.gainA]] : [[left, matching.gainA], [right, matching.gainB]], files = [];
    for (const [side, [row, gain]] of entries.entries()) {
      const original = await readArtifact(row.artifact); if (!(original instanceof Uint8Array) || original.length !== row.artifact.bytes || await digest(original) !== row.artifact.sha256) fail('source render artifact changed.');
      const decoded = decodeQualificationFloatWav(original), bytes = blindWav(decoded.planes, decoded.sampleRate, gain), sha256 = await digest(bytes);
      if ((outputBytes += bytes.length) > 512 * 1048576) fail('blind package exceeds its explicit artifact budget.');
      const name = 'trial-' + key.slice(0, 20) + '-' + (side ? 'B' : 'A') + '.wav', saved = await writeArtifact({ name, bytes, sha256 });
      if (saved?.sha256 !== sha256 || saved?.bytes !== bytes.length || saved.path !== name) fail('blind sink must acknowledge the identity-free relative file name and exact bytes.'); files.push(saved);
    }
    publicTrials.push({ id: key, files, conditions: ['headphones', 'small-speakers'], contexts: ['quiet', 'dense-ensemble'], verdicts: ['heard', 'not-heard', 'objection', 'skipped'], automaticAcceptance: false });
    privateTrials.push({ id: key, reversed, reportA: pair.reportA.reportHash, reportB: pair.reportB.reportHash, caseA: left.case.id, caseB: right.case.id, intendedDifference: pair.intendedDifference,
      sourceA: pair.reportA.source, sourceB: pair.reportB.source, matching, rawArtifactA: left.artifact, rawArtifactB: right.artifact });
  }
  const publicManifest = { schema: 'lemmings-blind-sound-listening/v1', trials: publicTrials, privacy: 'reviewer-alias-only-no-device-identifiers', rights: 'private-qualification-does-not-grant-redistribution', seed };
  return { publicManifest: { ...publicManifest, packageHash: await hashData(publicManifest) }, privateKey: { schema: 'lemmings-blind-sound-key/v1', trials: privateTrials }, outputBytes };
}
export async function recordSoundListeningReview({ packageManifest, previous = null, input } = {}) {
  const { packageHash, ...value } = packageManifest || {};
  if (!hash(packageHash) || await hashData(value) !== packageHash || typeof input?.reviewer !== 'string' || !input.reviewer.trim() || input.reviewer.length > 64 || !Array.isArray(input.verdicts) || input.verdicts.length > packageManifest.trials.length * 4 ||
      typeof input.timestamp !== 'string' || !Number.isFinite(Date.parse(input.timestamp)) || previous && (previous.packageHash !== packageHash || !Number.isSafeInteger(previous.revision))) fail('invalid source-bound reviewer record.');
  if (previous) { const { reviewHash, ...prior } = previous; if (previous.schema !== 'lemmings-sound-human-review/v1' || !Number.isSafeInteger(previous.revision + 1) || await hashData(prior) !== reviewHash) fail('previous review version is not intact.'); }
  const seen = new Set(), verdicts = input.verdicts.map(verdict => {
    const trial = packageManifest.trials.find(value => value.id === verdict.trialId), key = JSON.stringify([verdict.trialId, verdict.condition, verdict.context]);
    if (!trial || !trial.conditions.includes(verdict.condition) || !trial.contexts.includes(verdict.context) || !trial.verdicts.includes(verdict.verdict) || seen.has(key) ||
        typeof verdict.notes !== 'string' || verdict.notes.length > 2048) fail('review verdict omitted its exact trial/listening condition or is duplicated.'); seen.add(key);
    return { trialId: verdict.trialId, condition: verdict.condition, context: verdict.context, verdict: verdict.verdict, notes: verdict.notes };
  });
  const complete = packageManifest.trials.every(trial => trial.conditions.every(condition => trial.contexts.every(context => verdicts.some(value => value.trialId === trial.id && value.condition === condition && value.context === context && value.verdict !== 'skipped'))));
  const record = { schema: 'lemmings-sound-human-review/v1', packageHash, revision: (previous?.revision || 0) + 1, previousReviewHash: previous?.reviewHash || null,
    reviewer: input.reviewer.trim(), timestamp: input.timestamp, verdicts, state: !complete ? 'listening-pending' : verdicts.some(value => value.verdict !== 'heard') ? 'listening-objection' : 'listening-accepted',
    technicalQualificationIsSeparate: true, acousticSpeakerMeasurementClaim: false };
  canonicalDataText(record, { maxBytes: 262144, maxNodes: 16384 }); return { ...record, reviewHash: await hashData(record) };
}
