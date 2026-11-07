import { expect } from 'chai';
import { createMidiProject, sanitizeMidiProject, reduceMidiProject } from '../js/midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { procgenLane, procgenLaneIndex, procgenProjectChange, procgenLaneCollectionChange, procgenIndexDiagnostics } from '../js/app/procgen/workstation/ProcgenProjectIndex.js';

const fixture = count => sanitizeMidiProject(createProcgenWorkstationProject(createMidiProject(), { lanes: Array.from({ length: count }, () => ({ mode: 'pattern', patternPurpose: 'Edit-cost fixture' })) }));
describe('changed-data project indexes and revisions', () => {
  it('shares its ID index across nonstructural edits and advances only touched lane revisions', () => {
    const before = fixture(1024), index = procgenLaneIndex(before.procgen.lanes), builds = procgenIndexDiagnostics().builds;
    const after = reduceMidiProject(before, { type: 'procgen/lane', laneId: 'lane-512', patch: { gain: .5 } });
    expect(procgenLaneIndex(after.procgen.lanes)).to.equal(index); expect(procgenIndexDiagnostics().builds).to.equal(builds);
    expect(after.procgen.revision).to.equal(before.procgen.revision + 1);
    expect(procgenLane(after.procgen.lanes, 'lane-512').revision).to.equal(1);
    expect(after.procgen.lanes[0]).to.equal(before.procgen.lanes[0]);
    expect(after.procgen.lanes[511].patterns).to.equal(before.procgen.lanes[511].patterns);
    expect(procgenProjectChange(before, after).laneIds).to.deep.equal(['lane-512']);
    expect(procgenLaneCollectionChange(before.procgen.lanes, after.procgen.lanes).laneIds).to.deep.equal(['lane-512']);
    expect(procgenLaneCollectionChange(before.procgen.lanes.slice(), after.procgen.lanes)).to.equal(null);
    expect(procgenLaneCollectionChange(before.procgen.lanes, after.procgen.lanes.slice())).to.equal(null);
    expect(procgenProjectChange(fixture(1), after)).to.equal(null);
    expect(reduceMidiProject(after, { type: 'procgen/lane', laneId: 'lane-512', patch: { gain: .5 } })).to.equal(after);
  });
  it('rebuilds IDs only for structural changes and preserves one batch revision', () => {
    const before = fixture(8), index = procgenLaneIndex(before.procgen.lanes);
    const removed = reduceMidiProject(before, { type: 'procgen/removeLane', laneId: 'lane-4' });
    expect(procgenLaneIndex(removed.procgen.lanes)).not.to.equal(index);
    expect(procgenLane(removed.procgen.lanes, 'lane-5')).to.equal(before.procgen.lanes[4]);
    const after = reduceMidiProject(before, { type: 'procgen/launchedBatch', launches: [{ laneId: 'lane-2', slot: 1 }, { laneId: 'lane-4', slot: 2 }] });
    expect(after.procgen.revision).to.equal(before.procgen.revision + 1);
    expect(procgenProjectChange(before, after).laneIds).to.deep.equal(['lane-2', 'lane-4']);
  });
});
