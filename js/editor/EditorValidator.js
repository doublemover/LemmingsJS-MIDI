import { DEFAULT_LEVEL_WIDTH, DEFAULT_LEVEL_HEIGHT } from '../level/ClassicLevelConstants.js';
import { createGadgetEntry, removeEntryAt } from './EditorEntryFactory.js';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const coerceNumber = (value, fallback = 0) => {
  return Number.isFinite(value) ? value : fallback;
};

const isFiniteNumber = (value) => Number.isFinite(value);
const ROTATION_STEPS = new Set([0, 90, 180, 270]);
const MAX_ENTRANCES = 4;
const MAX_EXITS = 4;

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

const createIssue = (severity, message, fixLabel = null, fix = null) => {
  return { severity, message, fixLabel, fix };
};

const normalizeRotation = (value) => {
  const numeric = Number(value);
  const normalized = ((numeric % 360) + 360) % 360;
  const snapped = Math.round(normalized / 90) * 90;
  return ((snapped % 360) + 360) % 360;
};

const validateLevel = (level, assets = null, options = {}) => {
  if (!level) return [];
  const issues = [];
  const width = getHeaderNumber(level, 'WIDTH', DEFAULT_LEVEL_WIDTH);
  const height = getHeaderNumber(level, 'HEIGHT', DEFAULT_LEVEL_HEIGHT);
  const safeWidth = isFiniteNumber(width) && width > 0 ? width : DEFAULT_LEVEL_WIDTH;
  const safeHeight = isFiniteNumber(height) && height > 0 ? height : DEFAULT_LEVEL_HEIGHT;
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

  if (!isFiniteNumber(lemmings) || lemmings < 0) {
    issues.push(createIssue('error', 'Lemmings count is invalid.', 'Reset lemmings', () => {
      level.setHeader('LEMMINGS', 0);
    }));
  }

  if (!isFiniteNumber(saveReq) || saveReq < 0) {
    issues.push(createIssue('error', 'Save requirement is invalid.', 'Reset save requirement', () => {
      level.setHeader('SAVE_REQUIREMENT', 0);
    }));
  }

  if (isFiniteNumber(lemmings) && isFiniteNumber(saveReq) && saveReq > lemmings) {
    issues.push(createIssue('error', 'Save requirement exceeds lemmings.', 'Clamp save requirement', () => {
      level.setHeader('SAVE_REQUIREMENT', Math.max(0, lemmings));
    }));
  }

  if (spawnInterval != null && !isFiniteNumber(spawnInterval)) {
    issues.push(createIssue('warning', 'Spawn interval is invalid.', 'Reset spawn interval', () => {
      level.setHeader('MAX_SPAWN_INTERVAL', 50);
    }));
  }

  if (timeLimit != null && timeLimit !== 'INFINITE' && !isFiniteNumber(timeLimit)) {
    issues.push(createIssue('warning', 'Time limit is invalid.', 'Set infinite', () => {
      level.setHeader('TIME_LIMIT', 'INFINITE');
    }));
  }

  if (safeWidth > 0 && (startX < 0 || startX >= safeWidth)) {
    issues.push(createIssue('warning', 'Start X is out of bounds.', 'Clamp Start X', () => {
      level.setHeader('START_X', clamp(startX, 0, Math.max(safeWidth - 1, 0)));
    }));
  }

  if (safeHeight > 0 && (startY < 0 || startY >= safeHeight)) {
    issues.push(createIssue('warning', 'Start Y is out of bounds.', 'Clamp Start Y', () => {
      level.setHeader('START_Y', clamp(startY, 0, Math.max(safeHeight - 1, 0)));
    }));
  }

  const entranceId = assets?.entranceId ?? null;
  const exitId = assets?.exitId ?? null;
  const gadgets = Array.isArray(level.gadgets) ? level.gadgets : [];
  const steelEntries = Array.isArray(level.steel) ? level.steel : [];

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

  if (safeWidth > 0 && safeHeight > 0) {
    const clampList = (entries) => {
      for (const entry of entries) {
        if (!entry?.props) continue;
        entry.props.X = clamp(coerceNumber(entry.props.X, 0), 0, Math.max(safeWidth - 1, 0));
        entry.props.Y = clamp(coerceNumber(entry.props.Y, 0), 0, Math.max(safeHeight - 1, 0));
      }
    };
    const outOfBounds = (entries) => entries.some(entry => {
      const x = coerceNumber(entry?.props?.X, 0);
      const y = coerceNumber(entry?.props?.Y, 0);
      return x < 0 || y < 0 || x >= safeWidth || y >= safeHeight;
    });
    const terrains = Array.isArray(level.terrains) ? level.terrains : [];
    const hasBadTerrain = outOfBounds(terrains);
    const hasBadGadget = outOfBounds(gadgets);
    const hasBadSteel = outOfBounds(steelEntries);
    if (hasBadTerrain || hasBadGadget || hasBadSteel) {
      issues.push(createIssue('warning', 'Out-of-bounds entries.', 'Clamp entries', () => {
        clampList(terrains);
        clampList(gadgets);
        clampList(steelEntries);
      }));
    }
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
        entry.props.WIDTH = clamp(coerceNumber(entry.props.WIDTH, 1), 1, safeWidth);
        entry.props.HEIGHT = clamp(coerceNumber(entry.props.HEIGHT, 1), 1, safeHeight);
      }
    }));
  }

  const steelOutOfBounds = steelEntries.some(entry => {
    const x = coerceNumber(entry?.props?.X, 0);
    const y = coerceNumber(entry?.props?.Y, 0);
    const width = coerceNumber(entry?.props?.WIDTH, 0);
    const height = coerceNumber(entry?.props?.HEIGHT, 0);
    return x < 0 || y < 0 || x + width > safeWidth || y + height > safeHeight;
  });
  if (steelOutOfBounds) {
    issues.push(createIssue('warning', 'Steel is out of bounds.', 'Clamp steel', () => {
      for (const entry of steelEntries) {
        if (!entry?.props) continue;
        const x = clamp(coerceNumber(entry.props.X, 0), 0, Math.max(safeWidth - 1, 0));
        const y = clamp(coerceNumber(entry.props.Y, 0), 0, Math.max(safeHeight - 1, 0));
        const width = clamp(coerceNumber(entry.props.WIDTH, 1), 1, Math.max(safeWidth - x, 1));
        const height = clamp(coerceNumber(entry.props.HEIGHT, 1), 1, Math.max(safeHeight - y, 1));
        entry.props.X = x;
        entry.props.Y = y;
        entry.props.WIDTH = width;
        entry.props.HEIGHT = height;
      }
    }));
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
          if (entry?.props) entry.props.ROTATE = snapped;
        }
      }
    ));
  }

  return issues;
};

export { validateLevel };
