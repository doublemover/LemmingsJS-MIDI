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
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const KEYBINDINGS_PATH = path.join(ROOT_DIR, 'keybindings.json');
const SPECTATOR_HTML_PATH = path.join(__dirname, 'spectator.html');

const DEFAULT_BASE_URL = process.env.LEMMINGS_MCP_BASE_URL || 'https://localhost:8080';
const DEFAULT_PATH = process.env.LEMMINGS_MCP_PATH || '/?e2e=1';
const DEFAULT_VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };

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

const sessions = new Map();
let cachedKeybindings = null;

const nowIso = () => new Date().toISOString();

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

class ResourceStore {
  constructor({ maxBytes = 256 * 1024 * 1024, ttlMs = 10 * 60 * 1000, maxItems = 5000 } = {}) {
    this.maxBytes = maxBytes;
    this.defaultTtlMs = ttlMs;
    this.maxItems = maxItems;
    this.items = new Map();
    this.totalBytes = 0;
  }

  put({ sessionId, bytes, mimeType, meta = {}, ttlMs } = {}) {
    if (!bytes) return null;
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const id = crypto.randomUUID();
    const uri = `lemmings://sessions/${sessionId}/resources/${id}`;
    const sizeBytes = buffer.length;
    const ttl = Number.isFinite(ttlMs) ? ttlMs : this.defaultTtlMs;
    const expiresAt = ttl > 0 ? Date.now() + ttl : null;
    const item = {
      id,
      uri,
      sessionId,
      mimeType,
      meta,
      bytes: buffer,
      sizeBytes,
      createdAt: nowIso(),
      expiresAt
    };
    this.items.set(id, item);
    this.totalBytes += sizeBytes;
    this._evictIfNeeded();
    return {
      uri,
      sizeBytes,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
    };
  }

  get(uri) {
    const match = RESOURCE_URI_RE.exec(String(uri || ''));
    if (!match) return null;
    const id = match[2];
    const item = this.items.get(id);
    if (!item) return null;
    if (item.expiresAt && Date.now() >= item.expiresAt) {
      this._remove(id);
      return null;
    }
    this.items.delete(id);
    this.items.set(id, item);
    return item;
  }

  list({ limit = 200 } = {}) {
    const out = [];
    for (const item of this.items.values()) {
      if (item.expiresAt && Date.now() >= item.expiresAt) {
        this._remove(item.id);
        continue;
      }
      out.push({
        uri: item.uri,
        name: item.meta?.tag || item.meta?.kind || item.id,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString() : null
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  clearSession(sessionId) {
    if (!sessionId) return;
    for (const [id, item] of this.items.entries()) {
      if (item.sessionId === sessionId) {
        this._remove(id);
      }
    }
  }

  _remove(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    this.totalBytes = Math.max(0, this.totalBytes - item.sizeBytes);
  }

  _evictIfNeeded() {
    while (this.totalBytes > this.maxBytes || this.items.size > this.maxItems) {
      const firstKey = this.items.keys().next().value;
      if (!firstKey) break;
      this._remove(firstKey);
    }
  }
}

class EventQueue {
  constructor({ maxEvents = 1000 } = {}) {
    this.maxEvents = maxEvents;
    this.events = [];
    this.seq = 0;
    this.lastDelivered = 0;
    this.humanSummaryParts = [];
  }

  add({ source, type, summary, data, resourceUris, tickIndex } = {}) {
    const entry = {
      id: crypto.randomUUID(),
      source,
      type,
      tickIndex: Number.isFinite(tickIndex) ? tickIndex : null,
      time: nowIso(),
      summary: summary || '',
      data,
      resourceUris
    };
    this.seq += 1;
    entry.seq = this.seq;
    this.events.push(entry);
    if (source === 'human' && summary) {
      this.humanSummaryParts.push(summary);
    }
    while (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    return entry;
  }

  drain(after, { updateCursor = true, includeHumanSummary = true } = {}) {
    const afterSeq = Number.isFinite(Number(after)) ? Number(after) : this.lastDelivered;
    const events = this.events.filter((event) => event.seq > afterSeq);
    if (!events.length) return null;
    const cursor = String(events[events.length - 1].seq);
    if (updateCursor) {
      this.lastDelivered = Number(cursor);
    }
    const payload = {
      cursor,
      events: events.map(({ seq, ...rest }) => rest)
    };
    if (includeHumanSummary && this.humanSummaryParts.length) {
      payload.humanSummary = this.humanSummaryParts.join('; ');
      this.humanSummaryParts = [];
    }
    return payload;
  }
}

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
    openBrowser: z.boolean().optional()
  }).optional(),
  resources: z.object({
    maxBytes: z.number().int().positive().optional(),
    ttlMs: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().positive().optional()
  }).optional(),
  events: z.object({
    maxEvents: z.number().int().positive().optional()
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
  include: z.object({
    view: z.boolean().optional(),
    stage: z.boolean().optional(),
    game: z.boolean().optional(),
    editor: z.boolean().optional(),
    midi: z.boolean().optional()
  }).optional(),
  lemmings: z.object({
    mode: z.enum(['none', 'summary', 'all', 'ids']).optional(),
    ids: z.array(z.number().int()).optional(),
    max: z.number().int().positive().optional()
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
      w: z.number(),
      h: z.number()
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

const EventsPollSchema = z.object({
  sessionId: z.string().min(1),
  after: z.string().optional()
});

const TOOL_SPECS = [
  {
    name: 'session.create',
    description: 'Launch a Playwright session and load the game with the E2E harness.',
    schema: SessionCreateSchema
  },
  {
    name: 'session.close',
    description: 'Close a Playwright session and clear resources/events.',
    schema: SessionCloseSchema
  },
  {
    name: 'time.pause',
    description: 'Pause the game timer via the E2E harness.',
    schema: TimeSchema
  },
  {
    name: 'time.resume',
    description: 'Resume the game timer via the E2E harness.',
    schema: TimeSchema
  },
  {
    name: 'time.step',
    description: 'Step the game timer forward or backward by a number of ticks.',
    schema: TimeStepSchema
  },
  {
    name: 'state.get',
    description: 'Fetch a structured state snapshot from the E2E harness.',
    schema: StateGetSchema
  },
  {
    name: 'lemming.summary',
    description: 'Return aggregated lemming summary data.',
    schema: LemmingsSummarySchema
  },
  {
    name: 'lemming.select',
    description: 'Select a lemming by ID via the E2E harness.',
    schema: LemmingSelectSchema
  },
  {
    name: 'skill.apply',
    description: 'Apply a skill to a selected lemming using keybindings.',
    schema: SkillApplySchema
  },
  {
    name: 'input.action',
    description: 'Execute a named action from keybindings.json.',
    schema: InputActionSchema
  },
  {
    name: 'input.keys',
    description: 'Inject low-level key events.',
    schema: InputKeysSchema
  },
  {
    name: 'vision.capture',
    description: 'Capture a screenshot of the page or canvas.',
    schema: VisionCaptureSchema
  },
  {
    name: 'vision.captureSequence',
    description: 'Capture multiple frames across time.',
    schema: VisionSequenceSchema
  },
  {
    name: 'watch.create',
    description: 'Create a watch that emits events based on ticks or state changes.',
    schema: WatchCreateSchema
  },
  {
    name: 'watch.cancel',
    description: 'Cancel a watch.',
    schema: WatchCancelSchema
  },
  {
    name: 'events.poll',
    description: 'Poll events since a cursor.',
    schema: EventsPollSchema
  }
];

const TOOL_NAME_ALIASES = new Map();

const toToolName = (name) => String(name).replace(/\./g, '_');

const LEGACY_TOOL_ALIASES = new Map([
  ['lemmings.session.create', 'session.create'],
  ['lemmings.session.close', 'session.close'],
  ['lemmings.time.pause', 'time.pause'],
  ['lemmings.time.resume', 'time.resume'],
  ['lemmings.time.step', 'time.step'],
  ['lemmings.state.get', 'state.get'],
  ['lemmings.lemmings.summary', 'lemming.summary'],
  ['lemmings.lemming.select', 'lemming.select'],
  ['lemmings.skill.apply', 'skill.apply'],
  ['lemmings.input.action', 'input.action'],
  ['lemmings.input.keys', 'input.keys'],
  ['lemmings.vision.capture', 'vision.capture'],
  ['lemmings.vision.captureSequence', 'vision.captureSequence'],
  ['lemmings.watch.create', 'watch.create'],
  ['lemmings.watch.cancel', 'watch.cancel'],
  ['lemmings.events.poll', 'events.poll']
]);

const TOOL_DEFS = TOOL_SPECS.map((spec) => {
  const externalName = toToolName(spec.name);
  TOOL_NAME_ALIASES.set(externalName, spec.name);
  TOOL_NAME_ALIASES.set(spec.name, spec.name);
  return {
    name: externalName,
    description: spec.description,
    inputSchema: toJsonSchemaCompat(spec.schema)
  };
});

for (const [legacyName, currentName] of LEGACY_TOOL_ALIASES.entries()) {
  TOOL_NAME_ALIASES.set(legacyName, currentName);
  TOOL_NAME_ALIASES.set(toToolName(legacyName), currentName);
}

const buildToolResponse = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload
});

const getSession = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
};

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

const attachEvents = (session, payload) => {
  if (!session) return payload;
  const envelope = session.events.drain();
  if (envelope) {
    payload.events = envelope;
  }
  return payload;
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
  return {
    version: snapshot.version,
    mode: snapshot.mode,
    ready: snapshot.ready,
    view: config.view ? snapshot.view : null,
    stage: config.stage ? snapshot.stage : null,
    game: config.game ? snapshot.game : null,
    editor: config.editor ? snapshot.editor : null,
    midi: config.midi ? snapshot.midi : null
  };
};

const withinRect = (lem, rect) => {
  if (!rect) return true;
  const width = Number.isFinite(rect.w) ? rect.w : rect.width;
  const height = Number.isFinite(rect.h) ? rect.h : rect.height;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return (
    lem.x >= rect.x &&
    lem.x <= rect.x + width &&
    lem.y >= rect.y &&
    lem.y <= rect.y + height
  );
};

const buildLemmingSummary = (state, options = {}) => {
  const lemmings = Array.isArray(state?.game?.lemmings) ? state.game.lemmings : [];
  const manager = state?.game?.lemmingManager || null;
  const tickIndex = state?.game?.timer?.tickIndex ?? null;
  const activeOnly = options.activeOnly !== false;
  const includeSelected = options.includeSelected !== false;
  const viewRect = options.inViewOnly ? state?.stage?.viewRect : null;
  const rect = options.rectWorld || viewRect;
  const filtered = lemmings.filter((lem) => {
    if (!lem) return false;
    if (activeOnly && (lem.removed || lem.disabled)) return false;
    return withinRect(lem, rect);
  });

  const counts = {
    totalCount: filtered.length,
    activeCount: filtered.filter((lem) => !lem.removed && !lem.disabled).length,
    removedCount: filtered.filter((lem) => lem.removed).length,
    disabledCount: filtered.filter((lem) => lem.disabled).length
  };

  const histAction = {};
  const histState = {};
  let climbers = 0;
  let floaters = 0;
  let countingDown = 0;
  let exploded = 0;
  for (const lem of filtered) {
    const actionKey = String(lem.actionType ?? 'null');
    histAction[actionKey] = (histAction[actionKey] || 0) + 1;
    const stateKey = String(lem.state ?? 'null');
    histState[stateKey] = (histState[stateKey] || 0) + 1;
    if (lem.canClimb) climbers += 1;
    if (lem.hasParachute) floaters += 1;
    if (lem.countdownActive) countingDown += 1;
    if (lem.hasExploded) exploded += 1;
  }

  const selectedId = manager?.selectedIndex ?? null;
  const selected = includeSelected && Number.isFinite(selectedId) && selectedId >= 0
    ? lemmings[selectedId] || null
    : null;

  const topK = Number.isFinite(options.topK) ? options.topK : 10;
  const top = filtered.slice(0, Math.max(0, topK));

  return {
    tickIndex,
    selectedLemmingId: selected ? selected.id : null,
    ...counts,
    byActionType: histAction,
    byState: histState,
    climbers,
    floaters,
    countingDown,
    exploded,
    selected,
    top
  };
};

const readPointer = (obj, pointer) => {
  if (!pointer || pointer === '/') return obj;
  const parts = String(pointer)
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
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
    return { ok: false, reason: 'unknown_action', available: Object.keys(bindings) };
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

const resolveCanvasMetrics = async (page) => page.evaluate(() => {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const stage = globalThis.lemmings?.stage;
  const gameRect = stage?.gameImgProps?.canvasViewportSize
    ? {
      x: stage.gameImgProps.x,
      y: stage.gameImgProps.y,
      width: stage.gameImgProps.canvasViewportSize.width,
      height: stage.gameImgProps.canvasViewportSize.height
    }
    : null;
  const guiRect = stage?.guiImgProps?.canvasViewportSize
    ? {
      x: stage.guiImgProps.x,
      y: stage.guiImgProps.y,
      width: stage.guiImgProps.canvasViewportSize.width,
      height: stage.guiImgProps.canvasViewportSize.height
    }
    : null;
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    size: { width: canvas.width, height: canvas.height },
    gameRect,
    guiRect
  };
});

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
    const metrics = await resolveCanvasMetrics(session.page);
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
  if (clip) {
    screenshotOptions.clip = clip;
  }

  const bytes = await session.page.screenshot(screenshotOptions);
  const sizeBytes = bytes.length;
  const tickIndex = await getTickIndex(session);

  const frame = {
    id: crypto.randomUUID(),
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

  const sequenceId = crypto.randomUUID();
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

const startSpectatorServer = async (session, options = {}) => {
  const html = await fs.readFile(SPECTATOR_HTML_PATH, 'utf8');
  const port = Number.isFinite(options.port) ? options.port : 0;
  const allowHumanInput = options.allowHumanInput === true;
  const frameIntervalMs = 500;

  const server = http.createServer((req, res) => {
    if (req.url && req.url !== '/' && req.url !== '/index.html') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', allowHumanInput }));
    if (session.spectator?.lastFrame) {
      ws.send(JSON.stringify(session.spectator.lastFrame));
    }
    ws.on('message', async (data) => {
      if (!allowHumanInput) return;
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch (err) {
        return;
      }
      await handleSpectatorInput(session, payload);
    });
    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://127.0.0.1:${actualPort}`;

  session.spectator = {
    server,
    wss,
    clients,
    allowHumanInput,
    url: baseUrl,
    lastFrame: null,
    frameTimer: null,
    isCapturing: false
  };

  session.spectator.frameTimer = setInterval(async () => {
    if (session.spectator.isCapturing) return;
    session.spectator.isCapturing = true;
    try {
      const result = await captureFrame(session, { target: 'stageCanvas', format: 'jpeg', delivery: 'inline' });
      if (result.ok && result.frame?.dataBase64) {
        const payload = {
          type: 'frame',
          mimeType: result.frame.mimeType,
          dataBase64: result.frame.dataBase64
        };
        session.spectator.lastFrame = payload;
        for (const ws of clients) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify(payload));
          }
        }
      }
    } catch (err) {
      session.events.add({
        source: 'system',
        type: 'error',
        summary: 'spectator capture failed',
        data: { message: err ? String(err) : 'unknown' }
      });
    } finally {
      session.spectator.isCapturing = false;
    }
  }, frameIntervalMs);

  return baseUrl;
};

const handleSpectatorInput = async (session, payload) => {
  if (!payload || !session.spectator?.allowHumanInput) return;
  if (payload.type === 'key') {
    const key = normalizeKeyToken(payload.key);
    await ensureGameFocus(session);
    if (payload.action === 'down') {
      await session.page.keyboard.down(key);
    } else if (payload.action === 'up') {
      await session.page.keyboard.up(key);
    }
    session.events.add({
      source: 'human',
      type: 'input',
      summary: `key:${payload.action}:${key}`
    });
    return;
  }
  if (payload.type === 'click') {
    if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
    const metrics = await resolveCanvasMetrics(session.page);
    if (!metrics) return;
    const x = metrics.rect.x + metrics.rect.width * payload.x;
    const y = metrics.rect.y + metrics.rect.height * payload.y;
    await session.page.mouse.click(x, y);
    session.events.add({
      source: 'human',
      type: 'input',
      summary: `click:${payload.x.toFixed(2)},${payload.y.toFixed(2)}`
    });
  }
};

const stopSpectatorServer = (session) => {
  if (!session.spectator) return;
  const { server, wss, frameTimer, clients } = session.spectator;
  if (frameTimer) clearInterval(frameTimer);
  for (const ws of clients || []) {
    try {
      ws.close();
    } catch (err) {
      // ignore
    }
  }
  try {
    wss?.close();
  } catch (err) {
    // ignore
  }
  try {
    server?.close();
  } catch (err) {
    // ignore
  }
  session.spectator = null;
};

const startWatchLoop = (session) => {
  if (session.watchTimer) return;
  session.watchTimer = setInterval(() => pollWatches(session), 250);
};

const stopWatchLoop = (session) => {
  if (session.watchTimer) {
    clearInterval(session.watchTimer);
  }
  session.watchTimer = null;
};

const pollWatches = async (session) => {
  if (session.watchPolling) return;
  if (!session.watches.size) return;
  session.watchPolling = true;
  try {
    const state = await getState(session);
    if (!state) return;
    const tickIndex = state.game?.timer?.tickIndex ?? null;
    for (const watch of session.watches.values()) {
      if (!watch.enabled) continue;
      let triggered = false;
      if (watch.type === 'everyTicks') {
        if (Number.isFinite(tickIndex) && tickIndex - watch.lastTick >= watch.everyTicks) {
          watch.lastTick = tickIndex;
          triggered = true;
        }
      } else if (watch.type === 'onChange') {
        const value = readPointer(state, watch.jsonPointer);
        const serialized = JSON.stringify(value);
        if (serialized !== watch.lastValue) {
          watch.lastValue = serialized;
          triggered = true;
        }
      }

      if (!triggered) continue;
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
              data.statePointers[pointer] = readPointer(state, pointer);
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
  } finally {
    session.watchPolling = false;
  }
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
  const sessionId = crypto.randomUUID();

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
    watches: new Map(),
    watchTimer: null,
    watchPolling: false,
    spectator: null
  };

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
    sessionId,
    gameUrl,
    spectatorUrl: session.spectator?.url || null,
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
  stopSpectatorServer(session);
  stopWatchLoop(session);
  session.resources.clearSession(sessionId);
  sessions.delete(sessionId);
  await session.context.close();
  await session.browser.close();
  return { ok: true };
};

const pauseTime = async (args) => {
  const { sessionId } = TimeSchema.parse(args || {});
  const session = getSession(sessionId);
  const result = await callE2E(session, 'pause');
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
  const tickIndexAfter = await getTickIndex(session);
  return attachEvents(session, {
    ok: !!result.ok && !!result.value,
    tickIndexBefore,
    tickIndexAfter
  });
};

const getStateTool = async (args) => {
  const { sessionId, include, lemmings, format } = StateGetSchema.parse(args || {});
  const session = getSession(sessionId);
  const raw = await getState(session);
  if (!raw) {
    return attachEvents(session, { ok: false, reason: 'harness_unavailable' });
  }

  let snapshot = filterStateSnapshot(raw, include);
  if (snapshot.game && lemmings) {
    const mode = lemmings.mode || 'summary';
    if (mode === 'none') {
      snapshot.game.lemmings = [];
    } else if (mode === 'summary') {
      snapshot.game.lemmings = [];
      snapshot.game.lemmingsSummary = buildLemmingSummary(raw, {
        activeOnly: true,
        inViewOnly: false
      });
    } else if (mode === 'ids') {
      const ids = Array.isArray(lemmings.ids) ? lemmings.ids : [];
      snapshot.game.lemmingsIds = ids;
      snapshot.game.lemmings = ids.map((id) => raw.game?.lemmings?.[id] || null);
    } else {
      const max = lemmings.max || raw.game.lemmings.length;
      snapshot.game.lemmings = raw.game.lemmings.slice(0, max);
    }
  }

  const delivery = format?.delivery || 'inline';
  if (delivery === 'resource') {
    const json = JSON.stringify(snapshot, null, format?.pretty ? 2 : 0);
    const stored = session.resources.put({
      sessionId: session.id,
      bytes: Buffer.from(json),
      mimeType: 'application/json',
      meta: { kind: 'state' }
    });
    return attachEvents(session, {
      resourceUri: stored?.uri || null,
      mimeType: 'application/json',
      sizeBytes: Buffer.byteLength(json),
      expiresAt: stored?.expiresAt || null
    });
  }

  const json = JSON.stringify(snapshot);
  return attachEvents(session, {
    snapshot,
    sizeBytesEstimate: Buffer.byteLength(json)
  });
};

const getLemmingsSummaryTool = async (args) => {
  const { sessionId, filter, topK, includeSelected } = LemmingsSummarySchema.parse(args || {});
  const session = getSession(sessionId);
  const state = await getState(session);
  if (!state) {
    return attachEvents(session, { ok: false, reason: 'harness_unavailable' });
  }
  const summary = buildLemmingSummary(state, {
    activeOnly: filter?.activeOnly !== false,
    inViewOnly: !!filter?.inViewOnly,
    rectWorld: filter?.rectWorld,
    topK,
    includeSelected
  });
  return attachEvents(session, summary);
};

const centerViewOnLemming = async (session, lemmingId) => session.page.evaluate((id) => {
  const view = globalThis.lemmings;
  const stage = view?.stage;
  const manager = view?.game?.getLemmingManager?.();
  const lem = manager?.getLemming?.(id);
  if (!stage || !lem) return false;
  const rect = stage.getGameViewRect?.();
  if (!rect) return false;
  stage.gameImgProps.viewPoint.x = lem.x - rect.w / 2;
  stage.gameImgProps.viewPoint.y = lem.y - rect.h / 2;
  view?.render?.();
  return true;
}, lemmingId);

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
  const { sessionId, skill, lemmingId, ensurePaused, verify } = SkillApplySchema.parse(args || {});
  const session = getSession(sessionId);
  if (ensurePaused !== false) {
    await callE2E(session, 'pause');
  }

  let tickIndexBefore = null;
  let tickIndexAfter = null;
  let beforeState = null;
  if (verify !== false) {
    beforeState = await getState(session);
    tickIndexBefore = beforeState?.game?.timer?.tickIndex ?? null;
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

  const action = SKILL_ACTIONS[skill];
  if (!action) {
    return attachEvents(session, { ok: false, reason: 'unknown_skill', skill });
  }

  const selectKey = await pressAction(session, action, 1);
  if (!selectKey.ok) {
    return attachEvents(session, { ok: false, reason: 'missing_binding', skill, action });
  }
  const applyKey = await pressAction(session, 'applySkillToSelected', 1);
  if (!applyKey.ok) {
    return attachEvents(session, { ok: false, reason: 'missing_binding', action: 'applySkillToSelected' });
  }
  await callE2E(session, 'step', 1);

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
    verification = {
      changed: JSON.stringify(beforeLem) !== JSON.stringify(afterLem),
      before: beforeLem,
      after: afterLem
    };
  }

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
  return attachEvents(session, await pressAction(session, action, repeat || 1));
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
  const watchId = crypto.randomUUID();
  const state = await getState(session);
  const tickIndex = state?.game?.timer?.tickIndex ?? 0;

  const entry = {
    id: watchId,
    type: watch.type,
    everyTicks: watch.everyTicks || 1,
    jsonPointer: watch.jsonPointer || '',
    enabled: enabled !== false,
    actions: actions || [],
    lastTick: Number.isFinite(tickIndex) ? tickIndex : 0,
    lastValue: watch.type === 'onChange' ? JSON.stringify(readPointer(state, watch.jsonPointer)) : null,
    lastCaptureTick: -Infinity
  };

  session.watches.set(watchId, entry);
  startWatchLoop(session);

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
  const envelope = session.events.drain(after, { updateCursor: true });
  const cursor = String(Number.isFinite(Number(after)) ? Number(after) : session.events.lastDelivered);
  return envelope || { cursor, events: [] };
};

const TOOL_HANDLERS = new Map([
  ['session.create', createSession],
  ['session.close', closeSession],
  ['time.pause', pauseTime],
  ['time.resume', resumeTime],
  ['time.step', stepTime],
  ['state.get', getStateTool],
  ['lemming.summary', getLemmingsSummaryTool],
  ['lemming.select', selectLemmingTool],
  ['skill.apply', applySkillTool],
  ['input.action', inputActionTool],
  ['input.keys', inputKeysTool],
  ['vision.capture', visionCaptureTool],
  ['vision.captureSequence', visionSequenceTool],
  ['watch.create', watchCreateTool],
  ['watch.cancel', watchCancelTool],
  ['events.poll', eventsPollTool]
]);

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
  const toolName = TOOL_NAME_ALIASES.get(rawName) || rawName;
  const handler = TOOL_HANDLERS.get(toolName);
  if (!handler) {
    throw new Error(`Unknown tool: ${rawName}`);
  }
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

const shutdown = async () => {
  for (const session of sessions.values()) {
    stopSpectatorServer(session);
    stopWatchLoop(session);
    try {
      await session.context.close();
      await session.browser.close();
    } catch (err) {
      // ignore
    }
  }
  sessions.clear();
};

process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});
