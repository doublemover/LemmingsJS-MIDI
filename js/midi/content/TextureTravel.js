import { planCircularTravel } from './CircularSpectrum.js';
import { freezeData } from '../../core/CanonicalData.js';
import { TEXTURE_EXCITER_LIMITS, TEXTURE_EXCITER_REVISION } from './TextureExciter.js';

export function planTextureTravel(parameters, intent, targetFrame, sampleRate) {
  if (intent?.controlFixture === true && !intent.articulationState?.travel) return freezeData({ from: 0, to: 8 / 128, firstFrame: targetFrame, endFrame: targetFrame + Math.round(sampleRate * 0.04), sequence: 1,
    ownerIdentity: 'explicit-texture-control-fixture', receipt: { schema: 'lemmings-texture-travel-receipt/v1', rendererRevision: TEXTURE_EXCITER_REVISION, source: 'authored-eight-pixel-forty-ms-control-program', physicalTakeEvidence: false, acousticReceipt: false } });
  const planned = planCircularTravel({ sourceMode: 2, circularControlMode: 0, circularScope: parameters.textureScope, circularAxis: parameters.textureAxis, circularRequireSegments: parameters.textureRequireSegments,
    circularPixelsPerCycle: 128, circularOriginPixels: 0, circularPhaseOrigin: 0 }, intent, targetFrame, sampleRate);
  if (!planned || Math.max(Math.abs(planned.from), Math.abs(planned.to)) * 128 > TEXTURE_EXCITER_LIMITS.maximumSignedCoordinatePixels || planned.endFrame - planned.firstFrame > sampleRate * TEXTURE_EXCITER_LIMITS.maximumSpanSeconds || Math.abs(planned.to - planned.from) * 128 * sampleRate / (planned.endFrame - planned.firstFrame) > TEXTURE_EXCITER_LIMITS.maximumPixelsPerSecond) throw new TypeError('Texture travel requires its exact bounded canonical source, scope and coordinate.');
  const { pixelsPerCycle, phaseOrigin, firstPhaseCycles, endPhaseCycles, ...coordinateReceipt } = planned.receipt;
  return freezeData({ ...planned, receipt: { ...coordinateReceipt, firstSignedPositionPixels: planned.from * 128, endSignedPositionPixels: planned.to * 128, schema: 'lemmings-texture-travel-receipt/v1', rendererRevision: TEXTURE_EXCITER_REVISION,
    coordinateScale: '128-world-pixels-per-internal-coordinate-unit;not-a-pitch-cycle', phasePolicy: 'unwrapped-observed-signed-coordinate;only-visited-spatial-cells-excite;carrier-pitch-cycle-not-used', excitationPolicy: 'actual-visited-spatial-cells;no-extrapolated-motion-or-extra-semantic-source', physicalTakeEvidence: true } });
}
