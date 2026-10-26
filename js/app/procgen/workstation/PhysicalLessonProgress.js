import { freezeData } from '../../../core/CanonicalData.js';

export const PHYSICAL_LESSON_PROGRESS_KEY = 'lemmings.physical-lesson-progress.v1';
export function createPhysicalLessonProgress({ storage = null } = {}) {
  let records = {}, persistence = storage ? 'available' : 'session-only';
  const valid = record => record && Object.keys(record).every(key => ['version', 'physicalObserved', 'soundAccepted', 'reportedHearing', 'evidencePath'].includes(key)) && Number.isSafeInteger(record.version) && record.version > 0 && record.physicalObserved === true && typeof record.soundAccepted === 'boolean' && typeof record.reportedHearing === 'boolean' && (!record.reportedHearing || record.soundAccepted) && ['visual', 'reported-hearing'].includes(record.evidencePath);
  try {
    const raw = storage?.getItem(PHYSICAL_LESSON_PROGRESS_KEY);
    if (raw && raw.length <= 32768) { const saved = JSON.parse(raw); if (saved?.schema === 'lemmings-physical-lesson-progress/v1' && saved.records && !Array.isArray(saved.records) && Object.keys(saved.records).length <= 32) for (const [id, record] of Object.entries(saved.records)) if (/^[a-z][a-z0-9._:-]{0,127}$/i.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id) && valid(record)) records[id] = { ...record }; }
  } catch { persistence = 'session-only;storage-unavailable'; }
  return Object.freeze({
    read(id, version) { return records[id]?.version === version ? freezeData({ ...records[id] }) : null; },
    write(id, record) {
      if (!/^[a-z][a-z0-9._:-]{0,127}$/i.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || !valid(record) || !Object.hasOwn(records, id) && Object.keys(records).length >= 32) throw new TypeError('Invalid bounded independent lesson progress.');
      records[id] = { ...record };
      try { storage?.setItem(PHYSICAL_LESSON_PROGRESS_KEY, JSON.stringify({ schema: 'lemmings-physical-lesson-progress/v1', records })); } catch { persistence = 'session-only;storage-unavailable'; }
      return freezeData({ ...records[id] });
    },
    state() { return Object.freeze({ persistence, records: Object.keys(records).length, musicalProjectModified: false }); }
  });
}
