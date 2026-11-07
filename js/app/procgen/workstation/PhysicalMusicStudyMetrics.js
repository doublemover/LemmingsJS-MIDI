import { freezeData } from '../../../core/CanonicalData.js';
export function summarizePhysicalMusicStudyMetrics(trace, { throughTicks, sourceTimeMs, finalTimeMs, finalPopulation, finalJunctions = [], finalLayers = null } = {}) {
  const times = trace.onsets.map(onset => onset.timeTicks).sort((a, b) => a - b), gaps = []; let previous = 0, maximumGap = 0;
  for (const time of [...times, throughTicks]) { if (time > previous) { const gap = { firstTick: previous, lastTick: time, durationTicks: time - previous }; maximumGap = Math.max(maximumGap, gap.durationTicks); gaps.push(gap); } previous = time; }
  const seconds = (finalTimeMs - sourceTimeMs) / 1000, motifCounts = Object.create(null);
  for (const fact of trace.motifOccurrences) if (fact.kind === 'MotifCompleted') motifCounts[fact.motifId] = (motifCounts[fact.motifId] || 0) + 1;
  return freezeData({ scope: 'actual-causal-begin-end-voices-and-physical-observations;no-DSP-loudness-or-acoustic-silence-claim', throughTicks, sourceSeconds: seconds,
    onsets: trace.onsets.length, onsetsPer100Ticks: throughTicks > 0 ? trace.onsets.length / throughTicks * 100 : null, onsetsPerSourceSecond: seconds > 0 ? trace.onsets.length / seconds : null,
    semanticPolyphony: { maximum: trace.maximumSemanticPolyphony, ending: trace.heldVoices.length, observedCompletedBoundaries: trace.polyphonyBoundaries,
      meanAtCompletedBoundaries: trace.polyphonyBoundaries ? trace.polyphonySum / trace.polyphonyBoundaries : null },
    onsetFreeGaps: { maximumTicks: maximumGap, intervals: gaps.slice(0, 64), omittedIntervals: Math.max(0, gaps.length - 64), interpretation: 'no-new-onset;held-voices-may-continue' },
    motifCounts, motifOccurrences: trace.motifOccurrences, restObservations: trace.restObservations,
    crew: { minimumLiving: trace.minimumLiving, maximumLiving: trace.maximumLiving, births: trace.births, terminations: trace.terminations, safetyFailures: trace.safetyFailures },
    realizedReleasePolicy: finalPopulation, realizedJunctions: finalJunctions, realizedInterventionLayers: finalLayers, observationCoverage: trace.censoredObservations.length ? 'unknown-censored-observations' : 'complete-admitted-observation-profile', censoredObservations: trace.censoredObservations });
}
