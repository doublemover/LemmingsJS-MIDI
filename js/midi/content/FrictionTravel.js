import { planCircularTravel } from './CircularSpectrum.js';
import { freezeData } from '../../core/CanonicalData.js';
import { FRICTION_MODEL_LIMITS as L, FRICTION_MODEL_REVISION } from './FrictionModel.js';

export function planFrictionTravel(parameters, intent, targetFrame, sampleRate) {
  if (intent?.controlFixture === true && !intent.articulationState?.travel) return freezeData({ from: 0, to: 78 / 128, firstFrame: targetFrame, endFrame: targetFrame + Math.round(sampleRate * 0.65), sequence: 1, ownerIdentity: 'explicit-friction-control-fixture',
    receipt: { schema: 'lemmings-friction-travel-receipt/v1', rendererRevision: FRICTION_MODEL_REVISION, source: 'authored-seventy-eight-pixel-six-hundred-fifty-ms-control-program', physicalTakeEvidence: false, acousticReceipt: false } });
  const planned = planCircularTravel({ sourceMode: 2, circularControlMode: 0, circularScope: parameters.frictionScope, circularAxis: parameters.frictionAxis, circularRequireSegments: parameters.frictionRequireSegments, circularPixelsPerCycle: 128, circularOriginPixels: 0, circularPhaseOrigin: 0 }, intent, targetFrame, sampleRate);
  if (!planned || Math.max(Math.abs(planned.from), Math.abs(planned.to)) * 128 > L.maximumCoordinatePixels || planned.endFrame - planned.firstFrame > sampleRate * L.maximumSpanSeconds || Math.abs(planned.to - planned.from) * 128 * sampleRate / (planned.endFrame - planned.firstFrame) > L.maximumPixelsPerSecond) throw new TypeError('Friction needs its exact bounded completed signed-axis motion and source scope.');
  const { pixelsPerCycle, phaseOrigin, firstPhaseCycles, endPhaseCycles, ...coordinateReceipt } = planned.receipt;
  return freezeData({ ...planned, receipt: { ...coordinateReceipt, schema: 'lemmings-friction-travel-receipt/v1', rendererRevision: FRICTION_MODEL_REVISION, firstSignedPositionPixels: planned.from * 128, endSignedPositionPixels: planned.to * 128,
    coordinateScale: '128-world-pixels-per-internal-coordinate-unit;not-acoustic-length-or-pitch-cycle', feedbackPolicy: 'observed-bow-velocity-minus-owned-modal-contact-velocity;no-extrapolation', restPolicy: 'zero-bow-input-work;positive-body-relaxation', physicalTakeEvidence: true } });
}
