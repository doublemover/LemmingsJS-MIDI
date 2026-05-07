import { SkillTypes } from '../game/SkillTypes.js';

const SKILL_INDEX_BY_NAME = new Map([
  ['climber', SkillTypes.CLIMBER],
  ['floater', SkillTypes.FLOATER],
  ['bomber', SkillTypes.BOMBER],
  ['blocker', SkillTypes.BLOCKER],
  ['builder', SkillTypes.BUILDER],
  ['basher', SkillTypes.BASHER],
  ['miner', SkillTypes.MINER],
  ['digger', SkillTypes.DIGGER]
]);

const EDITOR_ADVISORY_WARNING_CODES = Object.freeze({
  MISSING_ENTRANCE: 'missing-entrance',
  MISSING_EXIT: 'missing-exit',
  UNREACHABLE_GAP: 'unreachable-gap',
  LETHAL_DROP: 'lethal-drop',
  INSUFFICIENT_SKILLS: 'insufficient-skills',
  UNSUPPORTED_MECHANIC: 'unsupported-mechanic',
  ADVISORY_ERROR: 'advisory-error'
});

const DEFAULT_EDITOR_ADVISORY_OPTIONS = Object.freeze({
  maxScanColumns: 512,
  maxScanDrop: 96,
  maxSafeFall: 60,
  maxWalkGap: 2,
  builderReach: 12,
  stepTolerance: 6
});

const isPlainObject = value => value != null && typeof value === 'object' && !Array.isArray(value);

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toPositiveInteger = (value, fallback) => {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const normalizePoint = value => {
  if (!isPlainObject(value)) return null;
  const props = isPlainObject(value.props) ? value.props : {};
  const x = toFiniteNumber(value.x ?? props.X, Number.NaN);
  const y = toFiniteNumber(value.y ?? props.Y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
};

const getEntryPieceId = entry => {
  const props = isPlainObject(entry?.props) ? entry.props : {};
  return entry?.pieceId ?? entry?.piece ?? props.PIECE ?? null;
};

const entryTypeMatches = (entry, names) => {
  const raw = entry?.kind ?? entry?.type ?? entry?.role ?? entry?.name ?? '';
  const type = String(raw).trim().toLowerCase();
  return names.some(name => type.includes(name));
};

const extractPointList = (source, key, options) => {
  const direct = Array.isArray(source?.[key]) ? source[key].map(normalizePoint).filter(Boolean) : [];
  if (direct.length) return direct;
  const gadgets = Array.isArray(source?.gadgets) ? source.gadgets : [];
  const idKey = key === 'entrances' ? 'entranceId' : 'exitId';
  const targetId = options[idKey] ?? options.assets?.[idKey] ?? null;
  const names = key === 'entrances' ? ['entrance', 'hatch'] : ['exit'];
  return gadgets.filter(entry => {
    if (targetId != null && getEntryPieceId(entry) === targetId) return true;
    return entryTypeMatches(entry, names);
  }).map(normalizePoint).filter(Boolean);
};

const getHeaderNumber = (source, key, fallback) => {
  const raw = source?.getHeader?.(key) ?? source?.headers?.[key] ?? source?.[key.toLowerCase()];
  return toFiniteNumber(raw, fallback);
};

const extractMaskSource = source => {
  const layer = source?.groundMask ?? source?.terrainMask ?? source?.mask ?? null;
  if (layer?.mask && Number.isFinite(layer.width) && Number.isFinite(layer.height)) {
    return {
      width: layer.width,
      height: layer.height,
      hasGroundAt: (x, y) => typeof layer.hasGroundAt === 'function'
        ? layer.hasGroundAt(x, y)
        : layer.mask[x + y * layer.width] !== 0
    };
  }
  if (layer && typeof layer.hasGroundAt === 'function') {
    return {
      width: source.width ?? layer.width,
      height: source.height ?? layer.height,
      hasGroundAt: (x, y) => layer.hasGroundAt(x, y)
    };
  }
  if (ArrayBuffer.isView(layer) && Number.isFinite(source?.width) && Number.isFinite(source?.height)) {
    return {
      width: source.width,
      height: source.height,
      hasGroundAt: (x, y) => layer[x + y * source.width] !== 0
    };
  }
  return null;
};

const normalizeAdvisoryContext = (source, options = {}) => {
  const mask = extractMaskSource(source);
  const width = toPositiveInteger(source?.width ?? mask?.width ?? getHeaderNumber(source, 'WIDTH', 0), 0);
  const height = toPositiveInteger(source?.height ?? mask?.height ?? getHeaderNumber(source, 'HEIGHT', 0), 0);
  const normalizedOptions = {
    ...DEFAULT_EDITOR_ADVISORY_OPTIONS,
    ...options,
    maxScanColumns: toPositiveInteger(options.maxScanColumns, DEFAULT_EDITOR_ADVISORY_OPTIONS.maxScanColumns),
    maxScanDrop: toPositiveInteger(options.maxScanDrop, DEFAULT_EDITOR_ADVISORY_OPTIONS.maxScanDrop),
    maxSafeFall: toPositiveInteger(options.maxSafeFall, DEFAULT_EDITOR_ADVISORY_OPTIONS.maxSafeFall),
    maxWalkGap: toPositiveInteger(options.maxWalkGap, DEFAULT_EDITOR_ADVISORY_OPTIONS.maxWalkGap),
    builderReach: toPositiveInteger(options.builderReach, DEFAULT_EDITOR_ADVISORY_OPTIONS.builderReach),
    stepTolerance: toPositiveInteger(options.stepTolerance, DEFAULT_EDITOR_ADVISORY_OPTIONS.stepTolerance)
  };
  return {
    source,
    options: normalizedOptions,
    width,
    height,
    mask,
    entrances: extractPointList(source, 'entrances', options),
    exits: extractPointList(source, 'exits', options),
    oneWay: Array.isArray(source?.oneWay) ? source.oneWay : [],
    hazards: Array.isArray(source?.hazards) ? source.hazards : [],
    unsupportedMechanics: Array.isArray(source?.unsupportedMechanics) ? source.unsupportedMechanics : [],
    skills: source?.skills ?? source?.skillset ?? {}
  };
};

const createWarning = (code, message, details = {}) => ({
  severity: 'warning',
  code,
  message,
  blocking: false,
  ...details
});

const createAdvisoryResult = (warnings, budgetUsage = {}) => ({
  status: warnings.length ? 'warnings' : 'ok',
  canContinue: true,
  blocksEditing: false,
  blocksExport: false,
  warnings,
  budgetUsage: {
    scannedColumns: budgetUsage.scannedColumns ?? 0,
    maxScanColumns: budgetUsage.maxScanColumns ?? DEFAULT_EDITOR_ADVISORY_OPTIONS.maxScanColumns
  }
});

const warningExists = (warnings, code) => warnings.some(warning => warning.code === code);

const pushWarningOnce = (warnings, warning) => {
  if (!warningExists(warnings, warning.code)) warnings.push(warning);
};

const getSkillCount = (skills, skillName) => {
  const expected = String(skillName).toLowerCase();
  if (skills instanceof Map) {
    for (const [key, value] of skills.entries()) {
      const normalizedKey = String(key).toLowerCase();
      if (normalizedKey === expected || normalizedKey === `${expected}s`) {
        return Math.max(0, Math.floor(toFiniteNumber(value, 0)));
      }
    }
    return 0;
  }
  if (Array.isArray(skills) || ArrayBuffer.isView(skills)) {
    const index = SKILL_INDEX_BY_NAME.get(expected);
    return index == null ? 0 : Math.max(0, Math.floor(toFiniteNumber(skills[index], 0)));
  }
  if (!isPlainObject(skills)) return 0;
  for (const [key, value] of Object.entries(skills)) {
    const normalizedKey = String(key).toLowerCase();
    if (normalizedKey === expected || normalizedKey === `${expected}s`) {
      return Math.max(0, Math.floor(toFiniteNumber(value, 0)));
    }
  }
  return 0;
};

const detectUnsupportedMechanics = (context, warnings) => {
  if (context.oneWay.length) {
    pushWarningOnce(warnings, createWarning(
      EDITOR_ADVISORY_WARNING_CODES.UNSUPPORTED_MECHANIC,
      'One-way terrain constraints are outside the current advisory solver scope.',
      { target: 'oneWay', count: context.oneWay.length }
    ));
  }
  if (context.unsupportedMechanics.length) {
    const mechanics = context.unsupportedMechanics.map(item => String(item)).sort();
    pushWarningOnce(warnings, createWarning(
      EDITOR_ADVISORY_WARNING_CODES.UNSUPPORTED_MECHANIC,
      `Unsupported mechanics detected: ${mechanics.join(', ')}.`,
      { target: 'mechanics', mechanics }
    ));
  }
  const supportedHazards = new Set(['fire', 'fryer', 'hazard', 'trap', 'water']);
  const unsupportedHazards = context.hazards.filter(hazard => {
    const kind = String(hazard?.kind ?? hazard?.type ?? '').trim().toLowerCase();
    return kind && !supportedHazards.has(kind);
  });
  if (unsupportedHazards.length) {
    const kinds = Array.from(new Set(unsupportedHazards.map(hazard => {
      return String(hazard?.kind ?? hazard?.type).trim().toLowerCase();
    }))).sort();
    pushWarningOnce(warnings, createWarning(
      EDITOR_ADVISORY_WARNING_CODES.UNSUPPORTED_MECHANIC,
      `Unsupported hazard mechanics detected: ${kinds.join(', ')}.`,
      { target: 'hazards', mechanics: kinds }
    ));
  }
};

const hasGroundAt = (context, x, y) => {
  if (!context.mask || x < 0 || y < 0 || x >= context.width || y >= context.height) return false;
  return context.mask.hasGroundAt(Math.floor(x), Math.floor(y));
};

const findSupportY = (context, x, nearY) => {
  const { maxScanDrop, stepTolerance } = context.options;
  const startY = Math.max(0, Math.floor(nearY - stepTolerance));
  const endY = Math.min(context.height - 1, Math.floor(nearY + maxScanDrop));
  for (let y = startY; y <= endY; y += 1) {
    if (hasGroundAt(context, x, y)) return y;
  }
  return null;
};

const createColumnSampler = (startX, endX, maxScanColumns) => {
  const direction = startX <= endX ? 1 : -1;
  const distance = Math.abs(endX - startX) + 1;
  const step = direction * Math.max(1, Math.ceil(distance / maxScanColumns));
  const columns = [];
  for (let x = startX; direction > 0 ? x <= endX : x >= endX; x += step) {
    columns.push(x);
  }
  if (columns[columns.length - 1] !== endX) columns.push(endX);
  return columns;
};

const analyzeClosedGap = (context, warnings, gap, landingSupportY) => {
  const width = Math.abs(gap.endX - gap.startX) + 1;
  if (width <= context.options.maxWalkGap) return;
  const requiredBuilders = Math.max(1, Math.ceil((width - context.options.maxWalkGap) / context.options.builderReach));
  const availableBuilders = getSkillCount(context.skills, 'builder');
  if (requiredBuilders > availableBuilders) {
    pushWarningOnce(warnings, createWarning(
      EDITOR_ADVISORY_WARNING_CODES.UNREACHABLE_GAP,
      `Obvious gap from x=${gap.startX} to x=${gap.endX} needs about ${requiredBuilders} builder skill(s).`,
      {
        target: 'terrain',
        startX: gap.startX,
        endX: gap.endX,
        requiredBuilders
      }
    ));
    pushWarningOnce(warnings, createWarning(
      EDITOR_ADVISORY_WARNING_CODES.INSUFFICIENT_SKILLS,
      `Builder budget is ${availableBuilders}, below the estimated ${requiredBuilders} needed for an obvious gap.`,
      {
        target: 'skills.builder',
        available: availableBuilders,
        required: requiredBuilders
      }
    ));
  }
  if (gap.previousSupportY != null && landingSupportY != null) {
    const drop = landingSupportY - gap.previousSupportY;
    if (drop > context.options.maxSafeFall) {
      pushWarningOnce(warnings, createWarning(
        EDITOR_ADVISORY_WARNING_CODES.LETHAL_DROP,
        `Drop near x=${gap.endX} is about ${drop}px, above the advisory safe limit.`,
        {
          target: 'terrain',
          x: gap.endX,
          drop,
          maxSafeFall: context.options.maxSafeFall
        }
      ));
    }
  }
};

const analyzeRouteGeometry = (context, warnings) => {
  if (!context.mask || !context.width || !context.height || !context.entrances.length || !context.exits.length) {
    return { scannedColumns: 0, maxScanColumns: context.options.maxScanColumns };
  }
  const entrance = context.entrances[0];
  const exit = context.exits[0];
  const startX = Math.min(Math.max(0, entrance.x), context.width - 1);
  const endX = Math.min(Math.max(0, exit.x), context.width - 1);
  const columns = createColumnSampler(startX, endX, context.options.maxScanColumns);
  let previousSupportY = findSupportY(context, startX, entrance.y + 1);
  let gap = null;
  for (const x of columns) {
    const nearY = previousSupportY ?? entrance.y + 1;
    const supportY = findSupportY(context, x, nearY);
    if (supportY == null) {
      if (!gap) {
        gap = {
          startX: x,
          endX: x,
          previousSupportY
        };
      } else {
        gap.endX = x;
      }
      continue;
    }
    if (gap) {
      analyzeClosedGap(context, warnings, gap, supportY);
      gap = null;
    } else if (previousSupportY != null) {
      const drop = supportY - previousSupportY;
      if (drop > context.options.maxSafeFall) {
        pushWarningOnce(warnings, createWarning(
          EDITOR_ADVISORY_WARNING_CODES.LETHAL_DROP,
          `Drop near x=${x} is about ${drop}px, above the advisory safe limit.`,
          {
            target: 'terrain',
            x,
            drop,
            maxSafeFall: context.options.maxSafeFall
          }
        ));
      }
    }
    previousSupportY = supportY;
  }
  if (gap) analyzeClosedGap(context, warnings, gap, null);
  return {
    scannedColumns: columns.length,
    maxScanColumns: context.options.maxScanColumns
  };
};

const checkEditorSolvabilityAdvisory = (source, options = {}) => {
  try {
    const context = normalizeAdvisoryContext(source, options);
    const warnings = [];
    if (!context.entrances.length) {
      warnings.push(createWarning(
        EDITOR_ADVISORY_WARNING_CODES.MISSING_ENTRANCE,
        'Missing entrance; solver advisory cannot prove a route.',
        { target: 'entrances' }
      ));
    }
    if (!context.exits.length) {
      warnings.push(createWarning(
        EDITOR_ADVISORY_WARNING_CODES.MISSING_EXIT,
        'Missing exit; solver advisory cannot prove a route.',
        { target: 'exits' }
      ));
    }
    detectUnsupportedMechanics(context, warnings);
    const budgetUsage = analyzeRouteGeometry(context, warnings);
    return createAdvisoryResult(warnings, budgetUsage);
  } catch (error) {
    return createAdvisoryResult([
      createWarning(
        EDITOR_ADVISORY_WARNING_CODES.ADVISORY_ERROR,
        'Solver advisory could not complete, but editing and export remain available.',
        { detail: error?.message || String(error) }
      )
    ]);
  }
};

export {
  DEFAULT_EDITOR_ADVISORY_OPTIONS,
  EDITOR_ADVISORY_WARNING_CODES,
  checkEditorSolvabilityAdvisory
};
