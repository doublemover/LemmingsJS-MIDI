import { verifyMaterialPalette, validateMaterialPalette } from '../../midi/content/MaterialPalette.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const fail = message => Object.assign(new Error(message), { code: 'material-palette-unavailable' });
let ordinal = 0;
export function createMaterialPalettePreparation({ getCatalog, getContext, prepareLane, unassignLane, assignment, resourceBudget, onState = () => {} } = {}) {
  if ([getCatalog, getContext, prepareLane, unassignLane, assignment].some(callback => typeof callback !== 'function')) throw new TypeError('Material palettes require the existing source preparation and routed assignment owners.');
  const owner = 'material-palettes-' + (++ordinal), scope = createProcgenRetirementScope(), groups = new Map(), verifications = new Set(), failures = new Map(); let disposed = false, pending = null, unknown = false, observedLanes = null, observedPalettes = new Map();
  const report = (group, state, reason = null) => { try { onState({ laneId: 'material-palette', state, paletteId: group?.palette.id || null, code: reason }); } catch {} };
  const drop = group => {
    if (group.holds || group.used || group.preparing) return;
    try { for (const entry of group.entries) unassignLane(entry.id); group.storage.release(); groups.delete(group.palette.identityHash); }
    catch (error) { unknown = true; group.error = error.message; throw error; }
  };
  const build = async (group, signal, isCurrent) => {
    if (group.ready && group.context === getContext()) return;
    const context = getContext(); if (context?.state !== 'running') return;
    if (pending) throw fail('Another material palette is still preparing.');
    const operation = { controller: new AbortController(), promise: null }, abort = () => operation.controller.abort(signal.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); pending = operation; group.preparing = true; group.error = null;
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || unknown || !isCurrent() || getContext() !== context || context.state !== 'running') throw fail('The palette, document or audio clock changed during source preparation.'); };
    operation.promise = (async () => {
      try {
        for (const [index, reference] of group.palette.references.entries()) {
          check(); const id = 'material:' + group.palette.identityHash.slice(0, 24) + ':' + index; let candidate = null;
          try { candidate = await prepareLane(id, reference, { signal: operation.controller.signal, retainPrevious: true, switchLane: { soundChangePolicy: 'new-notes-only', soundChangeBoundary: 'immediate', soundChangeFadeSeconds: 0.02 } }); check(); candidate.commit();
            if (!group.entries.some(entry => entry.id === id)) group.entries.push({ id, instrumentRef: reference, patchId: reference.patchId }); candidate.accept();
          } catch (error) { if (candidate) { const retirement = candidate.release(); await retirement?.completion; if (retirement?.outcome && retirement.outcome !== 'complete') { unknown = true; throw Object.assign(fail('A material source preparation retains unknown ownership.'), { cause: error, retirement }); } } throw error; }
        }
        check(); group.context = context; group.ready = true; report(group, 'ready');
      } catch (error) { group.ready = false; group.error = error.message; group.errorContext = context; report(group, 'unavailable', error.message); throw error; }
      finally { signal?.removeEventListener('abort', abort); group.preparing = false; if (pending === operation) pending = null; }
    })(); return operation.promise;
  };
  const prepare = async (raw, { signal, isCurrent = () => true } = {}) => {
    signal?.throwIfAborted(); if (disposed || unknown || verifications.size || pending) throw fail('The material palette owner has retired or retains unknown source ownership.');
    const workspace = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'material-palette-reference-verification', category: 'candidate', bytes: 2 * 1048576 }); let group = null, held = false, finish;
    const completion = new Promise(resolve => { finish = resolve; }); verifications.add(completion);
    try {
      const catalog = await getCatalog(); signal?.throwIfAborted(); if (disposed || !isCurrent() || catalog.state !== 'bound-application-engines') throw fail('Prepare material sources against the current bound application build.');
      const palette = await verifyMaterialPalette(raw, { descriptors: catalog.descriptors, signal }); signal?.throwIfAborted(); if (disposed || !isCurrent()) throw fail('The requested palette changed.');
      group = groups.get(palette.identityHash);
      if (!group) { if (groups.size >= 3) throw fail('The admitted three-palette bound is full; retire an unused palette and its retained source tails first.');
        group = { palette, entries: [], context: null, ready: false, published: false, holds: 0, used: false, preparing: false, error: null,
          storage: createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'five-pinned-material-source-references', category: 'audio', bytes: 2 * 1048576 }) }; groups.set(palette.identityHash, group);
      }
      group.holds++; held = true; await build(group, signal, isCurrent); signal?.throwIfAborted(); if (!isCurrent()) throw fail('The palette target changed before publication.');
      let released = false, committed = false;
      const release = () => { if (released) return true; released = true; group.holds--; drop(group); return true; };
      return Object.freeze({ palette, validateCommit() { signal?.throwIfAborted(); if (released || disposed || !isCurrent()) throw fail('The prepared material palette is stale.'); },
        commit() { this.validateCommit(); committed = true; return palette; }, accept() { if (!committed || released) throw fail('Commit the exact palette before accepting its source preparation.'); group.published = true; group.used = true; release(); return palette; }, release });
    } catch (error) { if (typeof raw?.identityHash === 'string' && failures.size < 128) failures.set(raw.identityHash, { context: getContext(), message: error.message.slice(0, 512) }); if (held) { group.holds--; try { drop(group); } catch (retirementError) { error.retirementError = retirementError; } } throw error; }
    finally { try { workspace.release(); } catch (error) { unknown = true; if (group) group.error = error.message; throw error; } finally { verifications.delete(completion); finish(); } }
  };
  return Object.freeze({ prepare,
    aliases: () => [...groups.values()].flatMap(group => group.entries.map(entry => ({ id: entry.id, instrumentRef: entry.instrumentRef, soundChangePolicy: 'new-notes-only', soundChangeBoundary: 'immediate' }))),
    synchronizeUsage(lanes) {
      if (lanes === observedLanes) return;
      const palettes = new Map(); for (const lane of lanes) if (lane.materialPalette && !palettes.has(lane.materialPalette.identityHash)) { const value = validateMaterialPalette(lane.materialPalette); palettes.set(value.identityHash, value); }
      const identities = new Set(palettes.keys()); observedLanes = lanes; observedPalettes = palettes;
      for (const group of groups.values()) { group.used = identities.has(group.palette.identityHash); if (!group.used && !group.holds && !group.preparing) drop(group); }
    },
    async ensure(lanes, { isCurrent = () => true } = {}) {
      if (disposed || unknown || pending || verifications.size || getContext()?.state !== 'running') return;
      this.synchronizeUsage(lanes);
      for (const palette of observedPalettes.values()) {
        const group = groups.get(palette.identityHash); if (failures.get(palette.identityHash)?.context === getContext() || group?.ready && group.context === getContext() || group?.error && group.errorContext === getContext()) continue;
        let candidate; try { candidate = await prepare(palette, { isCurrent: () => !disposed && isCurrent() && lanes.some(lane => lane.materialPalette?.identityHash === palette.identityHash) }); candidate.commit(); candidate.accept(); } catch (error) { candidate?.release(); report(group, 'unavailable', error.message); }
      }
    },
    retry(lanes, options) { failures.clear(); for (const group of groups.values()) group.error = group.errorContext = null; return this.ensure(lanes, options); },
    resolve(intent, paletteRaw) {
      if (disposed || unknown || !paletteRaw) return null; const group = groups.get(paletteRaw.identityHash), material = intent.materialState;
      if (!group?.published || !group.ready || group.context !== getContext() || !material) return null;
      const entry = group.entries.find(entry => entry.patchId === material.patchId), key = entry && assignment(entry.id); return key ? Object.freeze({ key, instrumentKey: entry.instrumentRef.packHash + ':' + entry.instrumentRef.definitionHash, patchId: entry.patchId }) : null;
    },
    state: () => Object.freeze({ preparing: !!pending || verifications.size > 0, failedPalettes: [...failures].slice(0, 16).map(([identityHash, failure]) => ({ identityHash, reason: failure.message })), unknownRetirement: unknown, palettes: [...groups.values()].map(group => ({ id: group.palette.id, identityHash: group.palette.identityHash, ready: group.ready && group.context === getContext(), published: group.published, used: group.used, preparedBodies: group.entries.length, error: group.error })) }),
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; pending?.controller.abort(fail('The material palette owner retired.')); const settled = pending?.promise, readers = [...verifications];
      return scope.retire([{ name: 'material-palette-preparation', run: async () => { await Promise.all(readers); try { await settled; } catch {} if (unknown) throw fail('Material palette source retirement remains unresolved.'); for (const group of groups.values()) { group.holds = 0; group.used = false; drop(group); } observedLanes = null; observedPalettes.clear(); failures.clear(); } }]); }
  });
}
