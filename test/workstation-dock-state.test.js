import { expect } from 'chai';
import { normalizeWorkstationDockPreferences, workstationDockHeight, createWorkstationDockContext } from '../js/app/procgen/workstation/WorkstationDockState.js';

describe('independent workstation dock preferences and scope', () => {
  it('migrates the old column width to a closed performance surface without copying world or music state', () => {
    const old = { inspectorWidth: 304, laneId: 'lane-7', seed: 42, project: { lanes: 1024 } }, before = JSON.stringify(old);
    expect(normalizeWorkstationDockPreferences(old)).to.deep.equal({ dockVersion: 1, workspaceMode: 'perform', dockHeight: 288 }); expect(JSON.stringify(old)).to.equal(before);
    expect(normalizeWorkstationDockPreferences(null).workspaceMode).to.equal('perform'); expect(normalizeWorkstationDockPreferences({ workspaceMode: 'inspect', dockHeight: 9999 })).to.include({ workspaceMode: 'inspect', dockHeight: 480 }); expect(workstationDockHeight(480, 500)).to.equal(308);
  });
  it('names the actual lane/editor/target and bounds volatile entity references and dirty buffers outside persisted preferences', () => {
    const context = createWorkstationDockContext({ laneId: 'lane-A', laneName: 'Brass', editorKind: 'Automation', targetId: 'cc-74', selectedEntity: { id: '1:actor:7', kind: 'actor', generation: 1, worldId: 'world' }, dirtyBuffer: Array.from({ length: 20 }, (_, index) => ({ curveId: 'curve-' + index, dirty: true, draftText: 'x'.repeat(20000) })) });
    expect(context).to.include({ laneId: 'lane-A', editorKind: 'Automation', targetId: 'cc-74' }); expect(context.dirtyBuffer).to.have.length(16); expect(context.dirtyBuffer[0].draftText).to.have.length(16384); expect(Object.isFrozen(context.dirtyBuffer[0])).to.equal(true); expect(normalizeWorkstationDockPreferences(context)).not.to.have.property('dirtyBuffer');
    expect(() => createWorkstationDockContext({ laneId: 'lane-A' })).to.throw('exact lane');
  });
});
