const CLASSIC_SKILL_NAMES = new Set([
  'CLIMBER',
  'FLOATER',
  'BOMBER',
  'BLOCKER',
  'BUILDER',
  'BASHER',
  'MINER',
  'DIGGER'
]);

const countLines = (lines) => {
  if (!Array.isArray(lines)) return 0;
  return lines.filter(line => String(line ?? '').trim()).length;
};

const getEntries = (level, key) => Array.isArray(level?.[key]) ? level[key] : [];

const collectEntryUnknownLineCount = (level) => {
  let count = 0;
  for (const key of ['terrains', 'gadgets', 'steel']) {
    for (const entry of getEntries(level, key)) {
      count += countLines(entry?.unknownLines);
    }
  }
  for (const group of getEntries(level, 'terrainGroups')) {
    count += countLines(group?.unknownLines);
    const terrains = Array.isArray(group?.terrains) ? group.terrains : [];
    for (const terrain of terrains) {
      count += countLines(terrain?.unknownLines);
    }
  }
  return count;
};

const getPreservedUnknownDataSummary = (level) => {
  const unknownSections = Array.isArray(level?.unknownSections)
    ? level.unknownSections.length
    : 0;
  const unknownSectionLines = Array.isArray(level?.unknownSections)
    ? level.unknownSections.reduce((total, section) => total + countLines(section?.lines), 0)
    : 0;
  const topLevelLines = countLines(level?.unknownLines);
  const skillsetLines = countLines(level?.skillsetUnknownLines);
  const entryLines = collectEntryUnknownLineCount(level);
  const totalLines = unknownSectionLines + topLevelLines + skillsetLines + entryLines;
  const parts = [];
  if (unknownSections) parts.push(`${unknownSections} unknown section${unknownSections === 1 ? '' : 's'}`);
  if (totalLines) parts.push(`${totalLines} preserved line${totalLines === 1 ? '' : 's'}`);
  return {
    hasData: unknownSections > 0 || totalLines > 0,
    summary: parts.join(', ')
  };
};

const hasAnyProp = (entry, names) => {
  const props = entry?.props || null;
  if (!props) return false;
  return names.some(name => Object.prototype.hasOwnProperty.call(props, name));
};

const hasAnyEntryWithProps = (entries, names) => {
  return Array.isArray(entries) && entries.some(entry => hasAnyProp(entry, names));
};

const hasNonClassicSkill = (level) => {
  if (!level?.skillset?.keys) return false;
  for (const skill of level.skillset.keys()) {
    if (!CLASSIC_SKILL_NAMES.has(String(skill).toUpperCase())) return true;
  }
  return false;
};

const hasClassicExportUnsupportedProps = (level) => {
  const terrainUnsupported = ['ROTATE', 'FLIP_HORIZONTAL', 'WIDTH', 'HEIGHT', 'ONE_WAY'];
  const gadgetUnsupported = [
    'ROTATE',
    'FLIP_HORIZONTAL',
    'WIDTH',
    'HEIGHT',
    'SKILL',
    'LEMMINGS',
    'PAIRING',
    'MIDI_FLAG',
    'MIDI_FLAG_ID',
    'MIDI_FLAG_COOLDOWN',
    'ERASE'
  ];
  return hasAnyEntryWithProps(getEntries(level, 'terrains'), terrainUnsupported)
    || hasAnyEntryWithProps(getEntries(level, 'gadgets'), gadgetUnsupported)
    || getEntries(level, 'terrainGroups').some(group => {
      const terrains = Array.isArray(group?.terrains) ? group.terrains : [];
      return hasAnyProp(group, ['STEEL', 'STYLE'])
        || hasAnyEntryWithProps(terrains, terrainUnsupported);
    })
    || hasNonClassicSkill(level);
};

const getClassicExportLossReasons = (level) => {
  const reasons = [];
  const preserved = getPreservedUnknownDataSummary(level);
  if (preserved.hasData) reasons.push('comments/unknown NXLV data');
  if (Array.isArray(level?.terrainGroups) && level.terrainGroups.length > 0) {
    reasons.push('terrain groups');
  }
  if (hasAnyEntryWithProps(getEntries(level, 'terrains'), ['ONE_WAY'])) {
    reasons.push('terrain one-way flags');
  }
  if (hasClassicExportUnsupportedProps(level)) {
    reasons.push('unsupported transforms, resize, or metadata');
  }
  return Array.from(new Set(reasons));
};

const getClassicExportLossSummary = (level) => {
  const reasons = getClassicExportLossReasons(level);
  return {
    hasLoss: reasons.length > 0,
    reasons,
    summary: reasons.join(', ')
  };
};

const buildClassicSubsetIssues = (level) => {
  if (!level) return [];
  const issues = [];
  const preserved = getPreservedUnknownDataSummary(level);
  if (preserved.hasData) {
    issues.push({
      severity: 'warning',
      message: `NXLV has preserved comments or unknown data (${preserved.summary}). NXLV export keeps it; classic preview and LVL export ignore it.`
    });
  }
  const classicLoss = getClassicExportLossSummary(level);
  if (classicLoss.hasLoss) {
    issues.push({
      severity: 'warning',
      message: `Classic LVL export is lossy: ${classicLoss.summary}. Use NXLV export to preserve editor and NeoLemmix data.`
    });
  }
  return issues;
};

const isDestructiveQuickFix = (issue) => {
  if (!issue?.fix) return false;
  if (issue.destructive === true) return true;
  const text = `${issue.fixLabel || ''} ${issue.message || ''}`.toLowerCase();
  return /\b(remove|clamp|clear|snap|reset)\b/.test(text)
    || text.includes('keep first')
    || text.includes('fix steel');
};

const getErrorMessage = (error) => {
  if (!error) return 'Unknown error.';
  if (typeof error === 'string') return error;
  const message = error.message || error.name || String(error);
  return String(message || 'Unknown error.').trim() || 'Unknown error.';
};

export {
  buildClassicSubsetIssues,
  getClassicExportLossSummary,
  getErrorMessage,
  isDestructiveQuickFix
};
