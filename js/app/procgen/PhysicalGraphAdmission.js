const owners = new WeakMap();
export function registerPhysicalGraphAdmission(world, prepare) {
  if (!world || world._disposed || typeof prepare !== 'function') throw new Error('A live physical world and graph admission owner are required.');
  let entries = owners.get(world); if (!entries) { entries = new Map(); owners.set(world, entries); }
  if (entries.size >= 8) throw new Error('Physical graph admission owner capacity exceeded.');
  const token = {}; entries.set(token, prepare);
  return () => { entries.delete(token); if (!entries.size) owners.delete(world); };
}
export function preparePhysicalGraphAdmission(world, graph) {
  const entries = owners.get(world), snapshot = [...(entries || [])], generation = world.generation, proposals = [];
  let committed = false, canceled = false;
  const cancel = () => { if (committed || canceled) return false; canceled = true; const errors = [];
    for (const proposal of proposals) try { proposal.cancel(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Physical graph admission retirement is unresolved.'); return true;
  };
  try { for (const [, prepare] of snapshot) { const proposal = prepare(graph); if (!proposal || typeof proposal.commit !== 'function' || typeof proposal.cancel !== 'function') throw new Error('Physical graph admission did not return an owned proposal.'); proposals.push(proposal); } }
  catch (error) { try { cancel(); } catch (retirementError) { error.retirementError = retirementError; } throw error; }
  return Object.freeze({ cancel, commit() {
    if (committed) return true;
    if (canceled || world._disposed || world.generation !== generation || owners.get(world) !== entries || snapshot.length !== (entries?.size || 0) || snapshot.some(([token, prepare]) => entries.get(token) !== prepare)) {
      cancel(); throw new Error('Physical graph admission owner changed before publication.');
    }
    for (const proposal of proposals) proposal.commit(); committed = true; return true;
  } });
}
