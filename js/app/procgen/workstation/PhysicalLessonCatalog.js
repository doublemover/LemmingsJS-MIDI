import { performanceSceneHash } from './PerformanceScene.js';
import { validatePhysicalLessonDefinition } from './PhysicalLessonDefinition.js';

export async function createInstalledPhysicalLessons(catalog) {
  const rows = catalog.registry.page({ limit: 64 }).rows, resolve = id => { const row = rows.find(value => value.id === id && value.supported); return row ? catalog.registry.resolve(row) : null; };
  const zero = resolve('practice.quiet-control'); if (!zero) return Object.freeze([]);
  const reference = async scene => ({ id: scene.id, version: scene.version, hash: await performanceSceneHash(scene) }), zeroNoteScene = await reference(zero), lessons = [];
  for (const spec of [
    { scene: 'practice.one-foot-one-sound', id: 'lesson.one-foot-one-sound', title: 'One Foot, One Sound', kind: 'pickup-relocation', actors: 1,
      prediction: 'First hear or inspect one actual crossing. Predict where the next pluck will occur after moving the visible pickup.', intervention: 'Pause, move the pickup in Physical authoring, then explicitly release a new finite entrant. Keep its sound unchanged.', difference: 'The next owned onset comes from the new world-space pickup position, with a different observed crossing time or location.', hint: 'The pickup is a physical observation gate. Moving a UI display or waiting does not move it.' },
    { scene: 'practice.space-becomes-rhythm', id: 'lesson.space-becomes-rhythm', title: 'Space Becomes Rhythm', kind: 'entry-spacing-change', actors: 2,
      prediction: 'Observe two actual crossings. Predict how a different finite entry spacing will change their arrival interval.', intervention: 'Use Release gestures to change the actual lane entry spacing and perform a new finite two-entrant phrase. Keep the pickup and sound unchanged.', difference: 'New actors have a different actual birth interval and a different pickup-arrival interval; the note schedule never moves them.', hint: 'A changed requested spacing alone is insufficient. Both new births and both arrivals must actually differ.' }
  ]) {
    const scene = resolve(spec.scene); if (!scene) continue;
    lessons.push(validatePhysicalLessonDefinition({ schema: 'lemmings-physical-lesson/v1', id: spec.id, version: 1, title: spec.title, setupScene: await reference(scene), zeroNoteScene,
      prediction: spec.prediction, intervention: spec.intervention, expectedPhysicalEvidence: 'Complete current-world causal batches and source-linked PickupCrossing begin intents for the visible practice pickup.', expectedMusicalDifference: spec.difference,
      audibleEvidence: 'Sound acceptance is separate from physical success. Only explicitly report hearing after the backend accepted the matching new causes. Visual evidence does not verify hearing or rendered PCM.', hint: spec.hint,
      permittedActions: spec.kind === 'pickup-relocation' ? ['move-pickup', 'finite-release', 'play-pause'] : ['change-release-spacing', 'finite-release', 'play-pause'], success: { kind: spec.kind, pickupId: 'practice-pickup', mappingIds: scene.causalMappings.instruments.map(item => item.id), minimumActors: spec.actors },
      resetCheckpoint: 'fresh-zero-tick-setup-via-existing-scene-owner', accessibility: 'semantic-controls;keyboard-touch-controller-actions-shared;sound-off-physical-evidence;no-microphone' }));
  }
  return Object.freeze(lessons);
}
