import { SkillTypes } from '../game/SkillTypes.js';
import { TriggerTypes } from '../level/TriggerTypes.js';

const HASH_OFFSET_A = 0x811c9dc5;
const HASH_OFFSET_B = 0x9e3779b9;
const HASH_PRIME = 0x01000193;

const SKILL_NAMES_BY_TYPE = Object.freeze({
  [SkillTypes.CLIMBER]: 'climber',
  [SkillTypes.FLOATER]: 'floater',
  [SkillTypes.BOMBER]: 'bomber',
  [SkillTypes.BLOCKER]: 'blocker',
  [SkillTypes.BUILDER]: 'builder',
  [SkillTypes.BASHER]: 'basher',
  [SkillTypes.MINER]: 'miner',
  [SkillTypes.DIGGER]: 'digger'
});

const HAZARD_TRIGGER_TYPES = new Set([
  TriggerTypes.UNKNOWN_2,
  TriggerTypes.UNKNOWN_3,
  TriggerTypes.TRAP,
  TriggerTypes.DROWN,
  TriggerTypes.KILL,
  TriggerTypes.FRYING
]);

const TRIGGER_NAMES_BY_TYPE = Object.freeze({
  [TriggerTypes.EXIT_LEVEL]: 'exit',
  [TriggerTypes.TRAP]: 'trap',
  [TriggerTypes.DROWN]: 'drown',
  [TriggerTypes.KILL]: 'kill',
  [TriggerTypes.ONEWAY_LEFT]: 'oneway-left',
  [TriggerTypes.ONEWAY_RIGHT]: 'oneway-right',
  [TriggerTypes.FRYING]: 'frying'
});

const isPlainObject = value => (
  value != null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const toInteger = (value, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
};

const toNonNegativeInteger = (value, fallback = 0) => Math.max(0, toInteger(value, fallback));

const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);

const hex32 = value => (value >>> 0).toString(16).padStart(8, '0');

const mixHashByte = (state, byte) => {
  state.a ^= byte & 0xff;
  state.a = Math.imul(state.a, HASH_PRIME) >>> 0;
  state.b ^= (byte + state.a) & 0xff;
  state.b = Math.imul(state.b, HASH_PRIME) >>> 0;
};

const mixHashString = (state, text) => {
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    mixHashByte(state, code & 0xff);
    mixHashByte(state, (code >>> 8) & 0xff);
  }
};

const createHashState = () => ({ a: HASH_OFFSET_A, b: HASH_OFFSET_B });

const finishHashState = state => `${hex32(state.a)}${hex32(state.b)}`;

const stableJsonValue = (value, seen = new Set()) => {
  if (value == null) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (ArrayBuffer.isView(value)) {
    return Array.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }
  if (Array.isArray(value)) {
    return value.map(item => stableJsonValue(item, seen));
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const out = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    const next = value[key];
    if (typeof next === 'undefined' || typeof next === 'function') continue;
    out[key] = stableJsonValue(next, seen);
  }
  seen.delete(value);
  return out;
};

const stableStringify = value => JSON.stringify(stableJsonValue(value));

const stableHash = value => {
  const state = createHashState();
  mixHashString(state, stableStringify(value));
  return finishHashState(state);
};

const cloneMaskBytes = (value, width, height, sampler = null) => {
  const length = Math.max(0, width * height);
  if (value instanceof Uint8Array) {
    const out = new Uint8Array(length);
    out.set(value.subarray(0, Math.min(length, value.length)));
    return out;
  }
  if (ArrayBuffer.isView(value)) {
    const out = new Uint8Array(length);
    const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    out.set(source.subarray(0, Math.min(length, source.length)));
    return out;
  }
  if (Array.isArray(value)) {
    const out = new Uint8Array(length);
    for (let i = 0; i < Math.min(length, value.length); i += 1) {
      out[i] = value[i] ? 1 : 0;
    }
    return out;
  }
  const out = new Uint8Array(length);
  if (typeof sampler !== 'function') return out;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      out[row + x] = sampler(x, y) ? 1 : 0;
    }
  }
  return out;
};

const readLayerObject = (source, keys) => {
  for (const key of keys) {
    const value = source?.[key];
    if (value) return value;
  }
  return null;
};

const readGroundLayer = source => {
  if (typeof source?.getGroundMaskLayer === 'function') return source.getGroundMaskLayer();
  return readLayerObject(source, ['groundMask', 'terrainMask', 'mask']);
};

const readSteelLayer = source => readLayerObject(source, ['steelMask', 'steelLayer']);

const normalizeMask = (source, width, height, {
  layer = null,
  samplerName = null
} = {}) => {
  const resolvedLayer = layer || source;
  const maskValue = resolvedLayer?.mask ?? resolvedLayer;
  const sampler = samplerName && typeof source?.[samplerName] === 'function'
    ? (x, y) => source[samplerName](x, y)
    : null;
  return cloneMaskBytes(maskValue, width, height, sampler);
};

const hashMask = (mask, width, height, salt = '') => {
  const state = createHashState();
  mixHashString(state, `${salt}:${width}x${height}:`);
  for (let i = 0; i < mask.length; i += 1) {
    mixHashByte(state, mask[i] ? 1 : 0);
  }
  return finishHashState(state);
};

const countMask = mask => {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) count += 1;
  }
  return count;
};

const normalizeRectSize = (rect, axis) => {
  const sizeKey = axis === 'x' ? 'width' : 'height';
  const altSizeKey = axis === 'x' ? 'w' : 'h';
  const endKey = axis === 'x' ? 'x2' : 'y2';
  const startKey = axis === 'x' ? 'x1' : 'y1';
  const pointKey = axis === 'x' ? 'x' : 'y';
  const altPointKey = axis === 'x' ? 'left' : 'top';
  if (rect[sizeKey] != null || rect[altSizeKey] != null) {
    return toNonNegativeInteger(rect[sizeKey] ?? rect[altSizeKey], 0);
  }
  if (Number.isFinite(Number(rect[endKey]))) {
    return toNonNegativeInteger(Number(rect[endKey]) - Number(rect[startKey] ?? rect[pointKey] ?? 0), 0);
  }
  if (rect[pointKey] != null || rect[altPointKey] != null || rect[startKey] != null) return 1;
  return 0;
};

const normalizeRect = (rect = {}, index = 0) => ({
  index: toNonNegativeInteger(rect.index, index),
  x: toInteger(rect.x ?? rect.left ?? rect.x1, 0),
  y: toInteger(rect.y ?? rect.top ?? rect.y1, 0),
  width: normalizeRectSize(rect, 'x'),
  height: normalizeRectSize(rect, 'y')
});

const normalizeRectList = (items = []) => {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => normalizeRect(item, index))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height);
};

const normalizeRanges = (ranges, stride, hasDirection = false) => {
  if (!ranges || typeof ranges.length !== 'number') return [];
  const out = [];
  for (let i = 0, index = 0; i + stride - 1 < ranges.length; i += stride, index += 1) {
    const rect = {
      index,
      x: ranges[i],
      y: ranges[i + 1],
      width: ranges[i + 2],
      height: ranges[i + 3]
    };
    if (hasDirection) rect.direction = ranges[i + 4];
    out.push(rect);
  }
  return out;
};

const readMaskComponentRects = (mask, width, height) => {
  const visited = new Uint8Array(mask.length);
  const queueX = [];
  const queueY = [];
  const rects = [];
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x;
      if (!mask[offset] || visited[offset]) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      visited[offset] = 1;
      queueX.length = 0;
      queueY.length = 0;
      queueX.push(x);
      queueY.push(y);
      for (let read = 0; read < queueX.length; read += 1) {
        const cx = queueX[read];
        const cy = queueY[read];
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1]
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nextOffset = ny * width + nx;
          if (!mask[nextOffset] || visited[nextOffset]) continue;
          visited[nextOffset] = 1;
          queueX.push(nx);
          queueY.push(ny);
        }
      }
      rects.push({
        index: rects.length,
        x: minX,
        y: minY,
        width: (maxX - minX) + 1,
        height: (maxY - minY) + 1
      });
    }
  }
  return rects;
};

const normalizeSteelConstraints = (source, steelMask, width, height) => {
  const explicit = normalizeRectList(source?.steel ?? source?.steelAreas ?? []);
  const ranges = normalizeRanges(source?.steelRanges, 4, false);
  const rects = explicit.length ? explicit : ranges;
  const constraints = rects.length ? rects : readMaskComponentRects(steelMask, width, height);
  return constraints.map((rect, index) => ({ ...normalizeRect(rect, index), type: 'steel' }));
};

const normalizeOneWayDirection = value => {
  if (value === 'left' || value === 'right') return value;
  const number = Number(value);
  if (Number.isFinite(number)) return number === 1 ? 'right' : 'left';
  return 'unknown';
};

const normalizeOneWayConstraints = source => {
  const explicit = Array.isArray(source?.oneWay) ? source.oneWay : [];
  const fromRanges = normalizeRanges(source?.arrowRanges, 5, true);
  const fromTriggers = Array.isArray(source?.triggers)
    ? source.triggers
      .filter(trigger => trigger?.type === TriggerTypes.ONEWAY_LEFT || trigger?.type === TriggerTypes.ONEWAY_RIGHT)
      .map(trigger => ({
        x: trigger.x1,
        y: trigger.y1,
        width: trigger.x2 - trigger.x1,
        height: trigger.y2 - trigger.y1,
        direction: trigger.type === TriggerTypes.ONEWAY_RIGHT ? 'right' : 'left'
      }))
    : [];
  return [...explicit, ...fromRanges, ...fromTriggers]
    .map((item, index) => ({
      ...normalizeRect(item, index),
      direction: normalizeOneWayDirection(item.direction),
      type: 'one-way'
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.direction.localeCompare(b.direction));
};

const normalizeEntrance = (item, index) => ({
  ...normalizeRect(item, index),
  opened: !!item?._opened,
  type: 'entrance'
});

const normalizeEntrances = source => normalizeRectList(source?.entrances ?? [])
  .map((item, index) => normalizeEntrance(item, index));

const triggerToRect = (trigger, index) => ({
  index,
  x: toInteger(trigger?.x1, 0),
  y: toInteger(trigger?.y1, 0),
  width: toNonNegativeInteger((trigger?.x2 ?? 0) - (trigger?.x1 ?? 0), 0),
  height: toNonNegativeInteger((trigger?.y2 ?? 0) - (trigger?.y1 ?? 0), 0),
  triggerType: toInteger(trigger?.type, 0),
  kind: TRIGGER_NAMES_BY_TYPE[trigger?.type] || `trigger-${trigger?.type ?? 0}`
});

const normalizeExits = source => {
  const explicit = Array.isArray(source?.exits)
    ? source.exits
      .map((item, index) => ({
        ...normalizeRect(item, index),
        type: 'exit',
        kind: item.kind || item.type || 'exit'
      }))
    : [];
  const triggerExits = Array.isArray(source?.triggers)
    ? source.triggers
      .filter(trigger => trigger?.type === TriggerTypes.EXIT_LEVEL)
      .map((trigger, index) => ({ ...triggerToRect(trigger, index), type: 'exit' }))
    : [];
  return [...explicit, ...triggerExits]
    .sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width);
};

const normalizeHazards = source => {
  const explicit = Array.isArray(source?.hazards)
    ? source.hazards.map((item, index) => ({
      ...normalizeRect(item, index),
      type: 'hazard',
      kind: item.kind || item.type || 'hazard'
    }))
    : [];
  const triggerHazards = Array.isArray(source?.triggers)
    ? source.triggers
      .filter(trigger => HAZARD_TRIGGER_TYPES.has(trigger?.type))
      .map((trigger, index) => ({ ...triggerToRect(trigger, index), type: 'hazard' }))
    : [];
  return [...explicit, ...triggerHazards]
    .sort((a, b) => a.y - b.y || a.x - b.x || String(a.kind).localeCompare(String(b.kind)));
};

const normalizeMutationRecord = (item, index, fallbackKind) => ({
  ...normalizeRect(item, index),
  kind: String(item?.kind ?? item?.type ?? fallbackKind),
  skillType: item?.skillType == null ? null : String(item.skillType),
  direction: item?.direction == null ? null : normalizeOneWayDirection(item.direction),
  tick: item?.tick == null ? null : toNonNegativeInteger(item.tick, 0),
  source: item?.source == null ? null : String(item.source)
});

const normalizeMutationRecords = source => {
  const groups = [
    ['terrainMutations', 'mutation'],
    ['mutations', 'mutation'],
    ['builderStairs', 'builder-stair'],
    ['digShafts', 'dig-shaft'],
    ['bashTunnels', 'bash-tunnel'],
    ['mineTunnels', 'mine-tunnel']
  ];
  const out = [];
  for (const [key, fallbackKind] of groups) {
    const records = Array.isArray(source?.[key]) ? source[key] : [];
    for (const record of records) {
      out.push(normalizeMutationRecord(record, out.length, fallbackKind));
    }
  }
  return out.sort((a, b) => (
    a.y - b.y ||
    a.x - b.x ||
    a.width - b.width ||
    String(a.kind).localeCompare(String(b.kind)) ||
    a.index - b.index
  ));
};

const readGameFacade = input => {
  if (!input) return null;
  if (input.level || typeof input.getGameTimer === 'function' || typeof input.getLemmingManager === 'function') {
    return input;
  }
  if (input.game) return input.game;
  return null;
};

const resolveLevelSource = input => {
  const game = readGameFacade(input);
  if (game?.level) return game.level;
  if (input?.level) return input.level;
  return input;
};

const readLemmingCollection = input => {
  const game = readGameFacade(input);
  const manager = game?.getLemmingManager?.() ?? game?.lemmingManager ?? input?.lemmingManager;
  if (typeof manager?.getLemmings === 'function') return manager.getLemmings();
  if (Array.isArray(manager?.activeLemmings)) return manager.activeLemmings;
  if (Array.isArray(input?.lemmings)) return input.lemmings;
  if (Array.isArray(resolveLevelSource(input)?.lemmings)) return resolveLevelSource(input).lemmings;
  return [];
};

const normalizeActionName = action => {
  if (action == null) return null;
  if (typeof action === 'string' || typeof action === 'number') return action;
  if (typeof action.getActionName === 'function') return action.getActionName();
  if (action.constructor?.name) return action.constructor.name;
  return String(action);
};

const normalizeLemming = (lemming, index) => ({
  id: lemming?.id ?? index,
  x: toInteger(lemming?.x, 0),
  y: toInteger(lemming?.y, 0),
  lookRight: lemming?.lookRight !== false,
  direction: lemming?.lookRight === false ? 'left' : 'right',
  action: normalizeActionName(lemming?.action),
  state: normalizeActionName(lemming?.state),
  removed: !!(lemming?.removed || lemming?.isRemoved?.()),
  disabled: !!(lemming?.disabled || lemming?.isDisabled?.()),
  countdown: toNonNegativeInteger(lemming?.countdown, 0),
  canClimb: !!lemming?.canClimb,
  hasParachute: !!lemming?.hasParachute
});

const normalizeLemmings = input => readLemmingCollection(input)
  .filter(Boolean)
  .map((lemming, index) => normalizeLemming(lemming, index))
  .sort((a, b) => Number(a.id) - Number(b.id) || a.y - b.y || a.x - b.x);

const normalizeSkillMap = skills => {
  const out = {};
  for (const name of Object.values(SKILL_NAMES_BY_TYPE)) out[name] = 0;
  if (Array.isArray(skills)) {
    for (const [typeText, name] of Object.entries(SKILL_NAMES_BY_TYPE)) {
      out[name] = toNonNegativeInteger(skills[Number(typeText)], 0);
    }
    return out;
  }
  if (isPlainObject(skills)) {
    const keys = Object.keys(skills).sort();
    for (const key of keys) {
      const normalized = key.toLowerCase();
      out[normalized] = toNonNegativeInteger(skills[key], 0);
    }
  }
  return out;
};

const normalizeSkills = input => {
  const game = readGameFacade(input);
  const level = resolveLevelSource(input);
  const gameSkills = game?.getGameSkills?.() ?? game?.skills ?? null;
  const sourceSkills = gameSkills?.skills ?? level?.skills ?? input?.skills ?? {};
  const counts = normalizeSkillMap(sourceSkills);
  return {
    counts,
    selectedSkill: gameSkills?.selectedSkill ?? null,
    selectedSkillName: SKILL_NAMES_BY_TYPE[gameSkills?.selectedSkill] ?? null,
    cheatMode: !!gameSkills?.cheatMode
  };
};

const normalizeTimer = input => {
  const game = readGameFacade(input);
  const level = resolveLevelSource(input);
  const timer = input?.timer ?? game?.getGameTimer?.() ?? game?.gameTimer ?? null;
  const tick = timer?.tick ?? timer?.tickIndex ?? timer?.getGameTicks?.() ?? input?.tick ?? 0;
  return {
    tick: toNonNegativeInteger(tick, 0),
    seconds: Number.isFinite(Number(timer?.getGameTime?.())) ? Number(timer.getGameTime()) : null,
    timeLimit: toNonNegativeInteger(timer?.timeLimit ?? level?.timeLimit ?? input?.timeLimit, 0),
    timeLeft: Number.isFinite(Number(timer?.getGameLeftTime?.())) ? Number(timer.getGameLeftTime()) : null
  };
};

const normalizeVictory = input => {
  const game = readGameFacade(input);
  const level = resolveLevelSource(input);
  const victory = input?.victory ?? game?.getVictoryCondition?.() ?? game?.gameVictoryCondition ?? null;
  const needCount = victory?.getNeedCount?.() ?? victory?.needCount ?? level?.needCount ?? input?.needCount ?? 0;
  const releaseCount = victory?.getReleaseCount?.() ?? victory?.releaseCount ?? level?.releaseCount ?? input?.releaseCount ?? 0;
  const survivors = victory?.getSurvivorsCount?.() ?? victory?.survivorCount ?? input?.survivorsCount ?? 0;
  const left = victory?.getLeftCount?.() ?? victory?.leftCount ?? input?.leftCount ?? releaseCount;
  const out = victory?.getOutCount?.() ?? victory?.outCount ?? input?.outCount ?? 0;
  return {
    needCount: toNonNegativeInteger(needCount, 0),
    releaseCount: toNonNegativeInteger(releaseCount, 0),
    survivorsCount: toNonNegativeInteger(survivors, 0),
    leftCount: toNonNegativeInteger(left, 0),
    outCount: toNonNegativeInteger(out, 0),
    gameState: game?.getGameState?.() ?? game?.finalGameState ?? null
  };
};

const publicSnapshotForHash = snapshot => ({
  kind: snapshot.kind,
  sourceKind: snapshot.sourceKind,
  id: snapshot.id,
  width: snapshot.width,
  height: snapshot.height,
  terrainHash: snapshot.terrainHash,
  terrainMutationHash: snapshot.terrainMutationHash,
  steel: {
    hash: snapshot.steel.hash,
    solidCount: snapshot.steel.solidCount,
    constraints: snapshot.steel.constraints
  },
  oneWay: snapshot.oneWay,
  entrances: snapshot.entrances,
  exits: snapshot.exits,
  hazards: snapshot.hazards,
  lemmings: snapshot.lemmings,
  terrainMutations: snapshot.terrainMutations,
  skills: snapshot.skills,
  timer: snapshot.timer,
  victory: snapshot.victory
});

const extractSolverState = (input, options = {}) => {
  const source = resolveLevelSource(input);
  if (!source) {
    throw new Error('extractSolverState requires a synthetic fixture, Level-like object, or Game-like object.');
  }
  const width = Math.max(1, toInteger(options.width ?? source.width, 1));
  const height = Math.max(1, toInteger(options.height ?? source.height, 1));
  const groundLayer = readGroundLayer(source);
  const groundMask = normalizeMask(source, width, height, {
    layer: groundLayer,
    samplerName: 'hasGroundAt'
  });
  const baseGroundLayer = source.baseGroundMask ?? source.originalGroundMask ?? source.terrainMask ?? groundLayer;
  const baseGroundMask = normalizeMask(source, width, height, {
    layer: baseGroundLayer,
    samplerName: 'hasGroundAt'
  });
  const steelLayer = readSteelLayer(source);
  const steelMask = normalizeMask(source, width, height, {
    layer: steelLayer,
    samplerName: 'isSteelAt'
  });
  const terrainHash = source.terrainHash ?? hashMask(baseGroundMask, width, height, 'terrain');
  const terrainMutations = normalizeMutationRecords(source);
  const terrainMutationMaskHash = hashMask(groundMask, width, height, 'terrain-mutation');
  const terrainMutationHash = source.terrainMutationHash ??
    source.groundMutationHash ??
    stableHash({
      maskHash: terrainMutationMaskHash,
      mutations: terrainMutations
    });
  const steelHash = source.steelHash ?? hashMask(steelMask, width, height, 'steel');
  const steelConstraints = normalizeSteelConstraints(source, steelMask, width, height);
  const snapshot = {
    kind: 'solver-state',
    sourceKind: options.sourceKind ||
      input?.sourceKind ||
      input?.kind ||
      input?.type ||
      source.kind ||
      (readGameFacade(input)?.level ? 'game' : 'level'),
    id: String(options.id ?? source.id ?? source.name ?? 'level'),
    width,
    height,
    terrainHash,
    terrainMutationHash,
    terrain: {
      width,
      height,
      hash: terrainHash,
      mutationHash: terrainMutationHash,
      solidCount: countMask(groundMask),
      mask: groundMask
    },
    steel: {
      hash: steelHash,
      solidCount: countMask(steelMask),
      mask: steelMask,
      constraints: steelConstraints
    },
    oneWay: normalizeOneWayConstraints(source),
    entrances: normalizeEntrances(source),
    exits: normalizeExits(source),
    hazards: normalizeHazards(source),
    terrainMutations,
    lemmings: normalizeLemmings(input),
    skills: normalizeSkills(input),
    timer: normalizeTimer(input),
    victory: normalizeVictory(input)
  };
  snapshot.hashes = {
    terrain: snapshot.terrainHash,
    terrainMutation: snapshot.terrainMutationHash,
    steel: steelHash,
    oneWay: stableHash(snapshot.oneWay),
    hazards: stableHash(snapshot.hazards),
    terrainMutations: stableHash(snapshot.terrainMutations),
    entrances: stableHash(snapshot.entrances),
    exits: stableHash(snapshot.exits),
    lemmings: stableHash(snapshot.lemmings),
    skills: stableHash(snapshot.skills),
    timer: stableHash(snapshot.timer),
    victory: stableHash(snapshot.victory)
  };
  snapshot.snapshotHash = stableHash(publicSnapshotForHash(snapshot));
  snapshot.hashes.snapshot = snapshot.snapshotHash;
  return snapshot;
};

const isSolverState = value => value?.kind === 'solver-state' && value?.terrain?.mask;

export {
  SKILL_NAMES_BY_TYPE,
  extractSolverState,
  hashMask,
  isSolverState,
  stableHash,
  stableStringify
};
