export async function qualifyRouteMarkerBindings({ graph, source, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ validateCausalInstrumentGraph }, { createRouteCoordinateAtlas }] = await Promise.all([
    import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('workstation/physical/RouteCoordinateAtlas.js', sourceRoot))]);
  const check = (value, message) => { if (!value) throw new Error('Marker binding: ' + message); }, clone = value => JSON.parse(JSON.stringify(value));
  const prepare = value => validateCausalInstrumentGraph(value).routes, fresh = () => { const atlas = createRouteCoordinateAtlas(); atlas.configure(prepare(graph)); atlas.restore(clone(source)); return atlas; };
  const results = [], baseline = JSON.stringify(source), actor = source.trackers[0], other = source.trackers.find(value => value.routeId !== actor.routeId);
  check(actor && other && source.version === 2, 'needs real observed marker-bound two-route history');
  const edits = [
    ['geometry', gate => { gate.geometry.points.forEach(point => point.x++); }], ['lane-scope', gate => { gate.laneScope = [1]; }],
    ['direction', gate => { gate.directionPolicy = 'negative'; }], ['bypass', gate => { gate.bypass = true; }], ['hysteresis', gate => { gate.hysteresis = 1; }],
    ['trigger', gate => { gate.geometry = { kind: 'band', bounds: { x1: 40, x2: 42, y1: 70, y2: 84 } }; gate.trigger = 'enter'; }]
  ];
  for (const [name, edit] of edits) {
    const atlas = fresh(), changed = clone(graph); edit(changed.pickups[0]); changed.pickups[0].revision++; changed.revision++;
    atlas.configure(prepare(changed)); check(atlas.coordinate(actor.actorId, actor.routeId) === null, name + ' retained stale qualified history');
    check(JSON.stringify(atlas.coordinate(other.actorId, other.routeId)) === JSON.stringify(fresh().coordinate(other.actorId, other.routeId)), name + ' disturbed independent route');
    const before = JSON.stringify(atlas.snapshot()); let refused = false; try { atlas.restore(clone(source)); } catch { refused = true; }
    check(refused && JSON.stringify(atlas.snapshot()) === before, name + ' accepted incompatible saved history'); results.push({ name, invalidatedOnlyDependentRoute: true, restoreRefused: true });
  }
  for (const [name, edit] of [['pitch', gate => { gate.pitchMap = { mode: 'fixed', baseCents: 7200 }; }], ['metadata-revision', () => {}]]) {
    const atlas = fresh(), changed = clone(graph); edit(changed.pickups[0]); changed.pickups[0].revision++; changed.revision++; atlas.configure(prepare(changed));
    check(JSON.stringify(atlas.snapshot()) === baseline, name + ' reset physical phase'); results.push({ name, phasePreserved: true });
  }
  const atlas = fresh(), before = JSON.stringify(atlas.snapshot());
  for (const unbound of [clone(prepare(graph)), prepare(graph).map(route => ({ ...route, markerSignature: source.signatures[0][1] }))]) {
    let refused = false; try { atlas.configure(unbound); } catch { refused = true; } check(refused && JSON.stringify(atlas.snapshot()) === before, 'unbound configuration was accepted or partially applied');
  }
  const oldObserved = clone(source); oldObserved.version = 1; oldObserved.signatures = oldObserved.signatures.map(([id, value]) => [id, value.split('\0')[0]]);
  let legacyRefused = false; try { atlas.restore(oldObserved); } catch { legacyRefused = true; } check(legacyRefused && JSON.stringify(atlas.snapshot()) === before, 'unbound legacy observation accepted');
  const oldEmpty = { ...oldObserved, trackers: [], invalid: [] }; atlas.restore(oldEmpty); check(atlas.coordinate(actor.actorId, actor.routeId) === null && atlas.snapshot().version === 2, 'empty legacy upgrade inferred a route pose');
  check(JSON.stringify(source) === baseline, 'source modified');
  return { edits: results, unboundDefinitionsRefused: 2, observedLegacyRefused: true, emptyLegacyUpgradedWithoutGuess: true, nativeJsonRoundTrip: true, sourceUnchanged: true };
}
