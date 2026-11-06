import { freezeData } from '../../../core/CanonicalData.js';

export const PHYSICAL_LESSON_PROGRESS_KEY = 'lemmings.physical-lesson-progress.v1';
export function createPhysicalLessonProgress({ storage = null } = {}) {
  let records = {}, dismissed = {}, persistence = storage ? 'available' : 'session-only';
  const validId = id => /^[a-z][a-z0-9._:-]{0,127}$/i.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
  const save = () => { try { storage?.setItem(PHYSICAL_LESSON_PROGRESS_KEY, JSON.stringify({ schema: 'lemmings-physical-lesson-progress/v1', records, dismissed })); } catch { persistence = 'session-only;storage-unavailable'; } };
  const valid = record => record && Object.keys(record).every(key => ['version', 'physicalObserved', 'soundAccepted', 'reportedHearing', 'evidencePath'].includes(key)) && Number.isSafeInteger(record.version) && record.version > 0 && record.physicalObserved === true && typeof record.soundAccepted === 'boolean' && typeof record.reportedHearing === 'boolean' && (!record.reportedHearing || record.soundAccepted) && ['visual', 'reported-hearing'].includes(record.evidencePath);
  try {
    const raw = storage?.getItem(PHYSICAL_LESSON_PROGRESS_KEY);
    if (raw && raw.length <= 32768) { const saved = JSON.parse(raw); if (saved?.schema === 'lemmings-physical-lesson-progress/v1') {
      if (saved.records && !Array.isArray(saved.records) && Object.keys(saved.records).length <= 32) for (const [id, record] of Object.entries(saved.records)) if (validId(id) && valid(record)) records[id] = { ...record };
      if (saved.dismissed && !Array.isArray(saved.dismissed) && Object.keys(saved.dismissed).length <= 32) for (const [id, version] of Object.entries(saved.dismissed)) if (validId(id) && Number.isSafeInteger(version) && version > 0) dismissed[id] = version;
    } }
  } catch { persistence = 'session-only;storage-unavailable'; }
  return Object.freeze({
    read(id, version) { return records[id]?.version === version ? freezeData({ ...records[id] }) : null; },
    write(id, record) {
      if (!/^[a-z][a-z0-9._:-]{0,127}$/i.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || !valid(record) || !Object.hasOwn(records, id) && Object.keys(records).length >= 32) throw new TypeError('Invalid bounded independent lesson progress.');
      records[id] = { ...record };
      save();
      return freezeData({ ...records[id] });
    },
    dismiss(id, version) { if (!validId(id) || !Number.isSafeInteger(version) || version < 1 || !Object.hasOwn(dismissed, id) && Object.keys(dismissed).length >= 32) throw new TypeError('Invalid lesson dismissal.'); dismissed[id] = version; save(); },
    isDismissed: (id, version) => dismissed[id] === version,
    reset() { records = {}; dismissed = {}; save(); },
    state() { return Object.freeze({ persistence, records: Object.keys(records).length, dismissed: Object.keys(dismissed).length, musicalProjectModified: false }); }
  });
}
