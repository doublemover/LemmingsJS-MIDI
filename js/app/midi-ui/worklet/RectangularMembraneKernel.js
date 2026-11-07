import { MembraneStrikeQueue } from './MembraneStrikeQueue.js';
import { encodeUtf8 } from '../../../core/CanonicalData.js';
import { prepareRectangularMembraneProfile, rectangularMembraneIdentity, MEMBRANE_CONTROLS, MEMBRANE_TOUCH_CONTROLS, membraneControlValid, membraneTouchSupported, membraneControlTarget } from '../../../midi/content/RectangularMembraneProfile.js';
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
    this.profile = prepareRectangularMembraneProfile(parameters, sampleRate); this.identity = rectangularMembraneIdentity(this.profile); this.strikes = new MembraneStrikeQueue(this.profile); this.forces = new Float64Array(this.profile.nodeCount);
    const count = this.profile.stride ** 2;
    this.planes = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
    this.controls = new Float64Array(MEMBRANE_CONTROLS.length * 2); this.touches = new Float64Array(16); this.touchField = new Float64Array(this.profile.nodeCount * 2); this.touchDirty = false;
    for (let index = 0; index < 4; index++) this.touches.set([0.5, 0.5, membraneControlTarget('touchRadius01', 0.12), 0], index * 4);
    for (let i = 0; i < MEMBRANE_CONTROLS.length; i++) this.controls[i] = this.controls[i + MEMBRANE_CONTROLS.length] = this.profile.parameters[MEMBRANE_CONTROLS[i]];
    this.previous = 0; this.current = 1; this.next = 2; this.frame = this.faults = this.energy = this.overflows = this.leftSample = this.rightSample = 0; this.muted = false;
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * 0.008));
    // Prepared readers are used only for transfer validation, never in the render loop.
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.profile.revision + ':' + sampleRate, configurationBytes: encodeUtf8(this.identity), arrays: [...this.planes, this.controls, this.touches, this.touchField, this.strikes.queue, this.strikes.voices, this.strikes.receipts, this.strikes.frontier],
      scalars: [...['previous', 'current', 'next', 'frame', 'faults', 'energy', 'overflows', 'leftSample', 'rightSample'].map(name => ({ name, type: 'number' })), { name: 'muted', type: 'boolean' }, { name: 'touchDirty', type: 'boolean' }],
      validate: data => {
        for (const key of ['previous', 'current', 'next']) if (!Number.isInteger(data.named(key)) || data.named(key) < 0 || data.named(key) > 2) throw new Error('Invalid membrane plane frontier.');
        if (new Set(['previous', 'current', 'next'].map(key => data.named(key))).size !== 3) throw new Error('Aliased membrane state planes.');
        for (const key of ['frame', 'faults', 'overflows']) if (!Number.isSafeInteger(data.named(key)) || data.named(key) < 0) throw new Error('Invalid membrane frame or fault count.');
        for (let i = 0; i < this.controls.length; i++) if (data.planes[3].read(i) < 0 || data.planes[3].read(i) > 1) throw new Error('Invalid membrane control state.');
        for (let i = 0; i < 16; i++) if (!membraneControlValid(MEMBRANE_TOUCH_CONTROLS[i], data.planes[4].read(i))) throw new Error('Invalid membrane preparation coordinates.');
        for (let i = 0; i < this.touchField.length; i++) if (data.planes[5].read(i) < 0 || data.planes[5].read(i) > 1) throw new Error('Invalid positive loss field.');
        for (let i = 0; i < 16; i += 4) if (data.planes[4].read(i + 3) > 0 && !membraneTouchSupported(this.profile.parameters.gridSize, data.planes[4].read(i), data.planes[4].read(i + 1), data.planes[4].read(i + 2))) throw new Error('Unsupported restored touch patch.');
        if (data.named('touchDirty')) throw new Error('Membrane touch field must be prepared before state transfer.');
        const size = this.profile.parameters.gridSize, stride = this.profile.stride;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          let target = 0;
          for (let i = 0; i < 16; i += 4) { const dx = x / (size - 1) - data.planes[4].read(i), dy = y / (size - 1) - data.planes[4].read(i + 1), radius = data.planes[4].read(i + 2); target = Math.max(target, data.planes[4].read(i + 3) * Math.max(0, 1 - (dx * dx + dy * dy) / (radius * radius))); }
          const field = y * size + x;
          if (Math.abs(data.planes[5].read(this.profile.nodeCount + field) - target) > 1e-12 || data.named('muted') && data.planes[5].read(field) !== 0) throw new Error('Membrane loss field differs from its exact prepared touch targets.');
        }
        for (let plane = 0; plane < 3; plane++) for (let i = 0; i < count; i++) {
          const value = data.planes[plane].read(i), x = i % stride, y = Math.floor(i / stride);
          if (Math.abs(value) > this.profile.displacementBound * 1.000001 || (x === 0 || y === 0 || x === stride - 1 || y === stride - 1) && value !== 0) throw new Error('Membrane displacement or fixed boundary exceeds its domain.');
        }
        const measured = energyBetween(data.planes[data.named('current')].read, data.planes[data.named('previous')].read, size, stride, this.profile.lambdaSquared);
        if (measured < -1e-8 || measured > 1.0000001 || Math.abs(data.named('energy') - measured) > 1e-8 || data.named('energy') < 0 ||
            Math.abs(data.named('leftSample')) > this.profile.maximumOutputAmplitude || Math.abs(data.named('rightSample')) > this.profile.maximumOutputAmplitude) throw new Error('Invalid membrane discrete energy or pickup state.');
        this.strikes.validateTransfer(data, 6, data.named('muted') === 1);
        if (data.named('muted') && (measured !== 0 || data.named('leftSample') !== 0 || data.named('rightSample') !== 0)) throw new Error('Cleared membrane contains active energy.');
      } });
  }
  setControls(values, apply = true) {
    if (this.muted || !values || Object.getPrototypeOf(values) !== Object.prototype || !Object.keys(values).length || Object.keys(values).some(key => !membraneControlValid(key, values[key]))) throw new TypeError('Membrane coordinates and damping require normalized controls.');
    for (let i = 0; i < 16; i += 4) {
      const x = values[MEMBRANE_TOUCH_CONTROLS[i]] ?? this.touches[i], y = values[MEMBRANE_TOUCH_CONTROLS[i + 1]] ?? this.touches[i + 1], radius = values[MEMBRANE_TOUCH_CONTROLS[i + 2]] ?? this.touches[i + 2], amount = values[MEMBRANE_TOUCH_CONTROLS[i + 3]] ?? this.touches[i + 3];
      if (amount > 0 && !membraneTouchSupported(this.profile.parameters.gridSize, x, y, radius)) throw new RangeError('The touch patch has no supported grid sites at this resolution.');
    }
    if (apply) {
      for (let i = 0; i < MEMBRANE_CONTROLS.length; i++) if (values[MEMBRANE_CONTROLS[i]] != null) this.controls[i + MEMBRANE_CONTROLS.length] = Math.fround(values[MEMBRANE_CONTROLS[i]]);
      for (let i = 0; i < 16; i++) if (values[MEMBRANE_TOUCH_CONTROLS[i]] != null && this.touches[i] !== values[MEMBRANE_TOUCH_CONTROLS[i]]) { this.touches[i] = membraneControlTarget(MEMBRANE_TOUCH_CONTROLS[i], values[MEMBRANE_TOUCH_CONTROLS[i]]); this.touchDirty = true; }
      this.refreshTouchField();
    }
  }
  setTouch(index, x, y, radius, amount) {
    if (!Number.isInteger(index) || index < 0 || index > 3 || !Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1 || !Number.isFinite(radius) || radius < Math.fround(0.08) || radius > Math.fround(0.18) || !Number.isFinite(amount) || amount < 0 || amount > 1 || amount > 0 && !membraneTouchSupported(this.profile.parameters.gridSize, x, y, radius)) return false;
    x = Math.fround(x); y = Math.fround(y); radius = membraneControlTarget('touchRadius01', radius); amount = Math.fround(amount);
    const at = index * 4, t = this.touches; if (t[at] !== x || t[at + 1] !== y || t[at + 2] !== radius || t[at + 3] !== amount) { t[at] = x; t[at + 1] = y; t[at + 2] = radius; t[at + 3] = amount; this.touchDirty = true; } return true;
  }
  refreshTouchField() {
    if (!this.touchDirty) return; const size = this.profile.parameters.gridSize, count = this.profile.nodeCount, t = this.touches;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let loss = 0;
      for (let i = 0; i < 16; i += 4) { const dx = x / (size - 1) - t[i], dy = y / (size - 1) - t[i + 1]; loss = Math.max(loss, t[i + 3] * Math.max(0, 1 - (dx * dx + dy * dy) / (t[i + 2] * t[i + 2]))); }
      this.touchField[count + y * size + x] = loss;
    }
    this.touchDirty = false;
  }
  enqueueStrike(command) { return !this.muted && this.strikes.enqueue(command); }
  panic(audioFrame) { this.strikes.panic(audioFrame); this.forces.fill(0); this.touchField.fill(0); this.touchDirty = false; for (let i = 3; i < 16; i += 4) this.touches[i] = 0; for (const plane of this.planes) plane.fill(0); this.energy = this.leftSample = this.rightSample = 0; this.muted = true; }
  pickup(plane, x01, y01) {
    const size = this.profile.parameters.gridSize, stride = this.profile.stride, x = 1 + x01 * (size - 1), y = 1 + y01 * (size - 1), ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy, i = iy * stride + ix;
    return (plane[i] * (1 - a) + plane[i + 1] * a) * (1 - b) + (plane[i + stride] * (1 - a) + plane[i + stride + 1] * a) * b;
  }
  sample(left, right, strikeX = this.controls[7], strikeY = this.controls[8], leftX = this.controls[9], leftY = this.controls[10], rightX = this.controls[11], rightY = this.controls[12], damp = this.controls[13], audioFrame = this.strikes.lastFrame + 1) {
    this.frame++; this.leftSample = this.rightSample = 0; if (this.muted) return;
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32 ||
        !Number.isFinite(strikeX) || strikeX < 0 || strikeX > 1 || !Number.isFinite(strikeY) || strikeY < 0 || strikeY > 1 ||
        !Number.isFinite(leftX) || leftX < 0 || leftX > 1 || !Number.isFinite(leftY) || leftY < 0 || leftY > 1 ||
        !Number.isFinite(rightX) || rightX < 0 || rightX > 1 || !Number.isFinite(rightY) || rightY < 0 || rightY > 1 || !Number.isFinite(damp) || damp < 0 || damp > 1) { this.faults++; this.panic(); return; }
    this.forces.fill(0); if (!this.strikes.advance(audioFrame, this.forces)) { this.faults++; this.panic(); return; }
    const c = this.controls, slew = this.smoothing;
    c[0] += (strikeX - c[0]) * slew; c[1] += (strikeY - c[1]) * slew; c[2] += (leftX - c[2]) * slew; c[3] += (leftY - c[3]) * slew;
    c[4] += (rightX - c[4]) * slew; c[5] += (rightY - c[5]) * slew; c[6] += (damp - c[6]) * slew;
    const p = this.profile, size = p.parameters.gridSize, stride = p.stride, previous = this.planes[this.previous], current = this.planes[this.current], next = this.planes[this.next];
    const baseLoss = p.longLoss + (p.shortLoss - p.longLoss) * c[6], lambda = p.lambdaSquared;
    for (let y = 1; y <= size; y++) for (let x = 1; x <= size; x++) {
      const i = y * stride + x, now = current[i], field = (y - 1) * size + x - 1; this.touchField[field] += (this.touchField[field + p.nodeCount] - this.touchField[field]) * slew;
      const loss = baseLoss + (p.touchLoss - baseLoss) * this.touchField[field], inverse = 1 / (1 + loss);
      next[i] = (2 * now - (1 - loss) * previous[i] + lambda * (current[i - 1] + current[i + 1] + current[i - stride] + current[i + stride] - 4 * now)) * inverse;
    }
    const force = (left + right) * 0.5 * p.parameters.excitationGain01 * 0.02;
    if (force !== 0) this.strikes.scatter(this.forces, c[0], c[1], force);
    let normSquared = 0; for (let i = 0; i < this.forces.length; i++) normSquared += this.forces[i] * this.forces[i];
    if (!Number.isFinite(normSquared)) { this.faults++; this.panic(); return; }
    if (normSquared > 0) {
      const norm = Math.sqrt(normSquared), available = Math.SQRT2 * Math.max(0, 1 - Math.sqrt(this.energy)), scale = norm > available ? available / norm : 1;
      if (scale < 1) this.overflows++;
      for (let y = 1; y <= size; y++) for (let x = 1; x <= size; x++) { const field = (y - 1) * size + x - 1; next[y * stride + x] += this.forces[field] * scale / (1 + baseLoss + (p.touchLoss - baseLoss) * this.touchField[field]); }
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
    return { revision: this.profile.revision, frame: this.frame, faults: this.faults, muted: this.muted, energy: this.energy, excitationCaps: this.overflows, strikes: this.strikes.diagnostics(), displacement,
      touches: Array.from({ length: 4 }, (_, index) => ({ slot: index, x01: this.touches[index * 4], y01: this.touches[index * 4 + 1], radius01: this.touches[index * 4 + 2], amount01: this.touches[index * 4 + 3] })), preparation: this.profile.preparation,
      displayGridSize: 8, gridSize: size, energyDomain: 'discrete-modeled-audio-state;not-physical-terrain-energy', cost: this.profile.cost };
  }
}
