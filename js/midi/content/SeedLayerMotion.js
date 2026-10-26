import { validateSampleTraversalBinding, planSampleTraversal } from './SampleTraversal.js';
import { freezeData } from '../../core/CanonicalData.js';

const fail = message => { throw new TypeError('Bowed seed contact: ' + message); };
const integer = (value, low = 0, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const text = (value, maximum = 512) => typeof value === 'string' && value.length > 0 && value.length <= maximum;

export function createSeedLayerContactBinding(mapping, { framesPerWorldPixel = 100 } = {}) {
  const field = mapping?.contactTravel;
  if (!mapping || !text(mapping.id, 128) || mapping.route !== 'local' || mapping.sourceKind !== 'ContactSpanBegan' || mapping.causeKind !== 'support' || field?.lifetimeScope !== 'contactSpan' || !['endpoint-chord', 'segment-path'].includes(field.metric) || field.orientation !== 'unsigned' || field.phaseMode !== 'contact-stroke' || field.sustain !== true) fail('Choose a saved local support-contact mapping with its explicit contact travel policy.');
  return validateSampleTraversalBinding({ schema: 'lemmings-sample-traversal/v1', revision: 1, mappingId: mapping.id, lifetimeScope: 'contactSpan', metric: field.metric, orientation: 'unsigned', mode: 'one-way-rubbing', originPixels: 0,
    framesPerWorldPixel, requiredPrecision: field.metric === 'segment-path' ? 'committed-coordinate-write' : 'endpoint-chord', discontinuityPolicy: 'end-voice', timing: 'completed-tick-equal-segments-v1' });
}

export function planSeedLayerContactBegin(plan, intent, targetFrame) {
  if (plan?.profile?.family !== 'bowed-scrap') return null;
  const binding = plan.profile.motionBinding, contact = intent?.articulationState?.contactCoordinate;
  if (intent?.kind !== 'begin' || intent.physicalSourceKind !== 'ContactSpanBegan' || !contact || contact.schema !== 'lemmings-canonical-contact-coordinate/v1' || contact.worldId !== intent.worldId || contact.generation !== intent.generation || contact.actorId !== intent.actorId || contact.mappingId !== binding.mappingId || intent.mappingId !== binding.mappingId ||
      !text(contact.worldId) || !integer(contact.generation) || !integer(contact.actorId) || !text(contact.contactInstanceId) || !text(contact.sourceEventId) || !intent.sourceEventIds?.includes(contact.sourceEventId) || !integer(contact.sourceSequence, 1) || !integer(contact.graphRevision) || !integer(contact.observedTick) || contact.precision !== 'completed-contact-coordinate' || contact.coordinateMeaning !== 'observed-completed-support-cell-anchor' || !Number.isFinite(contact.coordinate?.x) || !Number.isFinite(contact.coordinate?.y) || !integer(targetFrame)) fail('A real completed contact begin must own the transient; motion cannot fabricate another onset.');
  return freezeData({ ownerIdentity: JSON.stringify([contact.worldId, contact.generation, contact.actorId, contact.contactInstanceId, 0]), contactInstanceId: contact.contactInstanceId, lastSequence: contact.sourceSequence, lastEndFrame: targetFrame, lastSourceFrame: 0,
    receipt: { schema: 'lemmings-seed-layer-contact-begin/v1', mappingId: binding.mappingId, mappingRevision: binding.revision, contactInstanceId: contact.contactInstanceId, sourceEventId: contact.sourceEventId, sourceSequence: contact.sourceSequence, coordinate: contact.coordinate, targetFrame, transientBegins: 1, physicalTakeEvidence: true } });
}

export function planSeedLayerContactMotion(plan, intent, targetFrame) {
  if (plan?.profile?.family !== 'bowed-scrap') fail('This source has no contact travel contract.');
  const material = plan.regions[1], entry = { assetHash: material.assetHash, sourceFirst: 0, sourceEnd: material.sourceFrames, sourceSampleRate: material.sourceSampleRate, traversal: plan.profile.motionBinding,
    cursorProfile: { sampleRate: plan.sampleRate, sourceToDecoded: material.decodedSampleRate / material.sourceSampleRate, maximumCoordinateSourceFrames: material.sourceFrames, maximumReadDerivative: 4, interpolation: 'linear' } };
  const result = planSampleTraversal(entry, intent, targetFrame, plan.sampleRate), segment = result.segment;
  if (segment.firstSourceFrame < 0 || segment.endSourceFrame < segment.firstSourceFrame || segment.endSourceFrame > material.sourceFrames) fail('The finite contact path exceeds its prepared component region; select a longer seed or a different explicit distance scale.');
  return freezeData({ ownerIdentity: result.ownerIdentity, firstFrame: segment.firstOutputFrame, endFrame: segment.endOutputFrame, from: segment.firstSourceFrame / material.sourceFrames, to: segment.endSourceFrame / material.sourceFrames, sequence: segment.sequence,
    receipt: { ...result.receipt, schema: 'lemmings-seed-layer-contact-motion/v1', rendering: 'observed-window-position-and-birth-activity;independent-grain-pitch;not-transparent-time-warp', semanticBegins: 0, extrapolation: 'none;rest-or-gap-closes-new-grain-births' } });
}

export function seedLayerContactBeginFields(contact) { return contact ? { 19: 0, 26: 0, 27: 1, 28: 0, 38: 1 } : {}; }
export function seedLayerContactMotionFields(motion) { return { 15: 1024, 40: motion.firstFrame, 41: motion.endFrame, 42: motion.from, 43: motion.to, 44: motion.sequence }; }
