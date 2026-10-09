import {
  createMidiProjectTemplate,
  createMidiProjectFromMidiConfig,
  sanitizeMidiProject
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

const safeGetItem = (storage, key) => {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch (e) {
    return null;
  }
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
  return { project: clean, ...safeSetItem(storage, PROJECT_STORAGE_KEY, JSON.stringify(clean)) };
};

const saveMidiProject = (storage, project) => saveMidiProjectWithOutcome(storage, project).project;

const readStoredMidiProject = (storage) => {
  const raw = safeGetItem(storage, PROJECT_STORAGE_KEY);
  if (!raw) return null;
  try {
    return sanitizeMidiProject(JSON.parse(raw));
  } catch (e) {
    return null;
  }
};

const readStoredMidiProjectTemplates = (storage) => {
  const raw = safeGetItem(storage, TEMPLATE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : parsed.templates;
    if (!Array.isArray(entries)) return [];
    return entries
      .map(template => createMidiProjectTemplate(template?.project, template))
      .filter(template => template.id);
  } catch (e) {
    return [];
  }
};

const saveStoredMidiProjectTemplates = (storage, templates) => {
  const clean = Array.isArray(templates)
    ? templates.map(template => createMidiProjectTemplate(template?.project, template))
    : [];
  safeSetItem(storage, TEMPLATE_STORAGE_KEY, JSON.stringify({ version: 1, templates: clean }));
  return clean;
};

const saveMidiProjectTemplateWithOutcome = (storage, project, options = {}) => {
  const templates = readStoredMidiProjectTemplates(storage);
  const previous = options.asNew ? null : templates.find(entry => entry.id === (options.id || project.templateId));
  const templateOptions = { ...(previous ? { name: previous.name, createdAt: previous.createdAt } : {}), ...options };
  if (options.asNew) {
    const base = options.id || 'user-template-' + (Number.isFinite(options.now) ? options.now : Date.now());
    let id = base, suffix = 1;
    while (templates.some(entry => entry.id === id)) id = base + '-' + suffix++;
    templateOptions.id = id;
  }
  const template = createMidiProjectTemplate(project, templateOptions);
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

export {
  LEGACY_MIDI_STORAGE_KEYS,
  PROJECT_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
  cleanupLegacyMidiProjectStorage,
  clearMidiProjectStorage,
  loadMidiProject,
  readStoredMidiProject,
  readStoredMidiProjectTemplates,
  resetMidiProjectStorage,
  resolveStoredMidiProjectTemplate,
  saveMidiProject,
  saveMidiProjectWithOutcome,
  saveMidiProjectTemplate,
  saveMidiProjectTemplateWithOutcome,
  saveStoredMidiProjectTemplates
};
