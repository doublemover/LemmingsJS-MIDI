import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { chromium } from '@playwright/test';
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
import { getSession, normalizeSessionId, sessions } from './sessionStore.js';
import { attachEvents } from './eventEnvelope.js';
import { disposeAllSessionRuntimes, disposeSessionRuntime } from './sessionLifecycle.js';
import { buildLemmingSummary } from './lemmingSummary.js';
import { createStateToolHandlers } from './stateTools.js';
import { createSpectatorTools } from './spectatorTools.js';
import { createShutdownController } from './shutdownController.js';
import { createEditorObjectToolHandlers } from './editorObjectTools.js';
import { createVisionToolHandlers } from './visionTools.js';
import { createGameToolHandlers } from './gameTools.js';
import { createSessionToolHandlers } from './sessionTools.js';
import { createWatchToolHandlers } from './watchTools.js';
import { createServerHelpers } from './serverHelpers.js';
import {
  buildProtocolMetadata,
  buildToolResponse,
  formatToMime,
  makeId,
  normalizeKeyChord,
  normalizeKeyToken,
  nowIso,
  toToolName
} from './protocolMetadata.js';
import {
  buildToolCatalog,
  resolveToolName
} from './toolRouting.js';

import {
  DEFAULT_LEM_DELTA_FIELDS,
  EditorApplySchema,
  EventsPollSchema,
  InputActionSchema,
  InputKeysSchema,
  LEMMING_DELTA_FIELDS,
  LemmingsSummarySchema,
  LemmingSelectSchema,
  MCP_MAX_CAPTURE_SEQUENCE_FRAMES,
  MCP_PROTOCOL_SCHEMA_FROZEN_AT,
  MCP_PROTOCOL_VERSION,
  ObjectsDeleteSchema,
  ObjectsListSchema,
  ObjectsPlaceSchema,
  ObjectsUpdateSchema,
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
} from './schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const KEYBINDINGS_PATH = path.join(ROOT_DIR, 'keybindings.json');
const SPECTATOR_HTML_PATH = path.join(__dirname, 'spectator.html');

const DEFAULT_BASE_URL = process.env.LEMMINGS_MCP_BASE_URL || 'https://localhost:8080';
const DEFAULT_PATH = process.env.LEMMINGS_MCP_PATH || '/?e2e=1';
const DEFAULT_VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };
const ENABLED_TOOL_SURFACES = parseEnabledSurfaces(process.env.LEMMINGS_MCP_SURFACES);

const RESOURCE_URI_RE = /^lemmings:\/\/sessions\/([^/]+)\/resources\/([^/]+)$/;


const {
  loadKeybindings,
  callE2E,
  getState,
  getTickIndex,
  filterStateSnapshot,
  buildSkillInfo,
  buildLemmingPrunePolicy,
  pruneLemming,
  buildLemmingSummaryCompact,
  ensureGameFocus,
  pressKey,
  pressAction
} = createServerHelpers({
  fs,
  keybindingsPath: KEYBINDINGS_PATH,
  normalizeKeyChord,
  skillNames: SKILL_NAMES,
  buildLemmingSummary
});

const {
  captureFrame,
  captureSequence,
  resolveCanvasMetrics,
  visionCaptureTool,
  visionSequenceTool
} = createVisionToolHandlers({
  schemas: { VisionCaptureSchema, VisionSequenceSchema },
  getSession,
  callE2E,
  getTickIndex,
  attachEvents,
  formatToMime,
  makeId,
  nowIso,
  maxCaptureSequenceFrames: MCP_MAX_CAPTURE_SEQUENCE_FRAMES
});

const { startSpectatorServer, stopSpectatorServer } = createSpectatorTools({
  spectatorHtmlPath: SPECTATOR_HTML_PATH,
  captureFrame,
  resolveCanvasMetrics,
  normalizeKeyToken,
  ensureGameFocus
});

const {
  startWatchLoop,
  stopWatchLoop,
  requestWatchPoll,
  nudgeWatchPolling,
  pollWatches,
  watchCreateTool,
  watchCancelTool,
  eventsPollTool
} = createWatchToolHandlers({
  schemas: { EventsPollSchema, WatchCancelSchema, WatchCreateSchema },
  getSession,
  getState,
  attachEvents,
  makeId,
  readPointerValue,
  createPointerWatchState,
  updatePointerWatchState,
  buildLemmingSummary,
  captureFrame,
  pressAction,
  pressKey
});

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

const { createSession, closeSession } = createSessionToolHandlers({
  schemas: { SessionCloseSchema, SessionCreateSchema },
  chromium,
  ResourceStore,
  EventQueue,
  WatchPollingController,
  sessions,
  normalizeSessionId,
  getSession,
  disposeSessionRuntime,
  loadKeybindings,
  pollWatches,
  startSpectatorServer,
  stopSpectatorServer,
  stopWatchLoop,
  createProtocolMetadata: () => createProtocolMetadata(),
  attachEvents,
  defaults: { DEFAULT_BASE_URL, DEFAULT_PATH, DEFAULT_VIEWPORT },
  makeId
});

const {
  pauseTime,
  resumeTime,
  stepTime,
  selectLemmingTool,
  applySkillTool,
  inputActionTool,
  inputKeysTool
} = createGameToolHandlers({
  schemas: {
    InputActionSchema,
    InputKeysSchema,
    LemmingSelectSchema,
    SkillApplySchema,
    TimeSchema,
    TimeStepSchema
  },
  getSession,
  getState,
  getTickIndex,
  callE2E,
  attachEvents,
  nudgeWatchPolling,
  ensureGameFocus,
  pressAction,
  pressKey,
  normalizeKeyToken,
  skillActions: SKILL_ACTIONS,
  skillIndexByName: SKILL_INDEX_BY_NAME
});

const {
  editorApplyTool,
  listObjectsTool,
  placeObjectsTool,
  updateObjectsTool,
  deleteObjectsTool
} = createEditorObjectToolHandlers({
  schemas: {
    EditorApplySchema,
    ObjectsDeleteSchema,
    ObjectsListSchema,
    ObjectsPlaceSchema,
    ObjectsUpdateSchema
  },
  getSession,
  getState,
  callE2E,
  attachEvents,
  nudgeWatchPolling
});

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

const ACTIVE_TOOL_SURFACES = ENABLED_TOOL_SURFACES;

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

const resolveTool = (rawName) => {
  const requestedName = resolveToolName(rawName);
  const route = TOOL_ROUTES.get(requestedName);
  if (!route) {
    throw new Error(`Unknown tool: ${rawName}`);
  }
  if (!ENABLED_TOOL_SURFACES.has(route.surface)) {
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

const createProtocolMetadata = () => buildProtocolMetadata({
  protocolVersion: MCP_PROTOCOL_VERSION,
  schemaFrozenAt: MCP_PROTOCOL_SCHEMA_FROZEN_AT,
  skillNames: SKILL_NAMES,
  lemmingDeltaFields: LEMMING_DELTA_FIELDS
});

const createMcpRuntime = async ({
  transport = new StdioServerTransport(),
  processRef = process
} = {}) => {
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

  processRef?.on?.('SIGINT', () => {
    shutdownController.handleSignal('SIGINT');
  });

  processRef?.on?.('SIGTERM', () => {
    shutdownController.handleSignal('SIGTERM');
  });

  return {
    server,
    transport,
    shutdownController
  };
};

const isMainModule = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  await createMcpRuntime();
}

export {
  createMcpRuntime,
  createProtocolMetadata,
  server
};
