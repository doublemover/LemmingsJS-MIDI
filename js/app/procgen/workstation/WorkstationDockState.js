const modes = Object.freeze(['perform', 'inspect', 'overview']);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;

export function normalizeWorkstationDockPreferences(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return Object.freeze({ dockVersion: 1, workspaceMode: modes.includes(value.workspaceMode) ? value.workspaceMode : 'perform',
    dockHeight: Number.isFinite(value.dockHeight) ? Math.max(180, Math.min(480, Math.round(value.dockHeight))) : 288 });
}

export function workstationDockHeight(value, workspaceHeight) {
  const maximum = Number.isFinite(workspaceHeight) && workspaceHeight > 0 ? Math.min(480, Math.max(180, workspaceHeight - 192)) : 480;
  return Math.max(180, Math.min(maximum, Number.isFinite(value) ? Math.round(value) : 288));
}

export function createWorkstationDockContext({ laneId, laneName, editorKind, targetId = null, targetScope = 'lane', selectedEntity = null, documentIdentity = null, dirtyBuffer = [] } = {}) {
  if (!text(laneId) || !text(editorKind)) throw new TypeError('A dock context needs its exact lane and editor identity.');
  const entity = selectedEntity && text(selectedEntity.id) && text(selectedEntity.kind) ? Object.freeze({ id: selectedEntity.id, kind: selectedEntity.kind,
    worldId: text(selectedEntity.worldId), generation: Number.isSafeInteger(selectedEntity.generation) && selectedEntity.generation >= 0 ? selectedEntity.generation : null }) : null;
  const drafts = Object.freeze((Array.isArray(dirtyBuffer) ? dirtyBuffer : []).slice(0, 16).filter(value => text(value?.curveId)).map(value => Object.freeze({ curveId: value.curveId, dirty: value.dirty === true, conflict: value.conflict === true, draftText: typeof value.draftText === 'string' ? value.draftText.slice(0, 16384) : null })));
  const scope = ['lane', 'world', 'physical-graph'].includes(targetScope) ? targetScope : 'lane';
  return Object.freeze({ laneId, laneName: text(laneName) || laneId, editorKind, targetId: text(targetId), targetScope: scope, selectedEntity: entity, documentIdentity, dirtyBuffer: drafts,
    key: JSON.stringify([scope, laneId, editorKind, text(targetId), entity?.kind ?? null, entity?.id ?? null, entity?.worldId ?? null, entity?.generation ?? null]) });
}
