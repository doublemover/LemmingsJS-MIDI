/** @typedef {Readonly<{version: 1, worldId: string, generation: number, actorId: number | string, patchId: string, patchRevision: number, seed: number, amount01: number}>} ActorTimbreLock */
/** @type {WeakSet<readonly ActorTimbreLock[]>} */
const locks = new WeakSet();
/** @type {WeakMap<readonly ActorTimbreLock[], ReadonlyMap<string, readonly ActorTimbreLock[]>>} */
const indexes = new WeakMap();
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const plain = value => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
/** @param {unknown} value @param {number} maximum @returns {value is string} */
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
/** @param {unknown} value @returns {value is number} */
const integer = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/** @param {unknown} value @returns {value is number | string} */
const actorId = value => integer(value) || text(value, 160);
/** @returns {never} */
const fail = () => { throw new TypeError('Invalid versioned actor timbre lock.'); };
export const MAX_ACTOR_TIMBRE_LOCKS = 256;
export const MAX_ACTOR_PATCH_LOCKS = 16;
/** @type {readonly ActorTimbreLock[]} */
export const EMPTY_ACTOR_TIMBRE_LOCKS = Object.freeze([]);
locks.add(EMPTY_ACTOR_TIMBRE_LOCKS);
/** @param {Pick<ActorTimbreLock, 'worldId' | 'generation' | 'actorId'>} value */
export const actorTimbreIdentityKey = value => JSON.stringify([value.worldId, value.generation, value.actorId]);
/** @param {Pick<ActorTimbreLock, 'patchId' | 'patchRevision'>} value */
export const actorTimbrePatchKey = value => JSON.stringify([value.patchId, value.patchRevision]);

/** @param {unknown} value @returns {ActorTimbreLock} */
export function validateActorTimbreLock(value) {
  if (!plain(value) || Object.keys(value).some(key => !['version', 'worldId', 'generation', 'actorId', 'patchId', 'patchRevision', 'seed', 'amount01'].includes(key)) ||
      value.version !== 1 || !text(value.worldId, 160) || !integer(value.generation) || !actorId(value.actorId) || !text(value.patchId, 128) ||
      !integer(value.patchRevision) || typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed) || value.seed < -2147483648 || value.seed > 2147483647 ||
      typeof value.amount01 !== 'number' || !Number.isFinite(value.amount01) || value.amount01 < 0 || value.amount01 > 1) fail();
  return Object.freeze({ version: 1, worldId: value.worldId, generation: value.generation, actorId: value.actorId,
    patchId: value.patchId, patchRevision: value.patchRevision, seed: value.seed, amount01: value.amount01 });
}
/** @param {unknown} value @param {number} maximum @returns {readonly ActorTimbreLock[]} */
export function validateActorTimbreLocks(value = EMPTY_ACTOR_TIMBRE_LOCKS, maximum = MAX_ACTOR_TIMBRE_LOCKS) {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_ACTOR_TIMBRE_LOCKS || !Array.isArray(value) || value.length > maximum) fail();
  if (locks.has(value)) return value;
  const seen = new Set(), counts = new Map();
  const result = value.map(entry => {
    const lock = validateActorTimbreLock(entry), actor = actorTimbreIdentityKey(lock), key = JSON.stringify([actor, actorTimbrePatchKey(lock)]);
    if (seen.has(key) || (counts.get(actor) || 0) >= MAX_ACTOR_PATCH_LOCKS) fail();
    seen.add(key); counts.set(actor, (counts.get(actor) || 0) + 1); return lock;
  }).sort((a, b) => {
    const left = JSON.stringify([actorTimbreIdentityKey(a), actorTimbrePatchKey(a)]), right = JSON.stringify([actorTimbreIdentityKey(b), actorTimbrePatchKey(b)]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  Object.freeze(result); locks.add(result); return result;
}
/** @param {readonly ActorTimbreLock[] | undefined} source @param {unknown} identity @returns {readonly ActorTimbreLock[] | null} */
export function actorTimbreLocksFor(source, identity) {
  if (!source?.length || !plain(identity) || !text(identity.worldId, 160) || !integer(identity.generation) || !actorId(identity.actorId)) return null;
  const qualified = validateActorTimbreLocks(source);
  let index = indexes.get(qualified);
  if (!index) {
    /** @type {Map<string, ActorTimbreLock[]>} */
    const building = new Map();
    for (const lock of qualified) { const key = actorTimbreIdentityKey(lock), entries = building.get(key) || []; entries.push(lock); building.set(key, entries); }
    index = new Map([...building].map(([key, entries]) => { const selected = Object.freeze(entries); locks.add(selected); return [key, selected]; }));
    indexes.set(qualified, index);
  }
  return index.get(actorTimbreIdentityKey({ worldId: identity.worldId, generation: identity.generation, actorId: identity.actorId })) || null;
}
/** @template T @param {T} controls @param {readonly ActorTimbreLock[] | undefined} source @param {unknown} identity */
export function actorTimbreControls(controls, source, identity) {
  if (controls == null) return controls;
  const selected = actorTimbreLocksFor(source, identity);
  return selected ? Object.assign({}, controls, { actorTimbreLocks: selected }) : controls;
}
