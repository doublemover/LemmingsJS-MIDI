import { RectangularMembraneKernel } from './RectangularMembraneKernel.js';
import { RECTANGULAR_MEMBRANE_REVISION, MEMBRANE_LIVE_CONTROLS, MEMBRANE_TOUCH_CONTROLS, membraneInitialControl } from '../../../midi/content/RectangularMembraneProfile.js';
import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';
const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
export class RectangularMembraneProcessor extends ProcessorBase {
  static get parameterDescriptors() { return MEMBRANE_LIVE_CONTROLS.map(name => ({ name, defaultValue: membraneInitialControl(name, { strikeX01: 0.5, strikeY01: 0.5, pickupLeftX01: 0.5, pickupLeftY01: 0.5, pickupRightX01: 0.5, pickupRightY01: 0.5, damp01: 0 }), minValue: name.endsWith('Radius01') ? 0.08 : 0, maxValue: name.endsWith('Radius01') ? 0.18 : 1, automationRate: 'a-rate' })); }
  constructor(options) {
    super(); const p = options?.processorOptions || {}; this.kernel = new RectangularMembraneKernel({ sampleRate: globalThis.sampleRate, parameters: p.parameters });
    this.touchParameterPlanes = new Array(16); this.disposed = false; this.reportedFaults = 0; this.inspectedAt = -Infinity; this.faultMessage = { type: 'effect-fault', revision: RECTANGULAR_MEMBRANE_REVISION, frame: 0, faults: 0, containment: 'body-only' };
    this.port.onmessage = event => {
      if (event.data?.type === 'dispose') { this.kernel.panic(globalThis.currentFrame); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
      else if (!this.disposed && event.data?.type === 'panic') this.kernel.panic(globalThis.currentFrame);
      else if (!this.disposed && event.data?.type === 'body-strike') { const command = event.data.command, accepted = this.kernel.enqueueStrike(command || {}); this.port.postMessage({ type: 'body-strike-admission', revision: RECTANGULAR_MEMBRANE_REVISION, token: command?.token ?? null, accepted, frame: globalThis.currentFrame, reasonCode: this.kernel.strikes.frontier[8], muted: this.kernel.muted }); }
      else if (!this.disposed && event.data?.type === 'inspect' && this.kernel.frame - this.inspectedAt >= globalThis.sampleRate / 4) { this.inspectedAt = this.kernel.frame; this.port.postMessage({ type: 'effect-health', ...this.kernel.diagnostics() }); }
    };
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: p.offlineEndFrame ?? null, sampleRate: globalThis.sampleRate, revision: RECTANGULAR_MEMBRANE_REVISION,
      stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity, port: this.port });
    this.port.postMessage({ type: 'ready', revision: RECTANGULAR_MEMBRANE_REVISION, sampleRate: globalThis.sampleRate, stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity });
  }
  updateTouches(frame) {
    if (this.kernel.muted) return; const planes = this.touchParameterPlanes;
    for (let index = 0; index < 16; index += 4) {
      const x = planes[index], y = planes[index + 1], radius = planes[index + 2], amount = planes[index + 3];
      if (!this.kernel.setTouch(index / 4, x[x.length === 1 ? 0 : frame], y[y.length === 1 ? 0 : frame], radius[radius.length === 1 ? 0 : frame], amount[amount.length === 1 ? 0 : frame])) { this.kernel.faults++; this.kernel.panic(); return; }
    }
    this.kernel.refreshTouchField();
  }
  process(inputs, outputs, parameters) {
    const left = outputs[0]?.[0], right = outputs[0]?.[1]; if (!left || !right) return true;
    if (this.disposed) { left.fill(0); right.fill(0); return false; }
    let varyingTouches = false;
    for (let index = 0; index < 16; index++) { const plane = parameters[MEMBRANE_TOUCH_CONTROLS[index]]; this.touchParameterPlanes[index] = plane; varyingTouches ||= plane.length !== 1; }
    if (!varyingTouches) this.updateTouches(0);
    const a = inputs[0]?.[0], b = inputs[0]?.[1] || a, sx = parameters.strikeX01, sy = parameters.strikeY01, lx = parameters.pickupLeftX01, ly = parameters.pickupLeftY01, rx = parameters.pickupRightX01, ry = parameters.pickupRightY01, damp = parameters.damp01;
    for (let i = 0; i < left.length; i++) {
      if (varyingTouches) this.updateTouches(i);
      this.kernel.sample(a?.[i] ?? 0, b?.[i] ?? 0, sx[sx.length === 1 ? 0 : i], sy[sy.length === 1 ? 0 : i], lx[lx.length === 1 ? 0 : i], ly[ly.length === 1 ? 0 : i], rx[rx.length === 1 ? 0 : i], ry[ry.length === 1 ? 0 : i], damp[damp.length === 1 ? 0 : i], globalThis.currentFrame + i);
      left[i] = this.kernel.leftSample; right[i] = this.kernel.rightSample;
    }
    if (this.kernel.faults !== this.reportedFaults) { this.reportedFaults = this.kernel.faults; this.faultMessage.frame = globalThis.currentFrame + left.length; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); }
    if (this.kernel.strikes.receiptCount) { const data = this.kernel.strikes.drainReceipts(); this.port.postMessage({ type: 'body-strike-receipts', revision: RECTANGULAR_MEMBRANE_REVISION, data }, [data.buffer]); }
    this.offlineCompletion.observe(globalThis.currentFrame, left.length, this.kernel.faults, this.kernel.muted); return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-rectangular-membrane-v1', RectangularMembraneProcessor);
