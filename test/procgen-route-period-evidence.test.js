import { expect } from 'chai';
import { describeRoutePeriods } from '../js/app/procgen/workstation/physical/RoutePeriodEvidence.js';
import { validateRouteDefinition, createRouteCoordinateAtlas } from '../js/app/procgen/workstation/physical/RouteCoordinateAtlas.js';

const row = (routeId, periodTicks, extra = {}) => ({ routeId, routeRevision: 1, branchId: 'corridor', actorId: 0, coordinateStatus: 'qualified', periodTicks, requestedPeriodTicks: periodTicks,
  lastCompletedLapTick: 481, sourceObservationId: 'actual:lap', sourceEventIds: ['actual:motion'], ...extra });
describe('completed route period evidence', () => {
  it('separates measured/requested periods, inverse frequency ratios and coincidence windows without changing motion', () => {
    const value = describeRoutePeriods([row('b', 160), row('a', 120, { requestedPeriodTicks: 121 })]);
    expect(value.rows.map(value => value.routeId)).to.deep.equal(['a', 'b']); expect(value.rows[0].periodErrorTicks).to.equal(-1);
    expect(value.comparisons[0].periodRatio.reduced).to.deep.equal([3, 4]); expect(value.comparisons[0].frequencyRatio.reduced).to.deep.equal([4, 3]);
    expect(value.comparisons[0].requestedPeriodRatio.reduced).to.deep.equal([121, 160]); expect(value.comparisons[0].periodLcmTicks).to.equal(480); expect(value.movementChanged).to.equal(false);
  });
  it('retains fractional measurements and refuses an unsafe integer coincidence claim', () => {
    const fractional = describeRoutePeriods([row('a', 1.5), row('b', 2.5)]); expect(fractional.comparisons[0].periodRatio.reduced).to.equal(null); expect(fractional.comparisons[0].periodLcmTicks).to.equal(null);
    const huge = describeRoutePeriods([row('a', 9007199254740991, { lastCompletedLapTick: 9007199254740991 }), row('b', 9007199254740989, { lastCompletedLapTick: 9007199254740989 })]); expect(huge.comparisons[0].periodLcmTicks).to.equal(null);
  });
  it('reports an empty or capped view without selecting an undisclosed first subset', () => {
    expect(describeRoutePeriods([]).status).to.equal('unobserved'); const capped = describeRoutePeriods(Array.from({ length: 129 }, (_, index) => row('r' + index, 120)));
    expect(capped).to.include({ status: 'capped', available: 129 }); expect(capped.rows).to.deep.equal([]); expect(capped.comparisons).to.deep.equal([]);
  });
  it('retains only bounded source fields and copies observation ancestry', () => {
    const input = row('a', 120, { privateActor: { action: 'live' }, requestedPeriodTicks: null }), value = describeRoutePeriods([input]); input.sourceEventIds.push('later');
    expect(value.rows[0]).not.to.have.property('privateActor'); expect(value.rows[0].sourceEventIds).to.deep.equal(['actual:motion']); expect(value.rows[0].periodErrorTicks).to.equal(null);
  });
  it('refuses zero, nonfinite, duplicate and incomplete source measurements', () => {
    for (const periodTicks of [0, -1, Infinity, NaN, Number.MIN_VALUE]) expect(() => describeRoutePeriods([row('a', periodTicks)])).to.throw('period');
    for (const extra of [{ routeRevision: -1 }, { sourceEventIds: [] }, { sourceObservationId: '' }, { actorId: 0.5 }, { requestedPeriodTicks: NaN }]) expect(() => describeRoutePeriods([row('a', 120, extra)])).to.throw('period');
    expect(() => describeRoutePeriods([row('a', 120), row('a', 120)])).to.throw('period'); expect(() => describeRoutePeriods([], { maxRows: 0 })).to.throw('capacity');
  });
  it('validates requested periods without treating an odd request as impossible for every physical system', () => {
    const pickups = [{ id: 'a' }, { id: 'b' }], route = { id: 'route', revision: 1, branchId: 'branch', markers: [{ gateId: 'a' }, { gateId: 'b' }], segments: [{ id: 'leg', path: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] };
    expect(validateRouteDefinition({ ...route, requestedPeriodTicks: 121 }, pickups).requestedPeriodTicks).to.equal(121);
    for (const requestedPeriodTicks of [0, -1, Infinity, NaN, '120']) expect(() => validateRouteDefinition({ ...route, requestedPeriodTicks }, pickups)).to.throw('requested route period');
  });
  it('keeps an exactly collinear 31/59 projection qualified at zero tolerance and rejects a whole pixel off the path', () => {
    const route = validateRouteDefinition({ id: 'line', revision: 1, branchId: 'left', tolerancePixels: 0, markers: [{ gateId: 'start' }, { gateId: 'end' }], segments: [{ id: 'leg', path: [{ x: 80, y: 80 }, { x: 21, y: 80 }] }] }, [{ id: 'start' }, { id: 'end' }]);
    const atlas = createRouteCoordinateAtlas(); atlas.configure([route]);
    const batch = (tick, from, to) => ({ worldId: 'roundoff', generation: 1, tick, facts: [{ kind: 'MotionCommitted', actorId: 7, eventId: 'motion:' + tick, causalSequence: tick, positionBefore: from, positionAfter: to }], snapshot: { actors: [{ actorId: 7, ...to, action: 'walk' }] } });
    atlas.observe(batch(1, { x: 81, y: 80 }, { x: 80, y: 80 }), [{ gateId: 'start', actorId: 7, direction: 'negative', fraction: 1, observationId: 'entry:7', sourceEventIds: ['motion:1'] }]);
    atlas.observe(batch(2, { x: 80, y: 80 }, { x: 49, y: 80 }), []); expect(atlas.coordinate(7, 'line')).to.include({ status: 'qualified', entryTick: 1 }); expect(atlas.coordinate(7, 'line').sPixels).to.be.closeTo(31, 1e-12);
    atlas.observe(batch(3, { x: 49, y: 80 }, { x: 48, y: 81 }), []); expect(atlas.coordinate(7, 'line').status).to.equal('off-route');
  });
});
