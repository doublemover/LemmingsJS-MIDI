import { expect } from 'chai';
import { createProcgenPresentationSnapshot, readProcgenCanvasRect, procgenScreenToWorld, procgenWorldToScreen, hitProcgenPresentation, overlapsProcgenPresentation, procgenPresentationStats } from '../js/app/procgen/ProcgenPresentationSnapshot.js';

const make = (options = {}) => createProcgenPresentationSnapshot({ worldId: 'world', generation: 2, tick: 50, terrainRevision: 3, revision: 7,
  rect: { left: 31, top: 47, width: 400, height: 304 }, backingSize: { width: 1200, height: 912 }, logicalSize: { width: 800, height: 608 }, originX: 100,
  viewWidth: 400, laneHeight: 96, layoutKey: 'strip:2:2:304:16', rows: [
    { lane: 2, sourceY: 210, sourceHeight: 72, destinationY: 0, destinationHeight: 288 },
    { lane: 3, sourceY: 300, sourceHeight: 72, destinationY: 304, destinationHeight: 288 }
  ], ...options });

describe('ProcGen immutable presented projection', () => {
  it('keeps control hit rectangles clear of actors and gates using the bounded spatial index', () => {
    const snapshot = make({ entities: [{ id: 'actor', kind: 'actor', bounds: { x: 200, y: 230, width: 10, height: 10 } },
      { id: 'gate', kind: 'gate', bounds: { x: 300, y: 240, width: 10, height: 10 } }, { id: 'wide', kind: 'zone', bounds: { x: 100, y: 210, width: 400, height: 70 } }] });
    const actor = procgenWorldToScreen(snapshot, 205, 235, 2), gate = procgenWorldToScreen(snapshot, 305, 245, 2);
    expect(overlapsProcgenPresentation(snapshot, { left: actor.x - 2, top: actor.y - 2, width: 4, height: 4 })).to.equal(true);
    expect(overlapsProcgenPresentation(snapshot, { left: gate.x - 2, top: gate.y - 2, width: 4, height: 4 })).to.equal(true);
    expect(overlapsProcgenPresentation(snapshot, { left: 32, top: 48, width: 10, height: 10 })).to.equal(false);
    expect(overlapsProcgenPresentation(snapshot, { left: 32, top: 48, width: 10, height: 10 }, ['zone'])).to.equal(true);
    expect(overlapsProcgenPresentation(snapshot, { left: 0, top: 0, width: 1e6, height: 1e6 })).to.equal(true);
    expect(procgenPresentationStats(snapshot).queryVisits).to.be.below(20);
  });
  it('maps CSS-scaled logical content and cropped rows at fractional DPR without DPR input arithmetic', () => {
    const snapshot = make();
    expect(procgenScreenToWorld(snapshot, 31, 47)).to.include({ x: 100, y: 210, lane: 2 });
    expect(procgenScreenToWorld(snapshot, 231, 123)).to.include({ x: 300, y: 248, lane: 2 });
    expect(procgenScreenToWorld(snapshot, 31, 199)).to.include({ x: 100, y: 300, lane: 3 });
    expect(procgenScreenToWorld(snapshot, 431, 47)).to.equal(null);
    expect(procgenScreenToWorld(snapshot, 31, 195)).to.equal(null);
    expect(procgenScreenToWorld(snapshot, 31, 347)).to.equal(null);
    expect(procgenWorldToScreen(snapshot, 120, 200, 2)).to.equal(null);
    expect(procgenWorldToScreen(null, 120, 200)).to.equal(null);
  });
  it('round trips every accepted row corner and center within 0.001 CSS pixel', () => {
    for (const dpr of [1, 1.25, 1.5, 2]) for (const zoom of [0.5, 1, 2]) {
      const snapshot = make({ backingSize: { width: 800 * dpr, height: 608 * dpr }, viewWidth: 400 / zoom });
      for (const row of snapshot.rows) for (const fx of [0, 0.5, 0.999999]) for (const fy of [0, 0.5, 0.999999]) {
        const x = snapshot.originX + fx * snapshot.viewWidth, y = row.sourceY + fy * row.sourceHeight;
        const point = procgenWorldToScreen(snapshot, x, y, row.lane), world = procgenScreenToWorld(snapshot, point.x, point.y), back = procgenWorldToScreen(snapshot, world.x, world.y, world.lane);
        expect(world.x).to.be.closeTo(x, 1e-7); expect(world.y).to.be.closeTo(y, 1e-7);
        expect(Math.hypot(point.x - back.x, point.y - back.y)).to.be.below(0.001);
      }
    }
  });
  it('uses the translated/scaled border and padding content box', () => {
    const canvas = { offsetWidth: 840, offsetHeight: 648, getBoundingClientRect: () => ({ left: 10, top: 20, width: 420, height: 324 }) };
    const window = { getComputedStyle: () => ({ borderLeftWidth: '4px', borderRightWidth: '4px', borderTopWidth: '4px', borderBottomWidth: '4px', paddingLeft: '16px', paddingRight: '16px', paddingTop: '16px', paddingBottom: '16px' }) };
    expect(readProcgenCanvasRect(canvas, window)).to.deep.equal({ left: 20, top: 30, width: 400, height: 304 });
    canvas.checkVisibility = () => false; expect(readProcgenCanvasRect(canvas, window)).to.equal(null);
  });
  it('rejects zero/nonfinite extents and ambiguous overlapping rows', () => {
    for (const width of [0, NaN, Infinity]) expect(make({ rect: { left: 0, top: 0, width, height: 304 } })).to.equal(null);
    expect(make({ rows: [{ lane: 1, sourceY: 96, sourceHeight: 96, destinationY: 0, destinationHeight: 200 }, { lane: 2, sourceY: 192, sourceHeight: 96, destinationY: 100, destinationHeight: 200 }] })).to.equal(null);
  });
  it('freezes actor primitives and resolves crowded identities in stable actor-ID order', () => {
    const bounds = { x: 200, y: 230, width: 10, height: 10 }, entities = [9, 2, 5].map(actorId => ({ id: `2:actor:${actorId}`, actorId, kind: 'actor', bounds }));
    entities.push({ id: 'contact', kind: 'contact', bounds });
    const snapshot = make({ entities }); bounds.x = 0;
    const point = procgenWorldToScreen(snapshot, 205, 235, 2);
    expect(hitProcgenPresentation(snapshot, point.x, point.y).map(entity => entity.id)).to.deep.equal(['2:actor:2', '2:actor:5', '2:actor:9', 'contact']);
    expect(Object.isFrozen(snapshot)).to.equal(true); expect(Object.isFrozen(snapshot.entities[0].bounds)).to.equal(true);
    expect(snapshot.entities[0].bounds.x).to.equal(200); expect(snapshot.physicalTick).to.equal(50); expect(snapshot.capabilities.edit).to.equal(false);
  });
  it('indexes visible entities without iterating unbounded world lane ranges', () => {
    const entities = Array.from({ length: 1200 }, (_, index) => ({ id: `a${index}`, kind: 'actor', bounds: { x: 100 + index % 40 * 10, y: 210 + Math.floor(index / 40) * 2, width: 2, height: 1 } }));
    entities.push({ id: 'huge', kind: 'zone', bounds: { x: -1e308, y: -1e308, width: 1.79e308, height: 1.79e308 } });
    const snapshot = make({ entities }), point = procgenWorldToScreen(snapshot, 101, 211, 2);
    hitProcgenPresentation(snapshot, point.x, point.y);
    expect(procgenPresentationStats(snapshot).queryVisits).to.be.below(100);
    expect(procgenPresentationStats(snapshot).wideEntities).to.equal(1);
  });
});
