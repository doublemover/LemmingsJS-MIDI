import { WIND_MODEL_LIMITS as L, windForceCurve, windRandomAdvance } from '../../../midi/content/WindModel.js';
import { WindModalKernel } from './WindModalKernel.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const near = (a, b) => Math.abs(a - b) <= 1e-11 * Math.max(1, Math.abs(b));
const fail = message => { throw new Error('Wind state: ' + message); };
export function validateOwnedWindState({ source, arrays, scalars, frame, active, voice }) {
  const state = arrays[0].get, modes = arrays[1].get, expected = new WindModalKernel(source.rate);
  if (!scalars.every(value => finite(value, -32, 32))) fail('Shared source observations are invalid.');
  for (let slot = 0; slot < source.voices; slot++) {
    const base = slot * L.state, get = field => state(base + field), modeBase = slot * L.modes * L.modeWidth;
    if (!active(slot)) { for (let field = 0; field < L.state; field++) if (get(field) !== 0) fail('Retired metadata is noncanonical.'); for (let field = 0; field < L.modes * L.modeWidth; field++) if (modes(modeBase + field) !== 0) fail('Retired modal state is noncanonical.'); continue; }
    if (get(0) !== 1 || !integer(get(1), 0, 2) || !integer(get(2), 0, 0xffffffff) || ![0, 1].includes(get(8)) || !integer(get(10), 0, frame - 1) || get(9) !== frame - 1 || get(21) !== voice(slot, 5) || get(21) !== voice(slot, 6) || get(48) !== voice(slot, 2) || get(49) !== voice(slot, 0) || get(50) !== voice(slot, 1) || get(8) !== Number(voice(slot, 20) !== 0) || get(8) && get(11) !== voice(slot, 21) || !get(8) && get(11) !== 0 || !integer(get(11), 0, frame - 1) || get(12) !== voice(slot, 9)) fail('Gate, token, epoch, generation, onset, pitch or release differs from the core.');
    if (!expected.begin(get(1), get(21), get(2), get(3), get(4), get(5), get(6), get(7), get(10))) fail('Source parameters exceed the admitted acoustic domain.');
    if (![0, 1].includes(get(23)) || get(24) !== get(23) || ![0, 1].includes(get(25)) || get(1) !== 2 && (get(23) || get(25)) || get(23) && !get(25)) fail('Register identity, hysteresis or transition count is invalid.');
    if (get(23)) { expected.state[25] = 1; if (!expected.raiseRegister()) fail('Register coefficients cannot be prepared.'); }
    for (const field of [21, 22, 26, 27, 28, 32, 33, 34, 35, 51, 52, 53]) if (!near(get(field), expected.state[field])) fail('Modal topology, admittance, acoustic size, pressure or filter coefficient differs.');
    for (let field = 54; field < L.state; field++) if (get(field) !== 0) fail('Reserved metadata is noncanonical.');
    const age = frame - get(10);
    if (!finite(get(12), 0, 1) || !finite(get(13), 0, get(3)) || !integer(get(36), 1, 0xffffffff) || get(36) !== windRandomAdvance(get(2) || 0x6d2b79f5, age) || !integer(get(43), 0, age * L.iterations) || get(43) % L.iterations || get(44) !== 0 || !finite(get(15), 0, L.maximumEnergy) || !finite(get(18), 0, 32) || !finite(get(19), 0, 1e-5) || !finite(get(20), 0, 0.001)) fail('Pressure, deterministic noise frontier, solver, energy or containment state exceeds its bound.');
    const noiseBound = get(6) * 10 ** (-26 / 20) + 1e-5;
    if (!finite(get(29), -noiseBound, noiseBound) || !finite(get(30), -2 * noiseBound, 2 * noiseBound) || !finite(get(31), -2 * noiseBound, 2 * noiseBound) || get(46) !== get(31) || !near(get(47), L.forceScale * get(13)) || !finite(get(14), -get(47) - 1e-10, get(47) + 1e-10)) fail('Breath filter or force exceeds the pressure bound.');
    let energy = 0, contact = 0, left = 0, right = 0;
    for (let mode = 0; mode < L.modes; mode++) {
      const offset = mode * L.modeWidth, at = modeBase + offset, read = field => modes(at + field);
      for (const field of [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17]) if (!near(read(field), expected.modes[offset + field])) fail('Positive mode loss, register bank, injection or signed observation differs.');
      if (!finite(read(0), -4096, 4096) || !finite(read(1), -4096, 4096) || !finite(read(8), -4096, 4096)) fail('Modal displacement or velocity exceeds its energy domain.');
      energy += 0.5 * (read(1) ** 2 + read(2) * read(0) ** 2); contact += read(5) * (read(8) + read(9) * get(14)); left += read(6) * read(1) * 0.05; right += read(7) * read(1) * 0.05;
    }
    if (!near(get(15), energy) || !near(get(45), contact) || !near(get(20), Math.abs(get(14) - windForceCurve(contact, get(46), get(47), get(52)))) || !near(get(39), left) || !near(get(41), right) || get(37) !== get(40) || get(38) !== get(42) || !finite(get(40), -32, 32) || !finite(get(42), -32, 32)) fail('Stored energy, implicit force port or body/DC observations disagree.');
    if (!finite(get(16), 0, Number.MAX_SAFE_INTEGER) || !finite(get(17), 0, Number.MAX_SAFE_INTEGER) || Math.abs(get(15) + get(17) - get(16)) > 1e-8 * (1 + get(16))) fail('Cumulative port work and positive loss disagree.');
  }
}
