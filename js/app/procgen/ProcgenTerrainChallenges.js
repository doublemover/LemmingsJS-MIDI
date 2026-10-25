import { causalRandomDecision } from './workstation/CausalRandom.js';
const CHALLENGE_KINDS = Object.freeze(['ledge', 'tunnel', 'gap', 'terraces']);

// Teach distinct decisions between the safe entrance and the unrestricted
// source landscape. Reserve the approach and exit before placing attachments.
const planTerrainChallenge = ({ seed, chunk, left, right, height, varied = false }) => {
  const scheduleDecision = causalRandomDecision({ seed, namespace: 'terrain', mappingId: 'terrain-challenge', generation: 0, stableCauseId: `chapter:${Math.floor(chunk / 16)}`, drawPurpose: 'schedule' }), schedule = scheduleDecision.drawUint32;
  const deep = chunk >= 17 && (varied ? chunk % 16 === 1 + schedule % 5 || chunk % 16 === 9 + (schedule >>> 8) % 5 : chunk % 8 === 1);
  if (!deep && (chunk < 2 || chunk > 7 || !(chunk & 1))) return null;
  const chapter = deep ? Math.floor(chunk / 8) : 0;
  const shapeDecision = causalRandomDecision({ seed, namespace: 'terrain', mappingId: 'terrain-challenge', generation: 0, stableCauseId: `shape:${varied ? chunk : chapter}`, drawPurpose: 'geometry' }), code = shapeDecision.drawUint32, kind = CHALLENGE_KINDS[(Math.floor(chunk / 2) + code % 4) % 4];
  const floor = Math.min(height - 18, Math.max(32, Math.min(left, right)));
  const rise = kind === 'tunnel' ? 18 + (code >>> 8) % 7 : 8 + (code >>> 12) % 3;
  const start = (varied ? 42 : 56) + (code >>> 16) % (varied ? 23 : 5), width = kind === 'gap' ? 10 + (code >>> 20) % (varied ? 13 : 7) : 14 + (code >>> 20) % (varied ? 17 : 9);
  return Object.freeze({ version: 3, random: { schedule: scheduleDecision, shape: shapeDecision }, ...(deep ? { chapter, stage: 'deep' } : {}), kind, floor, rise, start, width, end: start + width,
    approach: 24, exit: 104, recoveryFloor: kind === 'gap' ? floor + 16 : null });
};
const challengeSurface = (challenge, x, left, right) => {
  const { floor, kind, rise, start, end } = challenge;
  // The short entrance drop lets returning followers turn on real terrain
  // while the first worker finishes, without leaving a permanent blocker.
  if (x < 24) return Math.round(left + (floor - 8 - left) * Math.min(x, 16) / 16);
  const landing = kind === 'ledge' ? floor - rise : floor;
  if (x >= 104) return Math.round(landing + (right - landing) * (x - 104) / 23);
  if (kind === 'ledge') return x < start ? floor : landing;
  if (kind === 'tunnel') return x >= start && x < end ? floor - rise : floor;
  if (kind === 'terraces') {
    const steps = x < 64 ? Math.max(0, Math.floor((x - 32) / 8)) : Math.max(0, Math.floor((96 - x) / 8));
    return floor - Math.min(3, steps) * 3;
  }
  if (kind === 'gap' && x >= end + 12) return Math.round(floor + 16 - 16 * (x - end - 12) / (104 - end - 12));
  return floor;
};
export { CHALLENGE_KINDS, planTerrainChallenge, challengeSurface };
