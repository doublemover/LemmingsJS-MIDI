import { FRICTION_MODEL_LIMITS as L, frictionForceCurve, frictionSpatialRoughness } from '../../../midi/content/FrictionModel.js';
import { FrictionModalKernel } from './FrictionModalKernel.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const near = (a, b) => Math.abs(a - b) <= 1e-11 * Math.max(1, Math.abs(b));
const fail = message => { throw new Error('Friction state: ' + message); };
export function validateOwnedFrictionState({ source, arrays, scalars, frame, active, voice }) {
  const state = arrays[0].get, modes = arrays[1].get, rate = source.rate, expected = new FrictionModalKernel(rate);
  if (!scalars.every(value => finite(value, -32, 32))) fail('Shared source observations are invalid.');
  for (let slot = 0; slot < source.voices; slot++) {
    const base = slot * L.state, get = field => state(base + field), modeBase = slot * L.modes * L.modeWidth;
    if (!active(slot)) { for (let field = 0; field < L.state; field++) if (get(field) !== 0) fail('Retired source metadata is noncanonical.'); for (let index = 0; index < L.modes * L.modeWidth; index++) if (modes(modeBase + index) !== 0) fail('Retired body state is noncanonical.'); continue; }
    if (get(0) !== 1 || !integer(get(1), 0, 2) || !integer(get(2), 0, 0xffffffff) || ![0, 1].includes(get(7)) || !integer(get(14), 0, frame - 1) || get(13) !== frame - 1 || get(25) !== voice(slot, 5) || get(25) !== voice(slot, 6) || get(48) !== voice(slot, 2) || get(49) !== voice(slot, 0) || get(50) !== voice(slot, 1) || get(7) !== Number(voice(slot, 20) !== 0) || get(7) && get(31) !== voice(slot, 21) || !get(7) && get(31) !== 0 || !integer(get(31), 0, frame - 1) || get(33) !== voice(slot, 9)) fail('Body gate, token, epoch, generation, onset, pitch or release differs from the core.');
    if (!expected.begin(get(1), get(25), get(2), get(3), get(4), get(5), get(6), get(9), get(10), get(11), get(12), get(14))) fail('Body coefficients or observed span cannot be prepared in the admitted domain.');
    for (const field of [24, 38, 39, 44, 45]) if (!near(get(field), expected.state[field])) fail('Modal topology, point admittance or source coefficient differs.');
    for (const field of [47, 51, 52, 53, 54, 55]) if (get(field) !== 0) fail('Reserved source state is noncanonical.');
    if (!finite(get(15), 0, 1) || !finite(get(33), 0, 1) || !integer(get(46), 1, frame - get(14) + 1) || get(34) !== 0 || !integer(get(30), 0, (frame - get(14)) * L.iterations) || get(30) % L.iterations || !integer(get(32), 0, get(30) / L.iterations) || !finite(get(17), 0, L.maximumEnergy) || !finite(get(21), 0, 32) || !finite(get(22), 0, 1e-5) || !finite(get(23), 0, 4096)) fail('Pressure, iterations, energy, solver or containment state exceeds its bound.');
    const frontier = get(7) ? Math.min(frame, get(31)) : frame, fraction = Math.max(0, Math.min(1, (frontier - get(11)) / (get(12) - get(11)))), position = get(9) + (get(10) - get(9)) * fraction;
    if (!near(get(8), position) || !finite(get(8), -L.maximumCoordinatePixels, L.maximumCoordinatePixels) || !finite(get(35), 0, L.maximumPixelsPerSecond + 0.001) || !finite(get(36), -L.maximumVelocity, L.maximumVelocity)) fail('Observed cursor, speed or bow velocity differs.');
    const moving = !get(7) && frame - 1 >= get(11) && frame - 1 < get(12) && get(10) !== get(9), bow = moving ? L.maximumVelocity * Math.tanh(Math.sign(get(10) - get(9)) * get(35) * get(3) / 64) : 0;
    if (!near(get(36), bow) || !moving && get(35) !== 0) fail('Unobserved motion supplies bow work.');
    const roughness = get(1) === 2 ? frictionSpatialRoughness(get(2), get(8)) : 1, cap = L.forceScale * get(4) * get(15) * roughness;
    if (!near(get(37), cap) || !finite(get(16), -cap - 1e-10, cap + 1e-10)) fail('Force exceeds its pressure and observed spatial field.');
    let energy = 0, contact = 0, left = 0, right = 0;
    for (let mode = 0; mode < L.modes; mode++) {
      const offset = mode * L.modeWidth, at = modeBase + offset, read = field => modes(at + field);
      if (mode >= get(24)) { for (let field = 0; field < L.modeWidth; field++) if (read(field) !== 0) fail('Unused modal state is noncanonical.'); continue; }
      for (const field of [2, 3, 4, 5, 6, 7, 9]) if (!near(read(field), expected.modes[offset + field])) fail('Positive mode loss, force injection or signed observation differs from its source.');
      if (!finite(read(0), -4096, 4096) || !finite(read(1), -4096, 4096) || !finite(read(8), -4096, 4096)) fail('Modal displacement or velocity exceeds its admitted energy domain.');
      energy += 0.5 * (read(1) ** 2 + read(2) * read(0) ** 2); contact += read(5) * (read(8) + read(9) * get(16)); left += read(6) * read(1) * 0.05; right += read(7) * read(1) * 0.05;
    }
    if (!near(get(17), energy) || !near(get(42), contact) || !near(get(43), get(36) - contact) || get(16) * get(43) < -1e-10 || !near(get(23), Math.abs(get(16) - frictionForceCurve(get(43), cap))) || !near(get(26), left) || !near(get(28), right) || get(40) !== get(27) || get(41) !== get(29)) fail('Stored energy, force-port balance or body/DC observations disagree.');
    for (const field of [18, 19, 20]) if (!finite(get(field), 0, Number.MAX_SAFE_INTEGER)) fail('Accumulated work or dissipation is invalid.');
    if (Math.abs(get(17) + get(19) + get(20) - get(18)) > 1e-8 * (1 + get(18)) || !finite(get(27), -32, 32) || !finite(get(29), -32, 32)) fail('Accumulated energy or readout state exceeds its balance domain.');
  }
}
