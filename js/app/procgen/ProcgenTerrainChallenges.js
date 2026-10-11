const CHALLENGE_KINDS = Object.freeze(['ledge', 'tunnel', 'gap', 'terraces']);
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

// Teach distinct decisions between the safe entrance and the unrestricted
// source landscape. Reserve the approach and exit before placing attachments.
const planTerrainChallenge = ({ seed, chunk, left, right, height }) => {
  if (chunk < 2 || chunk > 7 || !(chunk & 1)) return null;
  const code = mix(seed ^ 0x36b12a7d), kind = CHALLENGE_KINDS[(Math.floor(chunk / 2) + code % 4) % 4];
  const floor = Math.min(height - 18, Math.max(32, Math.min(left, right)));
  const rise = kind === 'tunnel' ? 18 + (code >>> 8) % 7 : 8 + (code >>> 12) % 3;
  const start = 56 + (code >>> 16) % 5, width = kind === 'gap' ? 10 + (code >>> 20) % 7 : 14 + (code >>> 20) % 9;
  return Object.freeze({ version: 1, kind, floor, rise, start, width, end: start + width,
    approach: 24, exit: 104, recoveryFloor: kind === 'gap' ? floor + 16 : null });
};
const challengeSurface = (challenge, x, left, right) => {
  const { floor, kind, rise, start, end } = challenge;
  if (x < 24) return Math.round(left + (floor - left) * x / 24);
  const landing = kind === 'ledge' ? floor - rise : floor;
  if (x >= 104) return Math.round(landing + (right - landing) * (x - 104) / 23);
  if (kind === 'ledge') return x < start ? floor : landing;
  if (kind === 'tunnel') return x >= start && x < end ? floor - rise : floor;
  if (kind === 'terraces') {
    const steps = x < 64 ? Math.max(0, Math.floor((x - 32) / 8)) : Math.max(0, Math.floor((96 - x) / 8));
    return floor - Math.min(3, steps) * 3;
  }
  return floor;
};
export { CHALLENGE_KINDS, planTerrainChallenge, challengeSurface };
