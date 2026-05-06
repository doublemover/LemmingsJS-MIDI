import {
  DEFAULT_LEVEL_WIDTH,
  DEFAULT_LEVEL_HEIGHT,
  LEVEL_OBJECT_COUNT,
  LEVEL_TERRAIN_COUNT,
  LEVEL_STEEL_COUNT,
  LEVEL_NAME_LENGTH
} from '../level/ClassicLevelConstants.js';
import {
  EDITOR_ADVISORY_WARNING_CODES,
  checkEditorSolvabilityAdvisory
} from '../solver/EditorAdvisory.js';
import { createGadgetEntry, removeEntryAt } from './EditorEntryFactory.js';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const coerceNumber = (value, fallback = 0) => {
  return Number.isFinite(value) ? value : fallback;
};

const isFiniteNumber = (value) => Number.isFinite(value);
const ROTATION_STEPS = new Set([0, 90, 180, 270]);
const VALIDATOR_HANDLED_ADVISORY_CODES = new Set([
  EDITOR_ADVISORY_WARNING_CODES.MISSING_ENTRANCE,
  EDITOR_ADVISORY_WARNING_CODES.MISSING_EXIT
]);
const MAX_ENTRANCES = 4;
const MAX_EXITS = 4;
const MAX_LEVEL_WIDTH = DEFAULT_LEVEL_WIDTH;
const MAX_LEVEL_HEIGHT = DEFAULT_LEVEL_HEIGHT;
const MAX_TIME_LIMIT_SECONDS = 99 * 60 + 99;
const MAX_LEMMINGS = 999;
const MIN_SPAWN_INTERVAL = 1;
const MAX_SPAWN_INTERVAL = 99;

const getHeaderNumber = (level, key, fallback) => {
  const raw = level?.getHeader?.(key);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
};

const findPieceIndices = (entries, pieceId) => {
  const matches = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]?.props?.PIECE === pieceId) matches.push(i);
  }
  return matches;
};

const createIssue = (severity, message, fixLabel = null, fix = null, details = null) => {
  const issue = { severity, message, fixLabel, fix };
  if (details && typeof details === 'object') {
    Object.assign(issue, details);
  }
  return issue;
};

const normalizeRotation = (value) => {
  const numeric = Number(value);
  const normalized = ((numeric % 360) + 360) % 360;
  const snapped = Math.round(normalized / 90) * 90;
  return ((snapped % 360) + 360) % 360;
};

const createDestructiveIssue = (code, message, fixLabel = null, fix = null, details = {}) => {
  return createIssue('warning', message, fixLabel, fix, {
    code,
    exportFormat: 'classicLvl',
    destructive: true,
    ...details
  });
};

const normalizeSolverAdvisoryConfig = (options) => {
  if (options?.solverAdvisory === false) return null;
  return options?.solverAdvisory && typeof options.solverAdvisory === 'object'
    ? options.solverAdvisory
    : {};
};

const toSolverAdvisoryIssueCode = (code) => {
  const normalized = String(code || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `solver_advisory_${normalized || 'unknown'}`;
};

const appendSolverAdvisoryIssues = (issues, level, assets, options) => {
  const config = normalizeSolverAdvisoryConfig(options);
  if (!config) return;
  const { source = null, ...advisoryOptions } = config;
  const advisorySource = source || options?.solverAdvisorySource || options?.runtimeLevel || level;
  if (!advisorySource) return;
  const advisory = checkEditorSolvabilityAdvisory(advisorySource, {
    assets,
    entranceId: assets?.entranceId,
    exitId: assets?.exitId,
    ...advisoryOptions
  });
  for (const warning of advisory.warnings || []) {
    if (VALIDATOR_HANDLED_ADVISORY_CODES.has(warning.code)) continue;
    issues.push(createIssue(
      'warning',
      `Solver advisory: ${warning.message}`,
      null,
      null,
      {
        code: toSolverAdvisoryIssueCode(warning.code),
        source: 'solver-advisory',
        solverAdvisory: true,
        advisoryCode: warning.code,
        target: warning.target ?? null,
        blocking: false,
        blocksEditing: advisory.blocksEditing === true,
        blocksExport: advisory.blocksExport === true,
        budgetUsage: advisory.budgetUsage || null
      }
    ));
  }
};

const truncateEntries = (level, key, max) => {
  const entries = Array.isArray(level?.[key]) ? level[key] : [];
  entries.length = Math.min(entries.length, max);
};

const getUnsupportedPropKeys = (entry, allowedKeys) => {
  const props = entry?.props;
  if (!props) return [];
  return Object.keys(props).filter(key => !allowedKeys.has(key));
};

const hasUnsupportedProps = (entry, allowedKeys) => {
  return getUnsupportedPropKeys(entry, allowedKeys).length > 0;
};

const stripUnsupportedProps = (entry, allowedKeys) => {
  if (!entry?.props) return;
  for (const key of Object.keys(entry.props)) {
    if (!allowedKeys.has(key)) {
      delete entry.props[key];
    }
  }
};

const countPreservedNxlvMetadata = (level) => {
  if (!level) return 0;
  let count = 0;
  if (Array.isArray(level.unknownLines)) count += level.unknownLines.length;
  if (Array.isArray(level.unknownSections)) count += level.unknownSections.length;
  if (Array.isArray(level.skillsetUnknownLines)) count += level.skillsetUnknownLines.length;
  const addEntryUnknownLines = (entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (Array.isArray(entry?.unknownLines)) count += entry.unknownLines.length;
    }
  };
  addEntryUnknownLines(level.terrains);
  addEntryUnknownLines(level.gadgets);
  addEntryUnknownLines(level.steel);
  if (Array.isArray(level.terrainGroups)) {
    for (const group of level.terrainGroups) {
      if (Array.isArray(group?.unknownLines)) count += group.unknownLines.length;
      addEntryUnknownLines(group?.terrains);
    }
  }
  return count;
};

const validateLevel = (level, assets = null, options = {}) => {
  if (!level) return [];
  const issues = [];
  const width = getHeaderNumber(level, 'WIDTH', DEFAULT_LEVEL_WIDTH);
  const height = getHeaderNumber(level, 'HEIGHT', DEFAULT_LEVEL_HEIGHT);
  const safeWidth = isFiniteNumber(width) && width > 0 ? width : DEFAULT_LEVEL_WIDTH;
  const safeHeight = isFiniteNumber(height) && height > 0 ? height : DEFAULT_LEVEL_HEIGHT;
  const cappedWidth = Math.min(safeWidth, MAX_LEVEL_WIDTH);
  const cappedHeight = Math.min(safeHeight, MAX_LEVEL_HEIGHT);
  const lemmings = getHeaderNumber(level, 'LEMMINGS', 0);
  const saveReq = getHeaderNumber(level, 'SAVE_REQUIREMENT', 0);
  const spawnInterval = level.getHeader?.('MAX_SPAWN_INTERVAL');
  const timeLimit = level.getHeader?.('TIME_LIMIT');
  const startX = getHeaderNumber(level, 'START_X', 0);
  const startY = getHeaderNumber(level, 'START_Y', 0);
  const title = level.getHeader?.('TITLE');

  if (!title || !String(title).trim()) {
    issues.push(createIssue('warning', 'Title is empty.', 'Set title', () => {
      level.setHeader('TITLE', 'Untitled');
    }));
  } else if (String(title).length > LEVEL_NAME_LENGTH) {
    const titleText = String(title);
    issues.push(createDestructiveIssue(
      'classic_title_length',
      `Classic .lvl export stores ${LEVEL_NAME_LENGTH} title characters; the remaining ${titleText.length - LEVEL_NAME_LENGTH} will be omitted.`,
      'Truncate title',
      () => {
        level.setHeader('TITLE', titleText.slice(0, LEVEL_NAME_LENGTH));
      },
      {
        target: 'header.TITLE',
        count: titleText.length,
        max: LEVEL_NAME_LENGTH
      }
    ));
  }

  if (Array.isArray(level.terrainGroups) && level.terrainGroups.length > 0) {
    issues.push(createDestructiveIssue(
      'classic_terrain_groups',
      'Terrain groups are not exported to classic .lvl; ungroup terrain before classic export.',
      null,
      null,
      {
        target: 'terrainGroups',
        count: level.terrainGroups.length,
        max: 0
      }
    ));
  }

  const preservedMetadataCount = countPreservedNxlvMetadata(level);
  if (preservedMetadataCount) {
    issues.push(createDestructiveIssue(
      'classic_preserved_nxlv_metadata',
      'Comments and unknown NXLV sections are preserved for NXLV but are not exported to classic .lvl.',
      null,
      null,
      {
        target: 'nxlvMetadata',
        count: preservedMetadataCount,
        max: 0
      }
    ));
  }

  if (!isFiniteNumber(width) || width <= 0) {
    issues.push(createIssue('error', 'Width is invalid.', 'Reset width', () => {
      level.setHeader('WIDTH', DEFAULT_LEVEL_WIDTH);
    }));
  }

  if (!isFiniteNumber(height) || height <= 0) {
    issues.push(createIssue('error', 'Height is invalid.', 'Reset height', () => {
      level.setHeader('HEIGHT', DEFAULT_LEVEL_HEIGHT);
    }));
  }

  if (isFiniteNumber(width) && width > MAX_LEVEL_WIDTH) {
    issues.push(createIssue(
      'warning',
      `Width exceeds classic preview max (${MAX_LEVEL_WIDTH}).`,
      'Clamp width',
      () => {
        level.setHeader('WIDTH', MAX_LEVEL_WIDTH);
      }
    ));
  }

  if (isFiniteNumber(height) && height > MAX_LEVEL_HEIGHT) {
    issues.push(createIssue(
      'warning',
      `Height exceeds classic preview max (${MAX_LEVEL_HEIGHT}).`,
      'Clamp height',
      () => {
        level.setHeader('HEIGHT', MAX_LEVEL_HEIGHT);
      }
    ));
  }

  if (!isFiniteNumber(lemmings) || lemmings < 0) {
    issues.push(createIssue('error', 'Lemmings count is invalid.', 'Reset lemmings', () => {
      level.setHeader('LEMMINGS', 0);
    }));
  }

  if (isFiniteNumber(lemmings) && lemmings > MAX_LEMMINGS) {
    issues.push(createIssue(
      'warning',
      `Lemmings count exceeds safe max (${MAX_LEMMINGS}).`,
      'Clamp lemmings',
      () => {
        level.setHeader('LEMMINGS', MAX_LEMMINGS);
      }
    ));
  }

  if (!isFiniteNumber(saveReq) || saveReq < 0) {
    issues.push(createIssue('error', 'Save requirement is invalid.', 'Reset save requirement', () => {
      level.setHeader('SAVE_REQUIREMENT', 0);
    }));
  }

  if (isFiniteNumber(saveReq) && saveReq > MAX_LEMMINGS) {
    issues.push(createIssue(
      'warning',
      `Save requirement exceeds safe max (${MAX_LEMMINGS}).`,
      'Clamp save requirement',
      () => {
        level.setHeader('SAVE_REQUIREMENT', MAX_LEMMINGS);
      }
    ));
  }

  if (isFiniteNumber(lemmings) && isFiniteNumber(saveReq) && saveReq > lemmings) {
    issues.push(createIssue('error', 'Save requirement exceeds lemmings.', 'Clamp save requirement', () => {
      level.setHeader('SAVE_REQUIREMENT', Math.max(0, lemmings));
    }));
  }

  if (spawnInterval != null) {
    const numeric = Number(spawnInterval);
    if (!isFiniteNumber(numeric)) {
      issues.push(createIssue('warning', 'Spawn interval is invalid.', 'Reset spawn interval', () => {
        level.setHeader('MAX_SPAWN_INTERVAL', 50);
      }));
    } else if (numeric < MIN_SPAWN_INTERVAL || numeric > MAX_SPAWN_INTERVAL) {
      issues.push(createIssue(
        'warning',
        `Spawn interval is out of range (${MIN_SPAWN_INTERVAL}-${MAX_SPAWN_INTERVAL}).`,
        'Clamp spawn interval',
        () => {
          level.setHeader('MAX_SPAWN_INTERVAL', clamp(numeric, MIN_SPAWN_INTERVAL, MAX_SPAWN_INTERVAL));
        }
      ));
    }
  }

  if (timeLimit != null && timeLimit !== 'INFINITE') {
    const numeric = Number(timeLimit);
    if (!isFiniteNumber(numeric)) {
      issues.push(createIssue('warning', 'Time limit is invalid.', 'Set infinite', () => {
        level.setHeader('TIME_LIMIT', 'INFINITE');
      }));
    } else if (numeric < 0) {
      issues.push(createIssue('warning', 'Time limit cannot be negative.', 'Set to 0', () => {
        level.setHeader('TIME_LIMIT', 0);
      }));
    } else if (numeric > MAX_TIME_LIMIT_SECONDS) {
      issues.push(createIssue(
        'warning',
        `Time limit exceeds classic max (${MAX_TIME_LIMIT_SECONDS}s).`,
        'Clamp time limit',
        () => {
          level.setHeader('TIME_LIMIT', MAX_TIME_LIMIT_SECONDS);
        }
      ));
    }
  }

  if (!isFiniteNumber(startX)) {
    issues.push(createIssue('warning', 'Start X is invalid.', 'Reset Start X', () => {
      level.setHeader('START_X', 0);
    }));
  }

  if (!isFiniteNumber(startY)) {
    issues.push(createIssue('warning', 'Start Y is invalid.', 'Reset Start Y', () => {
      level.setHeader('START_Y', 0);
    }));
  }

  if (cappedWidth > 0 && (startX < 0 || startX >= cappedWidth)) {
    issues.push(createIssue('warning', 'Start X is out of bounds.', 'Clamp Start X', () => {
      level.setHeader('START_X', clamp(startX, 0, Math.max(cappedWidth - 1, 0)));
    }));
  }

  if (cappedHeight > 0 && (startY < 0 || startY >= cappedHeight)) {
    issues.push(createIssue('warning', 'Start Y is out of bounds.', 'Clamp Start Y', () => {
      level.setHeader('START_Y', clamp(startY, 0, Math.max(cappedHeight - 1, 0)));
    }));
  }

  const entranceId = assets?.entranceId ?? null;
  const exitId = assets?.exitId ?? null;
  const gadgets = Array.isArray(level.gadgets) ? level.gadgets : [];
  const steelEntries = Array.isArray(level.steel) ? level.steel : [];
  const directTerrains = Array.isArray(level.terrains) ? level.terrains : [];

  if (gadgets.length > LEVEL_OBJECT_COUNT) {
    issues.push(createDestructiveIssue(
      'classic_object_count',
      `Classic .lvl export stores ${LEVEL_OBJECT_COUNT} gadgets; the remaining ${gadgets.length - LEVEL_OBJECT_COUNT} will be omitted.`,
      'Keep first gadgets',
      () => {
        truncateEntries(level, 'gadgets', LEVEL_OBJECT_COUNT);
      },
      {
        target: 'gadgets',
        count: gadgets.length,
        max: LEVEL_OBJECT_COUNT
      }
    ));
  }

  if (directTerrains.length > LEVEL_TERRAIN_COUNT) {
    issues.push(createDestructiveIssue(
      'classic_terrain_count',
      `Classic .lvl export stores ${LEVEL_TERRAIN_COUNT} terrain pieces; the remaining ${directTerrains.length - LEVEL_TERRAIN_COUNT} will be omitted.`,
      'Keep first terrain',
      () => {
        truncateEntries(level, 'terrains', LEVEL_TERRAIN_COUNT);
      },
      {
        target: 'terrains',
        count: directTerrains.length,
        max: LEVEL_TERRAIN_COUNT
      }
    ));
  }

  if (steelEntries.length > LEVEL_STEEL_COUNT) {
    issues.push(createDestructiveIssue(
      'classic_steel_count',
      `Classic .lvl export stores ${LEVEL_STEEL_COUNT} steel rectangles; the remaining ${steelEntries.length - LEVEL_STEEL_COUNT} will be omitted.`,
      'Keep first steel',
      () => {
        truncateEntries(level, 'steel', LEVEL_STEEL_COUNT);
      },
      {
        target: 'steel',
        count: steelEntries.length,
        max: LEVEL_STEEL_COUNT
      }
    ));
  }

  if (Number.isFinite(entranceId)) {
    const entrances = findPieceIndices(gadgets, entranceId);
    if (entrances.length === 0) {
      issues.push(createIssue('error', 'Missing entrance.', 'Add entrance', () => {
        const entry = createGadgetEntry({
          styleName: level.getHeader('STYLE'),
          piece: entranceId,
          x: clamp(startX, 0, Math.max(safeWidth - 1, 0)),
          y: 0
        });
        level.gadgets.push(entry);
      }));
    } else if (entrances.length > MAX_ENTRANCES) {
      issues.push(createIssue(
        'warning',
        `Too many entrances (max ${MAX_ENTRANCES}).`,
        'Keep first entrances',
        () => {
          const nextEntrances = findPieceIndices(level.gadgets, entranceId);
          for (let i = nextEntrances.length - 1; i >= MAX_ENTRANCES; i--) {
            removeEntryAt(level, 'gadget', nextEntrances[i]);
          }
        }
      ));
    }
  } else {
    issues.push(createIssue('warning', 'Entrance piece is unknown for this style.'));
  }

  if (Number.isFinite(exitId)) {
    const exits = findPieceIndices(gadgets, exitId);
    if (exits.length === 0) {
      issues.push(createIssue('error', 'Missing exit.', 'Add exit', () => {
        const entry = createGadgetEntry({
          styleName: level.getHeader('STYLE'),
          piece: exitId,
          x: clamp(safeWidth - 32, 0, Math.max(safeWidth - 1, 0)),
          y: 0
        });
        level.gadgets.push(entry);
      }));
    } else if (exits.length > MAX_EXITS) {
      issues.push(createIssue(
        'warning',
        `Too many exits (max ${MAX_EXITS}).`,
        'Keep first exits',
        () => {
          const nextExits = findPieceIndices(level.gadgets, exitId);
          for (let i = nextExits.length - 1; i >= MAX_EXITS; i--) {
            removeEntryAt(level, 'gadget', nextExits[i]);
          }
        }
      ));
    }
  } else {
    issues.push(createIssue('warning', 'Exit piece is unknown for this style.'));
  }

  const invalidSteel = steelEntries.filter(entry => {
    const width = coerceNumber(entry?.props?.WIDTH, NaN);
    const height = coerceNumber(entry?.props?.HEIGHT, NaN);
    return !isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0;
  });
  if (invalidSteel.length) {
    issues.push(createIssue('warning', 'Steel rectangles must have width/height.', 'Fix steel sizes', () => {
      for (const entry of invalidSteel) {
        if (!entry?.props) continue;
        entry.props.WIDTH = clamp(coerceNumber(entry.props.WIDTH, 1), 1, cappedWidth);
        entry.props.HEIGHT = clamp(coerceNumber(entry.props.HEIGHT, 1), 1, cappedHeight);
      }
    }));
  }

  const oversizedSteel = steelEntries.filter(entry => {
    const width = coerceNumber(entry?.props?.WIDTH, 0);
    const height = coerceNumber(entry?.props?.HEIGHT, 0);
    return (cappedWidth > 0 && width > cappedWidth) || (cappedHeight > 0 && height > cappedHeight);
  });
  if (oversizedSteel.length) {
    issues.push(createIssue(
      'warning',
      'Steel sizes exceed the level bounds.',
      'Clamp steel sizes',
      () => {
        for (const entry of oversizedSteel) {
          if (!entry?.props) continue;
          entry.props.WIDTH = clamp(coerceNumber(entry.props.WIDTH, 1), 1, cappedWidth);
          entry.props.HEIGHT = clamp(coerceNumber(entry.props.HEIGHT, 1), 1, cappedHeight);
        }
      }
    ));
  }

  const steelOutOfBounds = steelEntries.some(entry => {
    const x = coerceNumber(entry?.props?.X, 0);
    const y = coerceNumber(entry?.props?.Y, 0);
    const width = coerceNumber(entry?.props?.WIDTH, 0);
    const height = coerceNumber(entry?.props?.HEIGHT, 0);
    return x < 0 || y < 0 || x + width > cappedWidth || y + height > cappedHeight;
  });
  if (steelOutOfBounds) {
    issues.push(createIssue('warning', 'Steel is out of bounds.', 'Clamp steel', () => {
      for (const entry of steelEntries) {
        if (!entry?.props) continue;
        const x = clamp(coerceNumber(entry.props.X, 0), 0, Math.max(cappedWidth - 1, 0));
        const y = clamp(coerceNumber(entry.props.Y, 0), 0, Math.max(cappedHeight - 1, 0));
        const width = clamp(coerceNumber(entry.props.WIDTH, 1), 1, Math.max(cappedWidth - x, 1));
        const height = clamp(coerceNumber(entry.props.HEIGHT, 1), 1, Math.max(cappedHeight - y, 1));
        entry.props.X = x;
        entry.props.Y = y;
        entry.props.WIDTH = width;
        entry.props.HEIGHT = height;
      }
    }));
  }

  const terrainEntries = [
    ...directTerrains,
    ...(Array.isArray(level.terrainGroups)
      ? level.terrainGroups.flatMap(group => Array.isArray(group?.terrains) ? group.terrains : [])
      : [])
  ];
  const gadgetEntries = Array.isArray(level.gadgets) ? level.gadgets : [];
  const gadgetOnlyProps = ['SKILL', 'LEMMINGS', 'PAIRING'];
  const terrainClassicProps = new Set([
    'STYLE',
    'PIECE',
    'X',
    'Y',
    'FLIP_VERTICAL',
    'NO_OVERWRITE',
    'ERASE'
  ]);
  const gadgetClassicProps = new Set([
    'STYLE',
    'PIECE',
    'X',
    'Y',
    'FLIP_VERTICAL',
    'NO_OVERWRITE'
  ]);
  const steelClassicProps = new Set([
    'X',
    'Y',
    'WIDTH',
    'HEIGHT'
  ]);

  const hasAnyProps = (entry, keys) => {
    const props = entry?.props;
    if (!props) return false;
    return keys.some(key => Object.prototype.hasOwnProperty.call(props, key));
  };

  const stripProps = (entry, keys) => {
    if (!entry?.props) return;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(entry.props, key)) {
        delete entry.props[key];
      }
    }
  };

  const terrainWithGadgetProps = terrainEntries.filter(entry => hasAnyProps(entry, gadgetOnlyProps));
  const steelWithGadgetProps = steelEntries.filter(entry => hasAnyProps(entry, gadgetOnlyProps));
  if (terrainWithGadgetProps.length || steelWithGadgetProps.length) {
    issues.push(createIssue(
      'warning',
      'Gadget-only properties are set on terrain/steel entries.',
      'Remove gadget-only props',
      () => {
        for (const entry of terrainWithGadgetProps) stripProps(entry, gadgetOnlyProps);
        for (const entry of steelWithGadgetProps) stripProps(entry, gadgetOnlyProps);
      }
    ));
  }

  const terrainWithUnsupported = terrainEntries.filter(entry => hasUnsupportedProps(entry, terrainClassicProps));
  if (terrainWithUnsupported.length) {
    const propKeys = Array.from(new Set(terrainWithUnsupported.flatMap(entry => {
      return getUnsupportedPropKeys(entry, terrainClassicProps);
    }))).sort();
    issues.push(createDestructiveIssue(
      'classic_unsupported_terrain_props',
      `Terrain entries include properties classic .lvl cannot export (${propKeys.join(', ')}).`,
      'Remove unsupported terrain props',
      () => {
        for (const entry of terrainWithUnsupported) stripUnsupportedProps(entry, terrainClassicProps);
      },
      {
        target: 'terrains',
        count: terrainWithUnsupported.length,
        props: propKeys
      }
    ));
  }

  const gadgetWithUnsupported = gadgetEntries.filter(entry => hasUnsupportedProps(entry, gadgetClassicProps));
  if (gadgetWithUnsupported.length) {
    const propKeys = Array.from(new Set(gadgetWithUnsupported.flatMap(entry => {
      return getUnsupportedPropKeys(entry, gadgetClassicProps);
    }))).sort();
    issues.push(createDestructiveIssue(
      'classic_unsupported_gadget_props',
      `Gadget entries include properties classic .lvl cannot export (${propKeys.join(', ')}).`,
      'Remove unsupported gadget props',
      () => {
        for (const entry of gadgetWithUnsupported) stripUnsupportedProps(entry, gadgetClassicProps);
      },
      {
        target: 'gadgets',
        count: gadgetWithUnsupported.length,
        props: propKeys
      }
    ));
  }

  const steelWithUnsupported = steelEntries.filter(entry => hasUnsupportedProps(entry, steelClassicProps));
  if (steelWithUnsupported.length) {
    const propKeys = Array.from(new Set(steelWithUnsupported.flatMap(entry => {
      return getUnsupportedPropKeys(entry, steelClassicProps);
    }))).sort();
    issues.push(createDestructiveIssue(
      'classic_unsupported_steel_props',
      `Steel entries include properties classic .lvl cannot export (${propKeys.join(', ')}).`,
      'Remove unsupported steel props',
      () => {
        for (const entry of steelWithUnsupported) stripUnsupportedProps(entry, steelClassicProps);
      },
      {
        target: 'steel',
        count: steelWithUnsupported.length,
        props: propKeys
      }
    ));
  }

  const invalidRotations = [];
  const snapRotations = [];
  const collectRotations = (entries) => {
    for (const entry of entries) {
      if (!entry?.props || !Object.prototype.hasOwnProperty.call(entry.props, 'ROTATE')) continue;
      const raw = entry.props.ROTATE;
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) {
        invalidRotations.push(entry);
        continue;
      }
      if (ROTATION_STEPS.has(numeric)) continue;
      const snapped = normalizeRotation(numeric);
      snapRotations.push({ entry, snapped });
    }
  };

  collectRotations(Array.isArray(level.terrains) ? level.terrains : []);
  collectRotations(gadgets);

  if (invalidRotations.length) {
    issues.push(createIssue('warning', 'Rotation values are invalid.', 'Clear rotations', () => {
      for (const entry of invalidRotations) {
        if (entry?.props) delete entry.props.ROTATE;
      }
    }));
  }

  if (snapRotations.length) {
    issues.push(createIssue(
      'warning',
      'Rotation must be 0/90/180/270 for classic preview.',
      'Snap rotations',
      () => {
        for (const { entry, snapped } of snapRotations) {
          if (entry?.props && Object.prototype.hasOwnProperty.call(entry.props, 'ROTATE')) {
            entry.props.ROTATE = snapped;
          }
        }
      }
    ));
  }

  appendSolverAdvisoryIssues(issues, level, assets, options);
  return issues;
};

export { validateLevel };
