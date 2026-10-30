export const routeStateMutations = [
  ['route-revision', state => { state.routeRevision++; }], ['branch', state => { state.branchId = 'foreign'; }],
  ['segment-id', state => { state.segmentId = 'foreign'; }], ['segment-index', state => { state.segmentIndex = 999; }],
  ['negative-lap', state => { state.lapId = -1; }], ['fractional-lap', state => { state.lapId = 0.5; }], ['forged-lap', state => { state.lapId++; }],
  ['arc-offset', state => { state.sPixels++; }], ['negative-segment-s', state => { state.segmentS = -1; }], ['oversized-segment-s', state => { state.segmentS = 999999; }],
  ['direction', state => { state.direction = 0; }], ['world', state => { state.worldId = 'foreign'; }], ['generation', state => { state.generation++; }],
  ['status', state => { state.status = 'trusted'; }], ['last-position', state => { state.lastPosition = null; }], ['nonfinite-position', state => { state.lastPosition.x = NaN; }],
  ['missing-coordinate-proof', state => { delete state.coordinatePrecision; }], ['source-geometry', state => { state.geometrySource = 'guessed'; }],
  ['future-entry', state => { state.entryTick = state.observationTick + 1; }], ['negative-entry', state => { state.entryTick = -1; }],
  ['future-return', state => { state.lastReturnTick = state.observationTick + 1; }], ['negative-period', state => { state.periodTicks = -1; }],
  ['missing-lap-proof', state => { state.lastLapObservationId = null; }], ['missing-lap-sources', state => { state.lastLapSourceEventIds = []; }],
  ['empty-marker-history', state => { state.markerHistory = []; }], ['invalid-marker-history', state => { state.markerHistory = [{}]; }], ['unbounded-marker-history', state => { state.markerHistory = Array(66).fill('marker'); }],
  ['empty-source-events', state => { state.sourceEventIds = []; }], ['invalid-source-events', state => { state.sourceEventIds = [false]; }], ['entry-observation', state => { state.entryObservationId = ''; }],
  ['future-observation', state => { state.observationTick++; }], ['motion-sequence', state => { state.motionSourceSequence = 0.5; }], ['future-motion-tick', state => { state.motionSourceTick = state.observationTick + 1; }],
  ['future-previous-observation', state => { state.previousObservationTick = state.observationTick + 1; }], ['negative-previous-arc', state => { state.previousSPixels = -1; }]
];

export async function qualifyRouteStateRefusals({ graph, source, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ validateCausalInstrumentGraph }, { createRouteCoordinateAtlas }] = await Promise.all([
    import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('workstation/physical/RouteCoordinateAtlas.js', sourceRoot))]);
  const atlas = createRouteCoordinateAtlas(); atlas.configure(validateCausalInstrumentGraph(graph).routes); atlas.restore(JSON.parse(JSON.stringify(source)));
  const before = JSON.stringify(atlas.snapshot()), outcomes = [];
  const reject = (name, value) => { let reason = null; try { atlas.restore(value); } catch (error) { reason = error.message; } if (!reason || JSON.stringify(atlas.snapshot()) !== before) throw new Error('Route state refusal was not transactional: ' + name); outcomes.push({ name, reason, unchanged: true }); };
  for (const [name, mutate] of routeStateMutations) { const value = JSON.parse(before); mutate(value.trackers[0]); reject(name, value); }
  for (const [name, mutate] of [
    ['foreign-boundary', value => { value.boundary = 'foreign:1'; }], ['missing-current-tick', value => { value.currentTick = -1; }],
    ['duplicate-tracker', value => { value.trackers.push(value.trackers[0]); }],
    ['duplicate-invalid-route', value => { value.invalid = [[value.trackers[0].routeId, []], [value.trackers[0].routeId, []]]; }],
    ['unknown-invalid-segment', value => { value.invalid = [[value.trackers[0].routeId, ['foreign']]]; }],
    ['qualified-invalidated-segment', value => { value.invalid = [[value.trackers[0].routeId, [value.trackers[0].segmentId]]]; }]
  ]) { const value = JSON.parse(before); mutate(value); reject(name, value); }
  const unqualified = JSON.parse(before); unqualified.trackers[0].status = 'off-route'; atlas.restore(unqualified);
  if (atlas.coordinate(unqualified.trackers[0].actorId, unqualified.trackers[0].routeId).status !== 'off-route') throw new Error('Unknown route history became qualified.');
  atlas.restore(JSON.parse(before)); const tracker = source.trackers[0], oldCoordinate = JSON.stringify(atlas.coordinate(tracker.actorId, tracker.routeId));
  atlas.configure(validateCausalInstrumentGraph({ ...graph, routes: graph.routes.map(route => ({ ...route, requestedPeriodTicks: route.requestedPeriodTicks + 1 })) }).routes);
  if (JSON.stringify(atlas.coordinate(tracker.actorId, tracker.routeId)) !== oldCoordinate || atlas.periods().rows.find(row => row.routeId === tracker.routeId).periodErrorTicks !== tracker.periodTicks - graph.routes.find(route => route.id === tracker.routeId).requestedPeriodTicks - 1) throw new Error('Requested period annotation reset actual traversal state.');
  return { rejected: outcomes.length, outcomes, sourceUnchanged: JSON.stringify(source) === before, unqualifiedRemainsUnknown: true, requestedMetadataRetainsPhase: true };
}
