import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

let ordinal = 0;
const fail = message => Object.assign(new Error(message), { code: 'morph-live-unavailable' });
export function createResonatorMorphLiveOwner({ getSource, getPlayback = () => null, resourceBudget, onState = () => {} } = {}) {
  if (typeof getSource !== 'function' || typeof getPlayback !== 'function') throw new TypeError('Live morphs need the reviewed source and existing physical owner.');
  const id = 'morph-live-' + (++ordinal), retirement = createProcgenRetirementScope(), unknown = new Set(); let disposed = false, pending = null, applied = null, error = null;
  const sourceCurrent = source => { try { const current = getSource(); return current.revision === source.revision && current.map.hash === source.map.hash; } catch { return false; } };
  const active = () => { try { const state = applied?.playback.inspectEffectGraph(); return !!applied && getPlayback() === applied.playback && state?.activeGraph?.hash === applied.expected.graphDefinitionHash && state.revision === applied.expected.ownerRouteRevision && ['active', 'mute'].includes(state.mode); } catch { return false; } };
  const state = () => Object.freeze({ disposed, preparing: !!pending, unknownRetirement: unknown.size, active: active(), currentSource: !!applied && sourceCurrent(applied.source), routeBound: !!applied?.routeBound, bodyCount: applied?.bodyCount || 0, mapHash: applied?.source.map.hash || null, expected: applied?.expected || null, error });
  const report = () => { if (!disposed) try { onState(state()); } catch {} };
  const cancel = () => { pending?.controller.abort(fail('Live morph preparation canceled.')); };
  return Object.freeze({ state, cancel,
    async prepare({ voiceId = null, generation = null, travelPixels = 256, wet01 = 0.2, morph01 = 0 } = {}) {
      if (disposed || pending || unknown.size) throw fail('Live morph preparation is unavailable while another request or unresolved retirement owns storage.');
      const source = getSource(), playback = getPlayback(); if (!['paired-synthetic-held', 'prepared-dual-body-blend'].includes(source?.map?.transitionPolicy) || !playback?.prepareMorphEffect) throw fail('Review a paired-held or explicit prepared-blend map and enable the existing physical audio owner first.');
      const operation = { controller: new AbortController(), promise: null, workspace: createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'morph-live-preparation', category: 'candidate', bytes: 2 * 1048576 }) }; pending = operation; error = null;
      const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || pending !== operation || getPlayback() !== playback || !sourceCurrent(source)) throw fail('The reviewed source or physical owner changed before live publication.'); };
      operation.promise = (async () => {
        let published = null;
        try { check(); const result = published = await playback.prepareMorphEffect({ map: source.map, a: source.a, b: source.b, voiceId, generation, travelPixels, wet01, morph01 }, { signal: operation.controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check();
          const expected = Object.freeze({ ownerRouteRevision: result.state.revision, graphDefinitionHash: result.state.activeGraph.hash }); applied = { playback, source, expected, routeBound: voiceId !== null, bodyCount: result.model?.bodyCount || 1 }; return Object.freeze({ expected, mapHash: source.map.hash, routeBound: voiceId !== null, acousticReceipt: false });
        } catch (caught) { if (published?.state?.activeGraph?.hash) try { playback.setEffectBypass('tail', { ownerRouteRevision: published.state.revision, graphDefinitionHash: published.state.activeGraph.hash }); } catch {} error = caught.message; throw caught; }
        finally { try { operation.workspace.release(); } catch (caught) { unknown.add(operation); error = caught.message; throw caught; } finally { if (pending === operation) pending = null; report(); } }
      })(); report(); return operation.promise;
    },
    control(morph01) {
      if (disposed || !active() || !sourceCurrent(applied.source) || applied.routeBound || !Number.isFinite(morph01) || morph01 < 0 || morph01 > 1) throw fail('Manual MORPH needs the current prepared manual body; observed travel owns a bound route.');
      return applied.playback.updateEffectGraph('morph-body', { morph01 }, undefined, applied.expected);
    },
    release(mode = 'tail') { if (disposed || !applied || !['tail', 'panic'].includes(mode)) throw fail('Choose tail retirement or explicit Panic for the prepared live body.'); const result = applied.playback.setEffectBypass(mode, applied.expected); applied = null; report(); return result; },
    suspend: cancel,
    invalidate() { cancel(); report(); },
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; cancel(); const settled = pending?.promise;
      return retirement.retire([{ name: 'live-morph-preparation', run: async () => { try { await settled; } catch {} if (unknown.size) throw fail('Live preparation storage retains unresolved retirement.'); applied = null; } }]);
    }
  });
}
