import { getRuntimeDependency } from '../core/dependencies.js';

const EDITOR_PROJECT_VERSION = 1;
const EDITOR_PROJECT_BUNDLE_KIND = 'lemmings.editor.pack.bundle';
const EDITOR_PROJECT_ARCHIVE_KIND = 'lemmings.editor.pack.archive';
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

const normalizeArchivePath = (path) => String(path || '')
  .replace(/\\/g, '/')
  .replace(/^\/+/, '')
  .replace(/\/+/g, '/')
  .trim();

const createArchiveReportIssue = (code, message, options = {}) => ({
  index: Number.isFinite(options.index) ? options.index : 0,
  source: 'pack-archive-install',
  severity: options.severity || 'error',
  code,
  target: options.target || 'pack',
  message,
  blocker: options.blocker !== false,
  blocksEditing: false,
  blocksExport: options.blocksExport !== false,
  destructive: false,
  exportFormat: null,
  hasFix: false,
  fixLabel: null,
  metadata: options.metadata || {}
});

const createArchiveInstallReport = (issues = [], metadata = {}) => {
  const summary = {
    total: issues.length,
    errors: issues.filter(issue => issue.severity === 'error').length,
    warnings: issues.filter(issue => issue.severity === 'warning').length,
    infos: issues.filter(issue => issue.severity === 'info').length,
    blockers: issues.filter(issue => issue.blocker === true).length,
    destructive: 0,
    unsupportedPreservedData: 0
  };
  return {
    kind: 'editor-pack-archive-install-report',
    schemaVersion: 1,
    summary,
    pack: {
      title: String(metadata.title || ''),
      levelCount: Number.isFinite(metadata.levelCount) ? metadata.levelCount : 0,
      fileCount: Number.isFinite(metadata.fileCount) ? metadata.fileCount : 0
    },
    issues
  };
};

const normalizeArchiveFiles = (archive = {}) => {
  const rawFiles = Array.isArray(archive.files)
    ? archive.files
    : (Array.isArray(archive.entries) ? archive.entries : []);
  const files = [];
  for (const [index, file] of rawFiles.entries()) {
    const path = normalizeArchivePath(file?.path);
    if (!path) continue;
    const text = typeof file.text === 'string' ? file.text : String(file?.content || '');
    files.push({
      path,
      mediaType: file?.mediaType || 'text/plain',
      text,
      size: Number.isFinite(file?.size) ? file.size : text.length,
      index
    });
  }
  return files;
};

const getArchiveFileMap = (files, issues) => {
  const map = new Map();
  for (const file of files) {
    if (map.has(file.path)) {
      issues.push(createArchiveReportIssue(
        'pack_archive_duplicate_path',
        `Pack archive contains duplicate path ${file.path}.`,
        { target: file.path, index: issues.length }
      ));
      continue;
    }
    map.set(file.path, file);
  }
  return map;
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

const createEditorProjectPackArchive = (project, options = {}) => {
  const bundle = createEditorProjectPackBundle(project, options);
  const files = bundle.files.map(file => ({
    path: normalizeArchivePath(file.path),
    mediaType: file.mediaType || 'text/plain',
    encoding: 'utf8',
    size: String(file.text || '').length,
    text: String(file.text || '')
  }));
  return {
    kind: EDITOR_PROJECT_ARCHIVE_KIND,
    schemaVersion: 1,
    exportedAt: bundle.exportedAt,
    project: bundle.project,
    manifest: {
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      validationSummary: bundle.packValidationReport?.summary || null
    },
    files,
    packValidationReport: bundle.packValidationReport,
    validationReports: bundle.validationReports
  };
};

const parseEditorProjectPackArchive = (input) => {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (error) {
      return null;
    }
  }
  return input && typeof input === 'object' ? input : null;
};

const getArchiveProjectLevelDescriptors = (archive, files) => {
  const declared = Array.isArray(archive?.project?.levels) ? archive.project.levels : [];
  if (declared.length) {
    return declared.map((level, index) => ({
      id: normalizeId(level?.id) || `level-${index + 1}`,
      title: normalizeName(level?.title, `Level ${index + 1}`),
      style: normalizeName(level?.style, ''),
      path: normalizeArchivePath(level?.path),
      index
    }));
  }
  return files
    .filter(file => /^levels\/.+\.nxlv$/i.test(file.path))
    .map((file, index) => ({
      id: `level-${index + 1}`,
      title: getTextHeader(file.text, 'TITLE') || `Level ${index + 1}`,
      style: getTextHeader(file.text, 'STYLE') || '',
      path: file.path,
      index
    }));
};

const createEditorProjectFromPackArchive = (input, options = {}) => {
  const archive = parseEditorProjectPackArchive(input);
  const issues = [];
  if (!archive) {
    const report = createArchiveInstallReport([
      createArchiveReportIssue(
        'pack_archive_parse_failed',
        'Pack archive JSON could not be parsed.'
      )
    ]);
    return { ok: false, project: null, report, archive: null };
  }

  if (archive.kind !== EDITOR_PROJECT_ARCHIVE_KIND && archive.kind !== EDITOR_PROJECT_BUNDLE_KIND) {
    issues.push(createArchiveReportIssue(
      'pack_archive_kind_unsupported',
      'Pack archive kind is not supported.',
      { metadata: { kind: archive.kind || null } }
    ));
  }

  const files = normalizeArchiveFiles(archive);
  const fileMap = getArchiveFileMap(files, issues);
  for (const requiredPath of ['info.nxmi', 'levels.nxmi']) {
    if (!fileMap.has(requiredPath)) {
      issues.push(createArchiveReportIssue(
        'pack_archive_missing_manifest',
        `Pack archive is missing ${requiredPath}.`,
        { target: requiredPath, index: issues.length }
      ));
    }
  }

  const descriptors = getArchiveProjectLevelDescriptors(archive, files);
  const levels = [];
  if (!descriptors.length) {
    issues.push(createArchiveReportIssue(
      'pack_archive_missing_levels',
      'Pack archive contains no installable .nxlv levels.',
      { target: 'levels', index: issues.length }
    ));
  }

  for (const descriptor of descriptors) {
    const file = descriptor.path ? fileMap.get(descriptor.path) : null;
    if (!file) {
      issues.push(createArchiveReportIssue(
        'pack_archive_missing_level_file',
        `Pack archive is missing level file ${descriptor.path || '(none)'}.`,
        { target: descriptor.path || `levels.${descriptor.index}`, index: issues.length }
      ));
      continue;
    }
    levels.push(sanitizeProjectLevel({
      id: descriptor.id,
      title: descriptor.title || getTextHeader(file.text, 'TITLE'),
      style: descriptor.style || getTextHeader(file.text, 'STYLE'),
      text: file.text,
      updatedAt: Number.isFinite(options.updatedAt) ? options.updatedAt : 0
    }, descriptor.index));
  }

  const metadata = {
    title: archive.project?.name || getTextHeader(fileMap.get('info.nxmi')?.text, 'TITLE') || 'Installed Pack',
    levelCount: levels.length,
    fileCount: files.length
  };
  const report = createArchiveInstallReport(issues, metadata);
  if (report.summary.blockers > 0) {
    return { ok: false, project: null, report, archive };
  }

  const project = createEditorProject({
    id: options.id || archive.project?.id || undefined,
    name: metadata.title,
    levels,
    activeLevelId: archive.project?.activeLevelId || levels[0]?.id || null,
    createdAt: Number.isFinite(options.createdAt) ? options.createdAt : Date.now(),
    updatedAt: Number.isFinite(options.updatedAt) ? options.updatedAt : Date.now()
  });
  return { ok: true, project, report, archive };
};

const installEditorProjectPackArchive = (storage = getDefaultStorage(), input, options = {}) => {
  const result = createEditorProjectFromPackArchive(input, options);
  if (!result.ok || !result.project) {
    return { ...result, projectId: null };
  }
  const projectId = options.save === false
    ? result.project.id
    : saveEditorProject(storage, result.project);
  return {
    ...result,
    projectId
  };
};

const __test__ = {
  compareSavedProjects,
  getTextHeader,
  sanitizeFileSegment
};

export {
  EDITOR_PROJECT_ARCHIVE_KIND,
  EDITOR_PROJECT_BUNDLE_KIND,
  EDITOR_PROJECT_VERSION,
  PROJECT_STORAGE_KEYS,
  createEditorProject,
  createEditorProjectId,
  createEditorProjectLevel,
  createEditorProjectFromPackArchive,
  createEditorProjectPackArchive,
  createEditorProjectLevelId,
  createEditorProjectPackBundle,
  deleteEditorProject,
  deleteEditorProjectLevel,
  duplicateEditorProjectLevel,
  installEditorProjectPackArchive,
  listSavedProjects,
  loadEditorProject,
  renameEditorProjectLevel,
  saveEditorProject,
  sanitizeEditorProject,
  upsertEditorProjectLevel,
  __test__
};
