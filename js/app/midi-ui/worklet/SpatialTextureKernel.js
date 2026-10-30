import { validTextureBodyCommand } from '../../../midi/content/TextureBodyProfile.js';
import { TEXTURE_EXCITER_LIMITS as LIMITS, TEXTURE_MODE_FREQUENCIES, textureSpatialHash } from '../../../midi/content/TextureExciter.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const unit = value => value / 4294967296;

export class SpatialTextureKernel {
  constructor(sampleRate, { state = new Float64Array(LIMITS.state), modes = new Float64Array(LIMITS.modes * LIMITS.modeWidth), pulses = new Float64Array(LIMITS.pulses * LIMITS.pulseWidth), observation = new Float64Array(LIMITS.modes), admission = new Float64Array([-1, 0]) } = {}) {
    if (![44100, 48000, 96000].includes(sampleRate) || !(state instanceof Float64Array) || state.length !== LIMITS.state || !(modes instanceof Float64Array) || modes.length !== LIMITS.modes * LIMITS.modeWidth || !(pulses instanceof Float64Array) || pulses.length !== LIMITS.pulses * LIMITS.pulseWidth || !(observation instanceof Float64Array) || observation.length !== LIMITS.modes || !(admission instanceof Float64Array) || admission.length !== 2) throw new TypeError('Texture excitation needs its exact preallocated state and pulse admission.');
    this.rate = sampleRate; this.state = state; this.modes = modes; this.pulses = pulses; this.observation = observation; this.admission = admission; this.leftSample = this.rightSample = 0;
  }
  begin(kind, seed, roughness, drag, shade, bodySeconds, fromPixels, toPixels, firstFrame, endFrame, onsetFrame = firstFrame) {
    if (!integer(onsetFrame, 0, firstFrame) || !integer(kind, 0, 3) || !integer(seed, 0, 0xffffffff) || !finite(roughness, 0.2, 0.8) || !finite(drag, 0, 1) || !finite(shade, 0, 1) || !finite(bodySeconds, kind === 3 ? 0.08 : 0.02, kind === 0 ? 0.07 : 0.25) || !this.validSpan(fromPixels, toPixels, firstFrame, endFrame)) return false;
    this.clear(); const s = this.state; s[0] = 1; s[1] = seed; s[2] = kind; s[3] = roughness; s[4] = drag; s[5] = shade; s[6] = bodySeconds; s[8] = fromPixels; s[10] = fromPixels; s[12] = firstFrame; s[13] = onsetFrame - 1; s[14] = Math.floor(fromPixels * roughness); s[28] = Math.exp(-2 * Math.PI * 120 / this.rate); s[29] = 1 - Math.exp(-2 * Math.PI * (2500 + 3500 * shade) / this.rate); s[41] = 1 - Math.exp(-1 / (bodySeconds * this.rate));
    for (let mode = 0; mode < 5; mode++) {
      if (kind === 3 && mode >= 2) continue;
      const at = mode * LIMITS.modeWidth, frequency = TEXTURE_MODE_FREQUENCIES[kind][mode], angle = 2 * Math.PI * frequency / this.rate, t60 = kind === 3 ? Math.log(1000) * 0.9 / (Math.PI * frequency) : (kind === 0 ? Math.max(0.02, bodySeconds * (1 - mode * 0.12)) : bodySeconds * (1 - mode * 0.12)), radius = Math.exp(-Math.log(1000) / (t60 * this.rate));
      this.modes[at] = Math.cos(angle); this.modes[at + 1] = Math.sin(angle); this.modes[at + 2] = radius; this.modes[at + 3] = (1 - radius) / (kind === 3 ? 2 : 5);
    }
    return this.setSpan(fromPixels, toPixels, firstFrame, endFrame);
  }
  configureExternalBody(command, frequency) {
    if (!validTextureBodyCommand(command, frequency, this.rate)) return false;
    const s = this.state, count = command[40]; if (!count) return true;
    let reference = 0;
    for (let mode = 0; mode < count; mode++) { const at = 46 + mode * 4; reference += Math.max(Math.abs(command[at + 2]), Math.abs(command[at + 3])); }
    this.modes.fill(0); s[42] = count; s[43] = command[41]; s[44] = command[44]; s[47] = frequency;
    for (let mode = 0; mode < count; mode++) {
      const src = 46 + mode * 4, at = mode * LIMITS.modeWidth, angle = 2 * Math.PI * frequency * command[src] / this.rate, t60 = command[42] * (1 - 0.9 * command[43]) * command[src + 1], radius = Math.exp(-Math.log(1000) / (t60 * this.rate));
      this.modes[at] = Math.cos(angle); this.modes[at + 1] = Math.sin(angle); this.modes[at + 2] = radius; this.modes[at + 3] = (1 - radius) / (2 * Math.SQRT2);
      this.observation[mode] = (command[src + 2] + (command[src + 3] - command[src + 2]) * command[45]) / Math.max(1, reference);
    }
    return true;
  }
  validSpan(fromPixels, toPixels, firstFrame, endFrame) {
    return finite(fromPixels, -LIMITS.maximumSignedCoordinatePixels, LIMITS.maximumSignedCoordinatePixels) && finite(toPixels, -LIMITS.maximumSignedCoordinatePixels, LIMITS.maximumSignedCoordinatePixels) && integer(firstFrame, 0) && integer(endFrame, firstFrame + 1) && endFrame - firstFrame <= this.rate * LIMITS.maximumSpanSeconds && Math.abs(toPixels - fromPixels) * this.rate / (endFrame - firstFrame) <= LIMITS.maximumPixelsPerSecond;
  }
  setSpan(fromPixels, toPixels, firstFrame, endFrame) {
    const s = this.state;
    if (!s[0] || s[7] || !this.validSpan(fromPixels, toPixels, firstFrame, endFrame) || firstFrame < s[12] || Math.abs(fromPixels - s[10]) > 1e-5) return false;
    s[9] = fromPixels; s[10] = toPixels; s[11] = firstFrame; s[12] = endFrame; return true;
  }
  end(frame) { if (!integer(frame, 0)) throw new RangeError('Texture end needs the actual output frame.'); this.state[7] = 1; this.state[32] = frame; }
  clear() { this.state.fill(0); this.modes.fill(0); this.observation.fill(0); this.pulses.fill(0); this.leftSample = this.rightSample = 0; }
  birth(frame, startFrame, duration, left, right) {
    const s = this.state, bucket = Math.floor(frame / 128); s[24]++;
    if (this.admission[0] !== bucket) { this.admission[0] = bucket; this.admission[1] = 0; }
    const free = (~(s[21] >>> 0)) >>> 0;
    if (!free || this.admission[1] >= LIMITS.birthsPer128Frames) { s[25]++; return false; }
    const slot = 31 - Math.clz32((free & -free) >>> 0), at = slot * LIMITS.pulseWidth;
    this.pulses[at] = startFrame; this.pulses[at + 1] = duration; this.pulses[at + 2] = left; this.pulses[at + 3] = right; this.pulses[at + 4] = frame; s[21] = ((s[21] >>> 0) | 1 << slot) >>> 0; this.admission[1]++; return true;
  }
  sample(frame) {
    this.leftSample = this.rightSample = 0; const s = this.state;
    if (!s[0]) return;
    if (!integer(frame, 0) || frame !== s[13] + 1) throw new RangeError('Texture excitation requires contiguous owned output frames.'); s[13] = frame;
    const moving = !s[7] && frame >= s[11] && frame < s[12] && s[10] !== s[9], position = moving ? s[9] + (s[10] - s[9]) * (frame - s[11] + 1) / (s[12] - s[11]) : s[8], previous = s[8], delta = moving ? position - previous : 0;
    const speed = Math.abs(delta) * this.rate, densityScale = 1 / Math.sqrt(Math.max(1, s[3] * speed));
    let response = Math.min(1, speed * s[4] / 64); if (s[2] === 3) { s[40] += (response - s[40]) * s[41]; if (Math.abs(s[40]) < 1e-24) s[40] = 0; response = s[40]; }
    let left = 0, right = 0;
    if (moving && delta !== 0) {
      const cellLow = Math.floor(Math.min(previous, position) * s[3]), cellHigh = Math.floor(Math.max(previous, position) * s[3]);
      if (cellHigh - cellLow > 1) throw new RangeError('Texture spatial step exceeds the bounded per-sample cell work.');
      if (s[2] !== 1 && response > 0) for (let cell = cellLow; cell <= cellHigh; cell++) {
        const hash = textureSpatialHash(s[1], cell, 1), location = (cell + unit(hash)) / s[3];
        if (!(delta > 0 ? location > previous && location <= position : location < previous && location >= position)) continue;
        const cluster = s[2] === 2 ? 1 + (hash >>> 16) % 4 : 1, spacing = Math.round((2 + 10 * unit(textureSpatialHash(s[1], cell, 2))) * this.rate / 1000), duration = Math.max(2, Math.round((1 + 4 * s[5]) * this.rate / 1000));
        const amplitude = response * densityScale / LIMITS.pulses / Math.sqrt(cluster), sign = hash & 1 ? 1 : -1, side = textureSpatialHash(s[1], cell, 3) & 1 ? 1 : -1;
        for (let child = 0; child < cluster; child++) { const start = frame + child * spacing; if (start >= s[12]) break; this.birth(frame, start, duration, amplitude * sign, amplitude * (0.8 * sign + 0.2 * side)); }
      }
      if (s[2] === 1 || s[2] === 3) {
        const coordinate = position * (320 * s[3]), cell = Math.floor(coordinate), fraction = coordinate - cell, amount = response * (s[2] === 3 ? 0.02 : 0.15);
        left = ((1 - fraction) * (2 * unit(textureSpatialHash(s[1], cell, 7)) - 1) + fraction * (2 * unit(textureSpatialHash(s[1], cell + 1, 7)) - 1)) * amount;
        right = left * 0.8 + ((1 - fraction) * (2 * unit(textureSpatialHash(s[1], cell, 8)) - 1) + fraction * (2 * unit(textureSpatialHash(s[1], cell + 1, 8)) - 1)) * amount * 0.2;
      }
      const slowCoordinate = position / 16, slowCell = Math.floor(slowCoordinate), slowFraction = slowCoordinate - slowCell;
      s[30] = 0.8 + 0.2 * ((1 - slowFraction) * unit(textureSpatialHash(s[1], slowCell, 9)) + slowFraction * unit(textureSpatialHash(s[1], slowCell + 1, 9)));
      s[8] = position; s[14] = cellHigh;
    }
    let mask = s[21] >>> 0;
    while (mask) {
      const bit = (mask & -mask) >>> 0, slot = 31 - Math.clz32(bit), at = slot * LIMITS.pulseWidth, age = frame - this.pulses[at]; mask = (mask & ~bit) >>> 0;
      if (age >= this.pulses[at + 1] || age <= 0 && !moving) { s[21] = ((s[21] >>> 0) & ~bit) >>> 0; continue; }
      if (age < 0) continue;
      const envelope = 0.5 - 0.5 * Math.cos(2 * Math.PI * age / (this.pulses[at + 1] - 1)); left += this.pulses[at + 2] * envelope; right += this.pulses[at + 3] * envelope;
    }
    s[34] += left * left + right * right;
    const highLeft = left - s[15] + s[28] * s[16], highRight = right - s[18] + s[28] * s[19]; s[15] = left; s[16] = Math.abs(highLeft) < 1e-24 ? 0 : highLeft; s[18] = right; s[19] = Math.abs(highRight) < 1e-24 ? 0 : highRight;
    const alpha = s[29] * (s[30] || 1); s[17] += alpha * (s[16] - s[17]); s[20] += alpha * (s[19] - s[20]); if (Math.abs(s[17]) < 1e-24) s[17] = 0; if (Math.abs(s[20]) < 1e-24) s[20] = 0; left = s[17] * 0.5; right = s[20] * 0.5;
    const dryLeft = left, dryRight = right;
    if (s[42]) {
      s[46] = Math.max(s[46], Math.abs(left), Math.abs(right));
      if (!Number.isFinite(s[46]) || s[46] > 1) s[45] = 1;
      if (!moving || s[45]) left = right = 0;
      else { left *= s[44]; right *= s[44]; }
    }
    let bodyLeft = 0, bodyRight = 0;
    for (let mode = 0, count = s[42] || 5; mode < count; mode++) {
      const at = mode * LIMITS.modeWidth, c = this.modes[at], sn = this.modes[at + 1], radius = this.modes[at + 2], gain = this.modes[at + 3];
      const a = this.modes[at + 4], b = this.modes[at + 5], x = (a * c - b * sn) * radius + left * gain, y = (a * sn + b * c) * radius;
      const d = this.modes[at + 6], e = this.modes[at + 7], u = (d * c - e * sn) * radius + right * gain, v = (d * sn + e * c) * radius;
      this.modes[at + 4] = Math.abs(x) < 1e-24 ? 0 : x; this.modes[at + 5] = Math.abs(y) < 1e-24 ? 0 : y; this.modes[at + 6] = Math.abs(u) < 1e-24 ? 0 : u; this.modes[at + 7] = Math.abs(v) < 1e-24 ? 0 : v; const pickup = s[42] ? this.observation[mode] : 1; bodyLeft += x * pickup; bodyRight += u * pickup;
    }
    const wet = s[42] ? s[43] : s[2] === 1 ? 0.1 : s[2] === 3 ? 0.7 : 0.8, bodyGain = s[42] ? 0.4 : 1;
    this.leftSample = dryLeft * (1 - wet) + bodyLeft * wet * bodyGain; this.rightSample = dryRight * (1 - wet) + bodyRight * wet * bodyGain;
    if (!Number.isFinite(this.leftSample) || !Number.isFinite(this.rightSample) || Math.max(Math.abs(this.leftSample), Math.abs(this.rightSample)) > 1.000001) throw new RangeError('Texture excitation violated its admitted peak bound.');
    s[23] = Math.max(s[23], Math.abs(this.leftSample), Math.abs(this.rightSample)); s[35] += this.leftSample * this.leftSample + this.rightSample * this.rightSample;
  }
}
