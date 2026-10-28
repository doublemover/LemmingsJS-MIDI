import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createLaneNavigationMetadata } from '../js/app/procgen/workstation/LaneNavigationMetadata.js';
import { createLaneNavigatorGroupsView } from '../js/app/procgen/workstation/LaneNavigatorGroupsView.js';
import { createProcgenLaneProjection } from '../js/app/procgen/workstation/ProcgenLaneProjection.js';

const source = count => Array.from({ length: count }, (_, index) => ({ id: 'lane-' + (index + 1), name: 'Lane ' + (index + 1), role: 'melody', solo: index === 63 }));
const fixture = (count = 64, saved = {}) => {
  let state = saved; const lanes = source(count), model = createLaneNavigationMetadata({ getState: () => state, setState: next => { state = next; } }); model.sync(lanes, 1); return { model, lanes, saved: () => state };
};

describe('separate bounded lane organization metadata', () => {
  for (const count of [1, 8, 64, 1024]) it(`organizes ${count} canonical lanes without editing any music fields`, () => {
    const f = fixture(count), before = JSON.stringify(f.lanes), group = f.model.createGroup('Ensemble'); f.model.assign(f.lanes.at(-1).id, group); f.model.toggleCollapsed(group);
    expect(f.model.visible().lanes).to.have.length(count - 1); expect(f.model.visible('lane-' + count).lanes.some(lane => lane.id === f.lanes.at(-1).id)).to.equal(true);
    expect(f.model.getState().collapsed).to.deep.equal([group]); f.model.togglePinned(f.lanes.at(-1).id); expect(f.model.visible().lanes[0]).to.equal(f.lanes.at(-1));
    expect(JSON.stringify(f.lanes)).to.equal(before); expect(f.saved().groups[0].laneIds).to.deep.equal([f.lanes.at(-1).id]);
    f.model.dispose(); expect(f.model.getState()).to.include({ retainedBytes: 0, undoCount: 0, redoCount: 0 });
  });
  it('reorders only presentation IDs and has separate reversible organization history', () => {
    const f = fixture(8); f.model.move('lane-8', -7); expect(f.model.visible().laneIndices).to.deep.equal([7, 0, 1, 2, 3, 4, 5, 6]); expect(f.lanes[0].id).to.equal('lane-1');
    expect(f.model.undo()).to.equal(true); expect(f.model.visible().laneIndices).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7]); expect(f.model.redo()).to.equal(true);
    expect(f.model.visible().laneIndices[0]).to.equal(7); const group = f.model.createGroup('First'); f.model.renameGroup(group, 'Renamed'); f.model.assign('lane-8', group); f.model.removeGroup(group);
    expect(f.model.groupFor('lane-8')).to.equal(null); f.model.undo(); expect(f.model.groupFor('lane-8')).to.equal(group); expect(f.model.getState().groups[0].name).to.equal('Renamed');
  });
  it('bounds history by count/bytes, pins and groups and keeps one-group lane membership', () => {
    const f = fixture(1024), groups = [];
    for (let i = 0; i < 128; i++) groups.push(f.model.createGroup('Group ' + i)); expect(f.model.createGroup('Beyond capacity')).to.equal(null);
    for (let i = 0; i < 64; i++) expect(f.model.togglePinned(f.lanes[i].id)).to.equal(true); expect(f.model.togglePinned('lane-65')).to.equal(false);
    f.model.assign('lane-1024', groups[0]); f.model.assign('lane-1024', groups[1]); expect(f.model.getState().groups[0].laneIds).to.deep.equal([]);
    for (let i = 0; i < 100; i++) f.model.renameGroup(groups[1], 'Change ' + i);
    expect(f.model.getState().retainedBytes).to.be.at.most(256 * 1024); expect(f.model.getState().undoCount).to.be.at.most(32); expect(f.model.getState().dropped).to.be.greaterThan(0);
    const snapshot = f.model.getState(); snapshot.order.reverse(); snapshot.groups[1].laneIds.length = 0; expect(f.model.groupFor('lane-1024')).to.equal(groups[1]);
  });
  it('prunes deleted lane IDs, admits inserted IDs and resets organization history on document replacement', () => {
    const f = fixture(8), group = f.model.createGroup('Group'); f.model.assign('lane-8', group); f.model.togglePinned('lane-8');
    const next = [{ id: 'new', name: 'New lane' }, ...f.lanes.slice(0, 7)]; f.model.sync(next, 1); expect(f.model.getState().pinned).to.deep.equal([]); expect(f.model.visible().lanes.some(lane => lane.id === 'new')).to.equal(true);
    f.model.undo(); expect(f.model.getState().order).not.to.include('lane-8'); f.model.sync([...next], 2); expect(f.model.getState()).to.include({ undoCount: 0, redoCount: 0 }); expect(f.model.getState().groups).to.deep.equal([]);
  });
  it('normalizes hostile/stale preferences and caches unchanged visible projections', () => {
    const f = fixture(8, { order: ['missing', 'lane-4', 'lane-4'], groups: [{ id: 'x', name: 'Group', laneIds: ['lane-8', 'missing'] }, { id: 'y', name: 'Other', laneIds: ['lane-8'] }], pinned: ['missing'], collapsed: ['x', 'missing'] });
    expect(f.model.getState().order[0]).to.equal('lane-4'); expect(f.model.groupFor('lane-8')).to.equal('x'); expect(f.model.visible()).to.equal(f.model.visible()); expect(f.model.visible('no match').lanes).to.have.length(0);
    expect(f.model.assign('missing', 'x')).to.equal(false); expect(f.model.assign('lane-1', 'missing')).to.equal(false); expect(f.model.renameGroup('x', '')).to.equal(false); expect(f.model.move('lane-1', NaN)).to.equal(false);
    f.model.reveal('lane-8'); expect(f.model.visible().lanes).to.have.length(8);
  });
  it('restores explicitly supplied incoming organization while retiring the former document history', () => {
    let saved = {}; const model = createLaneNavigationMetadata({ getState: () => saved, setState: value => { saved = value; } }), lanes = source(8); model.sync(lanes, 1); model.createGroup('Old document');
    saved = { version: 1, order: lanes.map(lane => lane.id).reverse(), groups: [{ id: 'new', name: 'Incoming document', laneIds: ['lane-8'] }], pinned: ['lane-8'] }; model.sync([...lanes], 2);
    expect(model.getState().groups[0].name).to.equal('Incoming document'); expect(model.visible().laneIndices[0]).to.equal(7); expect(model.getState().undoCount).to.equal(0); model.dispose();
  });
});

describe('physical row projection independent of lane organization', () => {
  it('maps arbitrary visible rows and crop coordinates to their physical stripes', () => {
    const projection = createProcgenLaneProjection({ laneCount: 64, height: 600, physicalHeight: 144, minimumRow: 100, laneIndices: [63, 0, 41] }); projection.scale = 2; projection.rowSourceY = [30, 40, 50];
    expect(projection.mapped).to.equal(true); expect(projection.laneAt(10)).to.equal(63); expect(projection.laneAt(210)).to.equal(0); expect(projection.worldY(210)).to.equal(45); expect(projection.worldY(410)).to.equal(41 * 144 + 55);
    expect(Object.isFrozen(projection.laneIndices)).to.equal(true);
  });
  it('keeps contiguous fast paths, caps eight rows and admits an empty visibility projection', () => {
    const projection = createProcgenLaneProjection({ laneCount: 64, height: 2160, firstLane: 2, laneIndices: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], maxVisibleRows: 100 });
    expect(projection.count).to.equal(8); expect(projection.firstVisible).to.equal(2); expect(projection.firstLane).to.equal(9); expect(projection.mapped).to.equal(false);
    const empty = createProcgenLaneProjection({ laneCount: 64, height: 1080, laneIndices: [] }); expect(empty.count).to.equal(0); expect(empty.laneAt(20)).to.equal(null); expect(empty.worldY(20)).to.equal(null);
    expect(() => createProcgenLaneProjection({ laneCount: 8, height: 600, laneIndices: [0, 0] })).to.throw('physical lane'); expect(() => createProcgenLaneProjection({ laneCount: 8, height: 600, laneIndices: [8] })).to.throw('physical lane');
  });
});

describe('lane organization controls', () => {
  it('preserves name drafts, consumes IME only after composition, and fences disposed actions', () => {
    const f = fixture(8), dom = new JSDOM('<body></body>'), { document } = dom.window; let changes = 0;
    const view = createLaneNavigatorGroupsView({ document, metadata: f.model, getSelection: () => 'lane-8', onChange: () => { changes++; view.update(1); } }); document.body.append(view.element); view.update(1);
    const name = document.querySelector('input'), create = document.querySelector('[aria-label="Create lane group"]'); name.value = 'Strings'; name.focus(); name.setSelectionRange(3, 3); view.update(1); expect(name.selectionStart).to.equal(3); expect(name.value).to.equal('Strings');
    name.dispatchEvent(new dom.window.Event('compositionstart')); create.click(); expect(changes).to.equal(0); name.dispatchEvent(new dom.window.Event('compositionend')); create.click(); expect(changes).to.equal(1);
    document.querySelector('[aria-label="Assign selected lane"]').click(); expect(f.model.groupFor('lane-8')).to.equal(f.model.getState().groups[0].id);
    const stale = document.querySelector('[aria-label="Move selected lane up"]'); view.dispose(); stale.click(); expect(changes).to.equal(2); f.model.dispose(); dom.window.close();
  });
});
