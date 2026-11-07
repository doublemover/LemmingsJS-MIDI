import {
  createMidiProjectTemplate,
  createMidiProjectFromMidiConfig,
  sanitizeMidiProject,
  importMidiProjectPayload,
  MIDI_PROJECT_VERSION
} from './MidiProject.js';

const PROJECT_STORAGE_KEY = 'lemmings.midi.project.v1';
const TEMPLATE_STORAGE_KEY = 'lemmings.midi.templates.v1';
const FACTORY_TEMPLATE_ID = 'midi-mapping';

const LEGACY_MIDI_STORAGE_KEYS = Object.freeze([
  'lemmings.midi.intent',
  'lemmings.midi.overrides',
  'lemmings.midi.inputId',
  'lemmings.midi.outputId',
  'lemmings.midi.enabled',
  'lemmings.midi.inputChannel',
  'lemmings.midi.viewPan',
  'lemmings.midi.adsrTarget',
  'lemmings.midi.tabLeft',
  'lemmings.midi.tabRight',
  'lemmings.midi.sectionStates',
  'lemmings.midi.schemaHash',
  'lemmings.midi.storageVersion',
  'lemmings.midi.panelCollapsed',
  'lemmings.midi.ui.audition'
]);

const MAX_STORED_CHARACTERS = 8 * 1048576;
const storageRead = (storage, key) => {
  if (typeof storage?.getItem !== 'function') return { state: 'unavailable', key, raw: null, diagnostic: 'Storage is unavailable.' };
  let raw = null;
  try {
    raw = storage.getItem(key);
    if (raw == null) return { state: 'absent', key, raw: null };
    if (typeof raw !== 'string' || raw.length > MAX_STORED_CHARACTERS) return { state: 'unsupported', key, raw, diagnostic: 'Stored data exceeds the admitted format or size.' };
    return { state: 'ready', key, raw, parsed: JSON.parse(raw) };
  } catch (error) {
    return { state: error instanceof SyntaxError ? 'corrupt' : 'unavailable', key,
      raw,
      diagnostic: error instanceof SyntaxError ? 'Stored data is not valid JSON.' : 'Stored data could not be read.' };
  }
};
const protectedRead = outcome => !['ready', 'absent'].includes(outcome.state);
const versionError = message => Object.assign(new Error(message), { code: 'unsupported-version' });
const admitProject = value => {
  if (value?.version !== MIDI_PROJECT_VERSION) throw versionError('Stored MIDI project version is unsupported. Export it before resetting storage.');
  return importMidiProjectPayload(value);
};
const rejectedRead = (outcome, error) => ({ ...outcome, parsed: undefined,
  state: error.code === 'unsupported-version' || /version|Legacy|conversion/.test(error.message) ? 'unsupported' : 'corrupt', diagnostic: error.message });
const readStoredMidiProjectOutcome = storage => {
  const outcome = storageRead(storage, PROJECT_STORAGE_KEY);
  if (outcome.state !== 'ready') return { ...outcome, project: null };
  try { return { ...outcome, parsed: undefined, project: admitProject(outcome.parsed) }; }
  catch (error) { return { ...rejectedRead(outcome, error), project: null }; }
};
const readStoredMidiProjectTemplatesOutcome = storage => {
  const outcome = storageRead(storage, TEMPLATE_STORAGE_KEY), templates = [], rejected = [];
  if (outcome.state !== 'ready') return { ...outcome, templates, rejected };
  const envelope = outcome.parsed;
  if (!envelope || Array.isArray(envelope) || envelope.version !== MIDI_PROJECT_VERSION || !Array.isArray(envelope.templates) || envelope.templates.length > 4096)
    return { ...rejectedRead(outcome, versionError('Stored template library format/version is unsupported.')), templates, rejected };
  const ids = new Set();
  for (let index = 0; index < envelope.templates.length; index++) {
    const entry = envelope.templates[index];
    try {
      if (entry?.version !== MIDI_PROJECT_VERSION) throw versionError('Stored template version is unsupported.');
      if (typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)) throw new Error('Stored template identity is invalid or duplicated.');
      ids.add(entry.id); templates.push(createMidiProjectTemplate(admitProject(entry.project), entry));
    } catch (error) { rejected.push({ index, id: typeof entry?.id === 'string' ? entry.id : null,
      state: rejectedRead(outcome, error).state, diagnostic: error.message, rawPayload: entry }); }
  }
  return { ...outcome, parsed: undefined, state: rejected.length ? rejected.some(entry => entry.state === 'unsupported') ? 'unsupported' : 'corrupt' : 'ready', templates, rejected,
    diagnostic: rejected.length ? 'Stored template library is protected because some entries cannot be admitted. Export the original data before explicitly resetting it.' : null };
};

const safeSetItem = (storage, key, value) => {
  if (typeof storage?.setItem !== 'function') return { persisted: false, reason: 'unavailable' };
  try {
    storage.setItem(key, value);
    return { persisted: true, reason: null };
  } catch {
    // Valid session state remains usable when durable storage rejects the write.
    return { persisted: false, reason: 'write-failed' };
  }
};

const safeRemoveItem = (storage, key) => {
  try {
    storage?.removeItem?.(key);
  } catch (e) {
    // Storage cleanup is best-effort for private browsing and test doubles.
  }
};

const cleanupLegacyMidiProjectStorage = (storage) => {
  for (const key of LEGACY_MIDI_STORAGE_KEYS) {
    safeRemoveItem(storage, key);
  }
};

const saveMidiProjectWithOutcome = (storage, project) => {
  const clean = sanitizeMidiProject(project);
  const existing = readStoredMidiProjectOutcome(storage);
  if (protectedRead(existing)) return { project: clean, persisted: false, reason: existing.state === 'unavailable' ? 'unavailable' : 'protected-storage', readState: existing.state, diagnostic: existing.diagnostic };
  return { project: clean, ...safeSetItem(storage, PROJECT_STORAGE_KEY, JSON.stringify(clean)) };
};

const saveMidiProject = (storage, project) => saveMidiProjectWithOutcome(storage, project).project;

const readStoredMidiProject = (storage) => {
  return readStoredMidiProjectOutcome(storage).project;
};

const readStoredMidiProjectTemplates = (storage) => {
  return readStoredMidiProjectTemplatesOutcome(storage).templates;
};

const saveStoredMidiProjectTemplates = (storage, templates) => {
  const clean = Array.isArray(templates)
    ? templates.map(template => createMidiProjectTemplate(template?.project, template))
    : [];
  if (!protectedRead(readStoredMidiProjectTemplatesOutcome(storage))) safeSetItem(storage, TEMPLATE_STORAGE_KEY, JSON.stringify({ version: 1, templates: clean }));
  return clean;
};

const saveMidiProjectTemplateWithOutcome = (storage, project, options = {}) => {
  const existing = readStoredMidiProjectTemplatesOutcome(storage), templates = existing.templates;
  const previous = options.asNew ? null : templates.find(entry => entry.id === (options.id || project.templateId));
  const templateOptions = { ...(previous ? { name: previous.name, createdAt: previous.createdAt } : {}), ...options };
  if (options.asNew) {
    const base = options.id || 'user-template-' + (Number.isFinite(options.now) ? options.now : Date.now());
    let id = base, suffix = 1;
    while (templates.some(entry => entry.id === id)) id = base + '-' + suffix++;
    templateOptions.id = id;
  }
  const template = createMidiProjectTemplate(project, templateOptions);
  if (protectedRead(existing)) return { template, persisted: false, reason: existing.state === 'unavailable' ? 'unavailable' : 'protected-storage',
    readState: existing.state, diagnostic: existing.diagnostic };
  const next = templates.filter(entry => entry.id !== template.id);
  next.push(template);
  const outcome = safeSetItem(storage, TEMPLATE_STORAGE_KEY, JSON.stringify({ version: 1, templates: next }));
  return { template, ...outcome };
};

const saveMidiProjectTemplate = (storage, project, options = {}) => (
  saveMidiProjectTemplateWithOutcome(storage, project, options).template
);

const resolveStoredMidiProjectTemplate = (storage, templateId) => (
  readStoredMidiProjectTemplates(storage)
    .find(template => template.id === templateId) || null
);

const loadMidiProject = (storage, factoryConfig = {}) => {
  cleanupLegacyMidiProjectStorage(storage);
  return readStoredMidiProject(storage) || createMidiProjectFromMidiConfig(factoryConfig);
};

const resetMidiProjectStorage = (storage, factoryConfig = {}, templateId = FACTORY_TEMPLATE_ID, { persist = true } = {}) => {
  cleanupLegacyMidiProjectStorage(storage);
  const template = templateId && templateId !== FACTORY_TEMPLATE_ID
    ? resolveStoredMidiProjectTemplate(storage, templateId)
    : null;
  const project = template
    ? sanitizeMidiProject({
      ...template.project,
      id: template.project.id,
      name: template.name,
      templateId: template.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    : createMidiProjectFromMidiConfig(factoryConfig);
  return persist ? saveMidiProject(storage, project) : project;
};

const clearMidiProjectStorage = (storage) => {
  cleanupLegacyMidiProjectStorage(storage);
  safeRemoveItem(storage, PROJECT_STORAGE_KEY);
};

const resetProtectedMidiStorage = (storage, { key, expectedRaw } = {}) => {
  if (![PROJECT_STORAGE_KEY, TEMPLATE_STORAGE_KEY].includes(key) || typeof expectedRaw !== 'string') throw new Error('Reset requires the exact rejected storage record.');
  try {
    if (storage?.getItem?.(key) !== expectedRaw) return { reset: false, reason: 'storage-changed' };
    if (typeof storage.removeItem !== 'function') return { reset: false, reason: 'unavailable' };
    storage.removeItem(key); return { reset: storage.getItem(key) == null, reason: null };
  } catch { return { reset: false, reason: 'unavailable' }; }
};

export {
  LEGACY_MIDI_STORAGE_KEYS,
  PROJECT_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
  cleanupLegacyMidiProjectStorage,
  clearMidiProjectStorage,
  loadMidiProject,
  readStoredMidiProject,
  readStoredMidiProjectOutcome,
  readStoredMidiProjectTemplatesOutcome,
  readStoredMidiProjectTemplates,
  resetMidiProjectStorage,
  resetProtectedMidiStorage,
  resolveStoredMidiProjectTemplate,
  saveMidiProject,
  saveMidiProjectWithOutcome,
  saveMidiProjectTemplate,
  saveMidiProjectTemplateWithOutcome,
  saveStoredMidiProjectTemplates
};
