import { canonicalDataText } from '../../../core/CanonicalData.js';
import { prepareSceneRehearsalLane } from './SceneRehearsalLane.js';
import { prepareCausalNativeRenderInput } from '../../midi-ui/CausalNativeRender.js';
import { NATIVE_OFFLINE_SOURCE_IDS } from '../../midi-ui/NativeOfflineProfile.js';
import { getNativeInstrumentCatalog } from '../../midi-ui/NativeInstrumentSchema.js';
import { createAudioResourceLeases } from '../../midi-ui/AudioResourceLeases.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { requireSynchronousResourceAcknowledgement } from '../../resources/ResourceRetirement.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const fail = message => Object.assign(new Error('Native scene rehearsal: ' + message), { code: 'scene-native-rehearsal-unavailable' });

export async function prepareSceneNativeRehearsal({ scene, source, sourceHash, sampleRate, resourceBudget, jobs, signal, isCurrent = () => true, getCatalog = getNativeInstrumentCatalog, OfflineAudioContext, prepareNative = prepareCausalNativeRenderInput } = {}) {
  const indices = scene.patchRefs.flatMap((row, index) => NATIVE_OFFLINE_SOURCE_IDS.includes(row.reference.engineRequirement.engineId) ? [index] : []);
  if (!indices.length) return null;
  if (indices.length > 4 || indices.some(index => scene.patchRefs[index].reference.assetHashes.length || scene.patchRefs[index].reference.engineRequirement.engineId === 'native-sample')) throw fail('Choose at most four assetless native source lanes. Sample sources need their separate pinned material adapter.');
  const scope = createProcgenRetirementScope(), resources = createAudioResourceLeases({ resourceBudget, ownerPrefix: 'scene-native-rehearsal' }), records = []; let workspace = null, bytes = 0, released = false;
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) throw fail('The scene or private source changed.'); };
  const releaseInputs = () => {
    if (released) return true;
    let failure = null;
    for (const record of records) {
      if (record.releaseError) { failure ||= record.releaseError; continue; }
      try { if (record.native) { requireSynchronousResourceAcknowledgement(record.native.release(), 'Native scene PCM reader release'); record.native = null; } record.input = null; }
      catch (error) { record.releaseError = error; failure ||= error; }
    }
    if (failure) throw failure; released = true; return true;
  };
  const retire = () => scope.getReceipt() || scope.retire([{ name: 'native-scene-pcm', run: releaseInputs }, { name: 'native-scene-resources', run: async () => { releaseInputs(); const receipt = resources.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('Native source reservations retain unresolved ownership.'); workspace?.release(); } }]);
  try {
    check(); workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'scene-native-rehearsal', kind: 'native-scene-lane-plans-and-receipts', bytes: 16 * 1048576 + source.intents.length * 4096 });
    const catalog = await getCatalog(); check();
    if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity?.buildId !== scene.sourceVersion.hash) throw fail('The native producer differs from the exact scene application build.');
    for (const index of indices) {
      const lane = await prepareSceneRehearsalLane({ scene, source, sourceHash, buildId: catalog.executionIdentity.buildId, sampleRate, index, descriptors: catalog.descriptors }); check();
      const record = { index, native: null, input: null }; records.push(record);
      record.native = await prepareNative(lane.input, { resources, resourceBudget, jobs, signal, isCurrent, OfflineAudioContext, maxWorkingBytes: 256 * 1048576 }); check();
      record.input = record.native.input;
      if (record.input?.mode !== 'causal-take' || !Array.isArray(record.input.planes) || record.input.planes.length !== 2 || record.input.firstFrame !== 0 || record.input.planes.some(plane => !(plane instanceof Float32Array) || plane.length !== record.input.endFrame)) throw fail('The native source omitted its complete bounded stereo output.');
      bytes += record.input.planes.reduce((sum, plane) => sum + plane.byteLength, 0);
      if (bytes > 32 * 1048576) throw fail('Native private-source PCM exceeds its aggregate 32 MiB input bound.');
    }
    check(); const metadata = canonicalDataText(records.map(record => ({ sourceIndex: record.index, input: { ...record.input, planes: null } })), { maxBytes: 1048576, maxNodes: 65536 }); workspace.resize(2 * 1048576 + metadata.bytes.length * 8 + metadata.nodes * 64);
    return Object.freeze({ bytes, inputs: () => { if (released) throw fail('Native PCM inputs retired.'); return records.map(record => ({ sourceIndex: record.index, input: record.input })); }, releaseInputs, retire });
  } catch (error) { const receipt = retire(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
