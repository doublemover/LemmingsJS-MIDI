import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

export function validateActorBirthAbilities(raw, laneCount) {
  if (raw == null) return null;
  if (!Number.isSafeInteger(laneCount) || laneCount < 1 || laneCount > 32 || !Array.isArray(raw) || raw.length !== laneCount || raw.some((entry, laneId) => !entry || Object.getPrototypeOf(entry) !== Object.prototype || Object.keys(entry).length !== 3 || Object.keys(entry).some(key => !['laneId', 'climb', 'parachute'].includes(key)) || entry.laneId !== laneId || typeof entry.climb !== 'boolean' || typeof entry.parachute !== 'boolean')) throw new TypeError('Authored actor birth abilities require one exact bounded lane policy.');
  return freezeData(raw.map(({ laneId, climb, parachute }) => ({ laneId, climb, parachute })));
}
export function sameActorBirthAbilities(a, b, laneCount) { return canonicalDataText(validateActorBirthAbilities(a, laneCount)).text === canonicalDataText(validateActorBirthAbilities(b, laneCount)).text; }
