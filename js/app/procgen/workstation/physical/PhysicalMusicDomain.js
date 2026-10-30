import { validatePickupGate, createPickupGateObserver, createPickupQueryPlan } from './PickupGates.js';
import { validateEnsembleDefinition, createEnsembleResolver } from './Ensembles.js';
import { validateRouteDefinition, createRouteCoordinateAtlas } from './RouteCoordinateAtlas.js';
import { boundedList, freeze } from './PhysicalSchema.js';

export const DERIVED_PHYSICAL_KINDS = Object.freeze(['PickupCrossing', 'RouteLap']);
export function validatePhysicalDomain(input) {
  const pickups = boundedList(input.pickups ?? [], 1024, validatePickupGate, 'pickups');
  const ensembles = boundedList(input.ensembles ?? [], 128, validateEnsembleDefinition, 'ensembles');
  const routes = boundedList(input.routes ?? [], 128, route => validateRouteDefinition(route, pickups), 'routes');
  for (const values of [pickups, ensembles, routes]) if (new Set(values.map(value => value.id)).size !== values.length) throw new Error('Duplicate physical object identity.');
  for (const pickup of pickups) if (pickup.ensembleId && !ensembles.some(ensemble => ensemble.id === pickup.ensembleId)) throw new Error('Pickup ensemble reference does not exist.');
  createPickupQueryPlan(pickups);
  return freeze({ pickups, ensembles, routes });
}
export function createPhysicalMusicDomain() {
  let pickups = createPickupGateObserver(), ensembles = createEnsembleResolver(), routes = createRouteCoordinateAtlas(), configured = null;
  let changed = new Set(), retired = [], enabled = false, last = null;
  const configure = graph => {
    configured = graph;
    enabled = !!(graph.pickups?.length || graph.ensembles?.length || graph.routes?.length);
    const result = pickups.configure(graph.pickups || []); changed = result.changed; retired = result.retired;
    ensembles.configure(graph.ensembles || []); routes.configure(graph.routes || []);
  };
  const observe = batch => {
    if (!enabled) return { facts: [], completeness: { status: 'complete' } };
    const result = pickups.observe(batch, undefined, changed); changed = new Set();
    const crossings = [...retired.map(state => ({ gateId: state.gateId, actorId: state.actorId, laneId: state.laneId, transition: 'exit', occupancy: true,
      reason: 'pickup-edited', sourceEventIds: [], fraction: 0, observationId: `${batch.batchId}:pickup-retired:${state.gateId}:${state.actorId}` })), ...result.observations]; retired = [];
    const laps = routes.observe(batch, crossings.filter(crossing => crossing.sourceEventIds.length));
    const views = ensembles.observe(batch, routes.coordinate);
    const selected = crossings.filter(crossing => { const gate = configured.pickups?.find(value => value.id === crossing.gateId), membership = ensembles.membership(gate?.ensembleId, crossing.actorId); return crossing.transition === 'exit' || membership.status === 'complete' && membership.includes; });
    const fact = (observation, kind) => freeze({ ...observation, kind, eventId: observation.sourceEventIds[0] || null,
      subTick: observation.fraction ?? 0, precision: 'interpolated', observationPrecision: 'derived-endpoint-interpolation', derivedObservation: true,
      causalSequence: observation.causalSequence ?? batch.facts.at(-1)?.causalSequence ?? 0 });
    const facts = [...selected.map(value => fact(value, 'PickupCrossing')), ...laps.map(value => fact(value, 'RouteLap'))];
    last = freeze({ facts, completeness: result.completeness, ensembles: views, batchId: batch.batchId }); return last;
  };
  return { configure, observe, ensembleView: id => ensembles.view(id), membership: (...args) => ensembles.membership(...args), routeCoordinate: (...args) => routes.coordinate(...args), routeNeighbors: (...args) => routes.neighbors(...args), routePeriods: () => routes.periods(),
    reset() { pickups.reset(); routes.reset(); ensembles.resetDynamic(); last = null; },
    snapshot: () => freeze({ version: 1, pickups: pickups.snapshot(), ensembles: ensembles.snapshot(), routes: routes.snapshot() }),
    restore(value) { if (value?.version !== 1) throw new Error('Unsupported physical domain checkpoint.'); const p = createPickupGateObserver(), e = createEnsembleResolver(), r = createRouteCoordinateAtlas(); p.configure(configured.pickups || []); e.configure(configured.ensembles || []); r.configure(configured.routes || []); p.restore(value.pickups); e.restore(value.ensembles); r.restore(value.routes); pickups = p; ensembles = e; routes = r; changed.clear(); retired = []; },
    diagnostics: () => freeze({ pickups: pickups.diagnostics(), ensembles: ensembles.diagnostics(), routes: routes.diagnostics(), last }) };
}
