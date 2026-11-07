import { validatePhysicalJunction } from '../PhysicalJunctions.js';
export function validateProjectJunctions(values = []) {
  if (!Array.isArray(values) || values.length > 64) throw new Error('Project junction capacity exceeded.');
  const definitions = values.map(validatePhysicalJunction);
  if (new Set(definitions.map(value => value.id)).size !== definitions.length || JSON.stringify(definitions).length * 2 > 524288) throw new Error('Project junction identity or byte capacity exceeded.');
  return Object.freeze(definitions);
}
export function prepareProjectJunctions(world, values) {
  const desired = validateProjectJunctions(values), current = world.physicalJunctions.definitions;
  const ids = new Set([...current.map(value => value.id), ...desired.map(value => value.id), ...world.interventionState.pending.filter(command => command.kind === 'junction-define').map(command => command.parameters.definition.junctionId)]), commands = [];
  const transactionId = `junction-author:${world.generation}:${world.tickIndex}:${world.interventionState.sequence + 1}`;
  for (const id of [...ids].sort()) {
    const before = current.find(value => value.id === id), after = desired.find(value => value.id === id), pending = world.interventionState.pending.find(command => command.kind === 'junction-define' && command.parameters.definition.junctionId === id);
    if (!pending && JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue;
    commands.push({ id: `${transactionId}:${commands.length}`, kind: 'junction-define', transactionId, origin: 'manual', target: { generation: world.generation },
      parameters: { definition: { operation: after ? 'upsert' : 'remove', junctionId: id, expectedRevision: before?.revision ?? null, definition: after ?? null, replacePending: true } } });
  }
  if (!commands.length) return { status: 'prepared', commands: [], commit: () => [] };
  const proposal = world.prepareInterventions(commands); if (proposal.status !== 'prepared') throw new Error('Junction authoring inputs were not admitted.');
  return { ...proposal, commands };
}
