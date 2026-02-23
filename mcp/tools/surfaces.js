import {
  GAME_NAMESPACES,
  GAME_SURFACE,
  buildGameToolHandlers,
  buildGameToolSpecs
} from './game.js';
import {
  EDITOR_NAMESPACES,
  EDITOR_SURFACE,
  buildEditorToolHandlers,
  buildEditorToolSpecs
} from './editor.js';
import {
  INTERACT_NAMESPACES,
  INTERACT_SURFACE,
  buildInteractToolHandlers,
  buildInteractToolSpecs
} from './interact.js';

const ALL_TOOL_SURFACES = Object.freeze([GAME_SURFACE, EDITOR_SURFACE, INTERACT_SURFACE]);
const DEFAULT_ENABLED_SURFACES = new Set(ALL_TOOL_SURFACES);

const SURFACE_MODULES = Object.freeze([
  {
    surface: GAME_SURFACE,
    namespaces: GAME_NAMESPACES,
    buildSpecs: buildGameToolSpecs,
    buildHandlers: buildGameToolHandlers
  },
  {
    surface: EDITOR_SURFACE,
    namespaces: EDITOR_NAMESPACES,
    buildSpecs: buildEditorToolSpecs,
    buildHandlers: buildEditorToolHandlers
  },
  {
    surface: INTERACT_SURFACE,
    namespaces: INTERACT_NAMESPACES,
    buildSpecs: buildInteractToolSpecs,
    buildHandlers: buildInteractToolHandlers
  }
]);

const parseEnabledSurfaces = (raw) => {
  if (!raw || !String(raw).trim()) return new Set(DEFAULT_ENABLED_SURFACES);
  const parts = String(raw)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return new Set(DEFAULT_ENABLED_SURFACES);
  const enabled = new Set();
  for (const part of parts) {
    if (!ALL_TOOL_SURFACES.includes(part)) {
      throw new Error(`Unknown MCP surface: ${part}`);
    }
    enabled.add(part);
  }
  return enabled;
};

const buildSurfaceRegistry = (schemas, handlers, enabledSurfaces) => {
  const activeSurfaces = enabledSurfaces instanceof Set
    ? enabledSurfaces
    : new Set(DEFAULT_ENABLED_SURFACES);
  const specsBySurface = new Map();
  const handlersBySurface = new Map();
  const toolSurfaceByName = new Map();
  for (const module of SURFACE_MODULES) {
    const specs = module.buildSpecs(schemas);
    const surfaceHandlers = module.buildHandlers(handlers);
    specsBySurface.set(module.surface, specs);
    handlersBySurface.set(module.surface, surfaceHandlers);
    for (const spec of specs) {
      const namespace = String(spec.name).split('.', 1)[0];
      if (!module.namespaces.includes(namespace)) {
        throw new Error(`Tool namespace mismatch for surface "${module.surface}": ${spec.name}`);
      }
      toolSurfaceByName.set(spec.name, module.surface);
    }
  }

  const specs = [];
  for (const [surface, list] of specsBySurface.entries()) {
    if (!activeSurfaces.has(surface)) continue;
    for (const spec of list) {
      specs.push(spec);
    }
  }

  return {
    specs,
    handlersBySurface,
    toolSurfaceByName
  };
};

export {
  ALL_TOOL_SURFACES,
  parseEnabledSurfaces,
  buildSurfaceRegistry
};
