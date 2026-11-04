const natural = value => Number.isSafeInteger(value) && value >= 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateEffectRouteTransition(value, packet) {
  const keys = (object, names) => object && Object.getPrototypeOf(object) === Object.prototype && Object.keys(object).every(key => names.includes(key));
  if (!keys(value, ['schema', 'startFrame', 'transitionFrames', 'previous']) || value.schema !== 'lemmings-effect-route-transition/v1' ||
      !natural(value.startFrame) || value.startFrame !== packet.targetFrame || !Number.isSafeInteger(value.transitionFrames) || value.transitionFrames < Math.ceil(packet.sampleRate * 0.005) || value.transitionFrames > Math.ceil(packet.sampleRate * 0.2) ||
      value.previous !== null && (!keys(value.previous, ['ownerRouteRevision', 'graphDefinitionHash', 'retireAtFrame', 'lastBodyDriveFrame']) || !Number.isSafeInteger(value.previous.ownerRouteRevision) || value.previous.ownerRouteRevision < 1 || value.previous.ownerRouteRevision >= packet.ownerRouteRevision || !hash(value.previous.graphDefinitionHash) || !natural(value.previous.retireAtFrame) || !natural(value.previous.lastBodyDriveFrame) || value.previous.retireAtFrame < value.startFrame + value.transitionFrames - 1 || value.previous.retireAtFrame - value.startFrame > packet.sampleRate * 150))
    throw new TypeError('A graph transition needs its original API input ramp, predecessor and bounded tail deadline.');
  return value;
}
