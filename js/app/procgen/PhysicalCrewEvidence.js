import { identity, integer, plain } from './workstation/physical/PhysicalSchema.js';
export const createPhysicalCrewEvidence = () => ({ version: 1, generation: null, projects: new Map(), censored: 0 });
const owner = world => {
  const state = world.physicalCrewEvidence ||= createPhysicalCrewEvidence();
  if (state.generation !== world.generation) { state.projects.clear(); state.generation = world.generation; state.censored = 0; } return state;
};
export function recordPhysicalCrewFact(world, project, kind, actorId = project.ownerId) {
  const state = owner(world); let evidence = state.projects.get(project.id);
  if (!evidence) { if (state.projects.size >= 128) { state.censored++; return null; } evidence = { roots: [], arrivals: new Map(), complete: kind === 'CrewRouteOpened' }; state.projects.set(project.id, evidence); }
  const receipt = world.soundEvents?.emitPhysicalFact?.({ kind, crewProjectId: project.id, actorId, laneId: project.lane, routeKind: project.kind, positionAfter: { x: project.goalX ?? project.startX, y: project.goalY ?? project.startY }, admittedCrew: project.members.size, routeRevisionsUnchanged: kind === 'CrewRouteConnected' ? true : undefined });
  if (!receipt?.eventId || evidence.roots.length >= 66) { evidence.complete = false; return null; }
  evidence.roots.push(receipt.eventId);
  if (kind === 'CrewMemberArrived') evidence.arrivals.set(actorId, receipt.eventId);
  return receipt;
}
export function finishPhysicalCrewEvidence(world, project, reason = null) {
  const state = owner(world), evidence = state.projects.get(project.id), participants = [...project.members.keys()].sort((a, b) => a - b);
  const complete = !reason && evidence?.complete && evidence.arrivals.size === participants.length && participants.every(id => evidence.arrivals.has(id)) && evidence.roots.length === participants.length + 2;
  const receipt = world.soundEvents?.emitPhysicalFact?.({ kind: reason ? 'RouteFailed' : 'RouteCompleted', completionId: `${world.worldId}:${project.generation}:crew:${project.id}:${project.startTick}`, crewProjectId: project.id,
    actorId: project.ownerId, laneId: project.lane, participants, admittedCrew: participants.length, completionCoverage: complete ? 'complete' : 'incomplete', prerequisiteSourceEventIds: evidence?.roots || [],
    reason, routeRevisionsUnchanged: !reason, positionAfter: { x: project.goalX ?? project.startX, y: project.goalY ?? project.startY }, sourceStartTick: project.startTick, connectionTick: project.connectionTick ?? null });
  state.projects.delete(project.id); return receipt;
}
export function discardPhysicalCrewEvidence(world, projectId) { owner(world).projects.delete(projectId); }
export function validatePhysicalCrewEvidence(value, generation) {
  if (value == null) return createPhysicalCrewEvidence();
  if (!plain(value) || value.version !== 1 || value.generation != null && value.generation !== generation || !(value.projects instanceof Map) || value.projects.size > 128 || !integer(value.censored)) throw new Error('Invalid physical crew evidence owner.');
  for (const [id, evidence] of value.projects) {
    if (!identity(id) || !plain(evidence) || !Array.isArray(evidence.roots) || evidence.roots.length > 66 || evidence.roots.some(id => !identity(id)) || new Set(evidence.roots).size !== evidence.roots.length || !(evidence.arrivals instanceof Map) || evidence.arrivals.size > 64 || typeof evidence.complete !== 'boolean') throw new Error('Invalid crew prerequisite evidence.');
    for (const [actorId, root] of evidence.arrivals) if (!integer(actorId) || !evidence.roots.includes(root)) throw new Error('Invalid crew arrival evidence.');
  }
  return value;
}
