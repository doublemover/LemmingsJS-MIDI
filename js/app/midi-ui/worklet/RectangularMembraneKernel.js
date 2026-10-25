import { encodeUtf8 } from '../../../core/CanonicalData.js';
import { prepareRectangularMembraneProfile, rectangularMembraneIdentity, MEMBRANE_CONTROLS } from '../../../midi/content/RectangularMembraneProfile.js';
import { createOwnedEffectState } from './OwnedEffectState.js';

function energyBetween(readA, readB, size, stride, lambdaSquared) {
  let kinetic = 0, potential = 0;
  for (let y = 1; y <= size; y++) for (let x = 1; x <= size; x++) {
    const i = y * stride + x, a = readA(i), b = readB(i); kinetic += (a - b) ** 2;
    potential += (a - readA(i + 1)) * (b - readB(i + 1)) + (a - readA(i + stride)) * (b - readB(i + stride));
    if (x === 1) potential += a * b; if (y === 1) potential += a * b;
  }
  return 0.5 * (kinetic + lambdaSquared * potential);
}
export class RectangularMembraneKernel {
  constructor({ sampleRate = 48000, parameters } = {}) {
    this.profile = prepareRectangularMembraneProfile(parameters, sampleRate); this.identity = rectangularMembraneIdentity(this.profile);
    const count = this.profile.stride ** 2;
    this.planes = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
    this.controls = new Float64Array(MEMBRANE_CONTROLS.length * 2);
    for (let i = 0; i < MEMBRANE_CONTROLS.length; i++) this.controls[i] = this.controls[i + MEMBRANE_CONTROLS.length] = parameters[MEMBRANE_CONTROLS[i]];
    this.previous = 0; this.current = 1; this.next = 2; this.frame = this.faults = this.energy = this.overflows = this.leftSample = this.rightSample = 0; this.muted = false;
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * 0.008));
    // Prepared readers are used only for transfer validation, never in the render loop.
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.profile.revision + ':' + sampleRate, configurationBytes: encodeUtf8(this.identity), arrays: [...this.planes, this.controls],
      scalars: [...['previous', 'current', 'next', 'frame', 'faults', 'energy', 'overflows', 'leftSample', 'rightSample'].map(name => ({ name, type: 'number' })), { name: 'muted', type: 'boolean' }],
      validate: data => {
        for (const key of ['previous', 'current', 'next']) if (!Number.isInteger(data.named(key)) || data.named(key) < 0 || data.named(key) > 2) throw new Error('Invalid membrane plane frontier.');
        if (new Set(['previous', 'current', 'next'].map(key => data.named(key))).size !== 3) throw new Error('Aliased membrane state planes.');
        for (const key of ['frame', 'faults', 'overflows']) if (!Number.isSafeInteger(data.named(key)) || data.named(key) < 0) throw new Error('Invalid membrane frame or fault count.');
        for (let i = 0; i < this.controls.length; i++) if (data.planes[3].read(i) < 0 || data.planes[3].read(i) > 1) throw new Error('Invalid membrane control state.');
        const size = parameters.gridSize, stride = this.profile.stride;
        for (let plane = 0; plane < 3; plane++) for (let i = 0; i < count; i++) {
          const value = data.planes[plane].read(i), x = i % stride, y = Math.floor(i / stride);
          if (Math.abs(value) > this.profile.displacementBound * 1.000001 || (x === 0 || y === 0 || x === stride - 1 || y === stride - 1) && value !== 0) throw new Error('Membrane displacement or fixed boundary exceeds its domain.');
        }
        const measured = energyBetween(data.planes[data.named('current')].read, data.planes[data.named('previous')].read, size, stride, this.profile.lambdaSquared);
        if (measured < -1e-8 || measured > 1.0000001 || Math.abs(data.named('energy') - measured) > 1e-8 || data.named('energy') < 0 ||
            Math.abs(data.named('leftSample')) > this.profile.maximumOutputAmplitude || Math.abs(data.named('rightSample')) > this.profile.maximumOutputAmplitude) throw new Error('Invalid membrane discrete energy or pickup state.');
        if (data.named('muted') && (measured !== 0 || data.named('leftSample') !== 0 || data.named('rightSample') !== 0)) throw new Error('Cleared membrane contains active energy.');
      } });
  }
  setControls(values, apply = true) {
    if (!values || Object.getPrototypeOf(values) !== Object.prototype || !Object.keys(values).length || Object.keys(values).some(key => !MEMBRANE_CONTROLS.includes(key) || !Number.isFinite(values[key]) || values[key] < 0 || values[key] > 1)) throw new TypeError('Membrane coordinates and damping require normalized controls.');
    if (apply) for (let i = 0; i < MEMBRANE_CONTROLS.length; i++) if (values[MEMBRANE_CONTROLS[i]] != null) this.controls[i + MEMBRANE_CONTROLS.length] = values[MEMBRANE_CONTROLS[i]];
  }
  panic() { for (const plane of this.planes) plane.fill(0); this.energy = this.leftSample = this.rightSample = 0; this.muted = true; }
  pickup(plane, x01, y01) {
    const size = this.profile.parameters.gridSize, stride = this.profile.stride, x = 1 + x01 * (size - 1), y = 1 + y01 * (size - 1), ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy, i = iy * stride + ix;
    return (plane[i] * (1 - a) + plane[i + 1] * a) * (1 - b) + (plane[i + stride] * (1 - a) + plane[i + stride + 1] * a) * b;
  }
  sample(left, right, strikeX = this.controls[7], strikeY = this.controls[8], leftX = this.controls[9], leftY = this.controls[10], rightX = this.controls[11], rightY = this.controls[12], damp = this.controls[13]) {
    this.frame++; this.leftSample = this.rightSample = 0; if (this.muted) return;
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32 ||
        !Number.isFinite(strikeX) || strikeX < 0 || strikeX > 1 || !Number.isFinite(strikeY) || strikeY < 0 || strikeY > 1 ||
        !Number.isFinite(leftX) || leftX < 0 || leftX > 1 || !Number.isFinite(leftY) || leftY < 0 || leftY > 1 ||
        !Number.isFinite(rightX) || rightX < 0 || rightX > 1 || !Number.isFinite(rightY) || rightY < 0 || rightY > 1 || !Number.isFinite(damp) || damp < 0 || damp > 1) { this.faults++; this.panic(); return; }
    const c = this.controls, slew = this.smoothing;
    c[0] += (strikeX - c[0]) * slew; c[1] += (strikeY - c[1]) * slew; c[2] += (leftX - c[2]) * slew; c[3] += (leftY - c[3]) * slew;
    c[4] += (rightX - c[4]) * slew; c[5] += (rightY - c[5]) * slew; c[6] += (damp - c[6]) * slew;
    const p = this.profile, size = p.parameters.gridSize, stride = p.stride, previous = this.planes[this.previous], current = this.planes[this.current], next = this.planes[this.next];
    const loss = p.longLoss + (p.shortLoss - p.longLoss) * c[6], inverse = 1 / (1 + loss), lambda = p.lambdaSquared;
    for (let y = 1; y <= size; y++) for (let x = 1; x <= size; x++) {
      const i = y * stride + x, now = current[i];
      next[i] = (2 * now - (1 - loss) * previous[i] + lambda * (current[i - 1] + current[i + 1] + current[i - stride] + current[i + stride] - 4 * now)) * inverse;
    }
    let force = (left + right) * 0.5 * p.parameters.excitationGain01 * 0.02;
    if (force !== 0) {
      const available = Math.SQRT2 * Math.max(0, 1 - Math.sqrt(this.energy));
      if (Math.abs(force) > available) { force = Math.sign(force) * available; this.overflows++; }
      const x = 1 + c[0] * (size - 1), y = 1 + c[1] * (size - 1), ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy, i = iy * stride + ix;
      force *= inverse; next[i] += force * (1 - a) * (1 - b); next[i + 1] += force * a * (1 - b); next[i + stride] += force * (1 - a) * b; next[i + stride + 1] += force * a * b;
    }
    let kinetic = 0, potential = 0;
    for (let y = 1; y <= size; y++) for (let x = 1; x <= size; x++) {
      const i = y * stride + x, a = next[i], b = current[i]; kinetic += (a - b) ** 2;
      potential += (a - next[i + 1]) * (b - current[i + 1]) + (a - next[i + stride]) * (b - current[i + stride]);
      if (x === 1) potential += a * b; if (y === 1) potential += a * b;
    }
    const energy = 0.5 * (kinetic + lambda * potential), l = this.pickup(next, c[2], c[3]) * p.outputScale, r = this.pickup(next, c[4], c[5]) * p.outputScale;
    if (!Number.isFinite(energy) || energy < -1e-8 || energy > 1.0000001 || !Number.isFinite(l) || !Number.isFinite(r) || Math.abs(l) > p.maximumOutputAmplitude || Math.abs(r) > p.maximumOutputAmplitude) { this.faults++; this.panic(); return; }
    this.energy = Math.max(0, energy); this.leftSample = l; this.rightSample = r;
    const spare = this.previous; this.previous = this.current; this.current = this.next; this.next = spare;
  }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
  get snapshotBytes() { return this.stateTransfer.byteLength; }
  diagnostics() {
    const size = this.profile.parameters.gridSize, plane = this.planes[this.current], displacement = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) displacement.push(plane[(1 + Math.round(y * (size - 1) / 7)) * this.profile.stride + 1 + Math.round(x * (size - 1) / 7)]);
    return { revision: this.profile.revision, frame: this.frame, faults: this.faults, muted: this.muted, energy: this.energy, excitationCaps: this.overflows, displacement,
      displayGridSize: 8, gridSize: size, energyDomain: 'discrete-modeled-audio-state;not-physical-terrain-energy', cost: this.profile.cost };
  }
}
