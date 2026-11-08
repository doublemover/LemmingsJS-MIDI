import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

const limits = { maxBytes: 16 * 1048576, maxNodes: 1000000 }, hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export async function createGestureSoundDescriptors(plan, report) {
  const { planHash, ...planData } = plan || {}, { reportHash, ...reportData } = report || {};
  if (plan?.schema !== 'lemmings-sound-qualification-plan/v1' || report?.schema !== 'lemmings-sound-qualification-report/v1' || !hash(planHash) || !hash(reportHash) ||
      await hashData(planData, limits) !== planHash || await hashData(reportData, limits) !== reportHash || report.planHash !== planHash || report.definitionHash !== plan.definitionHash ||
      report.applicationBuildId !== plan.applicationBuildId || !Array.isArray(report.results) || report.results.length > 1536) throw new Error('Gesture descriptors require the exact bounded source-bound qualification plan and measured report.');
  const descriptors = [];
  for (const row of report.results) {
    const { caseHash, ...rowData } = row, selected = plan.cases.find(item => item.id === row.case.id), fixture = plan.fixtures.find(item => item.id === selected?.fixtureId);
    if (!fixture || canonicalDataText(selected).text !== canonicalDataText(row.case).text || row.sourceFixture.hash !== fixture.fixtureHash || !hash(caseHash) || await hashData(rowData, limits) !== caseHash || row.planHash !== planHash || row.applicationBuildId !== plan.applicationBuildId || row.source.definitionHash !== plan.definitionHash ||
        row.engineRequirement.artifactHash !== plan.descriptor.artifactHash || row.engineRequirement.parameterSchemaHash !== plan.descriptor.parameterSchemaHash) throw new Error('A gesture measurement differs from its exact patch, renderer or fixture.');
    if (row.case.expected === 'admission-rejection') continue;
    const metrics = row.digitalReceipt?.metrics, physical = fixture.evidence === 'recorded-committed-world', observedKinds = [...new Set(fixture.revoice.intents.filter(intent => intent.kind === 'begin' || intent.kind === 'update').map(intent => intent.physicalSourceKind).filter(Boolean))].sort(),
      data = { schema: 'lemmings-gesture-sound-descriptor/v1', patchReceipt: { packHash: plan.source.contentHash, patchIdentity: plan.source.patchIdentity, definitionHash: plan.definitionHash,
        engineId: plan.descriptor.engineId, engineVersion: plan.descriptor.engineVersion, artifactHash: plan.descriptor.artifactHash, parameterSchemaHash: plan.descriptor.parameterSchemaHash, applicationBuildId: plan.applicationBuildId, qualityRevision: row.quality },
      controlDomain: { role: row.case.role, controls: row.case.controls, qualification: 'only-this-resolved-control-point;no-continuum' }, gestureFixtureId: fixture.id, fixtureHash: fixture.fixtureHash, planHash, reportHash, caseHash,
      sourceDomain: { kind: physical ? 'recorded-physical' : 'authored-calibration', density: fixture.density || null, observedSourceKinds: observedKinds, pitchHz: selected.fundamentalHz,
        velocity01: Number.isFinite(fixture.velocity) ? fixture.velocity / 127 : null, gateSeconds: fixture.gateSeconds ?? null, durationSeconds: fixture.durationSeconds, sampleRate: selected.sampleRate, coverage: row.sourceFixture.coverage, interpolation: 'none;only-this-observed-domain' },
      articulationCaps: { advertised: plan.descriptor.capabilities, observed: { physicalUpdates: row.admissionReceipt?.physicalSourceCoverage?.appliedPhysicalUpdates ?? null, missingOnsetBindings: row.admissionReceipt?.physicalSourceCoverage?.missingOnsetBindings ?? null }, scope: 'advertised-support-is-separate-from-rendered-gesture-evidence' },
      attackMeasurements: row.digitalReceipt?.gestureOnsetResponse || { status: 'unknown', reason: 'this-report-predates-isolated-onset-response-measurement' },
      decayMeasurements: metrics ? { measured60Seconds: metrics.decay60Seconds, censored: metrics.decayCensored, method: '10ms-RMS-post-energy-peak-amplitude60dB', unit: 'seconds' } : { status: 'unknown' },
      pitchStability: { status: 'unknown', reason: 'no-independent-fundamental-tracker-in-this-receipt' },
      noiseTonalityFeatures: metrics ? { centroidHz: metrics.spectralCentroidHz, normalizedRelativeSpectrum: metrics.normalizedFeatures?.spectrum || null, method: metrics.spectralSampling, tasteInference: 'none' } : { status: 'unknown' },
      macroResponses: report.macroCoverage.map(macro => ({ id: macro.id, testedCases: macro.comparisons.filter(comparison => comparison.fixtureAndRate === fixture.fixtureHash + ':' + selected.sampleRate), continuumQualified: false })),
      resourceReceipt: { maximumVoices: plan.definition.voicePolicy.maxVoices, measuredCpu: null, measuredAssetBytes: null, measuredMemoryBytes: null, reason: 'render-receipt-has-no-resource-profile-measurement' },
      qualificationState: row.state === 'listening-pending' && row.digitalReceipt?.state === 'technically-valid' ? 'measured-technical-pass' : row.digitalReceipt ? 'measured-failure-or-review' : row.state === 'failed' || row.state === 'degraded-backend' ? 'admission-failed' : 'unmeasured',
      findings: row.digitalReceipt?.findings || [], failure: row.failure || null, subjectiveTags: plan.definition.tags || [], evidenceScope: physical ? 'one-real-captured-physical-fixture;not-listener-preference' : 'one-authored-control-calibration;not-a-real-physical-take' };
    descriptors.push(freezeData({ ...data, descriptorHash: await hashData(data, limits) }));
  }
  return freezeData({ schema: 'lemmings-gesture-sound-descriptor-set/v1', planHash, reportHash, descriptors, coverage: { sourceCases: report.results.length, descriptorCount: descriptors.length, reportComplete: report.coverage.complete, noMissingEvidenceAsZero: true } });
}
export function validateGestureSoundDescriptor(raw) {
  const value = JSON.parse(canonicalDataText(raw, { maxBytes: 262144, maxNodes: 32768 }).text);
  if (value.schema !== 'lemmings-gesture-sound-descriptor/v1' || !['descriptorHash', 'fixtureHash', 'planHash', 'reportHash', 'caseHash'].every(key => hash(value[key])) || !value.patchReceipt ||
      !['packHash', 'definitionHash', 'artifactHash', 'parameterSchemaHash', 'applicationBuildId'].every(key => hash(value.patchReceipt[key])) || !['recorded-physical', 'authored-calibration'].includes(value.sourceDomain?.kind) ||
      !['measured-technical-pass', 'measured-failure-or-review', 'admission-failed', 'unmeasured'].includes(value.qualificationState) || !Array.isArray(value.sourceDomain.observedSourceKinds) || value.sourceDomain.observedSourceKinds.length > 128 ||
      !Array.isArray(value.subjectiveTags) || value.subjectiveTags.length > 16 || !Array.isArray(value.findings) || value.findings.length > 64) throw new Error('Use one bounded exact gesture descriptor with separate measured/unknown state.');
  const domain = value.sourceDomain, response = value.attackMeasurements;
  if (![44100, 48000, 96000].includes(domain.sampleRate) || !Number.isFinite(domain.durationSeconds) || domain.durationSeconds <= 0 || domain.durationSeconds > 120 ||
      domain.gateSeconds != null && (!Number.isFinite(domain.gateSeconds) || domain.gateSeconds <= 0 || domain.gateSeconds > 120) ||
      domain.pitchHz != null && (!Number.isFinite(domain.pitchHz) || domain.pitchHz <= 0 || domain.pitchHz > 20000) ||
      domain.velocity01 != null && (!Number.isFinite(domain.velocity01) || domain.velocity01 < 0 || domain.velocity01 > 1) ||
      !response || !['unknown', 'measured', 'measured-silent'].includes(response.status) ||
      response.status === 'measured' && (!Number.isFinite(response.timeToReferenceSeconds) || response.timeToReferenceSeconds < 0 || response.timeToReferenceSeconds > 2 || !Number.isFinite(response.resolutionSeconds) || response.resolutionSeconds <= 0 || response.resolutionSeconds > 0.1)) throw new Error('Gesture measurements require explicit bounded units and exact sampled domains.');
  return freezeData(value);
}
