import { TEXTURE_EXCITER_LIMITS as LIMITS, TEXTURE_MODE_FREQUENCIES } from '../../../midi/content/TextureExciter.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const near = (a, b) => Math.abs(a - b) <= 1e-12;
const fail = message => { throw new Error('Texture state: ' + message); };

export function validateOwnedTextureState({ source, arrays, scalars, frame, active, voice }) {
  const [state, modes, pulses, observations, admission] = arrays.map(array => array.get), rate = source.rate;
  if (!scalars.every(value => finite(value, -1.000001, 1.000001)) || !integer(admission(0), -1, Math.max(-1, Math.floor((frame - 1) / 128))) || !integer(admission(1), 0, LIMITS.birthsPer128Frames) || admission(0) === -1 && admission(1) !== 0) fail('Shared absolute-frame birth quota or stereo output is invalid.');
  for (let slot = 0; slot < source.voices; slot++) {
    const base = slot * LIMITS.state, get = index => state(base + index), modeBase = slot * LIMITS.modes * LIMITS.modeWidth, pulseBase = slot * LIMITS.pulses * LIMITS.pulseWidth, observationBase = slot * LIMITS.modes;
    if (!active(slot)) {
      for (const [read, start, count] of [[state, base, LIMITS.state], [modes, modeBase, LIMITS.modes * LIMITS.modeWidth], [pulses, pulseBase, LIMITS.pulses * LIMITS.pulseWidth], [observations, observationBase, LIMITS.modes]]) for (let i = 0; i < count; i++) if (read(start + i) !== 0) fail('Retired source memory is noncanonical.');
      continue;
    }
    if (get(0) !== 1 || !integer(get(1), 0, 0xffffffff) || !integer(get(2), 0, 3) || !finite(get(3), 0.2, 0.8) || !finite(get(4), 0, 1) || !finite(get(5), 0, 1) || !finite(get(6), get(2) === 3 ? 0.08 : 0.02, get(2) === 0 ? 0.07 : 0.25) || ![0, 1].includes(get(7))) fail('Exciter kind, seed, density, speed response or decay is invalid.');
    if (!source.children[slot].validSpan(get(9), get(10), get(11), get(12)) || !finite(get(8), -LIMITS.maximumSignedCoordinatePixels, LIMITS.maximumSignedCoordinatePixels) || get(13) !== frame - 1 || !integer(get(14), -LIMITS.maximumSignedCoordinatePixels, LIMITS.maximumSignedCoordinatePixels) || !integer(get(21), 0, 0xffffffff)) fail('Spatial cursor, motion frontier or child mask is invalid.');
    if (get(31) !== voice(slot, 5) || get(31) !== voice(slot, 6) || !finite(get(31), 20, 2000) || get(36) !== voice(slot, 2) || get(37) !== voice(slot, 0) || get(38) !== voice(slot, 1) || get(7) !== Number(voice(slot, 20) !== 0) || !integer(get(32), 0, frame) || get(7) && get(32) !== voice(slot, 21) || !get(7) && get(32) !== 0) fail('Source gate, token, epoch, generation, pitch or release frontier differs from its core.');
    for (const index of [22, 26, 27, 33, 39]) if (get(index) !== 0) fail('Reserved exciter state is noncanonical.');
    for (const index of [15, 16, 17, 18, 19, 20]) if (!finite(get(index), -4, 4)) fail('Filter state exceeds its admitted input bound.');
    if (!finite(get(23), 0, 1.000001) || !integer(get(24), 0) || !integer(get(25), 0, get(24)) || !finite(get(34), 0, Number.MAX_SAFE_INTEGER) || !finite(get(35), 0, Number.MAX_SAFE_INTEGER) || !near(get(28), Math.exp(-2 * Math.PI * 120 / rate)) || !near(get(29), 1 - Math.exp(-2 * Math.PI * (2500 + 3500 * get(5)) / rate)) || get(30) !== 0 && !finite(get(30), 0.8, 1) || !finite(get(40), 0, 1) || !near(get(41), 1 - Math.exp(-1 / (get(6) * rate)))) fail('Filter coefficients, correlation or bounded diagnostics are invalid.');
    if (!integer(get(42), 0, 8)) fail('External modal topology is invalid.');
    if (get(42)) {
      if (!finite(get(43), 0, 1) || !finite(get(44), 0, 1) || ![0, 1].includes(get(45)) || !finite(get(46), 0, 4) || get(47) !== get(31)) fail('External body input calibration or onset tuning is invalid.');
    } else for (let index = 42; index < LIMITS.state; index++) if (get(index) !== 0) fail('Unprepared external body state is noncanonical.');
    const count = get(42) || (get(2) === 3 ? 2 : 5); let observationL1 = 0;
    for (let mode = 0; mode < LIMITS.modes; mode++) {
      const at = modeBase + mode * LIMITS.modeWidth, read = index => modes(at + index), pickup = observations(observationBase + mode);
      if (mode >= count) { for (let index = 0; index < LIMITS.modeWidth; index++) if (read(index) !== 0) fail('Unused modal state is noncanonical.'); if (pickup !== 0) fail('Unused pickup state is noncanonical.'); continue; }
      if (!near(read(0) ** 2 + read(1) ** 2, 1) || !finite(read(2), Number.MIN_VALUE, 1 - Number.EPSILON) || Math.hypot(read(4), read(5), read(6), read(7)) > 1.000001) fail('Modal rotation, positive loss or state contraction exceeds its bound.');
      if (get(42)) {
        const frequency = Math.atan2(read(1), read(0)) * rate / (2 * Math.PI);
        if (!finite(frequency, get(47) * 0.125 - 1e-9, Math.min(get(47) * 16 + 1e-9, rate * 0.4)) || !finite(read(2), Math.exp(-Math.log(1000) / (0.00002 * rate)) - 1e-12, Math.exp(-Math.log(1000) / (2.5 * rate)) + 1e-12) || !near(read(3), (1 - read(2)) / (2 * Math.SQRT2)) || !finite(pickup, -1, 1)) fail('External modal register, injection or observation is invalid.');
        observationL1 += Math.abs(pickup);
      } else {
        const frequency = TEXTURE_MODE_FREQUENCIES[get(2)][mode], angle = 2 * Math.PI * frequency / rate, t60 = get(2) === 3 ? Math.log(1000) * 0.9 / (Math.PI * frequency) : get(2) === 0 ? Math.max(0.02, get(6) * (1 - mode * 0.12)) : get(6) * (1 - mode * 0.12), radius = Math.exp(-Math.log(1000) / (t60 * rate));
        if (!near(read(0), Math.cos(angle)) || !near(read(1), Math.sin(angle)) || !near(read(2), radius) || !near(read(3), (1 - radius) / count) || pickup !== 0) fail('Material modal coefficients differ from the admitted recipe.');
      }
    }
    if (observationL1 > 1.000001) fail('Signed observation exceeds its common L1 reference.');
    for (let pulse = 0; pulse < LIMITS.pulses; pulse++) {
      const at = pulseBase + pulse * LIMITS.pulseWidth;
      for (let index = 5; index < LIMITS.pulseWidth; index++) if (pulses(at + index) !== 0) fail('Reserved burst state is noncanonical.');
      if (!(get(21) >>> pulse & 1)) continue;
      if (!integer(pulses(at + 4), 0, frame - 1) || Math.floor(pulses(at + 4) / 128) > admission(0) || !integer(pulses(at), pulses(at + 4), get(12) - 1) || !integer(pulses(at + 1), 2, Math.ceil(rate * 0.005)) || pulses(at) + pulses(at + 1) <= frame - 1 || get(7) && pulses(at) >= frame - 1 || !finite(pulses(at + 2), -1 / LIMITS.pulses, 1 / LIMITS.pulses) || !finite(pulses(at + 3), -1 / LIMITS.pulses, 1 / LIMITS.pulses)) fail('Active finite burst lifetime or excitation amplitude is invalid.');
    }
  }
}
