import { validatePhysicalJunction } from '../app/procgen/PhysicalJunctions.js';
import { qualifyProcgenRouteContract } from './ProcgenRouteQualification.js';
import { ProcgenSolverAdapter } from './ProcgenSolverAdapter.js';
const inside = (point, rect) => point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
export function qualifyPhysicalJunctionRoutes(input, cases, createAdapter, options = {}) {
  const definition = validatePhysicalJunction(input);
  if (!Array.isArray(cases) || !cases.length || cases.length > 64 || typeof createAdapter !== 'function') throw new Error('Junction qualification needs bounded real-runtime cases.');
  const results = cases.map((sample, caseIndex) => {
    const config = definition.configurations.find(value => value.id === sample.configurationId), inlet = definition.ports.find(value => value.id === sample.inletId && value.role === 'inlet'), outlet = definition.ports.find(value => value.id === sample.outletId && value.role === 'outlet');
    if (!config || !inlet || !outlet || !config.outletIds.includes(outlet.id) || !inside(inlet.position, sample.contract?.geometry?.entry || {}) || !inside(outlet.position, sample.contract?.geometry?.exit || {})) throw new Error('Qualification case does not bind declared physical ports.');
    let observedEntry = null;
    const result = qualifyProcgenRouteContract(sample.contract, () => {
      const adapter = createAdapter(config, sample, caseIndex);
      try {
        if (!(adapter instanceof ProcgenSolverAdapter)) throw new Error('Junction qualification requires the actual procgen solver adapter.');
        const world = adapter.world, actors = world.actors.filter(actor => !actor.removed && !actor.failureReason && !actor.terminalReason && actor.action?.actionName !== 'blocking');
        if (actors.length < inlet.crew.min || actors.length > inlet.crew.max || actors.some(actor => !inlet.actions.includes(actor.action?.actionName) || !!actor.canClimb !== inlet.abilities.climb || !!actor.hasParachute !== inlet.abilities.parachute || inlet.direction !== 'either' && actor.lookRight !== (inlet.direction === 'right'))) throw new Error('Actual inlet action, ability, direction or crew range is unsupported.');
        const sorted = actors.map(actor => actor.x).sort((a, b) => a - b), spacings = sorted.slice(1).map((x, index) => x - sorted[index]);
        if (spacings.some(value => value < inlet.crew.minimumSpacingPixels || value > inlet.crew.maximumSpacingPixels)) throw new Error('Actual crew spacing is outside the port envelope.');
        for (const span of config.spans) for (let x = span.x1; x < span.x2; x++) if (world.hasGroundAt(x, span.y) !== span.solid) throw new Error('Actual world does not contain the requested junction configuration.');
        for (const port of [inlet, outlet]) for (const cell of port.support) if (world.hasGroundAt(port.position.x + cell.dx, port.position.y + cell.dy) !== cell.solid) throw new Error('Actual port support differs from its declaration.');
        observedEntry = { crewSize: actors.length, direction: actors[0]?.lookRight ? 'right' : 'left', spacingPixels: spacings, actions: [...new Set(actors.map(actor => actor.action.actionName))], geometryRevision: world.terrainRevision };
        return adapter;
      } catch (error) { adapter?.dispose?.(); throw error; }
    }, { maxTicks: 4096, maxNodes: 128, ...options });
    return { caseIndex, configurationId: config.id, inletId: inlet.id, outletId: outlet.id, observedEntry, qualification: result.qualification,
      declaredTraversalEnvelope: inlet.traversalEnvelope, actualReplay: result.verificationResult, timingEquivalenceAssumed: false };
  });
  return { schema: 'physical-junction-qualification/v1', junctionId: definition.id, authoringRevision: definition.revision,
    status: results.every(result => result.qualification.status === 'engine-qualified') ? 'qualified-tested-cases' : 'unqualified',
    untestedConfigurations: definition.configurations.filter(config => !results.some(result => result.configurationId === config.id)).map(config => config.id),
    claimsUntestedInputs: false, results };
}
