import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export async function stagePreparedSoundContent({ prepared, reader, archiver, engineDescriptors, signal, isCurrent = () => true, stageIsCurrent = isCurrent } = {}) {
  signal?.throwIfAborted();
  if (!isCurrent()) throw new Error('The prepared sound source changed.');
  const result = await archiver.prepareExport({ prepared, selection: prepared.patches.map(patch => patch.identity), mode: 'reference-only', signal, isCurrent });
  let lease = null, stage = null;
  try {
    lease = result.artifact.borrow();
    stage = await reader.stageArchive(lease.blob, { engineDescriptors, signal, isCurrent, stageIsCurrent });
    signal?.throwIfAborted(); if (!isCurrent()) throw new Error('The prepared sound source changed.');
    return stage;
  } catch (error) { stage?.discard(); throw error; }
  finally {
    const receipt = createProcgenRetirementScope().retire([{ name: 'archive-reader', run: () => lease?.release() },
      { name: 'archive-artifact', run: () => result.artifact.discard() }, { name: 'archive-digest', run: () => result.artifact.digest() }]);
    await receipt.completion;
    if (receipt.outcome !== 'complete') { stage?.discard(); throw Object.assign(new Error('Prepared sound archive retirement is unresolved.'), { retirement: receipt }); }
  }
}
