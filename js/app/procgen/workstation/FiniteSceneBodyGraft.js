import { validateSoundContentReference, resolveSoundContentReference } from '../../../midi/content/SoundContentReference.js';

export async function resolveFiniteSceneBodyGraft(raw, descriptor, { signal } = {}) {
  const reference = validateSoundContentReference(raw), definition = reference?.definition, p = definition?.parameters, map = definition?.sampleMap;
  if (descriptor?.engineId !== 'worklet-sample' || descriptor.capabilities?.feedforwardSampleBody !== true || definition?.engineId !== 'worklet-sample' || definition.voicePolicy.maxVoices > 8 || definition.voicePolicy.maxVoices > descriptor.maximumVoices || !Number.isInteger(p?.graftModeCount) || p.graftModeCount < 1 || p.graftModeCount > 8 || p.graftExcitationMode !== 0 || !(p.graftSupportSeconds >= 0.001 && p.graftSupportSeconds <= 0.5) || definition.sampleRefs.length < 1 || definition.sampleRefs.length > 8 || !map?.zones?.length || map.zones.some(zone => zone.playbackMode !== 'forward' || zone.loop !== null || zone.pitchTracking !== 'fixed') || !['excite', 'body', 'damp', 'mix'].every(id => definition.macros.some(macro => macro.id === id && macro.mode === 'onset-only'))) throw new TypeError('Choose an installed finite sample/FM into private modal body graft with fixed-rate forward excitation and EXCITE/BODY/DAMP/MIX. Travel playback, loops and an ungrafted sample need their separate physical source.');
  const resolved = await resolveSoundContentReference(reference, { engineDescriptors: [descriptor], availableHashes: reference.assetHashes, signal });
  if (resolved.status !== 'ready') throw new TypeError('The finite scene strike needs its exact current-build engine and immutable definition: ' + resolved.status);
  return reference;
}
