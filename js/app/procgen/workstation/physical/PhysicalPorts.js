import { plain, identity, integer, freeze } from './PhysicalSchema.js';
const ACTIONS = ['walk', 'falling', 'floating', 'blocking', 'building', 'bashing', 'digging', 'mining', 'climbing', 'hoist', 'jump'];
export function validatePhysicalPort(value) {
  if (!plain(value) || !identity(value.id) || value.id.length > 128 || !['inlet', 'outlet'].includes(value.role) || !['left', 'right', 'either'].includes(value.direction) || !plain(value.position) || ![value.position.x, value.position.y].every(Number.isSafeInteger) || Math.abs(value.position.x) > 1e9 || Math.abs(value.position.y) > 1e9) throw new Error('Invalid physical port.');
  const actions = value.actions ?? ['walk'], abilities = value.abilities ?? { climb: false, parachute: false }, support = value.support ?? [];
  if (!Array.isArray(actions) || !actions.length || actions.length > ACTIONS.length || new Set(actions).size !== actions.length || actions.some(action => !ACTIONS.includes(action)) || !plain(abilities) || Object.keys(abilities).some(key => !['climb', 'parachute'].includes(key)) || typeof abilities.climb !== 'boolean' || typeof abilities.parachute !== 'boolean' || !Array.isArray(support) || support.length > 64 || support.some(cell => !plain(cell) || !Number.isSafeInteger(cell.dx) || !Number.isSafeInteger(cell.dy) || Math.abs(cell.dx) > 32 || Math.abs(cell.dy) > 32 || typeof cell.solid !== 'boolean')) throw new Error('Invalid physical port entry envelope.');
  const crew = value.crew ?? { min: 1, max: 1, minimumSpacingPixels: 0, maximumSpacingPixels: 64 };
  if (!plain(crew) || !integer(crew.min, 64) || crew.min < 1 || !integer(crew.max, 64) || crew.max < crew.min || !integer(crew.minimumSpacingPixels, 1024) || !integer(crew.maximumSpacingPixels, 1024) || crew.maximumSpacingPixels < crew.minimumSpacingPixels) throw new Error('Invalid physical port crew range.');
  const timing = value.traversalEnvelope ?? null;
  if (timing != null && (!plain(timing) || timing.status !== 'measured' || !integer(timing.minimumTicks, 1000000) || !integer(timing.maximumTicks, 1000000) || timing.maximumTicks < timing.minimumTicks || !identity(timing.evidenceId) || !Array.isArray(timing.testedInputs) || timing.testedInputs.length > 64 || timing.testedInputs.some(input => !plain(input) || !integer(input.crewSize, 64) || input.crewSize < 1 || !integer(input.spacingPixels, 1024) || !['left', 'right'].includes(input.direction)) )) throw new Error('Invalid declared traversal evidence.');
  return freeze({ version: 1, id: value.id, role: value.role, position: { x: value.position.x, y: value.position.y }, direction: value.direction,
    actions: [...actions], abilities: { ...abilities }, support: support.map(cell => ({ dx: cell.dx, dy: cell.dy, solid: cell.solid })), crew: { min: crew.min, max: crew.max, minimumSpacingPixels: crew.minimumSpacingPixels, maximumSpacingPixels: crew.maximumSpacingPixels },
    traversalEnvelope: timing ? { status: 'measured', minimumTicks: timing.minimumTicks, maximumTicks: timing.maximumTicks, evidenceId: timing.evidenceId, testedInputs: timing.testedInputs.map(input => ({ crewSize: input.crewSize, spacingPixels: input.spacingPixels, direction: input.direction })), authority: 'captured-declaration-requires-source-qualified-replay' } : null });
}
export function validatePhysicalPorts(values = []) {
  if (!Array.isArray(values) || values.length > 16) throw new Error('Physical port capacity exceeded.');
  const ports = values.map(validatePhysicalPort); if (new Set(ports.map(port => port.id)).size !== ports.length) throw new Error('Duplicate physical port.'); return freeze(ports);
}
export function alignPhysicalPorts(outlet, inlet) {
  const a = validatePhysicalPort(outlet), b = validatePhysicalPort(inlet);
  const reasons = [];
  if (a.role !== 'outlet' || b.role !== 'inlet') reasons.push('port-role');
  if (a.position.x !== b.position.x || a.position.y !== b.position.y) reasons.push('position-mismatch');
  if (a.direction !== 'either' && b.direction !== 'either' && a.direction !== b.direction) reasons.push('direction-mismatch');
  if (!a.actions.every(action => b.actions.includes(action))) reasons.push('action-mismatch');
  if (a.abilities.climb !== b.abilities.climb || a.abilities.parachute !== b.abilities.parachute) reasons.push('ability-mismatch');
  if (a.crew.min < b.crew.min || a.crew.max > b.crew.max || a.crew.minimumSpacingPixels < b.crew.minimumSpacingPixels || a.crew.maximumSpacingPixels > b.crew.maximumSpacingPixels) reasons.push('crew-envelope-mismatch');
  for (const required of b.support) { const supplied = a.support.find(cell => cell.dx === required.dx && cell.dy === required.dy); if (!supplied || supplied.solid !== required.solid) { reasons.push('support-mismatch'); break; } }
  return freeze({ status: reasons.length ? 'unqualified' : 'compatible-declaration', reasons, passageGuaranteed: false, timingPreserved: false });
}
