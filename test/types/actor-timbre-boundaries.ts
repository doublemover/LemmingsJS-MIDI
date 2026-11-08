import { validateActorTimbreLocks, validateActorTimbreLock, actorTimbreLocksFor } from '../../js/midi/content/InstrumentActorLocks.js';
import type { ActorTimbreLock } from '../../js/midi/content/InstrumentActorLocks.js';
import type { PhysicalPlaybackOptions } from '../../js/app/procgen/workstation/PhysicalPlaybackContracts.js';
declare const lock: ActorTimbreLock;
const locks = validateActorTimbreLocks([lock]);
const restored: ActorTimbreLock = validateActorTimbreLock(JSON.parse('{}'));
const selected = actorTimbreLocksFor(locks, { worldId: lock.worldId, generation: lock.generation, actorId: lock.actorId });
void restored; void selected;
// @ts-expect-error Lock schema version is exact.
const wrongVersion: ActorTimbreLock = { ...lock, version: 2 };
// @ts-expect-error Seed values are numeric.
const wrongSeed: ActorTimbreLock = { ...lock, seed: 'seed' };
// @ts-expect-error Birth identity is required for a lock.
const missingActor: ActorTimbreLock = { version: 1, worldId: 'world', generation: 1, patchId: 'sound', patchRevision: 1, seed: 1, amount01: 1 };
// @ts-expect-error Published locks are immutable.
locks[0].seed = 3;
// @ts-expect-error Published lock collections cannot acquire another owner entry.
locks.push(lock);
declare const options: PhysicalPlaybackOptions;
// @ts-expect-error Playback lock providers are synchronous, bounded state readers.
const asyncProvider: PhysicalPlaybackOptions = { ...options, getActorTimbreLocks: async () => locks };
void wrongVersion; void wrongSeed; void missingActor; void asyncProvider;
