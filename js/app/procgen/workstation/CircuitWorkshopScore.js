import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { validateSoundContentReference, resolveSoundContentReference } from '../../../midi/content/SoundContentReference.js';
import { validateDrumKitBinding } from '../../../midi/content/DrumKitDefinition.js';
import { validatePerformanceScene } from './PerformanceScene.js';

export async function createCircuitWorkshopScores({ sourceHash, scores, descriptor, reference: raw, signal } = {}) {
  signal?.throwIfAborted(); const reference = validateSoundContentReference(raw), definition = reference.definition;
  if (descriptor?.engineId !== 'worklet-sample' || !descriptor.capabilities.advancedSampleMaps || definition?.engineId !== 'worklet-sample' || !reference.drumKit?.definition || definition.voicePolicy.maxVoices > descriptor.maximumVoices) throw new Error('Save and apply an actual component Circuit Workshop kit before assembling its worker score.');
  const kit = validateDrumKitBinding(reference.drumKit.definition, definition), controls = ['weight', 'snap', 'metal', 'damp'];
  if (!kit.voices.every(voice => voice.runtimeChildren === 3 && ['body', 'noise', 'metal'].every(id => voice.components?.some(part => part.id === id))) || !controls.every(id => definition.macros.some(macro => macro.id === id && macro.mode === 'onset-only'))) throw new Error('This score requires the exact three-component kit and its WEIGHT/SNAP/METAL/DAMP controls. A printed single-source kit is a separate edition.');
  const resolved = await resolveSoundContentReference(reference, { engineDescriptors: [descriptor], availableHashes: reference.assetHashes, signal });
  if (resolved.status !== 'ready') throw new Error('The exact saved Circuit kit is unavailable: ' + resolved.status);
  const suffix = (await hashData(reference, { maxBytes: 65536, maxNodes: 8192 })).slice(0, 24), voices = ['deep-kick', 'snare', 'closed-hat'].map(id => kit.voices.find(voice => voice.id === id));
  if (voices.some(voice => !voice)) throw new Error('The saved component kit lacks the authored kick, snare or closed-hat articulation.');
  const output = [];
  for (const base of scores) {
    signal?.throwIfAborted(); const original = base.scene; if (original.sourceVersion.hash !== sourceHash || original.causalMappings.instruments.some(instrument => instrument.sourceKind !== 'TerrainWorkCommitted' || instrument.workChangePolicy !== 'solid' || instrument.changedOnly !== true)) throw new Error('Circuit work scores require the exact original successful-work arrangements.');
    const dependencies = [...base.dependencies, ...reference.assetHashes.map(hash => ({ kind: 'asset', id: 'sha256:' + hash, revision: 1, hash, description: 'Exact original component atlas, kit and production ancestry; complete verified source-rate material required before publication' }))],
      scene = validatePerformanceScene({ ...original, id: original.id + '.circuit.' + suffix, title: original.title.replace('Builder-Miner Workshop', 'Circuit Workshop').replace('dry modal', 'actual work components'),
        description: 'The original finite work benches, entrant spacing and explicitly armed skill stations play the exact saved component kit: ' + definition.name.slice(0, 96) + '. Successful builder solid changes select Deep kick, actual miner substrokes select Snare, and an optional third basher selects Closed hat. Rejected, protected and zero-change work creates no substitute strike. One accepted work source owns its body/noise/metal regions, release and lane-kit choke lifetime; four clap lobes remain one source when that articulation is used elsewhere. WEIGHT/SNAP/METAL/DAMP change later strikes without changing the work or its timing. ROOM opens a separately prepared shared return for the physical owner sum; private rehearsal starts dry. The original dry work scene remains the direct physical timing comparison. Source-pool admission, dense headroom, device and listening qualification remain pending.',
        patchRefs: original.patchRefs.map(patch => ({ laneId: patch.laneId, reference })),
        causalMappings: { ...original.causalMappings, instruments: original.causalMappings.instruments.map(instrument => { const lane = instrument.sourceLanes[0], voice = voices[lane]; if (!voice) throw new Error('This score supports the original two- or three-worker arrangements only.'); return { ...instrument, pitchCents: voice.gmNote * 100, sampleGesture: voice.articulationId, sampleKitId: 'workshop-circuit-' + suffix, role: 'actual-work-' + voice.id }; }) },
        physicalControls: [...original.physicalControls.filter(control => ['stagger', 'focus'].includes(control.id)), ...controls.map(id => ({ id, label: id.toUpperCase() + ' · later actual work strikes', scope: 'sound', unit: 'normalized', minimum: 0, maximum: 1, initial: definition.macros.find(macro => macro.id === id).default01, step: 0.01, target: 'patch-macro:' + id + ';next-onset-only' })),
          { id: 'room', label: 'ROOM · explicit shared return', scope: 'sound', unit: 'normalized', minimum: 0, maximum: 0.65, initial: 0.2, step: 0.01, target: 'family-room:circuit;physical-owner;explicit-prepare' }],
        expectedLandmarks: [...original.expectedLandmarks, { id: 'actual-circuit-work', observationKind: 'TerrainWorkCommitted', sourceObjectId: 'builder-miner-work-0', consequence: 'Each actual successful work operation selects one exact kit articulation and one logical source with three co-owned component readers.', help: 'Inspect the work cause, saved kit hash, selected source region and component count. Mute/solo and timbre controls leave the real operation untouched; unknown material or rejected assignments create no compensating note.' }],
        requirements: { ...original.requirements, required: dependencies }, cost: { ...original.cost, maximumVoices: original.cost.lanes * definition.voicePolicy.maxVoices },
        credits: [...original.credits, { name: definition.author || 'Saved source author', role: 'Exact saved original Circuit component kit and verified production ancestry', source: null }], lessonLevel: 2 });
    output.push(freezeData({ ...base, scene, dependencies }));
  }
  return freezeData(output);
}
