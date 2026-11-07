import assert from 'node:assert/strict';
import { validateObservedSampleGesture, resolveObservedSampleGesture } from '../js/midi/content/ObservedSampleGesture.js';

describe('verified work-cell sample articulations', () => {
  const map = validateObservedSampleGesture({ schema: 'lemmings-observed-sample-gesture/v1', id: 'gesture', revision: 1, source: 'verified-work-material-cell', unknownPolicy: 'omit-source', regions: [{ gesture: 'muted', bounds: { x1: 0, x2: 128, y1: 0, y2: 128 } }, { gesture: 'muted-edge', bounds: { x1: 128, x2: 512, y1: 0, y2: 128 } }] }),
    batch = { worldId: 'world', generation: 2, tick: 10, completeness: { status: 'complete' } },
    fact = x => ({ kind: 'TerrainWorkCommitted', operationKind: 'build', outcome: 'changed', worldId: 'world', generation: 2, observedTick: 10, actorId: 3, eventId: 'work:one', causalSequence: 30, workOperationId: 'op:one',
      physicalPayload: { changedSolidCells: 4, sourceEditRevisionBefore: 8, sourceEditRevisionAfter: 9, terrainEdit: { completeness: 'complete', worldId: 'world', generation: 2, workOperationId: 'op:one', editId: 'edit:one', revisionBefore: 8, revisionAfter: 9,
        materialObservation: { schema: 'lemmings-terrain-work-material/v1', status: 'complete', aggregation: 'consensus-of-all-changed-solid-cells', changedSolidCells: 4, phase: 'added-solid-after-edit', revision: 9, sourceCell: { x, y: 100 }, sourceEditIds: ['edit:one'] } } } });
  it('uses the verified changed cell with half-open region boundaries and complete ancestry', () => {
    assert.equal(resolveObservedSampleGesture(map, batch, fact(127)).gesture, 'muted');
    const edge = resolveObservedSampleGesture(map, batch, fact(128)); assert.equal(edge.gesture, 'muted-edge'); assert.equal(edge.sourceEventId, 'work:one'); assert.equal(edge.surfaceRevision, 9); assert.deepEqual(edge.sourceCell, { x: 128, y: 100 });
    assert.equal(resolveObservedSampleGesture(map, batch, fact(512)), null);
  });
  it('omits unknown or incomplete work without an inferred neutral sample', () => {
    const unknown = fact(80); delete unknown.physicalPayload.terrainEdit.materialObservation;
    assert.equal(resolveObservedSampleGesture(map, batch, unknown), null); assert.equal(resolveObservedSampleGesture(map, { ...batch, completeness: { status: 'partial' } }, fact(80)), null);
    const stale = fact(80); stale.physicalPayload.terrainEdit.workOperationId = 'another'; assert.equal(resolveObservedSampleGesture(map, batch, stale), null);
    assert.throws(() => validateObservedSampleGesture({ ...map, regions: [...map.regions, { gesture: 'center', bounds: { x1: 100, x2: 200, y1: 10, y2: 20 } }] }));
  });
});
