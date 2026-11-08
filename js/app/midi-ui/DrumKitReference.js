import { borrowSoundContentStage } from './SoundContentReader.js';
import { validateDrumKitBinding } from '../../midi/content/DrumKitDefinition.js';
import { hashData, freezeData } from '../../core/CanonicalData.js';
import { requireSynchronousResourceAcknowledgement } from '../resources/ResourceRetirement.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export async function readStagedDrumKit(stage, patchIdentity, { signal, resourceBudget = null } = {}) {
  signal?.throwIfAborted(); const source = borrowSoundContentStage(stage); let workspace = null;
  try {
    const patch = source.prepared.patches.find(patch => patch.identity === patchIdentity), file = source.prepared.pack.files.find(file => file.path === 'circuit/kit.json');
    if (!file || patch && !patch.dependencies.includes(file.sha256)) return null;
    if (!patch || file.kind !== 'generated-data' || file.mediaType !== 'application/json' || file.bytes > 65536 || !patch.dependencies.includes(file.sha256)) throw new TypeError('The selected percussion source lacks its exact bounded kit-data dependency.');
    workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'drum-kit-data-reader', kind: 'bounded-kit-json-and-hash-overlap', bytes: 1048576 });
    const blob = source.assetBlob(file.sha256); if (!blob || blob.size !== file.bytes) throw new TypeError('Prepare or import the complete kit definition before applying this percussion source.');
    const bytes = await blob.arrayBuffer(); signal?.throwIfAborted(); const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), definition = validateDrumKitBinding(raw, patch.archivedDefinition);
    if (await hashData(definition, { maxBytes: 65536, maxNodes: 8192 }) !== file.sha256) throw new TypeError('The saved drum kit differs from its immutable content hash.'); signal?.throwIfAborted();
    return freezeData({ hash: file.sha256, definition });
  } finally {
    let readerKnown = false; const receipt = createProcgenRetirementScope().retire([{ name: 'drum-kit-definition-reader', run: () => { requireSynchronousResourceAcknowledgement(source.release(), 'Drum-kit definition reader release'); readerKnown = true; } }, { name: 'drum-kit-data-workspace', run: () => { if (!readerKnown) throw new Error('The drum-kit reader still owns its data.'); workspace?.release(); } }]); await receipt.completion;
    if (receipt.outcome !== 'complete') throw Object.assign(new Error('Drum-kit data retirement is unresolved.'), { retirement: receipt, drumKitOwnership: { source, workspace, receipt } });
  }
}
