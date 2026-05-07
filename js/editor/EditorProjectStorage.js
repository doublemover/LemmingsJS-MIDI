import { getRuntimeDependency } from '../core/dependencies.js';

const EDITOR_PROJECT_VERSION = 1;
const EDITOR_PROJECT_BUNDLE_KIND = 'lemmings.editor.pack.bundle';
const PROJECT_STORAGE_KEYS = Object.freeze({
  index: 'lemmings.editor.projects',
  projectPrefix: 'lemmings.editor.project.'
});

let projectIdCounter = 0;
let levelIdCounter = 0;

const getDefaultStorage = () => getRuntimeDependency('localStorage', null);

const safeGetItem = (storage, key) => {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch (error) {
    return null;
  }
};

const safeSetItem = (storage, key, value) => {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch (error) {
    return false;
  }
};

const safeRemoveItem = (storage, key) => {
  try {
    storage?.removeItem?.(key);
    return true;
  } catch (error) {
    return false;
  }
};

const normalizeName = (name, fallback = 'Untitled') => {
  const trimmed = String(name || '').trim();
  return trimmed ? trimmed : fallback;
};

const normalizeId = (id) => {
  const trimmed = String(id || '').trim();
  return trimmed || null;
};

const createTimestampId = (prefix, now, counter) => {
  return `${prefix}-${now()}-${counter()}`;
};

const createEditorProjectId = (now = () => Date.now()) => {
  projectIdCounter = (projectIdCounter + 1) % 100000;
  return createTimestampId('project', now, () => projectIdCounter);
};

const createEditorProjectLevelId = (now = () => Date.now()) => {
  levelIdCounter = (levelIdCounter + 1) % 100000;
  return createTimestampId('level', now, () => levelIdCounter);
};

const getTextHeader = (text, key) => {
  const normalizedKey = String(key || '').trim().toUpperCase();
  if (!normalizedKey) return '';
  const pattern = new RegExp(`^\\s*${normalizedKey}\\s+(.+?)\\s*$`, 'mi');
  const match = String(text || '').match(pattern);
  return match ? match[1].trim() : '';
};

const sanitizeFileSegment = (value, fallback = 'level') => {
  const normalized = normalizeName(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
};

const sanitizeProjectLevel = (entry = {}, index = 0) => {
  const text = typeof entry.text === 'string' ? entry.text : '';
  const title = normalizeName(entry.title || getTextHeader(text, 'TITLE'), `Level ${index + 1}`);
  return {
    id: normalizeId(entry.id) || `level-${index + 1}`,
    title,
    style: normalizeName(entry.style || getTextHeader(text, 'STYLE'), ''),
    text,
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0
  };
};

const sanitizeEditorProject = (project = {}) => {
  const levels = Array.isArray(project.levels)
    ? project.levels.map((entry, index) => sanitizeProjectLevel(entry, index))
    : [];
  const activeLevelId = normalizeId(project.activeLevelId);
  const activeExists = activeLevelId && levels.some(level => level.id === activeLevelId);
  return {
    version: EDITOR_PROJECT_VERSION,
    id: normalizeId(project.id) || 'project',
    name: normalizeName(project.name, 'Untitled Project'),
    activeLevelId: activeExists ? activeLevelId : (levels[0]?.id || null),
    levels,
    createdAt: Number.isFinite(project.createdAt) ? project.createdAt : 0,
    updatedAt: Number.isFinite(project.updatedAt) ? project.updatedAt : 0
  };
};

const createEditorProjectLevel = (payload = {}) => {
  const now = Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now();
  return sanitizeProjectLevel({
    id: payload.id || createEditorProjectLevelId(payload.now || (() => now)),
    title: payload.title,
    style: payload.style,
    text: payload.text,
    updatedAt: now
  });
};

const createEditorProject = (payload = {}) => {
  const now = Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now();
  const levels = Array.isArray(payload.levels)
    ? payload.levels
    : (payload.text != null
      ? [createEditorProjectLevel({
        id: payload.levelId,
        title: payload.levelTitle || payload.title,
        style: payload.style,
        text: payload.text,
        updatedAt: now,
        now: payload.now
      })]
      : []);
  return sanitizeEditorProject({
    id: payload.id || createEditorProjectId(payload.now || (() => now)),
    name: payload.name || payload.title || 'Untitled Project',
    activeLevelId: payload.activeLevelId || levels[0]?.id || null,
    levels,
    createdAt: Number.isFinite(payload.createdAt) ? payload.createdAt : now,
    updatedAt: now
  });
};

const parseIndex = (raw) => {
  if (!raw) return { entries: [], shouldMigrate: false };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { entries: parsed, shouldMigrate: true };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
      const parsedVersion = Number(parsed.version);
      return {
        entries: parsed.entries,
        shouldMigrate: !Number.isFinite(parsedVersion) || parsedVersion !== EDITOR_PROJECT_VERSION
      };
    }
  } catch (error) {
    return { entries: [], shouldMigrate: false };
  }
  return { entries: [], shouldMigrate: false };
};

const sanitizeProjectIndex = (entries = []) => entries
  .filter(entry => normalizeId(entry?.id))
  .map(entry => ({
    id: normalizeId(entry.id),
    name: normalizeName(entry.name, 'Untitled Project'),
    levelCount: Number.isFinite(entry.levelCount) ? Math.max(0, entry.levelCount) : 0,
    activeLevelId: normalizeId(entry.activeLevelId),
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0
  }));

const compareSavedProjects = (a, b) => {
  const updatedA = Number.isFinite(a?.updatedAt) ? a.updatedAt : 0;
  const updatedB = Number.isFinite(b?.updatedAt) ? b.updatedAt : 0;
  if (updatedA !== updatedB) return updatedB - updatedA;
  const nameA = String(a?.name || '').toLowerCase();
  const nameB = String(b?.name || '').toLowerCase();
  if (nameA < nameB) return -1;
  if (nameA > nameB) return 1;
  return 0;
};

const writeProjectIndex = (storage, entries) => {
  return safeSetItem(storage, PROJECT_STORAGE_KEYS.index, JSON.stringify({
    version: EDITOR_PROJECT_VERSION,
    entries
  }));
};

const projectToIndexEntry = (project) => ({
  id: project.id,
  name: project.name,
  levelCount: project.levels.length,
  activeLevelId: project.activeLevelId,
  updatedAt: project.updatedAt
});

const listSavedProjects = (storage = getDefaultStorage()) => {
  const parsed = parseIndex(safeGetItem(storage, PROJECT_STORAGE_KEYS.index));
  const entries = sanitizeProjectIndex(parsed.entries);
  if (parsed.shouldMigrate && storage) {
    writeProjectIndex(storage, entries);
  }
  entries.sort(compareSavedProjects);
  return entries;
};

const loadEditorProject = (storage = getDefaultStorage(), id) => {
  const projectId = normalizeId(id);
  if (!storage || !projectId) return null;
  const raw = safeGetItem(storage, PROJECT_STORAGE_KEYS.projectPrefix + projectId);
  if (!raw) return null;
  try {
    return sanitizeEditorProject(JSON.parse(raw));
  } catch (error) {
    return null;
  }
};

const saveEditorProject = (storage = getDefaultStorage(), project) => {
  if (!storage || !project) return null;
  const now = Number.isFinite(project.updatedAt) ? project.updatedAt : Date.now();
  const sanitized = sanitizeEditorProject({
    ...project,
    updatedAt: now
  });
  if (!safeSetItem(storage, PROJECT_STORAGE_KEYS.projectPrefix + sanitized.id, JSON.stringify(sanitized))) {
    return sanitized.id;
  }
  const parsed = parseIndex(safeGetItem(storage, PROJECT_STORAGE_KEYS.index));
  const entries = sanitizeProjectIndex(parsed.entries);
  const nextEntry = projectToIndexEntry(sanitized);
  const existing = entries.find(entry => entry.id === sanitized.id);
  if (existing) {
    Object.assign(existing, nextEntry);
  } else {
    entries.push(nextEntry);
  }
  writeProjectIndex(storage, entries);
  return sanitized.id;
};

const deleteEditorProject = (storage = getDefaultStorage(), id) => {
  const projectId = normalizeId(id);
  if (!storage || !projectId) return false;
  safeRemoveItem(storage, PROJECT_STORAGE_KEYS.projectPrefix + projectId);
  const parsed = parseIndex(safeGetItem(storage, PROJECT_STORAGE_KEYS.index));
  const entries = sanitizeProjectIndex(parsed.entries).filter(entry => entry.id !== projectId);
  writeProjectIndex(storage, entries);
  return true;
};

const upsertEditorProjectLevel = (project, payload = {}) => {
  const sanitized = sanitizeEditorProject(project);
  const now = Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now();
  const level = sanitizeProjectLevel({
    id: payload.id || createEditorProjectLevelId(payload.now || (() => now)),
    title: payload.title,
    style: payload.style,
    text: payload.text,
    updatedAt: now
  });
  const index = sanitized.levels.findIndex(entry => entry.id === level.id);
  if (index === -1) {
    sanitized.levels.push(level);
  } else {
    sanitized.levels[index] = level;
  }
  sanitized.activeLevelId = level.id;
  sanitized.updatedAt = now;
  return sanitized;
};

const duplicateEditorProjectLevel = (project, levelId, payload = {}) => {
  const sanitized = sanitizeEditorProject(project);
  const sourceIndex = sanitized.levels.findIndex(level => level.id === levelId);
  if (sourceIndex === -1) return sanitized;
  const source = sanitized.levels[sourceIndex];
  const now = Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now();
  const duplicate = sanitizeProjectLevel({
    id: payload.id || createEditorProjectLevelId(payload.now || (() => now)),
    title: payload.title || `${source.title} Copy`,
    style: source.style,
    text: source.text,
    updatedAt: now
  });
  sanitized.levels.splice(sourceIndex + 1, 0, duplicate);
  sanitized.activeLevelId = duplicate.id;
  sanitized.updatedAt = now;
  return sanitized;
};

const renameEditorProjectLevel = (project, levelId, title, updatedAt = Date.now()) => {
  const sanitized = sanitizeEditorProject(project);
  const level = sanitized.levels.find(entry => entry.id === levelId);
  if (!level) return sanitized;
  level.title = normalizeName(title, level.title || 'Untitled');
  level.updatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  sanitized.updatedAt = level.updatedAt;
  return sanitized;
};

const deleteEditorProjectLevel = (project, levelId, updatedAt = Date.now()) => {
  const sanitized = sanitizeEditorProject(project);
  const index = sanitized.levels.findIndex(level => level.id === levelId);
  if (index === -1) return sanitized;
  sanitized.levels.splice(index, 1);
  const nextIndex = Math.min(index, sanitized.levels.length - 1);
  sanitized.activeLevelId = sanitized.levels[nextIndex]?.id || null;
  sanitized.updatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  return sanitized;
};

const createLevelsNxmi = (project) => {
  const lines = ['# Generated by Lemmings Editor project export'];
  for (const [index, level] of project.levels.entries()) {
    const file = `levels/${sanitizeFileSegment(level.title, `level-${index + 1}`)}-${level.id}.nxlv`;
    lines.push(`LEVEL ${index + 1} ${file} ${level.title}`);
  }
  return `${lines.join('\n')}\n`;
};

const createInfoNxmi = (project) => [
  '# Generated by Lemmings Editor project export',
  `TITLE ${project.name}`,
  `LEVELS ${project.levels.length}`,
  ''
].join('\n');

const createEditorProjectPackBundle = (project, options = {}) => {
  const sanitized = sanitizeEditorProject(project);
  const reportsByLevelId = options.reportsByLevelId || {};
  const files = [
    {
      path: 'info.nxmi',
      mediaType: 'text/plain',
      text: createInfoNxmi(sanitized)
    },
    {
      path: 'levels.nxmi',
      mediaType: 'text/plain',
      text: createLevelsNxmi(sanitized)
    },
    ...sanitized.levels.map((level, index) => ({
      path: `levels/${sanitizeFileSegment(level.title, `level-${index + 1}`)}-${level.id}.nxlv`,
      mediaType: 'text/plain',
      text: level.text
    }))
  ];
  return {
    kind: EDITOR_PROJECT_BUNDLE_KIND,
    schemaVersion: 1,
    exportedAt: options.exportedAt ?? Date.now(),
    project: {
      id: sanitized.id,
      name: sanitized.name,
      activeLevelId: sanitized.activeLevelId,
      levelCount: sanitized.levels.length,
      levels: sanitized.levels.map(level => ({
        id: level.id,
        title: level.title,
        style: level.style,
        path: files.find(file => file.path.includes(`${level.id}.nxlv`))?.path || null,
        validation: reportsByLevelId[level.id]?.summary || null
      }))
    },
    files,
    packValidationReport: options.packValidationReport || null,
    validationReports: sanitized.levels.map(level => ({
      levelId: level.id,
      title: level.title,
      report: reportsByLevelId[level.id] || null
    }))
  };
};

const __test__ = {
  compareSavedProjects,
  getTextHeader,
  sanitizeFileSegment
};

export {
  EDITOR_PROJECT_BUNDLE_KIND,
  EDITOR_PROJECT_VERSION,
  PROJECT_STORAGE_KEYS,
  createEditorProject,
  createEditorProjectId,
  createEditorProjectLevel,
  createEditorProjectLevelId,
  createEditorProjectPackBundle,
  deleteEditorProject,
  deleteEditorProjectLevel,
  duplicateEditorProjectLevel,
  listSavedProjects,
  loadEditorProject,
  renameEditorProjectLevel,
  saveEditorProject,
  sanitizeEditorProject,
  upsertEditorProjectLevel,
  __test__
};
