import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
export function createProcgenNativeOutputWorkbench({ resourceBudget, getLanes, getSourceIdentity, onState = () => {}, MessageChannel = globalThis.MessageChannel } = {}) {
  let realm = null, snapshot = null, pending = null, lease = null, disposed = false, phase = 'idle', failure = null, assignedSource = null;
  const scope = createProcgenRetirementScope();
  const state = () => ({ phase, disposed, busy: !!pending, inUse: !!lease, realm: snapshot, failure, sourceCurrent: assignedSource !== null && assignedSource === getSourceIdentity(),
    requiredLanes: getLanes().length, ready: !!realm && !lease && assignedSource === getSourceIdentity() && getLanes().every(lane => snapshot?.assignments?.some(row => row.laneId === lane.id)), profile: 'baseline-dedicated-native-routes;one-contiguous-output-generation;terminal-pause' });
  const report = () => { try { onState(state()); } catch {} };
  const run = (next, work) => {
    if (disposed || pending || lease) return Promise.reject(new Error('Finish the current independent native output operation first.'));
    phase = next; failure = null;
    pending = Promise.resolve().then(work).catch(error => { failure = error.message; phase = 'failed'; throw error; }).finally(() => { pending = null; report(); }); report(); return pending;
  };
  const retireRealm = async () => { if (!realm) return; const receipt = realm.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw Object.assign(new Error('Independent native device cleanup remains unconfirmed.'), { retirement: receipt }); realm = null; snapshot = null; assignedSource = null; };
  return Object.freeze({ state,
    connect: options => run('pairing', async () => {
      if (typeof options?.pairingCode !== 'string' || !options.pairingCode || options.pairingCode.length > 128) throw new Error('Enter the fresh local pairing code before preparing the independent native client.');
      if (!realm) { const { prepareProcgenNativeOutputRealm } = await import('../ProcgenNativeOutputRealm.js'); if (disposed) throw new Error('The native output workbench retired.');
        realm = await prepareProcgenNativeOutputRealm({ resourceBudget, onState: value => { snapshot = value; report(); } }); }
      await realm.connect(options); phase = 'connected'; return state();
    }),
    enumerate: () => run('reading-devices', async () => { if (!realm) throw new Error('Pair the independent native client first.'); const value = await realm.enumerate(); phase = 'connected'; return value; }),
    selectBackend: api => run('selecting-native-backend', async () => { if (!realm) throw new Error('Pair the independent native client first.'); const value = await realm.selectBackend(api); phase = 'connected'; return value; }),
    open: options => run('opening-output', async () => { if (!realm) throw new Error('Pair and enumerate the independent native client first.'); const result = await realm.open(options); phase = 'output-granted'; return result; }),
    assign: ({ grant, protocol }) => run('assigning-native-lanes', async () => {
      if (!realm) throw new Error('Open an independently owned native output first.'); const source = getSourceIdentity(), lanes = getLanes();
      const missing = lanes.filter(lane => !snapshot?.assignments?.some(row => row.laneId === lane.id));
      const rows = missing.length ? await realm.assign({ grant, protocol, laneIds: missing.map(lane => lane.id) }) : []; if (source !== getSourceIdentity()) throw new Error('The physical project changed during native route preparation.'); assignedSource = source; phase = 'routes-prepared'; return rows;
    }),
    prepareAttachment({ semantic, graph, lanes, scoreContext } = {}) {
      if (disposed || pending || lease || !state().ready || typeof MessageChannel !== 'function' || !Array.isArray(semantic?.active) || semantic.active.length || !graph || graph.preparedSurfaces?.length || graph.acousticMap || graph.instruments.some(instrument => instrument.spatialAttachment) || !Array.isArray(lanes) || lanes.some(lane => lane.mode === 'pattern' || lane.devicePatch || lane.deviceParameters?.length || lane.percussion || lane.orchestral || lane.piano || lane.organ)) throw new Error('Direct native output requires current complete dedicated routes, physical lanes, no unreviewed device profiles/shared-body or world-spatial sources and an empty initial voice boundary.');
      const source = getSourceIdentity(), channel = new MessageChannel(), retirement = createProcgenRetirementScope(); let attempted = false, attached = false;
      const attachment = lease = Object.freeze({ requiredPort: channel.port2, state: () => ({ attempted, attached, terminalPause: true }),
        async attach(manifest) { if (lease !== attachment || source !== getSourceIdentity() || disposed) throw new Error('The independent native output source changed before attachment.'); attempted = true;
          await realm.attach({ port: channel.port1, manifest, lanes, scoreContext, initialHeldVoices: 0 }); attached = true; phase = 'attached-output-ready'; report(); },
        dispose() { return retirement.retire([{ name: 'independent-native-output', run: async () => { if (attempted) await retireRealm(); channel.port1.close(); channel.port2.close(); if (lease === attachment) lease = null; phase = realm ? 'routes-prepared' : 'closed'; report(); } }]); } }); phase = 'preparing-direct-port'; report(); return attachment;
    },
    close: () => run('closing', async () => { await retireRealm(); phase = 'closed'; return true; }),
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; const work = pending;
      return scope.retire([{ name: 'native-output-configuration', run: async () => { await work?.catch(() => {}); const receipt = lease?.dispose(); await receipt?.completion; if (receipt && receipt.outcome !== 'complete') throw new Error('The native source attachment retains ownership.'); await retireRealm(); } }]); }
  });
}
