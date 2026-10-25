import { createOwnedResourceReservation } from '../../app/resources/OwnedResourceReservation.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';
import { measureSoundRender, compareSoundFeatures } from './SoundRenderAnalysis.js';
const fail = message => { throw new Error('Sound qualification: ' + message); };
const bytesHash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const expectedRejection = (selected, error) => selected.role === 'negative-voice-budget' ? error.code === 'intent-voice-capacity' :
  selected.role === 'negative-unsupported-control' ? /unknown macro|unsupported.*control/i.test(error.message) :
    selected.role === 'negative-missing-asset' ? /material|asset|PCM|source payload/i.test(error.message) && !/backend|OfflineAudioContext/i.test(error.message) : false;
export async function runSoundQualification(plan, { renderer, writeArtifact, writeCase, signal, maximumCases = plan?.profile?.maximumCases,
  maximumRenderSeconds = plan?.profile?.maximumRenderSeconds, maximumOutputBytes = plan?.profile?.maximumOutputBytes, resourceBudget = null, onProgress = () => {} } = {}) {
  const { planHash, ...hashable } = plan || {};
  if (plan?.schema !== 'lemmings-sound-qualification-plan/v1' || await hashData(hashable) !== planHash || typeof renderer?.render !== 'function' || typeof writeArtifact !== 'function' || typeof writeCase !== 'function' ||
      !Number.isSafeInteger(maximumCases) || maximumCases < 1 || maximumCases > plan.profile.maximumCases || !Number.isFinite(maximumRenderSeconds) || maximumRenderSeconds <= 0 || maximumRenderSeconds > plan.profile.maximumRenderSeconds ||
      !Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 4096 || maximumOutputBytes > plan.profile.maximumOutputBytes) fail('invalid source-bound plan or artifact/coverage budget.');
  const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'sound-qualification-report:' + planHash, kind: 'qualification-report-and-repeat-pcm', category: 'audio', bytes: 64 * 1048576 });
  try {
    const results = [], baselines = new Map(), references = new Map(); let renderedSeconds = 0, outputBytes = 0, reportBytes = 0, stopReason = null;
    for (const selected of plan.cases) {
      if (signal?.aborted) { stopReason = 'cancelled'; break; }
      const fixture = plan.fixtures.find(value => value.id === selected.fixtureId), estimatedBytes = Math.ceil(fixture.durationSeconds * selected.sampleRate) * 8 + 262144;
      if (results.length >= maximumCases || renderedSeconds + fixture.durationSeconds > maximumRenderSeconds || outputBytes + estimatedBytes > maximumOutputBytes || reportBytes + 262144 > plan.profile.maximumRetainedReportBytes) { stopReason = 'declared-work-or-storage-budget'; break; }
      const row = { schema: 'lemmings-sound-qualification-case/v1', planHash, case: selected, source: plan.source, applicationBuildId: plan.applicationBuildId,
        engineRequirement: Object.fromEntries(['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].map(key => [key, plan.descriptor[key]])),
        sourceFixture: { id: fixture.id, hash: fixture.fixtureHash, coverage: fixture.revoice.coverage, evidence: fixture.evidence, density: fixture.density || null },
        quality: plan.coverage.qualityTier, state: 'unrendered', semanticReceipt: null, admissionReceipt: null, digitalReceipt: null, humanReceipt: { state: 'listening-pending', reviews: [] }, failure: null };
      let output = null, stage = 'backend-admission';
      try {
        output = await renderer.render(plan, selected, { signal }); renderedSeconds += fixture.durationSeconds;
        row.semanticReceipt = output.semanticReceipt; row.admissionReceipt = output.admissionReceipt;
        if (selected.expected === 'admission-rejection') throw Object.assign(new Error('Negative fixture was incorrectly admitted.'), { code: 'negative-fixture-admitted' });
        stage = 'digital-measurement'; const metrics = measureSoundRender(output.planes, selected.sampleRate, { fundamentalHz: selected.fundamentalHz });
        const tolerance = plan.tolerance, findings = [];
        if (output.admissionReceipt.physicalSourceCoverage?.missingOnsetBindings > 0) findings.push('missing-qualified-physical-control-source');
        if (output.admissionReceipt.realization?.nativeSourceProfile?.omittedModes > 0) findings.push('characteristic-modes-omitted-by-backend-tier');
        if (metrics.nonfiniteSamples) findings.push('nonfinite-output'); if (metrics.clippedSamples) findings.push('full-scale-or-clipped-output'); if (Math.abs(metrics.dc) > tolerance.maximumDC) findings.push('dc-policy-exceeded');
        if (!metrics.rms || metrics.silenceFraction === 1) findings.push('silent-compatibility-observation');
        let panic = null;
        if (selected.role === 'panic') {
          const admitted = output.admissionReceipt.panic, first = (admitted?.frame ?? 0) + 256; let tailPeak = 0;
          for (const plane of output.planes) for (let i = first; i < plane.length; i++) tailPeak = Math.max(tailPeak, Math.abs(plane[i]));
          panic = { admission: admitted, measuredFirstFrame: first, postPanicPeak: tailPeak, tolerance: 1e-7, scope: 'shared-offline-kernel-or-native-backend-not-live-port-delivery' };
          if (!admitted || first >= output.frames || tailPeak > 1e-7) findings.push('panic-silence-not-established');
        }
        const key = selected.fixtureHash + ':' + selected.sampleRate;
        let repeat = null;
        if (selected.role === 'repeat') {
          const reference = references.get(key); if (!reference) findings.push('repeat-reference-unavailable');
          else { let maximumAbsoluteError = output.planes[0].length === reference[0].length ? 0 : Infinity;
            if (Number.isFinite(maximumAbsoluteError)) for (let channel = 0; channel < 2; channel++) for (let i = 0; i < reference[channel].length; i++) maximumAbsoluteError = Math.max(maximumAbsoluteError, Math.abs(reference[channel][i] - output.planes[channel][i]));
            repeat = { maximumAbsoluteError: Number.isFinite(maximumAbsoluteError) ? maximumAbsoluteError : null, limit: tolerance.repeatMaximumAbsoluteError, sameBuildAndEngineOnly: true };
            if (maximumAbsoluteError > tolerance.repeatMaximumAbsoluteError) findings.push('repeat-tolerance-exceeded'); references.delete(key);
          }
        }
        if (selected.role === 'baseline') {
          baselines.set(key, { caseId: selected.id, metrics });
          if (fixture.note === 60 && fixture.velocity === 64 && fixture.gateSeconds === 1.2) references.set(key, output.planes.map(plane => new Float32Array(plane)));
        }
        const baseline = baselines.get(key), comparison = baseline && selected.role !== 'baseline' ? compareSoundFeatures(baseline.metrics, metrics) : null;
        row.digitalReceipt = { state: findings.length ? 'requires-review' : 'technically-valid', metrics, findings, repeat, comparison, panic,
          logicalVoiceCount: output.semanticReceipt.begins, audibleAttackEstimate: metrics.audibleAttackEstimate, onsetComparison: 'heuristic-energy-estimate-not-a-one-to-one-voice-detector' };
        stage = 'artifact-publication'; const artifactHash = await bytesHash(output.bytes), expectedBytes = output.bytes.byteLength;
        if (outputBytes + expectedBytes > maximumOutputBytes) fail('encoded output exceeded its reserved artifact bound.');
        const artifact = await writeArtifact({ name: selected.id.replace(':', '-') + '.wav', bytes: output.bytes, sha256: artifactHash, caseId: selected.id, planHash, signal });
        if (artifact?.sha256 !== artifactHash || artifact?.bytes !== expectedBytes || typeof artifact.path !== 'string' || !artifact.path || artifact.path.length > 1024) fail('artifact sink did not acknowledge the exact bytes.');
        row.artifact = artifact; outputBytes += expectedBytes;
        row.state = findings.length ? 'technical-review-required' : 'listening-pending';
      } catch (error) {
        const expected = selected.expected === 'admission-rejection' && expectedRejection(selected, error);
        row.state = expected ? 'expected-admission-rejection' : signal?.aborted ? 'cancelled' : /unavailable|unsupported|missing|material|asset|PCM/.test(error.message) ? 'degraded-backend' : 'failed';
        row.failure = { stage, code: error.code || error.name || 'render-error', message: String(error.message).slice(0, 2048), expectedRejection: expected };
        if (signal?.aborted) stopReason = 'cancelled';
        if (error.retirement && error.retirement.outcome !== 'complete') stopReason = 'unresolved-render-retirement';
      } finally {
        try { output?.release(); } catch (error) { row.state = 'failed'; row.failure = { stage: 'retirement', code: 'render-retirement-unknown', message: error.message }; stopReason = 'unresolved-render-retirement'; }
      }
      const encoded = canonicalDataText(row, { maxBytes: 262144, maxNodes: 32768 }); reportBytes += encoded.bytes.byteLength;
      const rowHash = await hashData(row); await writeCase({ id: selected.id, row, sha256: rowHash, planHash }); results.push({ ...row, caseHash: rowHash });
      try { onProgress({ completed: results.length, total: plan.cases.length, renderedSeconds, outputBytes, state: row.state }); } catch { /* Observers cannot qualify content. */ }
      if (stopReason) break;
    }
    references.clear();
    const macroCoverage = plan.macroIntents.map(macro => {
      const sets = new Map(); for (const row of results.filter(row => row.case.role === 'macro-endpoint' && row.case.macroIds[0] === macro.id)) {
        const key = row.case.fixtureHash + ':' + row.case.sampleRate, values = sets.get(key) || []; values.push(row); sets.set(key, values);
      }
      const comparisons = [];
      for (const [key, rows] of sets) { const low = rows.find(row => row.case.controls.macros[macro.id] === 0), high = rows.find(row => row.case.controls.macros[macro.id] === 1);
        const a = low?.admissionReceipt?.effectiveTargets?.[0]?.values, b = high?.admissionReceipt?.effectiveTargets?.[0]?.values;
        const changedTargets = a && b ? macro.targets.filter(target => a[target.parameter] !== b[target.parameter]).map(target => target.parameter) : [];
        comparisons.push({ fixtureAndRate: key, state: !a || !b ? 'unsupported-or-unmeasured' : !changedTargets.length ? 'dead-zone-or-unrealized-target' : changedTargets.length < macro.targets.length ? 'partial-target-realization' : 'effective-inputs-differ', changedTargets, unchangedTargets: macro.targets.filter(target => !changedTargets.includes(target.parameter)).map(target => target.parameter),
          measuredDifference: low?.digitalReceipt && high?.digitalReceipt ? compareSoundFeatures(low.digitalReceipt.metrics, high.digitalReceipt.metrics) : null });
      }
      return { ...macro, comparisons, qualifiedContinuum: false, listening: 'pending' };
    });
    const dynamics = [];
    for (const rate of plan.profile.sampleRates) for (const note of plan.profile.notes) for (const gateSeconds of plan.profile.gatesSeconds) {
      const rows = results.filter(row => row.case.sampleRate === rate && row.case.role === 'baseline' && plan.fixtures.some(f => f.id === row.case.fixtureId && f.note === note && f.gateSeconds === gateSeconds));
      if (!rows.length) continue; const measured = rows.filter(row => row.digitalReceipt).map(row => ({ velocity: plan.fixtures.find(f => f.id === row.case.fixtureId).velocity, rms: row.digitalReceipt.metrics.rms, clipping: row.digitalReceipt.metrics.clippedSamples })).sort((a, b) => a.velocity - b.velocity);
      dynamics.push({ sampleRate: rate, note, gateSeconds, values: measured, state: measured.length !== 3 ? 'incomplete' : measured.every(value => value.clipping) || measured.every(value => Math.abs(value.rms - measured[0].rms) < 1e-8) ? 'collapsed-or-clipped-plateau-review' : 'reference-relative-dynamics-observed-not-listening-qualified' });
    }
    const result = { schema: 'lemmings-sound-qualification-report/v1', planHash, source: plan.source, definitionHash: plan.definitionHash, applicationBuildId: plan.applicationBuildId,
      state: results.length ? 'listening-pending' : 'unrendered', results, macroCoverage, dynamics, coverage: { ...plan.coverage, expectedCases: plan.cases.length, completedCases: results.length,
        complete: results.length === plan.cases.length && !plan.coverage.missingPhysicalDensities.length, stopReason, omittedCaseIds: plan.cases.slice(results.length).map(value => value.id) },
      budget: { maximumCases, maximumRenderSeconds, maximumOutputBytes, renderedSeconds, outputBytes, reportBytes },
      acceptance: { accepted: false, technicalFailures: results.filter(row => ['failed', 'degraded-backend', 'technical-review-required', 'cancelled'].includes(row.state)).length,
        requiredSeparateReceipts: ['backend-panic-conformance', 'human-matched-level-listening', 'source-bound-instrument-journeys'], automaticAcousticAcceptance: false } };
    return Object.freeze({ ...result, reportHash: await hashData(result) });
  } finally { reservation.release(); }
}
