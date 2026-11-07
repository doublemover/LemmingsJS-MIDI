export function observeTerrainWorkMaterial(world, cells, revision, phase, read) {
  const changed = cells.filter(cell => phase === 'removed-solid-before-edit' ? cell.before && !cell.after : !cell.before && cell.after), sources = new Set();
  let materialId, tag, sourceCell = null, reason = null;
  for (const cell of changed) {
    const value = read(world, cell.x, cell.y, revision);
    if (value.status !== 'complete') { reason ||= 'incomplete-cell-provenance'; continue; }
    if (materialId === undefined) { materialId = value.materialId ?? null; tag = value.tag ?? null; }
    else if (materialId !== (value.materialId ?? null) || tag !== (value.tag ?? null)) reason ||= 'heterogeneous-work-material';
    if (!sourceCell || cell.y < sourceCell.y || cell.y === sourceCell.y && cell.x < sourceCell.x) sourceCell = { x: cell.x, y: cell.y };
    if (value.editId) sources.add(value.editId);
    if (sources.size > 32) { reason = 'material-source-capacity'; break; }
  }
  return { schema: 'lemmings-terrain-work-material/v1', status: !reason && changed.length ? 'complete' : 'unknown', reason: reason || (changed.length ? null : 'no-changed-solid-cells'),
    phase, revision, changedSolidCells: changed.length, materialId: reason ? null : materialId ?? null, tag: reason ? null : tag ?? null,
    sourceCell, sourceEditIds: [...sources].slice(0, 32).sort(), aggregation: 'consensus-of-all-changed-solid-cells' };
}
