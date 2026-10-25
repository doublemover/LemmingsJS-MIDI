const cache = new WeakMap();
export function recordBirthCohortSlot(world, laneId, actor = null, reason = null) {
  const startTick = world.cohorts ? world.population.cohortStartTick : world.generationStartTick;
  const id = `${world.worldId}:${world.generation}:cohort:${startTick}`;
  const records = world.birthCohortRecords ||= [];
  let cohort = records.find(record => record.id === id);
  if (!cohort) { cohort = { id, generation: world.generation, scheduledTick: startTick, expectedSlots: world.laneCount, slots: [], status: 'partial' }; records.push(cohort); if (records.length > 32) records.shift(); }
  if (cohort.slots.some(slot => slot.laneId === laneId)) return id;
  cohort.slots.push({ laneId, tick: world.tickIndex, actorId: actor?.id ?? null, status: actor ? 'admitted' : 'missed', reason: actor ? null : reason || 'admission-unavailable' });
  cohort.slots.sort((a, b) => a.laneId - b.laneId); cohort.status = cohort.slots.length === cohort.expectedSlots ? 'complete' : 'partial';
  world.birthCohortRevision = (world.birthCohortRevision || 0) + 1;
  return id;
}
export function completedBirthCohorts(world) {
  const previous = cache.get(world);
  if (previous?.revision === world.birthCohortRevision && previous.generation === world.generation) return previous.records;
  const records = Object.freeze((world.birthCohortRecords || []).map(record => Object.freeze({ ...record, slots: Object.freeze(record.slots.map(slot => Object.freeze({ ...slot }))) })));
  cache.set(world, { revision: world.birthCohortRevision, generation: world.generation, records }); return records;
}
export function attachCrewOrigin(world, actor, projectId) {
  const id = `${world.worldId}:crew:${projectId}`;
  actor.crewOriginIds ||= [];
  if (!actor.crewOriginIds.includes(id)) { if (actor.crewOriginIds.length >= 16) actor.crewOriginComplete = false; else actor.crewOriginIds.push(id); }
  return id;
}
