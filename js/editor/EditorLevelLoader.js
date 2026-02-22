import { FileContainer } from '../data/FileContainer.js';
import { Level } from '../level/Level.js';
import { LevelElement } from '../level/LevelElement.js';
import { GroundReader, loadSteelSprites } from '../level/GroundReader.js';
import { GroundRenderer } from '../render/GroundRenderer.js';
import { SolidLayer } from '../render/SolidLayer.js';
import { DrawProperties } from '../render/DrawProperties.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { DEFAULT_LEVEL_WIDTH, DEFAULT_LEVEL_HEIGHT } from '../level/ClassicLevelConstants.js';
import { MIDI_FLAG_TRIGGER_MAX, clampMidiFlagId, toMidiFlagTriggerType } from '../midi/MidiFlagTriggers.js';
import {
  getDefaultStyle,
  getStyle,
  resolveGadgetId,
  resolveTerrainId
} from './StyleRegistry.js';

const DEFAULT_RELEASE_RATE = 50;
const MAX_TIME_LIMIT_SECONDS = 99 * 60 + 99;
const DEFAULT_MIDI_FLAG_COOLDOWN = 8;

const coerceNumber = (value, fallback) => {
  return Number.isFinite(value) ? value : fallback;
};

const normalizeBoolean = (value) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return false;
};

const resolveStyleName = (editorLevel, options) => {
  if (options.styleName) return options.styleName;
  const headerStyle = editorLevel.getHeader('STYLE');
  if (headerStyle) return String(headerStyle);
  const defaultStyle = getDefaultStyle()?.name;
  return defaultStyle || 'dirt';
};

const resolveGroundSet = (styleName) => {
  const style = getStyle(styleName) || getDefaultStyle();
  if (Number.isFinite(style?.groundSet)) return style.groundSet | 0;
  return 0;
};

const resolveTimeLimit = (value) => {
  if (value === 'INFINITE') return MAX_TIME_LIMIT_SECONDS;
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const resolvePieceId = (resolver, styleName, piece) => {
  const resolved = resolver(styleName, piece);
  return Number.isFinite(resolved) ? resolved : 0;
};

const createDrawProperties = (props) => {
  return new DrawProperties(
    normalizeBoolean(props?.FLIP_VERTICAL),
    normalizeBoolean(props?.NO_OVERWRITE),
    false,
    normalizeBoolean(props?.ERASE)
  );
};

const createLevelElements = (entries, styleName, resolver) => {
  if (!Array.isArray(entries)) return [];
  return entries.map(entry => {
    const props = entry?.props || {};
    const element = new LevelElement();
    element.id = resolvePieceId(resolver, styleName, props.PIECE);
    element.x = coerceNumber(props.X, 0);
    element.y = coerceNumber(props.Y, 0);
    element.drawProperties = createDrawProperties(props);
    return element;
  });
};

const createSteelRanges = (entries) => {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => {
      const props = entry?.props || {};
      const x = coerceNumber(props.X, 0);
      const y = coerceNumber(props.Y, 0);
      const width = coerceNumber(props.WIDTH, 0);
      const height = coerceNumber(props.HEIGHT, 0);
      if (width <= 0 || height <= 0) return null;
      return { x, y, width, height };
    })
    .filter(Boolean);
};

/**
 * Convert editor gadget props tagged with MIDI flag metadata into runtime
 * trigger descriptors consumed by GameView.
 */
const extractMidiFlags = (entries, styleName, objectImages) => {
  if (!Array.isArray(entries) || !Array.isArray(objectImages)) return [];
  const flags = [];
  const usedIds = new Set();
  for (const entry of entries) {
    const props = entry?.props || {};
    if (!normalizeBoolean(props.MIDI_FLAG)) continue;
    const explicitId = clampMidiFlagId(Number(props.MIDI_FLAG_ID));
    if (explicitId) usedIds.add(explicitId);
  }
  let autoId = 1;
  const nextAutoId = () => {
    while (autoId <= MIDI_FLAG_TRIGGER_MAX && usedIds.has(autoId)) {
      autoId += 1;
    }
    if (autoId > MIDI_FLAG_TRIGGER_MAX) return null;
    const id = autoId;
    usedIds.add(id);
    autoId += 1;
    return id;
  };

  for (const entry of entries) {
    const props = entry?.props || {};
    const enabled = normalizeBoolean(props.MIDI_FLAG);
    if (!enabled) continue;
    const explicitId = clampMidiFlagId(Number(props.MIDI_FLAG_ID));
    const flagId = explicitId || nextAutoId();
    if (!flagId) continue;
    usedIds.add(flagId);
    const triggerType = toMidiFlagTriggerType(flagId);
    if (!triggerType) continue;
    const pieceId = resolvePieceId(resolveGadgetId, styleName, props.PIECE);
    const objectInfo = objectImages[pieceId] || null;
    const hasTriggerArea = objectInfo &&
      Number.isFinite(objectInfo.trigger_width) &&
      Number.isFinite(objectInfo.trigger_height) &&
      objectInfo.trigger_width > 0 &&
      objectInfo.trigger_height > 0;
    const x = coerceNumber(props.X, 0);
    const y = coerceNumber(props.Y, 0);
    const x1 = x + (hasTriggerArea ? coerceNumber(objectInfo.trigger_left, 0) : 0);
    const y1 = y + (hasTriggerArea ? coerceNumber(objectInfo.trigger_top, 0) : 0);
    const width = hasTriggerArea
      ? objectInfo.trigger_width
      : Math.max(1, objectInfo?.width || 8);
    const height = hasTriggerArea
      ? objectInfo.trigger_height
      : Math.max(1, objectInfo?.height || 8);
    const cooldownRaw = Number(props.MIDI_FLAG_COOLDOWN);
    const cooldownTicks = Number.isFinite(cooldownRaw)
      ? Math.max(0, Math.trunc(cooldownRaw))
      : DEFAULT_MIDI_FLAG_COOLDOWN;
    flags.push({
      id: flagId,
      triggerType,
      pieceId,
      x1,
      y1,
      x2: x1 + Math.max(1, width),
      y2: y1 + Math.max(1, height),
      cooldownTicks
    });
  }
  return flags;
};

const buildSkills = (skillset) => {
  const skills = new Array(Object.keys(SkillTypes).length).fill(0);
  if (!skillset) return skills;
  for (const [name, value] of skillset.entries()) {
    const id = SkillTypes[name];
    if (!Number.isFinite(id) || id <= 0) continue;
    skills[id] = coerceNumber(value, 0);
  }
  return skills;
};

const createClassicLevelData = (editorLevel, options = {}) => {
  if (!editorLevel) return null;
  const styleName = resolveStyleName(editorLevel, options);
  const groundSet = resolveGroundSet(styleName);
  const width = coerceNumber(editorLevel.getHeader('WIDTH'), DEFAULT_LEVEL_WIDTH);
  const height = coerceNumber(editorLevel.getHeader('HEIGHT'), DEFAULT_LEVEL_HEIGHT);
  const title = editorLevel.getHeader('TITLE') || 'Untitled';
  const releaseCount = coerceNumber(editorLevel.getHeader('LEMMINGS'), 0);
  const needCount = coerceNumber(editorLevel.getHeader('SAVE_REQUIREMENT'), 0);
  const releaseRate = coerceNumber(editorLevel.getHeader('MAX_SPAWN_INTERVAL'), DEFAULT_RELEASE_RATE);
  const timeLimit = resolveTimeLimit(editorLevel.getHeader('TIME_LIMIT'));
  const startX = coerceNumber(editorLevel.getHeader('START_X'), 0);

  const levelProperties = {
    levelName: String(title),
    releaseRate,
    releaseCount,
    needCount,
    timeLimit,
    skills: buildSkills(editorLevel.skillset)
  };

  const terrains = createLevelElements(editorLevel.terrains, styleName, resolveTerrainId);
  const objects = createLevelElements(editorLevel.gadgets, styleName, resolveGadgetId);
  const steelRanges = Array.isArray(options.steelRanges)
    ? options.steelRanges
    : createSteelRanges(editorLevel.steel);

  return {
    levelReader: {
      levelWidth: width,
      levelHeight: height,
      screenPositionX: startX,
      graphicSet1: groundSet,
      graphicSet2: 0,
      isSuperLemming: false,
      levelProperties,
      objects,
      terrains,
      steel: steelRanges
    },
    styleName,
    groundSet
  };
};

const loadEditorLevel = async (editorLevel, config, fileProvider, options = {}) => {
  if (!editorLevel || !config || !fileProvider) return null;
  const { levelReader, groundSet, styleName } = createClassicLevelData(editorLevel, {
    styleName: options.styleName,
    steelRanges: options.steelRanges
  });
  const deps = {
    Level,
    FileContainer,
    GroundReader,
    GroundRenderer,
    SolidLayer,
    loadSteelSprites,
    ...options
  };
  const LevelCtor = deps.Level;
  const FileContainerCtor = deps.FileContainer;
  const GroundReaderCtor = deps.GroundReader;
  const GroundRendererCtor = deps.GroundRenderer;
  const SolidLayerCtor = deps.SolidLayer;
  const loadSteelSpritesFn = deps.loadSteelSprites;

  const level = new LevelCtor(levelReader.levelWidth, levelReader.levelHeight);
  level.gameType = config.gametype;
  level.levelMode = Number.isFinite(options.levelGroupIndex) ? options.levelGroupIndex : 0;
  level.levelIndex = Number.isFinite(options.levelIndex) ? options.levelIndex : 0;
  level.screenPositionX = levelReader.screenPositionX;
  level.isSuperLemming = levelReader.isSuperLemming;
  level.mechanics = config.mechanics ?? {};

  const props = levelReader.levelProperties;
  level.name = props.levelName;
  level.releaseRate = props.releaseRate;
  level.releaseCount = props.releaseCount;
  level.needCount = props.needCount;
  level.timeLimit = props.timeLimit;
  level.skills = props.skills;

  await loadSteelSpritesFn();
  const groundSetId = groundSet | 0;
  const vgagrFile = fileProvider.loadBinary(config.path, `VGAGR${groundSetId}.DAT`);
  const groundFile = fileProvider.loadBinary(config.path, `GROUND${groundSetId}O.DAT`);
  const [vgagrBuf, groundBuf] = await Promise.all([vgagrFile, groundFile]);

  const vgaContainer = new FileContainerCtor(vgagrBuf);
  const groundReader = new GroundReaderCtor(groundBuf, vgaContainer.getPart(0), vgaContainer.getPart(1));
  const renderer = new GroundRendererCtor();
  renderer.createGroundMap(levelReader, groundReader.getTerrainImages());

  level.setGroundImage(renderer.img.getData());
  level.setGroundMaskLayer(new SolidLayerCtor(level.width, level.height, renderer.img.mask));
  const objectImages = groundReader.getObjectImages();
  level.setMapObjects(levelReader.objects, objectImages);
  level.setPalettes(groundReader.colorPalette, groundReader.groundPalette);
  level.midiFlags = extractMidiFlags(editorLevel.gadgets, styleName, objectImages);

  if (Array.isArray(levelReader.steel) && levelReader.steel.length) {
    level.setSteelAreas(levelReader.steel);
    if (typeof level.newSetSteelAreas === 'function') {
      level.newSetSteelAreas(levelReader, groundReader.getTerrainImages());
    }
  }

  return level;
};

export {
  createClassicLevelData,
  loadEditorLevel
};
