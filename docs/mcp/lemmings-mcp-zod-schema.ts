/**
 * LemmingsJS MCP - Zod Schemas (v1, memory-backed resources)
 *
 * This file defines Zod schemas for tool inputs/outputs and shared types.
 * It targets the v1 MCP SDK and mirrors the interface spec in docs/mcp.
 *
 * Intended use:
 * - Validate tool arguments at the MCP boundary
 * - Provide a single source of truth for structuredContent shapes
 */

import { z } from "zod";

/* ---------------------------------- */
/* Shared primitives                   */
/* ---------------------------------- */

export const SessionIdSchema = z.string().min(1);

export const IsoDateTimeSchema = z.string().min(1); // keep simple; enforce ISO in code if desired

export const ResourceUriSchema = z.string().min(1); // e.g. lemmings://sessions/<id>/resources/<rid>

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const TickIndexSchema = z.number().int().nonnegative();

export const MimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/json",
  "text/plain",
]);

/* ---------------------------------- */
/* Game-facing entities (from __E2E__) */
/* ---------------------------------- */

export const LemmingSchema = z.object({
  id: z.number().int(),
  x: z.number(),
  y: z.number(),
  state: z.number().int().nullable(),
  actionType: z.number().int().nullable(),
  lookRight: z.boolean().optional(),
  frameIndex: z.number().int().optional(),
  canClimb: z.boolean().optional(),
  hasParachute: z.boolean().optional(),
  removed: z.boolean().optional(),
  disabled: z.boolean().optional(),
  countdown: z.number().int().optional(),
  countdownActive: z.boolean().optional(),
  hasExploded: z.boolean().optional(),
  lastTriggerType: z.number().int().nullable().optional(),
});

export const GameTimerSchema = z.object({
  tickIndex: TickIndexSchema,
  speedFactor: z.number(),
  running: z.boolean(),
  frameTime: z.number().optional(),
  tps: z.number().optional(),
}).nullable();

export const VictorySchema = z.object({
  releaseRate: z.number().int(),
  minReleaseRate: z.number().int(),
  leftCount: z.number().int(),
  outCount: z.number().int(),
  survivorCount: z.number().int(),
  isFinalize: z.boolean(),
}).nullable();

export const SkillsSchema = z.object({
  selectedSkill: z.number().int().nullable(),
  selectedSkillName: z.string().nullable().optional(),
  cheatMode: z.boolean(),
  counts: z.array(z.number()).optional(),
  availableMask: z.number().int().optional(),
  skills: z.array(z.any()).optional(),
}).nullable();

export const LemmingManagerSchema = z.object({
  selectedIndex: z.number().int(),
  spawnTotal: z.number().int(),
  releaseTickIndex: z.number().int(),
  mmTickCounter: z.number().int(),
  activeCount: z.number().int(),
  totalCount: z.number().int(),
  nukeTargets: z.array(z.number().int()),
}).nullable();

export const GameSnapshotSchema = z.object({
  ready: z.boolean().optional(),
  finalGameState: z.any().nullable().optional(),
  state: z.any().nullable().optional(),
  timer: GameTimerSchema.optional(),
  history: z.any().nullable().optional(),
  timeTravel: z.any().nullable().optional(),
  victory: VictorySchema.optional(),
  skills: SkillsSchema.optional(),
  skillsInfo: SkillsSchema.optional(),
  commandManager: z.any().nullable().optional(),
  lemmingManager: LemmingManagerSchema.optional(),
  lemmings: z.array(LemmingSchema.nullable()).optional(),
  lemmingsSummary: z.any().optional(),
  selectedLemmingId: z.number().int().nullable().optional(),
  selectedLemming: LemmingSchema.nullable().optional(),
  level: z.any().nullable().optional(),
  triggers: z.any().nullable().optional(),
  objects: z.any().nullable().optional(),
  minimap: z.any().nullable().optional(),
  soundEvents: z.any().nullable().optional(),
}).nullable();

export const E2ESnapshotSchema = z.object({
  version: z.number().int(),
  mode: z.enum(["game", "editor"]),
  ready: z.boolean(),
  view: z.any().nullable().optional(),
  stage: z.any().nullable().optional(),
  game: GameSnapshotSchema.optional(),
  editor: z.any().nullable().optional(),
  midi: z.any().nullable().optional(),
});

/* ---------------------------------- */
/* Resources / Vision                  */
/* ---------------------------------- */

export const ImageFormatSchema = z.enum(["png", "jpeg", "webp"]);

export const CaptureTargetSchema = z.enum(["page", "gameCanvas", "guiCanvas", "stageCanvas", "rect"]);

export const FrameDescriptorSchema = z.object({
  id: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tickIndex: TickIndexSchema.nullable().optional(),
  takenAt: IsoDateTimeSchema.optional(),
  target: CaptureTargetSchema,
  clip: RectSchema.optional(),
  tag: z.string().optional(),

  // Delivery: resource or inline.
  resourceUri: ResourceUriSchema.optional(),
  dataBase64: z.string().optional(),

  // Optional bookkeeping.
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
  expiresAt: IsoDateTimeSchema.optional(),
});

/* ---------------------------------- */
/* Events                              */
/* ---------------------------------- */

export const EventSourceSchema = z.enum(["agent", "human", "system"]);

export const EventTypeSchema = z.enum([
  "input",
  "state-change",
  "watch-trigger",
  "capture",
  "error",
  "log",
]);

export const McpEventSchema = z.object({
  id: z.string().min(1).optional(),
  source: EventSourceSchema,
  type: EventTypeSchema,
  tickIndex: TickIndexSchema.nullable().optional(),
  time: IsoDateTimeSchema.optional(),
  summary: z.string().min(1).optional(),
  data: z.any().optional(),
  resourceUris: z.array(ResourceUriSchema).optional(),
});

export const EventsEnvelopeSchema = z.object({
  cursor: z.string().min(1),
  events: z.array(McpEventSchema).optional(),
  humanSummary: z.string().optional(),
}).optional();

/* ---------------------------------- */
/* Tool: session.create                */
/* ---------------------------------- */

export const SessionCreateInputSchema = z.object({
  baseUrl: z.string().optional(), // e.g. https://localhost:8080
  path: z.string().optional(),    // e.g. /?e2e=1
  headless: z.boolean().optional(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive().optional(),
  }).optional(),
  enableSpectator: z.boolean().optional(),
  spectator: z.object({
    port: z.number().int().positive().optional(),
    allowHumanInput: z.boolean().optional(),
    openBrowser: z.boolean().optional(),
  }).optional(),
  resources: z.object({
    maxBytes: z.number().int().positive().optional(),
    ttlMs: z.number().int().positive().optional(),
    maxItems: z.number().int().positive().optional(),
  }).optional(),
  events: z.object({
    maxEvents: z.number().int().positive().optional(),
    mode: z.enum(["none", "minimal", "full"]).optional(),
  }).optional(),
});

export const SessionCreateOutputSchema = z.object({
  ok: z.boolean().optional(),
  sessionId: SessionIdSchema,
  protocol: z.object({
    skillNames: z.array(z.string()),
    lemmingDeltaFields: z.array(z.string()),
  }).optional(),
  gameUrl: z.string(),
  spectatorUrl: z.string().optional(),
  keybindings: z.object({
    version: z.number().int().optional(),
    actions: z.array(z.string()),
  }),
  warnings: z.array(z.string()).optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: session.close                 */
/* ---------------------------------- */

export const SessionCloseInputSchema = z.object({
  sessionId: SessionIdSchema,
});

export const SessionCloseOutputSchema = z.object({
  ok: z.boolean(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: time.pause / time.resume      */
/* ---------------------------------- */

export const TimePauseResumeInputSchema = z.object({
  sessionId: SessionIdSchema,
});

export const TimePauseResumeOutputSchema = z.object({
  ok: z.boolean(),
  tickIndex: TickIndexSchema.optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: time.step                     */
/* ---------------------------------- */

export const TimeStepInputSchema = z.object({
  sessionId: SessionIdSchema,
  count: z.number().int(),
  ensurePaused: z.boolean().optional(),
});

export const TimeStepOutputSchema = z.object({
  ok: z.boolean(),
  tickIndexBefore: TickIndexSchema,
  tickIndexAfter: TickIndexSchema,
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: state.get                     */
/* ---------------------------------- */

export const StateGetInputSchema = z.object({
  sessionId: SessionIdSchema,
  preset: z.enum(["compact", "debug"]).optional(),
  include: z.object({
    view: z.boolean().optional(),
    stage: z.boolean().optional(),
    game: z.boolean().optional(),
    editor: z.boolean().optional(),
    midi: z.boolean().optional(),
  }).optional(),
  lemmings: z.object({
    mode: z.enum(["none", "summary", "selected", "all", "ids"]),
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
      h: z.number().positive().optional(),
    }).optional(),
  }).optional(),
  format: z.object({
    delivery: z.enum(["inline", "resource"]).optional(),
    pretty: z.boolean().optional(),
    includeSizeEstimate: z.boolean().optional(),
  }).optional(),
});

export const StateGetOutputSchema = z.object({
  ok: z.boolean().optional(),
  tickIndex: TickIndexSchema.optional(),
  preset: z.enum(["compact", "debug"]).optional(),
  snapshot: E2ESnapshotSchema.optional(),
  resourceUri: ResourceUriSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  expiresAt: IsoDateTimeSchema.optional(),
  sizeBytesEstimate: z.number().int().nonnegative().optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: state.delta                   */
/* ---------------------------------- */

export const StateDeltaInputSchema = z.object({
  sessionId: SessionIdSchema,
  afterTick: TickIndexSchema.optional(),
  toTick: TickIndexSchema.optional(),
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
    entrances: z.boolean().optional(),
  }).optional(),
  lemmings: z.object({
    fields: z.array(z.number().int()).optional(),
    includePrev: z.boolean().optional(),
    includeXY: z.enum(["none", "tracked", "all"]).optional(),
    trackedIds: z.array(z.number().int()).optional(),
    maxChanges: z.number().int().positive().optional(),
  }).optional(),
  format: z.object({
    delivery: z.enum(["inline", "resource"]).optional(),
    pretty: z.boolean().optional(),
  }).optional(),
});

export const StateDeltaOutputSchema = z.object({
  ok: z.boolean().optional(),
  cursor: TickIndexSchema.optional(),
  afterTick: TickIndexSchema.optional(),
  fromTick: TickIndexSchema.optional(),
  toTick: TickIndexSchema.optional(),
  deltas: z.array(z.any()).optional(),
  resourceUri: ResourceUriSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: editor.apply                  */
/* ---------------------------------- */

export const EditorApplyOpSchema = z.object({
  opId: z.string().optional(),
  type: z.string().min(1),
  args: z.record(z.any()).optional(),
});

export const EditorApplyInputSchema = z.object({
  sessionId: SessionIdSchema,
  ops: z.array(EditorApplyOpSchema),
  atomic: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  history: z.object({
    label: z.string().optional(),
    record: z.boolean().optional(),
  }).optional(),
  preview: z.object({
    refresh: z.boolean().optional(),
    label: z.string().optional(),
    preserveViewport: z.boolean().optional(),
  }).optional(),
  validate: z.object({
    run: z.boolean().optional(),
    autoFix: z.enum(["none", "safe", "aggressive"]).optional(),
  }).optional(),
  returnState: z.enum(["none", "editor", "full"]).optional(),
});

export const EditorApplyResultSchema = z.object({
  opId: z.string().nullable().optional(),
  type: z.string(),
  ok: z.boolean(),
  value: z.any().optional(),
  error: z.string().optional(),
});

export const EditorApplyResourceSchema = z.object({
  uri: ResourceUriSchema.optional(),
  mimeType: MimeTypeSchema.optional(),
  name: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  meta: z.any().optional(),
});

export const EditorApplyOutputSchema = z.object({
  ok: z.boolean(),
  results: z.array(EditorApplyResultSchema).optional(),
  state: z.any().optional(),
  resources: z.array(EditorApplyResourceSchema).optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: lemming.summary               */
/* ---------------------------------- */

export const LemmingsSummaryInputSchema = z.object({
  sessionId: SessionIdSchema,
  filter: z.object({
    activeOnly: z.boolean().optional(),
    inViewOnly: z.boolean().optional(),
    rectWorld: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
    }).optional(),
  }).optional(),
  topK: z.number().int().positive().optional(),
  includeSelected: z.boolean().optional(),
});

export const LemmingsSummaryOutputSchema = z.object({
  tickIndex: TickIndexSchema,
  selectedLemmingId: z.number().int().nullable(),
  totalCount: z.number().int(),
  activeCount: z.number().int(),
  removedCount: z.number().int(),
  disabledCount: z.number().int(),
  byActionType: z.record(z.number().int()),
  byState: z.record(z.number().int()),
  climbers: z.number().int(),
  floaters: z.number().int(),
  countingDown: z.number().int(),
  exploded: z.number().int(),
  selected: LemmingSchema.nullable().optional(),
  top: z.array(LemmingSchema).optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: lemming.select                */
/* ---------------------------------- */

export const LemmingSelectInputSchema = z.object({
  sessionId: SessionIdSchema,
  lemmingId: z.number().int(),
  alsoCenterView: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

export const LemmingSelectOutputSchema = z.object({
  ok: z.boolean(),
  lemmingId: z.number().int(),
  selectedNow: z.number().int().nullable().optional(),
  reason: z.string().optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: skill.apply                   */
/* ---------------------------------- */

export const SkillSchema = z.enum([
  "climber",
  "floater",
  "bomber",
  "blocker",
  "builder",
  "basher",
  "miner",
  "digger",
]);

export const SkillApplyInputSchema = z.object({
  sessionId: SessionIdSchema,
  skill: SkillSchema,
  lemmingId: z.number().int().optional(),
  ensurePaused: z.boolean().optional(),
  requireAvailable: z.boolean().optional(),
  postStep: z.number().int().nonnegative().optional(),
  verify: z.boolean().optional(),
});

export const SkillApplyVerificationSchema = z.object({
  applied: z.boolean().optional(),
  changedFields: z.array(z.string()).optional(),
});

export const SkillApplyOutputSchema = z.object({
  ok: z.boolean(),
  skill: SkillSchema,
  lemmingIdAppliedTo: z.number().int().nullable().optional(),
  tickIndexBefore: TickIndexSchema,
  tickIndexAfter: TickIndexSchema,
  verification: SkillApplyVerificationSchema.optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: input.action                  */
/* ---------------------------------- */

export const InputActionInputSchema = z.object({
  sessionId: SessionIdSchema,
  action: z.string().min(1), // action name from keybindings.json
  repeat: z.number().int().positive().optional(),
});

export const InputActionOutputSchema = z.object({
  ok: z.boolean(),
  action: z.string(),
  repeat: z.number().int(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: input.keys                    */
/* ---------------------------------- */

export const KeyPressListInputSchema = z.object({
  sessionId: SessionIdSchema,
  keys: z.array(z.string().min(1)),
  repeat: z.number().int().positive().optional(),
});

export const KeyEventSchema = z.object({
  type: z.enum(["down", "up", "press"]),
  key: z.string().min(1),
});

export const KeyEventListInputSchema = z.object({
  sessionId: SessionIdSchema,
  events: z.array(KeyEventSchema),
});

export const InputKeysInputSchema = z.union([KeyPressListInputSchema, KeyEventListInputSchema]);

export const InputKeysOutputSchema = z.object({
  ok: z.boolean(),
  eventsInjected: z.number().int().nonnegative(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: vision.capture                */
/* ---------------------------------- */

export const VisionCaptureInputSchema = z.object({
  sessionId: SessionIdSchema,
  target: CaptureTargetSchema.optional(),
  rect: RectSchema.optional(),
  format: ImageFormatSchema.optional(),
  delivery: z.enum(["resource", "inline"]).optional(),
  tag: z.string().optional(),
});

export const VisionCaptureOutputSchema = z.object({
  frame: FrameDescriptorSchema,
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: vision.captureSequence        */
/* ---------------------------------- */

export const VisionCaptureSequenceInputSchema = z.object({
  sessionId: SessionIdSchema,
  mode: z.enum(["step", "sample"]),
  frames: z.number().int().positive(),
  stepBy: z.number().int().positive().optional(),
  everyMs: z.number().int().positive().optional(),
  capture: VisionCaptureInputSchema.omit({ sessionId: true }).optional(),
  returnManifest: z.boolean().optional(),
});

export const VisionCaptureSequenceOutputSchema = z.object({
  sequenceId: z.string().min(1),
  frames: z.array(FrameDescriptorSchema),
  manifestResourceUri: ResourceUriSchema.optional(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: watch.create / watch.cancel   */
/* ---------------------------------- */

export const WatchTypeSchema = z.enum(["everyTicks", "onChange"]);

export const WatchDefSchema = z.union([
  z.object({
    type: z.literal("everyTicks"),
    everyTicks: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("onChange"),
    jsonPointer: z.string().min(1), // e.g. /game/victory/outCount
  }),
]);

export const WatchActionSchema = z.union([
  z.object({
    type: z.literal("emitSummary"),
    include: z.object({
      lemmingsSummary: z.boolean().optional(),
      statePointers: z.array(z.string()).optional(),
    }).optional(),
  }),
  z.object({
    type: z.literal("capture"),
    capture: VisionCaptureInputSchema.omit({ sessionId: true }),
    throttleTicks: z.number().int().positive().optional(),
  }),
]);

export const WatchCreateInputSchema = z.object({
  sessionId: SessionIdSchema,
  watch: WatchDefSchema,
  actions: z.array(WatchActionSchema).min(1),
  enabled: z.boolean().optional(),
});

export const WatchCreateOutputSchema = z.object({
  ok: z.boolean(),
  watchId: z.string().min(1),
  events: EventsEnvelopeSchema,
});

export const WatchCancelInputSchema = z.object({
  sessionId: SessionIdSchema,
  watchId: z.string().min(1),
});

export const WatchCancelOutputSchema = z.object({
  ok: z.boolean(),
  events: EventsEnvelopeSchema,
});

/* ---------------------------------- */
/* Tool: events.poll                   */
/* ---------------------------------- */

export const EventsPollInputSchema = z.object({
  sessionId: SessionIdSchema,
  after: z.string().optional(),
});

export const EventsPollOutputSchema = z.object({
  cursor: z.string().min(1),
  events: z.array(McpEventSchema),
  humanSummary: z.string().optional(),
  // (No nested events envelope here; this tool IS the envelope.)
});

/* ---------------------------------- */
/* Tool name registry                  */
/* ---------------------------------- */

export const ToolNameSchema = z.enum([
  "session.create",
  "session.close",
  "time.pause",
  "time.resume",
  "time.step",
  "state.get",
  "state.delta",
  "editor.apply",
  "lemming.summary",
  "lemming.select",
  "skill.apply",
  "input.action",
  "input.keys",
  "vision.capture",
  "vision.captureSequence",
  "watch.create",
  "watch.cancel",
  "events.poll",
]);

/**
 * Optional: map tool name -> (input, output) schemas.
 * Useful for a typed router.
 */
export const ToolSchemas = {
  "session.create": { input: SessionCreateInputSchema, output: SessionCreateOutputSchema },
  "session.close": { input: SessionCloseInputSchema, output: SessionCloseOutputSchema },
  "time.pause": { input: TimePauseResumeInputSchema, output: TimePauseResumeOutputSchema },
  "time.resume": { input: TimePauseResumeInputSchema, output: TimePauseResumeOutputSchema },
  "time.step": { input: TimeStepInputSchema, output: TimeStepOutputSchema },
  "state.get": { input: StateGetInputSchema, output: StateGetOutputSchema },
  "state.delta": { input: StateDeltaInputSchema, output: StateDeltaOutputSchema },
  "editor.apply": { input: EditorApplyInputSchema, output: EditorApplyOutputSchema },
  "lemming.summary": { input: LemmingsSummaryInputSchema, output: LemmingsSummaryOutputSchema },
  "lemming.select": { input: LemmingSelectInputSchema, output: LemmingSelectOutputSchema },
  "skill.apply": { input: SkillApplyInputSchema, output: SkillApplyOutputSchema },
  "input.action": { input: InputActionInputSchema, output: InputActionOutputSchema },
  "input.keys": { input: InputKeysInputSchema, output: InputKeysOutputSchema },
  "vision.capture": { input: VisionCaptureInputSchema, output: VisionCaptureOutputSchema },
  "vision.captureSequence": { input: VisionCaptureSequenceInputSchema, output: VisionCaptureSequenceOutputSchema },
  "watch.create": { input: WatchCreateInputSchema, output: WatchCreateOutputSchema },
  "watch.cancel": { input: WatchCancelInputSchema, output: WatchCancelOutputSchema },
  "events.poll": { input: EventsPollInputSchema, output: EventsPollOutputSchema },
} as const;
