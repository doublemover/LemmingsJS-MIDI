import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';

export const PHYSICAL_LESSON_SCHEMA = 'lemmings-physical-lesson/v1';
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reference = value => value && id(value.id) && Number.isSafeInteger(value.version) && value.version > 0 && hash(value.hash);

export function validatePhysicalLessonDefinition(value) {
  canonicalDataText(value, { maxBytes: 32768, maxNodes: 2048 });
  if (!value || Object.keys(value).some(key => !['schema', 'id', 'version', 'title', 'setupScene', 'zeroNoteScene', 'prediction', 'intervention', 'expectedPhysicalEvidence', 'expectedMusicalDifference', 'audibleEvidence', 'hint', 'permittedActions', 'success', 'resetCheckpoint', 'accessibility'].includes(key)) || value.schema !== PHYSICAL_LESSON_SCHEMA || !id(value.id) || !Number.isSafeInteger(value.version) || value.version < 1 || !text(value.title, 160) || !reference(value.setupScene) || !reference(value.zeroNoteScene)) throw new TypeError('Lesson needs a versioned definition and exact installed setup/control scenes.');
  for (const key of ['prediction', 'intervention', 'expectedPhysicalEvidence', 'expectedMusicalDifference', 'audibleEvidence', 'hint']) if (!text(value[key], 2048)) throw new TypeError('Lesson needs its prediction, real intervention and separate evidence explanations.');
  if (!Array.isArray(value.permittedActions) || !value.permittedActions.length || value.permittedActions.length > 8 || value.permittedActions.some(action => !id(action)) || new Set(value.permittedActions).size !== value.permittedActions.length || value.resetCheckpoint !== 'fresh-zero-tick-setup-via-existing-scene-owner' || value.accessibility !== 'semantic-controls;keyboard-touch-controller-actions-shared;sound-off-physical-evidence;no-microphone') throw new TypeError('Lesson controls and reset/accessibility policy are invalid.');
  const predicate = value.success, kind = predicate?.kind;
  const allowed = ['kind', 'mappingIds', 'minimumActors', ...(kind === 'productive-work' ? ['minimumContacts'] : ['pickupId']), ...(kind === 'route-delay-change' ? ['junctionId', 'configurationId'] : []), ...(kind === 'formation-and-timbre' ? ['formationId', 'fieldId', 'macroId', 'macroDefault01'] : [])];
  if (!predicate || Object.keys(predicate).some(key => !allowed.includes(key)) || !['pickup-relocation', 'entry-spacing-change', 'productive-work', 'route-delay-change', 'formation-and-timbre'].includes(kind) || kind !== 'productive-work' && !id(predicate.pickupId) || !Array.isArray(predicate.mappingIds) || !predicate.mappingIds.length || predicate.mappingIds.length > 8 || predicate.mappingIds.some(item => !id(item)) || new Set(predicate.mappingIds).size !== predicate.mappingIds.length || predicate.minimumActors !== (kind === 'entry-spacing-change' ? 2 : kind === 'formation-and-timbre' ? 3 : 1)) throw new TypeError('Unsupported observed lesson predicate.');
  if (kind === 'productive-work' && predicate.minimumContacts !== 2 || kind === 'route-delay-change' && (!id(predicate.junctionId) || !id(predicate.configurationId)) || kind === 'formation-and-timbre' && (![predicate.formationId, predicate.fieldId, predicate.macroId].every(id) || !Number.isFinite(predicate.macroDefault01) || predicate.macroDefault01 < 0 || predicate.macroDefault01 > 1)) throw new TypeError('The lesson requires its complete bounded observation contract.');
  return freezeData(structuredClone(value));
}
