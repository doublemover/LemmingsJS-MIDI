import { z } from 'zod';

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
const MCP_MAX_EVENT_QUEUE_EVENTS = 10000;
const MCP_MAX_CAPTURE_SEQUENCE_FRAMES = 240;

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
let cachedKeybindingsMtimeMs = NaN;

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
    maxEvents: z.number().int().positive().max(MCP_MAX_EVENT_QUEUE_EVENTS).optional(),
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
  frames: z.number().int().positive().max(MCP_MAX_CAPTURE_SEQUENCE_FRAMES),
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


export {
  DEFAULT_LEM_DELTA_FIELDS,
  EditorApplySchema,
  EditorMutationOptionsSchema,
  EditorObjectBBoxSchema,
  EditorObjectKindOrAllSchema,
  EditorObjectKindSchema,
  EditorObjectRefSchema,
  EventsPollSchema,
  InputActionSchema,
  InputKeysSchema,
  LEMMING_DELTA_FIELDS,
  LemmingsSummarySchema,
  LemmingSelectSchema,
  MCP_MAX_CAPTURE_SEQUENCE_FRAMES,
  MCP_MAX_EVENT_QUEUE_EVENTS,
  MCP_PROTOCOL_SCHEMA_FROZEN_AT,
  MCP_PROTOCOL_VERSION,
  ObjectsDeleteSchema,
  ObjectsListSchema,
  ObjectsPlaceSchema,
  ObjectsUpdateSchema,
  RectSchema,
  SKILL_ACTIONS,
  SKILL_INDEX_BY_NAME,
  SKILL_NAMES,
  SessionCloseSchema,
  SessionCreateSchema,
  SkillApplySchema,
  StateDeltaSchema,
  StateGetSchema,
  TimeSchema,
  TimeStepSchema,
  VisionCaptureSchema,
  VisionSequenceSchema,
  WatchCancelSchema,
  WatchCreateSchema
};
