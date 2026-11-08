import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';
import { validateGestureSoundDescriptor } from './GestureSoundDescriptor.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), before = (a, b) => a < b ? -1 : a > b ? 1 : 0, limits = { maxBytes: 16 * 1048576, maxNodes: 1000000 };
export function validateSoundQuery(raw = {}) {
  const query = JSON.parse(canonicalDataText(raw, { maxBytes: 65536, maxNodes: 8192 }).text);
  if (Object.keys(query).some(key => !['schema', 'gesture', 'maximumAttackSeconds', 'minimumHoldSeconds', 'gateSeconds', 'pitchHz', 'velocity01', 'requirePerVoicePitch', 'requireReleaseVelocity', 'requireChoke', 'maximumAssetBytes', 'preparedOnly', 'authoredTags', 'maximumResults'].includes(key)) ||
      query.schema !== 'lemmings-sound-query/v1' || !['any', 'short-trigger', 'held', 'contact-friction', 'dense'].includes(query.gesture || 'any') ||
      !Number.isSafeInteger(query.maximumResults ?? 8) || (query.maximumResults ?? 8) < 1 || (query.maximumResults ?? 8) > 32 ||
      ['maximumAttackSeconds', 'minimumHoldSeconds', 'gateSeconds', 'pitchHz', 'velocity01', 'maximumAssetBytes'].some(key => query[key] != null && (!Number.isFinite(query[key]) || query[key] < 0)) ||
      query.pitchHz != null && (query.pitchHz <= 0 || query.pitchHz > 20000) || query.velocity01 != null && query.velocity01 > 1 ||
      ['requirePerVoicePitch', 'requireReleaseVelocity', 'requireChoke', 'preparedOnly'].some(key => query[key] != null && typeof query[key] !== 'boolean') ||
      !Array.isArray(query.authoredTags || []) || (query.authoredTags || []).length > 16 || (query.authoredTags || []).some(tag => typeof tag !== 'string' || tag.length > 80)) throw new Error('Use bounded explicit gesture constraints; subjective tags remain a separate authored preference.');
  return freezeData({ ...query, gesture: query.gesture || 'any', maximumResults: query.maximumResults ?? 8, authoredTags: query.authoredTags || [] });
}
export async function queryGestureSounds(input, { signal, current = () => true, yieldControl = () => Promise.resolve() } = {}) {
  canonicalDataText(input, limits);
  if (!Array.isArray(input.candidates) || input.candidates.length > 256 || !Array.isArray(input.descriptors || []) || (input.descriptors || []).length > 2048) throw new Error('Query at most256 exact content revisions and2048 bounded gesture receipts.');
  const check = () => { signal?.throwIfAborted(); if (!current()) throw new Error('The sound/take query source changed.'); }, query = validateSoundQuery(input.query), descriptors = [];
  for (const raw of input.descriptors || []) { check(); const descriptor = validateGestureSoundDescriptor(raw), { descriptorHash, ...data } = descriptor;
    if (await hashData(data, limits) !== descriptorHash) throw new Error('A gesture descriptor changed its source-bound content hash.'); descriptors.push(descriptor); if (descriptors.length % 16 === 0) await yieldControl(); }
  const take = input.take || null;
  if (take && (!hash(take.canonicalHash) || !Number.isSafeInteger(take.revision) || take.revision < 1 || !['known-covered', 'partial', 'unknown'].includes(take.coverage) ||
      !['empty', 'held', 'unknown'].includes(take.initialVoices) || !Array.isArray(take.retainedSourceKinds) || !Array.isArray(take.availableFactKinds) || take.retainedSourceKinds.length > 128 || take.availableFactKinds.length > 128)) throw new Error('Take compatibility requires an exact revision/hash and explicit retained-intent versus available-fact coverage.');
  const rows = [], identities = new Set(), priority = { 'immutable-intent-compatible': 0, 'measured-compatible': 1, 'requires-reinterpretation': 2, 'requires-reconstruction': 3, unknown: 4, 'measured-failure': 5, unsupported: 6 };
  for (const candidate of input.candidates) {
    check(); if (!candidate || typeof candidate.identity !== 'string' || candidate.identity.length > 256 || identities.has(candidate.identity) || !['packHash', 'definitionHash'].every(key => hash(candidate[key])) ||
        !candidate.engineRequirement || !['artifactHash', 'parameterSchemaHash'].every(key => hash(candidate.engineRequirement[key])) || !Array.isArray(candidate.requiredSourceKinds) || candidate.requiredSourceKinds.length > 128 ||
        !Array.isArray(candidate.tags) || candidate.tags.length > 16 || !['ready', 'requirements-unavailable', 'unknown'].includes(candidate.preparation)) throw new Error('Use exact pinned candidate identities and current preparation/capability state.');
    identities.add(candidate.identity);
    let state = 'unknown'; const reasons = [], unknown = [], constraints = [], capabilities = candidate.capabilities || {}, required = candidate.requiredSourceKinds;
    const compatibleDescriptors = descriptors.filter(descriptor => descriptor.patchReceipt.packHash === candidate.packHash && descriptor.patchReceipt.definitionHash === candidate.definitionHash &&
      descriptor.patchReceipt.engineId === candidate.engineRequirement.engineId && descriptor.patchReceipt.engineVersion === candidate.engineRequirement.engineVersion &&
      descriptor.patchReceipt.artifactHash === candidate.engineRequirement.artifactHash && descriptor.patchReceipt.parameterSchemaHash === candidate.engineRequirement.parameterSchemaHash && descriptor.patchReceipt.qualityRevision === candidate.qualityRevision),
      staleCount = descriptors.filter(descriptor => descriptor.patchReceipt.definitionHash === candidate.definitionHash).length - compatibleDescriptors.length;
    const unsupported = [];
    for (const [requested, capability] of [['requirePerVoicePitch', 'perVoicePitch'], ['requireReleaseVelocity', 'releaseVelocity'], ['requireChoke', 'chokeGroups']]) if (query[requested]) {
      if (capabilities[capability] === false) unsupported.push('The current renderer declares ' + capability + ' unsupported.'); else if (capabilities[capability] !== true) unknown.push('Current ' + capability + ' capability is unreported.');
    }
    if (candidate.preparation === 'requirements-unavailable') unsupported.push('The exact renderer or required immutable assets are unavailable.');
    if (query.preparedOnly && candidate.preparation !== 'ready') unknown.push('The candidate is not currently prepared.');
    if (query.maximumAssetBytes != null) { if (candidate.assetBytes == null) unknown.push('Exact asset footprint is unknown.'); else if (candidate.assetBytes > query.maximumAssetBytes) unsupported.push('The required assets exceed the requested byte cap.'); }
    const matching = compatibleDescriptors.filter(descriptor => {
      if (descriptor.controlDomain?.role !== 'baseline') return false;
      const domain = descriptor.sourceDomain;
      return (query.gateSeconds == null || domain.gateSeconds === query.gateSeconds) && (query.pitchHz == null || domain.pitchHz != null && Math.abs(domain.pitchHz - query.pitchHz) < 1e-7) &&
        (query.velocity01 == null || domain.velocity01 === query.velocity01) && (query.gesture !== 'short-trigger' || domain.gateSeconds != null && domain.gateSeconds <= 0.08) &&
        (query.gesture !== 'held' || domain.gateSeconds != null && domain.gateSeconds >= (query.minimumHoldSeconds || 1)) &&
        (query.gesture !== 'dense' || domain.density === 'dense') &&
        (query.gesture !== 'contact-friction' || domain.kind === 'recorded-physical' && domain.observedSourceKinds.includes('MotionCommitted') && descriptor.articulationCaps.observed.physicalUpdates > 0);
    });
    const passes = matching.filter(descriptor => descriptor.qualificationState === 'measured-technical-pass'), failures = matching.filter(descriptor => ['measured-failure-or-review', 'admission-failed'].includes(descriptor.qualificationState));
    let measured = null;
    for (const descriptor of passes) {
      const response = descriptor.attackMeasurements;
      if (query.maximumAttackSeconds != null && (response.status !== 'measured' || response.timeToReferenceSeconds == null)) continue;
      if (query.maximumAttackSeconds != null && response.timeToReferenceSeconds > query.maximumAttackSeconds) continue;
      if (query.gesture === 'short-trigger' && response.referenceWithinDeclaredGate === false) continue;
      measured = descriptor; break;
    }
    if (unsupported.length) { state = 'unsupported'; reasons.push(...unsupported); }
    else if (measured && !unknown.length) { state = take ? 'immutable-intent-compatible' : 'measured-compatible'; reasons.push('Measured ' + measured.gestureFixtureId + ' at ' + measured.sourceDomain.sampleRate + 'Hz; ' + measured.evidenceScope + '.'); if (measured.attackMeasurements.status === 'measured') reasons.push('Digital relative25%-peak rise ' + measured.attackMeasurements.timeToReferenceSeconds + ' seconds at ' + measured.attackMeasurements.resolutionSeconds + ' second resolution; tested gate ' + measured.sourceDomain.gateSeconds + ' seconds.'); }
    else if (failures.length || passes.length && query.maximumAttackSeconds != null && passes.every(descriptor => descriptor.attackMeasurements.status === 'measured' && descriptor.attackMeasurements.timeToReferenceSeconds > query.maximumAttackSeconds)) { state = 'measured-failure'; reasons.push('Matching current-domain evidence fails or requires technical review for this request.'); }
    else { unknown.push('No current measured pass covers the exact requested gesture/pitch/gate/velocity domain.'); if (staleCount > 0) unknown.push(staleCount + ' earlier renderer/quality receipts are stale.'); }
    if (take && state !== 'unsupported') {
      if (take.initialVoices !== 'empty') { state = 'requires-reconstruction'; reasons.push('The selected take begins with held or unknown voice ancestry.'); }
      else if (take.coverage !== 'known-covered') { state = 'unknown'; unknown.push('The selected immutable intent coverage is incomplete or unknown.'); }
      else {
        const missing = required.filter(kind => !take.retainedSourceKinds.includes(kind)), controls = candidate.requiredControls || [], evidence = candidate.requiredEvidence || [],
          missingEvidence = evidence.filter(kind => !take.controlCoverage?.complete || !take.controlVoices?.length || take.controlVoices.some(voice => !(voice.evidence || []).includes(kind))), incompleteControls = controls.filter(control => {
            const voices = take.controlVoices || [], field = control.sourceKind + '.' + control.payloadField;
            return !take.controlCoverage?.complete || !voices.length || voices.some(voice => !(voice[control.mode === 'continuous' ? 'continuous' : 'onset'] || []).includes(field));
          });
        for (const control of incompleteControls) if (!missing.includes(control.sourceKind)) missing.push(control.sourceKind);
        if (missingEvidence.length && !missing.length) { state = 'unknown'; unknown.push('The selected take lacks retained ' + missingEvidence.join(', ') + '; any topology/contact/path reconstruction requires a separate qualified operation.'); }
        if (missing.length) {
          if (take.factsCovered && missing.every(kind => take.availableFactKinds.includes(kind))) { state = 'requires-reinterpretation'; reasons.push('Missing retained controls ' + missing.join(', ') + '; actual archived facts may support a separate explicit reinterpretation.'); }
          else { state = take.factsCovered ? 'unsupported' : 'unknown'; reasons.push('The selected note/control history does not retain required ' + missing.join(', ') + '. No control curve is invented.'); }
        } else if (required.length) constraints.push('Every inspected voice retains the required typed onset/update controls; exact output precision remains subject to ordinary revoice admission.');
        if (take.controlCoverage?.complete === false) { state = 'unknown'; unknown.push('The bounded voice-control inspection is censored; no all-voice compatibility claim is made.'); }
      }
    }
    rows.push({ patchReceipt: { packHash: candidate.packHash, definitionHash: candidate.definitionHash, patchIdentity: candidate.identity, engineRequirement: candidate.engineRequirement, qualityRevision: candidate.qualityRevision }, identity: candidate.identity, name: candidate.name || candidate.identity, state, reasons, unknown, constraints, preparation: candidate.preparation, assetBytes: candidate.assetBytes ?? null,
      descriptorHash: measured?.descriptorHash || null, evidence: measured || null, failedEvidence: failures.slice(0, 4).map(descriptor => ({ descriptorHash: descriptor.descriptorHash, state: descriptor.qualificationState, findings: descriptor.findings, failure: descriptor.failure })),
      subjectivePreference: { matchedAuthoredTags: query.authoredTags.filter(tag => candidate.tags.includes(tag)), scope: 'authored-label-match;not-measured-taste' },
      revalidateBeforeAudition: true, automaticSelection: false });
    await yieldControl();
  }
  rows.sort((a, b) => priority[a.state] - priority[b.state] || b.subjectivePreference.matchedAuthoredTags.length - a.subjectivePreference.matchedAuthoredTags.length || (a.assetBytes ?? Infinity) - (b.assetBytes ?? Infinity) || before(a.identity, b.identity));
  const requestHash = await hashData({ query, take, candidates: input.candidates, descriptorHashes: descriptors.map(descriptor => descriptor.descriptorHash) }, limits);
  return freezeData({ schema: 'lemmings-sound-query-result/v1', requestHash, query, take, candidates: rows.slice(0, query.maximumResults), omittedCandidates: Math.max(0, rows.length - query.maximumResults),
    totalCandidates: rows.length, compatibilityOrder: Object.keys(priority), evidencePolicy: 'exact-sampled-domain-only;missing-is-unknown;compatibility-separate-from-taste;audition-rechecks-current-backend', automaticSelection: false });
}
