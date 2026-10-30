import { SPECTRAL_CAPTURE_POLICY, validateSpectralCaptureReceipt } from './SpectralCaptureReceipt.js';
import { cloneData } from '../../core/CanonicalData.js';
import { validateCapturedBodyStrike } from './PreparedBodyStrike.js';

export const EFFECT_PERFORMANCE_SCHEMA = 'lemmings-effect-performance/v1';
export function validateEffectPerformance(raw) {
  const p = cloneData(raw, { maxBytes: 98304, maxNodes: 12288 }), keys = ['schema', 'status', 'stage', 'operation', 'sequence', 'streamId', 'ownerRouteRevision', 'graphDefinitionHash', 'sampleRate', 'targetFrame', 'executionEpoch', 'clockAnchor', 'definition', 'nodeId', 'values', 'mode', 'sourceEventIds', 'acousticReceipt', 'strike', 'spectralCapture', 'spectralCapturePolicy'];
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
  if (!p || Object.keys(p).some(key => !keys.includes(key)) || p.schema !== EFFECT_PERFORMANCE_SCHEMA || p.status !== 'accepted' || p.stage !== 'effect-performance-captured' ||
      !['graph', 'control', 'bypass', 'body-panic', 'body-strike', 'spectral-capture'].includes(p.operation) || !Number.isSafeInteger(p.sequence) || p.sequence < 1 || !text(p.streamId) || !Number.isSafeInteger(p.ownerRouteRevision) || p.ownerRouteRevision < 1 || !/^[a-f0-9]{64}$/.test(p.graphDefinitionHash) ||
      ![44100, 48000, 96000].includes(p.sampleRate) || !Number.isSafeInteger(p.targetFrame) || p.targetFrame < 0 || p.executionEpoch !== null && !text(p.executionEpoch) || p.acousticReceipt !== false || !Array.isArray(p.sourceEventIds) || p.sourceEventIds.length > 128 || p.sourceEventIds.some(id => !text(id))) throw new TypeError('Invalid captured effect performance.');
  if (p.clockAnchor !== null && (!p.clockAnchor || Object.keys(p.clockAnchor).some(key => !['intentId', 'sourceTargetFrame', 'executionEpoch'].includes(key)) || !text(p.clockAnchor.intentId) || !Number.isSafeInteger(p.clockAnchor.sourceTargetFrame) || p.clockAnchor.sourceTargetFrame < 0 || p.clockAnchor.executionEpoch !== p.executionEpoch)) throw new TypeError('Effect timing needs its exact source-intent audio-clock anchor.');
  if (p.operation === 'graph' ? !p.definition || p.nodeId != null || p.values != null || p.mode != null : p.definition != null) throw new TypeError('Effect publication requires its immutable graph definition.');
  if (['body-panic', 'body-strike', 'spectral-capture'].includes(p.operation) ? !text(p.nodeId) || p.values != null || p.mode != null : p.operation === 'control' ? !text(p.nodeId) || !p.values || Object.getPrototypeOf(p.values) !== Object.prototype || !Object.keys(p.values).length || Object.keys(p.values).length > 4 || Object.values(p.values).some(value => !Number.isFinite(value)) || p.mode != null : p.nodeId != null || p.values != null) throw new TypeError('Effect controls require bounded finite parameter targets.');
  if (p.operation === 'spectral-capture') { const capture = validateSpectralCaptureReceipt(p.spectralCapture); if (capture.sampleRate !== p.sampleRate || capture.endFrame !== p.targetFrame) throw new TypeError('The captured effect frontier must equal its actual spectral window end.'); }
  else if (p.spectralCapture != null) throw new TypeError('Only processor spectral acknowledgments carry capture-window evidence.');
  if (p.spectralCapturePolicy != null && (p.operation !== 'graph' || p.spectralCapturePolicy !== SPECTRAL_CAPTURE_POLICY || !p.definition?.nodes?.some(node => node.kind === 'spectral-freeze'))) throw new TypeError('Spectral evidence policy belongs to a published spectral graph.');
  if (p.operation === 'body-strike') { validateCapturedBodyStrike(p.strike); if (!p.clockAnchor || p.clockAnchor.intentId !== p.strike.intentId || p.clockAnchor.sourceTargetFrame !== p.targetFrame || JSON.stringify(p.sourceEventIds) !== JSON.stringify(p.strike.sourceEventIds)) throw new TypeError('A captured strike must retain its own source intent and exact applied frame anchor.'); }
  else if (p.strike != null) throw new TypeError('Only finite body strikes carry exciter application evidence.');
  if (p.operation === 'bypass' ? !['neutral', 'tail', 'mute', 'panic', 'owner-stop'].includes(p.mode) : p.mode != null) throw new TypeError('Unknown captured effect lifecycle operation.');
  return p;
}
