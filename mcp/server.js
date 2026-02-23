import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TOOL_SURFACES, buildSurfaceRegistry, parseEnabledSurfaces } from './tools/surfaces.js';
import { EventQueue } from './eventQueue.js';
import {
  WatchPollingController,
  readPointerValue,
  createPointerWatchState,
  updatePointerWatchState
} from './watchPolling.js';
import { ResourceStore } from './resourceStore.js';
import { getSession, sessions } from './sessionStore.js';
import { attachEvents } from './eventEnvelope.js';
import { disposeAllSessionRuntimes, disposeSessionRuntime } from './sessionLifecycle.js';
import { buildLemmingSummary } from './lemmingSummary.js';
import { createStateToolHandlers } from './stateTools.js';
import { createSpectatorTools } from './spectatorTools.js';
import { createShutdownController } from './shutdownController.js';
import {
  buildToolCatalog,
  createLegacyToolAliases,
  parseBooleanEnv,
  resolveToolCandidates
} from './toolRouting.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const KEYBINDINGS_PATH = path.join(ROOT_DIR, 'keybindings.json');
const SPECTATOR_HTML_PATH = path.join(__dirname, 'spectator.html');

const DEFAULT_BASE_URL = process.env.LEMMINGS_MCP_BASE_URL || 'https://localhost:8080';
const DEFAULT_PATH = process.env.LEMMINGS_MCP_PATH || '/?e2e=1';
const DEFAULT_VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };
const ENABLED_TOOL_SURFACES = parseEnabledSurfaces(process.env.LEMMINGS_MCP_SURFACES);

const MCP_SURFACE_SPLIT_ROLLOUT = parseBooleanEnv(
  process.env.LEMMINGS_ROLLOUT_MCP_SURFACE_SPLIT,
  true
);
const MCP_LEGACY_TOOL_ALIASES_ENABLED = parseBooleanEnv(
  process.env.LEMMINGS_ROLLOUT_MCP_LEGACY_ALIASES,
  true
);
const MCP_DOTTED_TOOL_FALLBACK_ENABLED = parseBooleanEnv(
  process.env.LEMMINGS_ROLLOUT_MCP_DOTTED_FALLBACK,
  true
);

const SKILL_ACTIONS = {
  climber: 'selectSkillClimber',
  floater: 'selectSkillFloater',
  bomber: 'selectSkillBomber',
  blocker: 'selectSkillBlocker',
  builder: 'selectSkillBuilder',
  basher: 'selectSkillBasher',
  miner: 'selectSkillMiner',
  digger: 'selectSkillDigger'
};

const SKILL_NAMES = Object.freeze([
  'climber',
  'floater',
  'bomber',
  'blocker',
  'builder',
  'basher',
  'miner',
  'digger'
]);

const SKILL_INDEX_BY_NAME = Object.freeze({
  climber: 1,
  floater: 2,
  bomber: 3,
  blocker: 4,
  builder: 5,
  basher: 6,
  miner: 7,
  digger: 8
});

const LEMMING_DELTA_FIELDS = Object.freeze([
  'x',
  'y',
  'lookRight',
  'frameIndex',
  'state',
  'canClimb',
  'hasParachute',
  'removed',
  'disabled',
  'countdown',
  'hasExploded',
  'lastTriggerType',
  'actionType',
  'countdownActive'
]);

const DEFAULT_LEM_DELTA_FIELDS = Object.freeze([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
const MCP_PROTOCOL_VERSION = '2.1.0';
const MCP_PROTOCOL_SCHEMA_FROZEN_AT = '2026-02-23';

const KEY_ALIASES = new Map([
  ['Ctrl', 'Control'],
  ['ControlLeft', 'Control'],
  ['ControlRight', 'Control'],
  ['Cmd', 'Meta'],
  ['Command', 'Meta'],
  ['MetaLeft', 'Meta'],
  ['MetaRight', 'Meta'],
  ['AltLeft', 'Alt'],
  ['AltRight', 'Alt'],
  ['Option', 'Alt'],
  ['ShiftLeft', 'Shift'],
  ['ShiftRight', 'Shift']
]);

const RESOURCE_URI_RE = /^lemmings:\/\/sessions\/([^/]+)\/resources\/([^/]+)$/;

let cachedKeybindings = null;

const nowIso = () => new Date().toISOString();

const makeId = (bytes = 9) => crypto.randomBytes(bytes)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const normalizeKeyToken = (token) => {
  const raw = String(token || '');
  return KEY_ALIASES.get(raw) || raw;
};

const normalizeKeyChord = (chord) => String(chord || '')
  .split('+')
  .map((part) => normalizeKeyToken(part.trim()))
  .filter(Boolean)
  .join('+');

const formatToMime = (format) => {
  switch (format) {
  case 'jpeg':
    return 'image/jpeg';
  case 'webp':
    return 'image/webp';
  default:
    return 'image/png';
  }
};

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
});

const SessionCreateSchema = z.object({
  baseUrl: z.string().optional(),
  path: z.string().optional(),
  headless: z.boolean().optional(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive().optional()
  }).optional(),
  enableSpectator: z.boolean().optional(),
  spectator: z.object({
    port: z.number().int().positive().optional(),
    allowHumanInput: z.boolean().optional(),
    openBrowser: z.boolean().optional(),
    frameIntervalMs: z.number().int().positive().optional(),
    jpegQuality: z.number().int().min(1).max(100).optional(),
    frameSkipPolicy: z.enum(['latest', 'none']).optional()
  }).optional(),
  resources: z.object({
    maxBytes: z.number().int().positive().optional(),
    ttlMs: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().positive().optional()
  }).optional(),
  events: z.object({
    maxEvents: z.number().int().positive().optional(),
    mode: z.enum(['none', 'minimal', 'full']).optional()
  }).optional()
});

const SessionCloseSchema = z.object({
  sessionId: z.string().min(1)
});

const TimeSchema = z.object({
  sessionId: z.string().min(1)
});

const TimeStepSchema = z.object({
  sessionId: z.string().min(1),
  count: z.number().int(),
  ensurePaused: z.boolean().optional()
});

const StateGetSchema = z.object({
  sessionId: z.string().min(1),
  preset: z.enum(['compact', 'debug']).optional(),
  include: z.object({
    view: z.boolean().optional(),
    stage: z.boolean().optional(),
    game: z.boolean().optional(),
    editor: z.boolean().optional(),
    midi: z.boolean().optional()
  }).optional(),
  lemmings: z.object({
    mode: z.enum(['none', 'summary', 'selected', 'all', 'ids']).optional(),
    ids: z.array(z.number().int()).optional(),
    max: z.number().int().positive().optional(),
    topK: z.number().int().positive().optional(),
    includeSelected: z.boolean().optional(),
    activeOnly: z.boolean().optional(),
    inViewOnly: z.boolean().optional(),
    rectWorld: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional()
    }).optional()
  }).optional(),
  format: z.object({
    delivery: z.enum(['inline', 'resource']).optional(),
    pretty: z.boolean().optional(),
    includeSizeEstimate: z.boolean().optional()
  }).optional()
});

const StateDeltaSchema = z.object({
  sessionId: z.string().min(1),
  afterTick: z.number().int().optional(),
  toTick: z.number().int().optional(),
  maxTicks: z.number().int().positive().optional(),
  include: z.object({
    lemmings: z.boolean().optional(),
    lemmingManager: z.boolean().optional(),
    skills: z.boolean().optional(),
    victory: z.boolean().optional(),
    timer: z.boolean().optional(),
    game: z.boolean().optional(),
    sound: z.boolean().optional(),
    minimap: z.boolean().optional(),
    triggers: z.boolean().optional(),
    objects: z.boolean().optional(),
    ground: z.boolean().optional(),
    entrances: z.boolean().optional()
  }).optional(),
  lemmings: z.object({
    fields: z.array(z.number().int().min(0).max(13)).optional(),
    includePrev: z.boolean().optional(),
    includeXY: z.enum(['none', 'tracked', 'all']).optional(),
    trackedIds: z.array(z.number().int()).optional(),
    maxChanges: z.number().int().positive().optional()
  }).optional(),
  format: z.object({
    delivery: z.enum(['inline', 'resource']).optional(),
    pretty: z.boolean().optional()
  }).optional()
});

const LemmingsSummarySchema = z.object({
  sessionId: z.string().min(1),
  filter: z.object({
    activeOnly: z.boolean().optional(),
    inViewOnly: z.boolean().optional(),
    rectWorld: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional()
    }).optional()
  }).optional(),
  topK: z.number().int().positive().optional(),
  includeSelected: z.boolean().optional()
});

const LemmingSelectSchema = z.object({
  sessionId: z.string().min(1),
  lemmingId: z.number().int(),
  alsoCenterView: z.boolean().optional(),
  confirm: z.boolean().optional()
});

const SkillApplySchema = z.object({
  sessionId: z.string().min(1),
  skill: z.enum([
    'climber',
    'floater',
    'bomber',
    'blocker',
    'builder',
    'basher',
    'miner',
    'digger'
  ]),
  lemmingId: z.number().int().optional(),
  ensurePaused: z.boolean().optional(),
  requireAvailable: z.boolean().optional(),
  postStep: z.number().int().nonnegative().optional(),
  verify: z.boolean().optional()
});

const InputActionSchema = z.object({
  sessionId: z.string().min(1),
  action: z.string().min(1),
  repeat: z.number().int().positive().optional()
});

const InputKeysSchema = z.object({
  sessionId: z.string().min(1),
  keys: z.array(z.string().min(1)).optional(),
  repeat: z.number().int().positive().optional(),
  events: z.array(z.object({
    type: z.enum(['down', 'up', 'press']),
    key: z.string().min(1)
  })).optional()
});

const VisionCaptureSchema = z.object({
  sessionId: z.string().min(1),
  target: z.enum(['page', 'gameCanvas', 'guiCanvas', 'stageCanvas', 'rect']).optional(),
  rect: RectSchema.optional(),
  format: z.enum(['png', 'jpeg', 'webp']).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  delivery: z.enum(['resource', 'inline']).optional(),
  tag: z.string().optional()
});

const VisionSequenceSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.enum(['step', 'sample']),
  frames: z.number().int().positive(),
  stepBy: z.number().int().optional(),
  everyMs: z.number().int().positive().optional(),
  capture: VisionCaptureSchema.omit({ sessionId: true }),
  returnManifest: z.boolean().optional()
});

const WatchCreateSchema = z.object({
  sessionId: z.string().min(1),
  watch: z.object({
    type: z.enum(['everyTicks', 'onChange']),
    everyTicks: z.number().int().positive().optional(),
    jsonPointer: z.string().optional()
  }),
  actions: z.array(z.object({
    type: z.enum(['emitSummary', 'capture']),
    include: z.object({
      lemmingsSummary: z.boolean().optional(),
      statePointers: z.array(z.string().min(1)).optional()
    }).optional(),
    capture: VisionCaptureSchema.omit({ sessionId: true }).optional(),
    throttleTicks: z.number().int().positive().optional()
  })).optional(),
  enabled: z.boolean().optional()
});

const WatchCancelSchema = z.object({
  sessionId: z.string().min(1),
  watchId: z.string().min(1)
});

const EditorApplySchema = z.object({
  sessionId: z.string().min(1),
  ops: z.array(z.object({
    opId: z.string().optional(),
    type: z.string().min(1),
    args: z.any().optional()
  })).optional(),
  atomic: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  history: z.object({
    label: z.string().optional(),
    record: z.boolean().optional()
  }).optional(),
  preview: z.object({
    refresh: z.boolean().optional(),
    label: z.string().optional(),
    preserveViewport: z.boolean().optional()
  }).optional(),
  validate: z.object({
    run: z.boolean().optional(),
    autoFix: z.enum(['none', 'safe', 'aggressive']).optional()
  }).optional(),
  returnState: z.enum(['none', 'editor', 'full']).optional()
});

const EditorMutationOptionsSchema = z.object({
  atomic: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  history: z.object({
    label: z.string().optional(),
    record: z.boolean().optional()
  }).optional(),
  preview: z.object({
    refresh: z.boolean().optional(),
    label: z.string().optional(),
    preserveViewport: z.boolean().optional()
  }).optional(),
  validate: z.object({
    run: z.boolean().optional(),
    autoFix: z.enum(['none', 'safe', 'aggressive']).optional()
  }).optional(),
  returnState: z.enum(['none', 'editor', 'full']).optional()
});

const EditorObjectKindSchema = z.enum(['terrain', 'gadget', 'steel']);
const EditorObjectKindOrAllSchema = z.enum(['terrain', 'gadget', 'steel', 'all']);

const EditorObjectRefSchema = z.object({
  kind: EditorObjectKindOrAllSchema.optional(),
  index: z.number().int().nonnegative().optional(),
  uid: z.string().min(1).optional()
}).refine(
  (value) => Number.isFinite(value.index) || typeof value.uid === 'string',
  { message: 'Editor object ref requires index or uid.' }
);

const EditorObjectBBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional()
});

const ObjectsListSchema = z.object({
  sessionId: z.string().min(1),
  kind: EditorObjectKindOrAllSchema.optional(),
  bbox: EditorObjectBBoxSchema.optional(),
  page: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().positive().max(500).optional(),
  fields: z.enum(['compact', 'full']).optional(),
  sinceRevision: z.number().int().nonnegative().optional()
});

const ObjectsPlaceSchema = z.object({
  sessionId: z.string().min(1),
  objects: z.array(z.object({
    kind: EditorObjectKindSchema,
    props: z.record(z.any()).optional(),
    piece: z.number().int().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    insertIndex: z.number().int().nonnegative().optional()
  })).min(1),
  options: EditorMutationOptionsSchema.optional()
});

const ObjectsUpdateSchema = z.object({
  sessionId: z.string().min(1),
  updates: z.array(z.object({
    ref: EditorObjectRefSchema,
    set: z.record(z.any()).optional(),
    unset: z.array(z.string().min(1)).optional()
  }).refine((value) => (
    (value.set && Object.keys(value.set).length > 0) ||
    (Array.isArray(value.unset) && value.unset.length > 0)
  ), {
    message: 'Each update requires set and/or unset fields.'
  })).min(1),
  options: EditorMutationOptionsSchema.optional()
});

const ObjectsDeleteSchema = z.object({
  sessionId: z.string().min(1),
  refs: z.array(EditorObjectRefSchema).min(1),
  options: EditorMutationOptionsSchema.optional()
});

const EventsPollSchema = z.object({
  sessionId: z.string().min(1),
  after: z.string().optional()
});

const toToolName = (name) => String(name).replace(/\./g, '_');

const buildToolResponse = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  structuredContent: payload
});

const loadKeybindings = async () => {
  if (cachedKeybindings) return cachedKeybindings;
  const raw = await fs.readFile(KEYBINDINGS_PATH, 'utf8');
  cachedKeybindings = JSON.parse(raw);
  return cachedKeybindings;
};

const ensureBlurred = async (session) => {
  await session.page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
  });
};

const callE2E = async (session, method, ...args) => session.page.evaluate(
  ({ method, args }) => {
    const api = window.__E2E__;
    if (!api || typeof api[method] !== 'function') {
      return { ok: false, error: 'harness_unavailable' };
    }
    try {
      return { ok: true, value: api[method](...args) };
    } catch (err) {
      return { ok: false, error: err ? String(err) : 'error' };
    }
  },
  { method, args }
);

const getState = async (session) => {
  const result = await callE2E(session, 'getState');
  return result.ok ? result.value : null;
};

const getTickIndex = async (session) => {
  const state = await getState(session);
  return state?.game?.timer?.tickIndex ?? null;
};

const filterStateSnapshot = (snapshot, include) => {
  const config = {
    view: false,
    stage: false,
    game: true,
    editor: false,
    midi: false,
    ...(include || {})
  };
  const output = {
    version: snapshot.version,
    mode: snapshot.mode,
    ready: snapshot.ready
  };

  if (config.view) output.view = snapshot.view;
  if (config.stage) output.stage = snapshot.stage;
  if (config.game) output.game = snapshot.game;
  if (config.editor) output.editor = snapshot.editor;
  if (config.midi) output.midi = snapshot.midi;

  return output;
};

const buildSkillInfo = (skills) => {
  if (!skills) return null;
  const counts = SKILL_NAMES.map((_, idx) => {
    const skillIndex = idx + 1;
    const raw = Array.isArray(skills.skills) ? skills.skills[skillIndex] ?? 0 : 0;
    return Number.isFinite(raw) ? raw : 99;
  });
  const cheatMode = !!skills.cheatMode;
  let availableMask = 0;
  counts.forEach((count, idx) => {
    if (cheatMode || count > 0) {
      availableMask |= (1 << idx);
    }
  });
  const selectedSkill = Number.isFinite(skills.selectedSkill) ? skills.selectedSkill : null;
  const selectedSkillName = Number.isFinite(selectedSkill)
    ? (SKILL_NAMES[selectedSkill - 1] || null)
    : null;
  return {
    selectedSkill,
    selectedSkillName,
    cheatMode,
    counts,
    availableMask
  };
};

const buildLemmingPrunePolicy = (state, skillInfo) => {
  const lemmings = Array.isArray(state?.game?.lemmings) ? state.game.lemmings : [];
  const availableMask = skillInfo?.availableMask ?? 0;
  const hasClimb = lemmings.some((lem) => lem?.canClimb);
  const hasParachute = lemmings.some((lem) => lem?.hasParachute);
  const hasCountdown = lemmings.some((lem) => lem?.countdownActive);
  const hasRemoved = lemmings.some((lem) => lem?.removed);
  const hasDisabled = lemmings.some((lem) => lem?.disabled);
  return {
    includeClimb: (availableMask & (1 << 0)) !== 0 || hasClimb,
    includeParachute: (availableMask & (1 << 1)) !== 0 || hasParachute,
    includeCountdown: (availableMask & (1 << 2)) !== 0 || hasCountdown,
    includeRemoved: hasRemoved,
    includeDisabled: hasDisabled
  };
};

const pruneLemming = (lem, policy) => {
  if (!lem) return null;
  const output = {
    id: lem.id,
    x: lem.x,
    y: lem.y,
    state: lem.state ?? null,
    actionType: lem.actionType ?? null
  };
  if (policy?.includeClimb && lem.canClimb) output.canClimb = true;
  if (policy?.includeParachute && lem.hasParachute) output.hasParachute = true;
  if (policy?.includeCountdown) {
    if (lem.countdownActive) output.countdownActive = true;
    if (Number.isFinite(lem.countdown) && lem.countdown > 0) output.countdown = lem.countdown;
  }
  if (policy?.includeRemoved && lem.removed) output.removed = true;
  if (policy?.includeDisabled && lem.disabled) output.disabled = true;
  return output;
};

const buildLemmingSummaryCompact = (state, policy, options = {}) => {
  const summary = buildLemmingSummary(state, options);
  return {
    ...summary,
    selected: pruneLemming(summary.selected, policy),
    top: Array.isArray(summary.top) ? summary.top.map((lem) => pruneLemming(lem, policy)) : []
  };
};

const ensureGameFocus = async (session) => {
  await ensureBlurred(session);
};

const pressKey = async (session, key) => {
  const normalized = normalizeKeyChord(key);
  if (!normalized) return;
  await session.page.keyboard.press(normalized);
};

const pressAction = async (session, action, repeat = 1) => {
  const bindings = session.keybindings?.bindings || {};
  const chordList = bindings[action];
  if (!Array.isArray(chordList) || chordList.length === 0) {
    return { ok: false, reason: 'unknown_action' };
  }
  await ensureGameFocus(session);
  for (let i = 0; i < repeat; i += 1) {
    await pressKey(session, chordList[0]);
  }
  session.events.add({
    source: 'agent',
    type: 'input',
    summary: `action:${action} x${repeat}`
  });
  return { ok: true, action, repeat };
};

const resolveCanvasMetrics = async (session) => {
  const result = await callE2E(session, 'getCanvasMetrics');
  return result.ok ? result.value : null;
};

const resolveCanvasClip = (metrics, target, rect) => {
  if (!metrics) return null;
  const scaleX = metrics.rect.width / metrics.size.width;
  const scaleY = metrics.rect.height / metrics.size.height;

  let base = null;
  if (target === 'gameCanvas' && metrics.gameRect) {
    base = metrics.gameRect;
  } else if (target === 'guiCanvas' && metrics.guiRect) {
    base = metrics.guiRect;
  } else if (target === 'stageCanvas') {
    base = null;
  }

  const baseCss = base
    ? {
      x: base.x * scaleX,
      y: base.y * scaleY,
      width: base.width * scaleX,
      height: base.height * scaleY
    }
    : { x: 0, y: 0, width: metrics.rect.width, height: metrics.rect.height };

  const clip = rect
    ? {
      x: baseCss.x + rect.x,
      y: baseCss.y + rect.y,
      width: rect.width,
      height: rect.height
    }
    : baseCss;

  return {
    clip: {
      x: metrics.rect.x + clip.x,
      y: metrics.rect.y + clip.y,
      width: clip.width,
      height: clip.height
    },
    width: clip.width,
    height: clip.height
  };
};

const captureFrame = async (session, options) => {
  const target = options.target || 'page';
  const rect = options.rect || null;
  const format = options.format || 'png';
  const quality = Number.isFinite(options.quality)
    ? Math.max(1, Math.min(100, Math.trunc(options.quality)))
    : null;
  const delivery = options.delivery || 'resource';
  const tag = options.tag || null;
  const mimeType = formatToMime(format);

  let clip = null;
  let width = null;
  let height = null;

  if (target === 'rect') {
    if (!rect) return { ok: false, reason: 'rect_required' };
    clip = rect;
    width = rect?.width ?? null;
    height = rect?.height ?? null;
  } else if (target === 'gameCanvas' || target === 'guiCanvas' || target === 'stageCanvas') {
    const metrics = await resolveCanvasMetrics(session);
    if (!metrics) return { ok: false, reason: 'canvas_missing' };
    const resolved = resolveCanvasClip(metrics, target, rect);
    clip = resolved?.clip || null;
    width = resolved?.width ?? null;
    height = resolved?.height ?? null;
  } else if (rect) {
    clip = rect;
    width = rect.width;
    height = rect.height;
  } else {
    const viewport = session.page.viewportSize();
    width = viewport?.width ?? null;
    height = viewport?.height ?? null;
  }

  if (clip && (!Number.isFinite(clip.width) || !Number.isFinite(clip.height) || clip.width <= 0 || clip.height <= 0)) {
    return { ok: false, reason: 'invalid_clip' };
  }

  const screenshotOptions = {
    type: format
  };
  if (quality != null && (format === 'jpeg' || format === 'webp')) {
    screenshotOptions.quality = quality;
  }
  if (clip) {
    screenshotOptions.clip = clip;
  }

  const bytes = await session.page.screenshot(screenshotOptions);
  const sizeBytes = bytes.length;
  const tickIndex = await getTickIndex(session);

  const frame = {
    id: makeId(),
    mimeType,
    width: Math.round(width ?? 0),
    height: Math.round(height ?? 0),
    tickIndex: Number.isFinite(tickIndex) ? tickIndex : null,
    takenAt: nowIso(),
    target,
    tag: tag || undefined
  };
  if (rect) {
    frame.clip = rect;
  }

  if (delivery === 'inline') {
    frame.dataBase64 = Buffer.from(bytes).toString('base64');
    return { ok: true, frame };
  }

  const stored = session.resources.put({
    sessionId: session.id,
    bytes,
    mimeType,
    meta: { kind: 'capture', target, tag }
  });
  frame.resourceUri = stored?.uri;
  frame.sizeBytes = sizeBytes;
  if (stored?.expiresAt) {
    frame.expiresAt = stored.expiresAt;
  }
  return { ok: true, frame };
};

const captureSequence = async (session, args) => {
  const frames = [];
  const mode = args.mode;
  const stepBy = Number.isFinite(args.stepBy) ? args.stepBy : 1;
  const everyMs = Number.isFinite(args.everyMs) ? args.everyMs : 250;
  const capture = args.capture || {};
  const total = Math.max(1, args.frames);

  if (mode === 'step') {
    await callE2E(session, 'pause');
  }

  for (let i = 0; i < total; i += 1) {
    const result = await captureFrame(session, capture);
    if (result?.frame) frames.push(result.frame);
    if (i === total - 1) break;
    if (mode === 'step') {
      await callE2E(session, 'step', stepBy);
    } else {
      await session.page.waitForTimeout(everyMs);
    }
  }

  const sequenceId = makeId();
  let manifestResourceUri = null;
  if (args.returnManifest !== false) {
    const manifest = {
      sequenceId,
      createdAt: nowIso(),
      frames
    };
    const stored = session.resources.put({
      sessionId: session.id,
      bytes: Buffer.from(JSON.stringify(manifest)),
      mimeType: 'application/json',
      meta: { kind: 'capture-manifest' }
    });
    manifestResourceUri = stored?.uri || null;
  }

  session.events.add({
    source: 'agent',
    type: 'capture',
    summary: `captureSequence:${sequenceId}`,
    resourceUris: manifestResourceUri ? [manifestResourceUri] : undefined
  });

  return {
    sequenceId,
    frames,
    manifestResourceUri
  };
};

const { startSpectatorServer, stopSpectatorServer } = createSpectatorTools({
  spectatorHtmlPath: SPECTATOR_HTML_PATH,
  captureFrame,
  resolveCanvasMetrics,
  normalizeKeyToken,
  ensureGameFocus
});

const startWatchLoop = (session) => {
  session.watchController?.start();
};

const stopWatchLoop = (session) => {
  session.watchController?.stop();
};

const requestWatchPoll = (session, { immediate = false } = {}) => {
  session.watchController?.request({ immediate });
};

const nudgeWatchPolling = (session) => {
  if (!session?.watches?.size) return;
  requestWatchPoll(session, { immediate: true });
};

const {
  getStateTool,
  getStateDeltaTool,
  getLemmingsSummaryTool
} = createStateToolHandlers({
  schemas: {
    StateGetSchema,
    StateDeltaSchema,
    LemmingsSummarySchema
  },
  attachEvents,
  getSession,
  callE2E,
  getState,
  getTickIndex,
  nudgeWatchPolling,
  helpers: {
    filterStateSnapshot,
    buildSkillInfo,
    buildLemmingPrunePolicy,
    buildLemmingSummary,
    buildLemmingSummaryCompact,
    pruneLemming
  },
  defaultLemDeltaFields: DEFAULT_LEM_DELTA_FIELDS
});

const pollWatches = async (session) => {
  if (!session.watches.size) return { triggeredCount: 0 };
  const state = await getState(session);
  if (!state) return { triggeredCount: 0 };
  const tickIndex = state.game?.timer?.tickIndex ?? null;
  let triggeredCount = 0;
  for (const watch of session.watches.values()) {
    if (!watch.enabled) continue;
    let triggered = false;
    if (watch.type === 'everyTicks') {
      if (Number.isFinite(tickIndex) && tickIndex - watch.lastTick >= watch.everyTicks) {
        watch.lastTick = tickIndex;
        triggered = true;
      }
    } else if (watch.type === 'onChange') {
      const pointerState = watch.pointerState || createPointerWatchState(watch.jsonPointer, state);
      watch.pointerState = pointerState;
      triggered = updatePointerWatchState(pointerState, state);
    }

    if (!triggered) continue;
    triggeredCount += 1;
    if (!Array.isArray(watch.actions) || !watch.actions.length) {
      session.events.add({
        source: 'system',
        type: 'watch-trigger',
        summary: `watch:${watch.id} triggered`,
        tickIndex
      });
      continue;
    }

    for (const action of watch.actions) {
      if (action.type === 'emitSummary') {
        const data = {};
        if (action.include?.lemmingsSummary) {
          data.lemmingsSummary = buildLemmingSummary(state, {});
        }
        if (Array.isArray(action.include?.statePointers)) {
          data.statePointers = {};
          for (const pointer of action.include.statePointers) {
            data.statePointers[pointer] = readPointerValue(state, pointer);
          }
        }
        session.events.add({
          source: 'system',
          type: 'watch-trigger',
          summary: `watch:${watch.id} summary`,
          tickIndex,
          data
        });
      } else if (action.type === 'capture') {
        const throttle = action.throttleTicks ?? 0;
        if (Number.isFinite(tickIndex) && throttle > 0 && tickIndex - watch.lastCaptureTick < throttle) {
          continue;
        }
        const captureOptions = action.capture || { target: 'page', delivery: 'resource' };
        const result = await captureFrame(session, captureOptions);
        if (result.ok && result.frame?.resourceUri) {
          watch.lastCaptureTick = Number.isFinite(tickIndex) ? tickIndex : watch.lastCaptureTick;
          session.events.add({
            source: 'system',
            type: 'capture',
            summary: `watch:${watch.id} capture`,
            tickIndex,
            resourceUris: [result.frame.resourceUri]
          });
        }
      }
    }
  }
  return { triggeredCount };
};

const createSession = async (args) => {
  const options = SessionCreateSchema.parse(args || {});
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const pathName = options.path || DEFAULT_PATH;
  const gameUrl = new URL(pathName, baseUrl).toString();
  const headless = options.headless !== false;
  const viewport = options.viewport || DEFAULT_VIEWPORT;

  const browser = await chromium.launch({
    headless,
    args: ['--allow-insecure-localhost']
  });

  const context = await browser.newContext({
    viewport: {
      width: viewport.width,
      height: viewport.height
    },
    deviceScaleFactor: Number.isFinite(viewport.deviceScaleFactor) ? viewport.deviceScaleFactor : 1,
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();
  const sessionId = makeId();

  const keybindings = await loadKeybindings();
  const resources = new ResourceStore(options.resources || {});
  const events = new EventQueue(options.events || {});

  const session = {
    id: sessionId,
    browser,
    context,
    page,
    baseUrl,
    gameUrl,
    keybindings,
    resources,
    events,
    eventsMode: options.events?.mode || 'minimal',
    lastStateTick: null,
    editorObjectListCache: new Map(),
    watches: new Map(),
    watchController: null,
    spectator: null
  };

  session.watchController = new WatchPollingController({
    hasWatchesFn: () => session.watches.size > 0,
    pollFn: () => pollWatches(session)
  });

  sessions.set(sessionId, session);

  page.on('pageerror', (error) => {
    session.events.add({
      source: 'system',
      type: 'error',
      summary: 'pageerror',
      data: { message: error?.message || String(error) }
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      session.events.add({
        source: 'system',
        type: 'error',
        summary: 'console error',
        data: { message: msg.text() }
      });
    }
  });

  try {
    await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => window.__E2E__?.getState?.().ready === true,
      null,
      { timeout: 30000 }
    );

    if (options.enableSpectator) {
      await startSpectatorServer(session, options.spectator || {});
    }
  } catch (err) {
    sessions.delete(sessionId);
    await context.close();
    await browser.close();
    throw err;
  }

  const actions = Object.keys(keybindings?.bindings || {}).sort();
  const response = {
    ok: true,
    sessionId,
    protocol: {
      version: MCP_PROTOCOL_VERSION,
      schemaFrozenAt: MCP_PROTOCOL_SCHEMA_FROZEN_AT,
      acceptedToolNameForms: ['underscore', 'dotted'],
      deprecatedToolAliases: LEGACY_TOOL_ALIASES,
      skillNames: SKILL_NAMES,
      lemmingDeltaFields: LEMMING_DELTA_FIELDS
    },
    gameUrl,
    spectatorUrl: session.spectator?.url || null,
    spectatorStream: session.spectator?.streamConfig || null,
    keybindings: {
      version: keybindings?.version || 1,
      actions
    },
    warnings: []
  };

  if (options.spectator?.openBrowser) {
    response.warnings.push('spectator openBrowser is not implemented');
  }

  return attachEvents(session, response);
};

const closeSession = async (args) => {
  const { sessionId } = SessionCloseSchema.parse(args || {});
  const session = getSession(sessionId);
  await disposeSessionRuntime(session, {
    stopSpectatorServer,
    stopWatchLoop
  });
  sessions.delete(sessionId);
  return { ok: true };
};

const pauseTime = async (args) => {
  const { sessionId } = TimeSchema.parse(args || {});
  const session = getSession(sessionId);
  const result = await callE2E(session, 'pause');
  if (result.ok && result.value) {
    nudgeWatchPolling(session);
  }
  const tickIndex = await getTickIndex(session);
  return attachEvents(session, {
    ok: !!result.ok && !!result.value,
    tickIndex
  });
};

const resumeTime = async (args) => {
  const { sessionId } = TimeSchema.parse(args || {});
  const session = getSession(sessionId);
  const result = await callE2E(session, 'resume');
  if (result.ok && result.value) {
    nudgeWatchPolling(session);
  }
  const tickIndex = await getTickIndex(session);
  return attachEvents(session, {
    ok: !!result.ok && !!result.value,
    tickIndex
  });
};

const stepTime = async (args) => {
  const { sessionId, count, ensurePaused } = TimeStepSchema.parse(args || {});
  const session = getSession(sessionId);
  if (ensurePaused !== false) {
    await callE2E(session, 'pause');
  }
  const tickIndexBefore = await getTickIndex(session);
  const result = await callE2E(session, 'step', count);
  if (result.ok && result.value) {
    nudgeWatchPolling(session);
  }
  const tickIndexAfter = await getTickIndex(session);
  return attachEvents(session, {
    ok: !!result.ok && !!result.value,
    tickIndexBefore,
    tickIndexAfter
  });
};

const getEditorLevelFromState = (state) => state?.editor?.session?.level ?? null;

const getEditorRevisionFromState = (state) => {
  const revision = state?.editor?.history?.cursor;
  return Number.isFinite(revision) ? Number(revision) : null;
};

const getEditorListByKind = (level, kind) => {
  if (!level) return null;
  if (kind === 'terrain') return Array.isArray(level.terrains) ? level.terrains : [];
  if (kind === 'gadget') return Array.isArray(level.gadgets) ? level.gadgets : [];
  if (kind === 'steel') return Array.isArray(level.steel) ? level.steel : [];
  return null;
};

const normalizeEditorBBox = (bbox) => {
  if (!bbox || !Number.isFinite(bbox.x) || !Number.isFinite(bbox.y)) return null;
  const width = Number.isFinite(bbox.width) ? bbox.width : bbox.w;
  const height = Number.isFinite(bbox.height) ? bbox.height : bbox.h;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    x: Number(bbox.x),
    y: Number(bbox.y),
    width: Number(width),
    height: Number(height)
  };
};

const editorBoundsIntersect = (a, b) => (
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y
);

const getEditorObjectBounds = (entry, kind) => {
  const props = entry?.props || {};
  const x = Number.isFinite(props.X) ? props.X : (Number.isFinite(props.x) ? props.x : 0);
  const y = Number.isFinite(props.Y) ? props.Y : (Number.isFinite(props.y) ? props.y : 0);
  if (kind === 'steel') {
    const width = Number.isFinite(props.WIDTH) ? props.WIDTH : 1;
    const height = Number.isFinite(props.HEIGHT) ? props.HEIGHT : 1;
    return { x, y, width, height };
  }
  return { x, y, width: 1, height: 1 };
};

const buildEditorObjectId = (kind, index, entry) => (
  entry?.uid ? `${kind}:${entry.uid}` : `${kind}:#${index}`
);

const buildEditorObjectRecord = (kind, index, entry, fields = 'compact') => {
  const props = entry?.props || {};
  const bounds = getEditorObjectBounds(entry, kind);
  const record = {
    id: buildEditorObjectId(kind, index, entry),
    kind,
    index,
    uid: entry?.uid || null,
    piece: Number.isFinite(props.PIECE) ? props.PIECE : null,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
  if (fields === 'full') {
    record.entry = entry ? JSON.parse(JSON.stringify(entry)) : null;
  }
  record._hash = JSON.stringify({
    uid: record.uid,
    index: record.index,
    props,
    order: Array.isArray(entry?.order) ? entry.order : []
  });
  return record;
};

const collectEditorObjectRecords = (level, kind, fields) => {
  const kinds = kind === 'all' ? ['terrain', 'gadget', 'steel'] : [kind];
  const records = [];
  for (const oneKind of kinds) {
    const list = getEditorListByKind(level, oneKind) || [];
    for (let index = 0; index < list.length; index += 1) {
      records.push(buildEditorObjectRecord(oneKind, index, list[index], fields));
    }
  }
  return records;
};

const resolveEditorObjectRef = (level, ref) => {
  const requestedKind = ref?.kind;
  const kinds = requestedKind && requestedKind !== 'all'
    ? [requestedKind]
    : ['terrain', 'gadget', 'steel'];
  if (Number.isFinite(ref?.index)) {
    if (!requestedKind || requestedKind === 'all') return null;
    const list = getEditorListByKind(level, requestedKind);
    const index = Math.trunc(ref.index);
    if (!list || index < 0 || index >= list.length) return null;
    const entry = list[index];
    return {
      kind: requestedKind,
      index,
      uid: entry?.uid || null
    };
  }
  if (typeof ref?.uid === 'string' && ref.uid) {
    for (const kind of kinds) {
      const list = getEditorListByKind(level, kind);
      if (!list) continue;
      const index = list.findIndex((entry) => entry?.uid === ref.uid);
      if (index >= 0) {
        return {
          kind,
          index,
          uid: ref.uid
        };
      }
    }
  }
  return null;
};

const cacheEditorListSnapshot = (session, queryKey, revision, records) => {
  if (!session.editorObjectListCache) {
    session.editorObjectListCache = new Map();
  }
  const map = new Map(records.map((record) => [record.id, record._hash]));
  session.editorObjectListCache.delete(queryKey);
  session.editorObjectListCache.set(queryKey, { revision, map });
  while (session.editorObjectListCache.size > 32) {
    const oldestKey = session.editorObjectListCache.keys().next().value;
    session.editorObjectListCache.delete(oldestKey);
  }
};

const buildEditorListDelta = (previous, current, sinceRevision, toRevision) => {
  if (!previous || previous.revision !== sinceRevision) {
    return {
      available: false,
      reason: 'stale_or_missing_revision',
      baseRevision: sinceRevision,
      toRevision
    };
  }
  const added = [];
  const removed = [];
  const updated = [];
  for (const [id, hash] of current.entries()) {
    if (!previous.map.has(id)) {
      added.push(id);
    } else if (previous.map.get(id) !== hash) {
      updated.push(id);
    }
  }
  for (const id of previous.map.keys()) {
    if (!current.has(id)) {
      removed.push(id);
    }
  }
  return {
    available: true,
    baseRevision: sinceRevision,
    toRevision,
    added,
    removed,
    updated
  };
};

const runEditorApply = async (session, ops, options = {}) => {
  const result = await callE2E(session, 'editorApply', ops || [], {
    atomic: options.atomic,
    dryRun: options.dryRun,
    history: options.history,
    preview: options.preview,
    validate: options.validate,
    returnState: options.returnState
  });
  if (!result.ok) {
    return attachEvents(session, {
      ok: false,
      reason: 'harness_unavailable',
      error: result.error || null
    });
  }

  const payload = result.value || {};
  if (!payload.ok) {
    return attachEvents(session, payload);
  }

  nudgeWatchPolling(session);

  const resources = [];
  if (Array.isArray(payload.resources)) {
    for (const resource of payload.resources) {
      if (!resource) continue;
      const encoding = resource.encoding || 'text';
      const data = resource.data || '';
      const bytes = encoding === 'base64'
        ? Buffer.from(data, 'base64')
        : Buffer.from(data, 'utf8');
      const mimeType = resource.mimeType || 'application/octet-stream';
      const stored = session.resources.put({
        sessionId: session.id,
        bytes,
        mimeType,
        meta: resource.meta || { kind: 'resource', name: resource.name || '' }
      });
      resources.push({
        uri: stored?.uri || null,
        mimeType,
        name: resource.name || null,
        sizeBytes: stored?.sizeBytes ?? null,
        meta: resource.meta || null
      });
    }
  }

  return attachEvents(session, {
    ok: true,
    results: Array.isArray(payload.results) ? payload.results : [],
    state: payload.state ?? null,
    resources
  });
};

const editorApplyTool = async (args) => {
  const parsed = EditorApplySchema.parse(args || {});
  const session = getSession(parsed.sessionId);
  return runEditorApply(session, parsed.ops || [], {
    atomic: parsed.atomic,
    dryRun: parsed.dryRun,
    history: parsed.history,
    preview: parsed.preview,
    validate: parsed.validate,
    returnState: parsed.returnState
  });
};

const listObjectsTool = async (args) => {
  const parsed = ObjectsListSchema.parse(args || {});
  const session = getSession(parsed.sessionId);
  const state = await getState(session);
  const level = getEditorLevelFromState(state);
  if (!level) {
    return attachEvents(session, {
      ok: false,
      reason: 'not_in_editor_mode'
    });
  }

  const kind = parsed.kind || 'all';
  const fields = parsed.fields || 'compact';
  const bbox = normalizeEditorBBox(parsed.bbox);
  let records = collectEditorObjectRecords(level, kind, fields);
  if (bbox) {
    records = records.filter((record) => editorBoundsIntersect(record, bbox));
  }
  const totalCount = records.length;
  const page = Number.isFinite(parsed.page) ? Math.max(0, parsed.page) : 0;
  const pageSize = Number.isFinite(parsed.pageSize) ? parsed.pageSize : 100;
  const start = page * pageSize;
  const pageRecords = records.slice(start, start + pageSize);
  const revision = getEditorRevisionFromState(state);
  const queryKey = JSON.stringify({ kind, fields, bbox: bbox || null });
  const currentSnapshot = new Map(records.map((record) => [record.id, record._hash]));
  let delta = null;
  if (Number.isFinite(parsed.sinceRevision)) {
    const previous = session.editorObjectListCache?.get(queryKey) || null;
    delta = buildEditorListDelta(
      previous,
      currentSnapshot,
      parsed.sinceRevision,
      revision
    );
  }
  cacheEditorListSnapshot(session, queryKey, revision, records);

  return attachEvents(session, {
    ok: true,
    revision,
    kind,
    page,
    pageSize,
    totalCount,
    entries: pageRecords.map((record) => {
      const { _hash, ...rest } = record;
      return rest;
    }),
    delta
  });
};

const placeObjectsTool = async (args) => {
  const parsed = ObjectsPlaceSchema.parse(args || {});
  const session = getSession(parsed.sessionId);
  const ops = parsed.objects.map((item, index) => ({
    opId: `objects.place.${index}`,
    type: 'entry.add',
    args: {
      kind: item.kind,
      props: item.props,
      piece: item.piece,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      insert: Number.isFinite(item.insertIndex) ? { index: item.insertIndex } : undefined
    }
  }));
  return runEditorApply(session, ops, parsed.options || {});
};

const updateObjectsTool = async (args) => {
  const parsed = ObjectsUpdateSchema.parse(args || {});
  const session = getSession(parsed.sessionId);
  const state = await getState(session);
  const level = getEditorLevelFromState(state);
  if (!level) {
    return attachEvents(session, {
      ok: false,
      reason: 'not_in_editor_mode'
    });
  }
  const ops = [];
  for (let index = 0; index < parsed.updates.length; index += 1) {
    const update = parsed.updates[index];
    const resolvedRef = resolveEditorObjectRef(level, update.ref);
    if (!resolvedRef) {
      return attachEvents(session, {
        ok: false,
        reason: 'invalid_ref',
        index
      });
    }
    ops.push({
      opId: `objects.update.${index}`,
      type: 'entry.update',
      args: {
        ref: resolvedRef,
        set: update.set || {},
        unset: update.unset || []
      }
    });
  }
  return runEditorApply(session, ops, parsed.options || {});
};

const deleteObjectsTool = async (args) => {
  const parsed = ObjectsDeleteSchema.parse(args || {});
  const session = getSession(parsed.sessionId);
  const state = await getState(session);
  const level = getEditorLevelFromState(state);
  if (!level) {
    return attachEvents(session, {
      ok: false,
      reason: 'not_in_editor_mode'
    });
  }
  const refs = [];
  for (let index = 0; index < parsed.refs.length; index += 1) {
    const resolvedRef = resolveEditorObjectRef(level, parsed.refs[index]);
    if (!resolvedRef) {
      return attachEvents(session, {
        ok: false,
        reason: 'invalid_ref',
        index
      });
    }
    refs.push(resolvedRef);
  }
  return runEditorApply(session, [{
    opId: 'objects.delete',
    type: 'entry.remove',
    args: { refs }
  }], parsed.options || {});
};

const centerViewOnLemming = async (session, lemmingId) => {
  const result = await callE2E(session, 'centerViewOnLemming', lemmingId);
  return !!(result.ok && result.value);
};

const selectLemmingTool = async (args) => {
  const { sessionId, lemmingId, alsoCenterView, confirm } = LemmingSelectSchema.parse(args || {});
  const session = getSession(sessionId);
  const result = await callE2E(session, 'selectLemmingById', lemmingId);
  if (!result.ok || !result.value) {
    const state = await getState(session);
    const entry = state?.game?.lemmings?.[lemmingId] || null;
    let reason = 'harness_unavailable';
    if (entry) {
      if (entry.removed) reason = 'removed';
      else if (entry.disabled) reason = 'disabled';
      else reason = 'not_found';
    } else {
      reason = 'not_found';
    }
    return attachEvents(session, {
      ok: false,
      lemmingId,
      reason
    });
  }

  if (alsoCenterView) {
    await centerViewOnLemming(session, lemmingId);
  }
  nudgeWatchPolling(session);

  let selectedNow = null;
  if (confirm !== false) {
    const state = await getState(session);
    selectedNow = state?.game?.lemmingManager?.selectedIndex ?? null;
  }

  return attachEvents(session, {
    ok: true,
    lemmingId,
    selectedNow
  });
};

const applySkillTool = async (args) => {
  const { sessionId, skill, lemmingId, ensurePaused, requireAvailable, postStep, verify } =
    SkillApplySchema.parse(args || {});
  const session = getSession(sessionId);
  if (ensurePaused !== false) {
    await callE2E(session, 'pause');
  }

  let tickIndexBefore = null;
  let tickIndexAfter = null;
  let beforeState = null;
  if (verify !== false || requireAvailable) {
    beforeState = await getState(session);
    tickIndexBefore = beforeState?.game?.timer?.tickIndex ?? null;
  }

  const action = SKILL_ACTIONS[skill];
  if (!action) {
    return attachEvents(session, { ok: false, reason: 'unknown_skill', skill });
  }

  if (requireAvailable) {
    const skills = beforeState?.game?.skills || null;
    const skillIndex = SKILL_INDEX_BY_NAME[skill];
    const available = !!skills?.cheatMode || (Number.isFinite(skillIndex)
      && Array.isArray(skills?.skills)
      && skills.skills[skillIndex] > 0);
    if (!available) {
      return attachEvents(session, { ok: false, reason: 'no_skill_remaining', skill });
    }
  }

  if (Number.isFinite(lemmingId)) {
    const selectResult = await callE2E(session, 'selectLemmingById', lemmingId);
    if (!selectResult.ok || !selectResult.value) {
      return attachEvents(session, {
        ok: false,
        skill,
        lemmingIdAppliedTo: lemmingId,
        reason: 'select_failed'
      });
    }
  }

  const selectKey = await pressAction(session, action, 1);
  if (!selectKey.ok) {
    return attachEvents(session, { ok: false, reason: 'missing_binding', skill, action });
  }
  const applyKey = await pressAction(session, 'applySkillToSelected', 1);
  if (!applyKey.ok) {
    return attachEvents(session, { ok: false, reason: 'missing_binding', action: 'applySkillToSelected' });
  }

  const steps = Number.isFinite(postStep) ? Math.trunc(postStep) : 1;
  if (steps > 0) {
    await callE2E(session, 'step', steps);
  }

  let verification = null;
  let lemmingIdAppliedTo = lemmingId ?? null;
  if (verify !== false) {
    const afterState = await getState(session);
    tickIndexAfter = afterState?.game?.timer?.tickIndex ?? null;
    const selectedId = afterState?.game?.lemmingManager?.selectedIndex ?? null;
    lemmingIdAppliedTo = Number.isFinite(lemmingIdAppliedTo) ? lemmingIdAppliedTo : selectedId;
    const beforeLem = lemmingIdAppliedTo != null
      ? beforeState?.game?.lemmings?.[lemmingIdAppliedTo] || null
      : null;
    const afterLem = lemmingIdAppliedTo != null
      ? afterState?.game?.lemmings?.[lemmingIdAppliedTo] || null
      : null;
    const changedFields = [];
    let applied = false;
    if (beforeLem && afterLem) {
      if (skill === 'climber' && !beforeLem.canClimb && afterLem.canClimb) {
        applied = true;
        changedFields.push('canClimb');
      } else if (skill === 'floater' && !beforeLem.hasParachute && afterLem.hasParachute) {
        applied = true;
        changedFields.push('hasParachute');
      } else if (skill === 'bomber' && !beforeLem.countdownActive && afterLem.countdownActive) {
        applied = true;
        changedFields.push('countdownActive');
      } else if (beforeLem.actionType !== afterLem.actionType) {
        applied = true;
        changedFields.push('actionType');
      }
    }
    verification = {
      applied,
      changedFields
    };
  }

  nudgeWatchPolling(session);
  return attachEvents(session, {
    ok: true,
    skill,
    lemmingIdAppliedTo,
    tickIndexBefore,
    tickIndexAfter,
    verification
  });
};

const inputActionTool = async (args) => {
  const { sessionId, action, repeat } = InputActionSchema.parse(args || {});
  const session = getSession(sessionId);
  const response = await pressAction(session, action, repeat || 1);
  if (response.ok) {
    nudgeWatchPolling(session);
  }
  return attachEvents(session, response);
};

const inputKeysTool = async (args) => {
  const { sessionId, keys, repeat, events } = InputKeysSchema.parse(args || {});
  const session = getSession(sessionId);
  await ensureGameFocus(session);
  let injected = 0;

  if (Array.isArray(keys) && keys.length) {
    const count = repeat || 1;
    for (let i = 0; i < count; i += 1) {
      for (const key of keys) {
        await pressKey(session, key);
        injected += 1;
      }
    }
  } else if (Array.isArray(events)) {
    for (const event of events) {
      const key = normalizeKeyToken(event.key);
      if (event.type === 'down') {
        await session.page.keyboard.down(key);
      } else if (event.type === 'up') {
        await session.page.keyboard.up(key);
      } else {
        await session.page.keyboard.press(key);
      }
      injected += 1;
    }
  }

  if (injected) {
    session.events.add({
      source: 'agent',
      type: 'input',
      summary: `keys:${injected}`
    });
    nudgeWatchPolling(session);
  }

  return attachEvents(session, { ok: true, eventsInjected: injected });
};

const visionCaptureTool = async (args) => {
  const options = VisionCaptureSchema.parse(args || {});
  const session = getSession(options.sessionId);
  const result = await captureFrame(session, options);
  if (!result.ok) {
    return attachEvents(session, { ok: false, reason: result.reason });
  }
  session.events.add({
    source: 'agent',
    type: 'capture',
    summary: 'capture',
    resourceUris: result.frame?.resourceUri ? [result.frame.resourceUri] : undefined
  });
  return attachEvents(session, { frame: result.frame });
};

const visionSequenceTool = async (args) => {
  const options = VisionSequenceSchema.parse(args || {});
  const session = getSession(options.sessionId);
  const result = await captureSequence(session, options);
  return attachEvents(session, result);
};

const watchCreateTool = async (args) => {
  const { sessionId, watch, actions, enabled } = WatchCreateSchema.parse(args || {});
  const session = getSession(sessionId);
  const watchId = makeId();
  const state = await getState(session);
  const tickIndex = state?.game?.timer?.tickIndex ?? 0;
  const pointerState = watch.type === 'onChange'
    ? createPointerWatchState(watch.jsonPointer, state)
    : null;

  const entry = {
    id: watchId,
    type: watch.type,
    everyTicks: watch.everyTicks || 1,
    jsonPointer: watch.jsonPointer || '',
    enabled: enabled !== false,
    actions: actions || [],
    lastTick: Number.isFinite(tickIndex) ? tickIndex : 0,
    pointerState,
    lastCaptureTick: -Infinity
  };

  session.watches.set(watchId, entry);
  startWatchLoop(session);
  requestWatchPoll(session, { immediate: true });

  return attachEvents(session, {
    watchId,
    ok: true
  });
};

const watchCancelTool = async (args) => {
  const { sessionId, watchId } = WatchCancelSchema.parse(args || {});
  const session = getSession(sessionId);
  const ok = session.watches.delete(watchId);
  if (!session.watches.size) {
    stopWatchLoop(session);
  }
  return attachEvents(session, { ok });
};

const eventsPollTool = async (args) => {
  const { sessionId, after } = EventsPollSchema.parse(args || {});
  const session = getSession(sessionId);
  if (session.watches.size) {
    await session.watchController?.tickNow();
  }
  const envelope = session.events.drain(after, { updateCursor: true });
  const cursor = String(Number.isFinite(Number(after)) ? Number(after) : session.events.lastDelivered);
  if (!envelope && session.watches.size) {
    requestWatchPoll(session, { immediate: true });
  }
  return envelope || { cursor, events: [] };
};

const TOOL_SCHEMA_REGISTRY = {
  SessionCreateSchema,
  SessionCloseSchema,
  TimeSchema,
  TimeStepSchema,
  StateGetSchema,
  StateDeltaSchema,
  EditorApplySchema,
  ObjectsListSchema,
  ObjectsPlaceSchema,
  ObjectsUpdateSchema,
  ObjectsDeleteSchema,
  LemmingsSummarySchema,
  LemmingSelectSchema,
  SkillApplySchema,
  InputActionSchema,
  InputKeysSchema,
  VisionCaptureSchema,
  VisionSequenceSchema,
  WatchCreateSchema,
  WatchCancelSchema,
  EventsPollSchema
};

const TOOL_HANDLER_REGISTRY = {
  createSession,
  closeSession,
  pauseTime,
  resumeTime,
  stepTime,
  getStateTool,
  getStateDeltaTool,
  editorApplyTool,
  listObjectsTool,
  placeObjectsTool,
  updateObjectsTool,
  deleteObjectsTool,
  getLemmingsSummaryTool,
  selectLemmingTool,
  applySkillTool,
  inputActionTool,
  inputKeysTool,
  visionCaptureTool,
  visionSequenceTool,
  watchCreateTool,
  watchCancelTool,
  eventsPollTool
};

const ACTIVE_TOOL_SURFACES = MCP_SURFACE_SPLIT_ROLLOUT
  ? ENABLED_TOOL_SURFACES
  : new Set(ALL_TOOL_SURFACES);

const surfaceRegistry = buildSurfaceRegistry(
  TOOL_SCHEMA_REGISTRY,
  TOOL_HANDLER_REGISTRY,
  new Set(ALL_TOOL_SURFACES)
);
const { toolDefs: TOOL_DEFS, toolRoutes: TOOL_ROUTES } = buildToolCatalog(
  surfaceRegistry,
  {
    activeSurfaces: ACTIVE_TOOL_SURFACES,
    toToolName,
    toJsonSchemaCompat
  }
);
const LEGACY_TOOL_ALIASES = createLegacyToolAliases(MCP_LEGACY_TOOL_ALIASES_ENABLED);

const resolveTool = (rawName) => {
  const { candidates } = resolveToolCandidates(rawName, {
    legacyToolAliases: LEGACY_TOOL_ALIASES,
    dottedFallbackEnabled: MCP_DOTTED_TOOL_FALLBACK_ENABLED,
    toToolName
  });
  let route = null;
  for (const candidate of candidates) {
    route = TOOL_ROUTES.get(candidate);
    if (route) break;
  }
  if (!route) {
    throw new Error(`Unknown tool: ${rawName}`);
  }
  if (MCP_SURFACE_SPLIT_ROLLOUT && !ENABLED_TOOL_SURFACES.has(route.surface)) {
    throw new Error(`Tool disabled by surface policy: ${rawName}`);
  }
  return route;
};

const server = new Server(
  {
    name: 'lemmings-mcp',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const rawName = request.params.name;
  const { handler } = resolveTool(rawName);
  const args = request.params.arguments || {};
  const payload = await handler(args);
  return buildToolResponse(payload);
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources = [];
  for (const session of sessions.values()) {
    resources.push(...session.resources.list({ limit: 200 }));
  }
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = RESOURCE_URI_RE.exec(String(uri || ''));
  if (!match) {
    throw new Error('Invalid resource URI');
  }
  const sessionId = match[1];
  const session = getSession(sessionId);
  const item = session.resources.get(uri);
  if (!item) {
    throw new Error('Resource not found');
  }
  const isText = item.mimeType.startsWith('text/') || item.mimeType === 'application/json';
  const contents = [
    {
      uri: item.uri,
      mimeType: item.mimeType,
      ...(isText
        ? { text: item.bytes.toString('utf8') }
        : { blob: item.bytes.toString('base64') })
    }
  ];
  return { contents };
});

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdownController = createShutdownController({
  disposeSessions: async () => {
    await disposeAllSessionRuntimes(sessions.values(), {
      stopSpectatorServer,
      stopWatchLoop
    });
    sessions.clear();
  },
  closeServer: () => server.close(),
  closeTransport: () => transport.close()
});

process.on('SIGINT', async () => {
  shutdownController.handleSignal('SIGINT');
});

process.on('SIGTERM', async () => {
  shutdownController.handleSignal('SIGTERM');
});
