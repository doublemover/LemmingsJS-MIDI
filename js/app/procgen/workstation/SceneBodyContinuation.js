import { canonicalDataText, cloneData, freezeData } from '../../../core/CanonicalData.js';

const limits = { maxBytes: 524288, maxNodes: 49152 };
const fail = () => new Error('The scene body binding differs from its exact restored audio route.');
export function captureSceneBodyContinuation({ mechanism, expected, context, pending, active, metadata }) {
  if (pending) throw new Error('Settle scene body preparation before capturing its audio image.');
  return freezeData(cloneData({ schema: 'lemmings-scene-body-binding/v1', mechanism, sampleRate: context?.sampleRate ?? null,
    expected, active: !!expected && active, metadata }, limits));
}
export function restoreSceneBodyContinuation(raw, mechanism, context, frontier) {
  const value = cloneData(raw, limits);
  if (value?.schema !== 'lemmings-scene-body-binding/v1' || canonicalDataText(value.mechanism, limits).text !== canonicalDataText(mechanism, limits).text ||
      typeof value.active !== 'boolean' || value.expected && (value.sampleRate !== context?.sampleRate || typeof value.expected.graphDefinitionHash !== 'string' || !Number.isSafeInteger(value.expected.ownerRouteRevision))) throw fail();
  if (value.active && (!value.expected || value.expected.graphDefinitionHash !== frontier.graphDefinitionHash || value.expected.ownerRouteRevision !== frontier.sourceOwnerRouteRevision || !Number.isSafeInteger(frontier.ownerRouteRevision))) throw fail();
  return Object.freeze({ metadata: freezeData(value.metadata), expected: value.expected ? Object.freeze({ ...value.expected,
    ...(value.active ? { ownerRouteRevision: frontier.ownerRouteRevision } : { ownerRouteRevision: -1 }) }) : null,
  retainedRoute: Number.isSafeInteger(frontier.ownerRouteRevision) });
}
