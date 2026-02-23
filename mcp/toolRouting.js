/**
 * Parse a boolean-like environment flag.
 *
 * @param {unknown} value
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
const parseBooleanEnv = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
};

/**
 * Create legacy alias mappings for underscore and dotted tool names.
 *
 * @param {boolean} [enabled]
 * @returns {Readonly<Record<string, string>>}
 */
const createLegacyToolAliases = (enabled = true) => {
  if (!enabled) return Object.freeze({});
  return Object.freeze({
    editor_mutate: 'editor_apply',
    'editor.mutate': 'editor_apply',
    editor_objects_list: 'objects_list',
    'editor.objects.list': 'objects_list',
    editor_objects_place: 'objects_place',
    'editor.objects.place': 'objects_place',
    editor_objects_update: 'objects_update',
    'editor.objects.update': 'objects_update',
    editor_objects_delete: 'objects_delete',
    'editor.objects.delete': 'objects_delete'
  });
};

/**
 * Resolve lookup candidates for a requested MCP tool name.
 *
 * @param {unknown} rawName
 * @param {{
 *   legacyToolAliases?: Readonly<Record<string, string>>,
 *   dottedFallbackEnabled?: boolean,
 *   toToolName?: (name: string) => string
 * }} [options]
 * @returns {{requestedName: string, candidates: string[]}}
 */
const resolveToolCandidates = (
  rawName,
  {
    legacyToolAliases = Object.freeze({}),
    dottedFallbackEnabled = true,
    toToolName = (name) => name
  } = {}
) => {
  const requestedName = rawName == null ? '' : String(rawName).trim();
  const candidates = [];
  const pushCandidate = (name) => {
    const canonical = legacyToolAliases[name] || name;
    if (!canonical) return;
    if (!candidates.includes(canonical)) {
      candidates.push(canonical);
    }
  };

  pushCandidate(requestedName);
  if (dottedFallbackEnabled && requestedName.includes('.')) {
    pushCandidate(toToolName(requestedName));
  }

  return {
    requestedName,
    candidates
  };
};

/**
 * Build list-tools definitions and call-tool routes from a surface registry.
 * Routes include all known tools so disabled-surface calls can still return
 * explicit policy errors instead of unknown-tool errors.
 *
 * @param {{
 *   specs?: Array<{name?: string, description?: string, schema?: unknown}>,
 *   handlersBySurface?: Map<string, Map<string, (...args: any[]) => any>>,
 *   toolSurfaceByName?: Map<string, string>
 * }} surfaceRegistry
 * @param {{
 *   activeSurfaces?: Set<string>,
 *   toToolName?: (name: string) => string,
 *   toJsonSchemaCompat?: (schema: unknown) => unknown
 * }} [options]
 * @throws {Error} When two canonical tool names normalize to the same exposed tool name.
 * @returns {{
 *   toolDefs: Array<{name: string, description: string, inputSchema: unknown}>,
 *   toolRoutes: Map<string, {
 *     toolName: string,
 *     canonicalName: string,
 *     surface: string,
 *     handler: (...args: any[]) => any
 *   }>
 * }}
 */
const buildToolCatalog = (
  surfaceRegistry,
  {
    activeSurfaces = null,
    toToolName = (name) => name,
    toJsonSchemaCompat = (schema) => schema
  } = {}
) => {
  const toolDefs = [];
  const toolRoutes = new Map();
  const specs = Array.isArray(surfaceRegistry?.specs) ? surfaceRegistry.specs : [];
  const handlersBySurface = surfaceRegistry?.handlersBySurface;
  const toolSurfaceByName = surfaceRegistry?.toolSurfaceByName;
  const hasActiveFilter = activeSurfaces instanceof Set;

  for (const spec of specs) {
    const canonicalName = String(spec?.name || '');
    if (!canonicalName) continue;
    const toolName = toToolName(canonicalName);
    const existing = toolRoutes.get(toolName);
    if (existing && existing.canonicalName !== canonicalName) {
      throw new Error(
        `Tool name collision: \"${existing.canonicalName}\" and \"${canonicalName}\" both map to \"${toolName}\"`
      );
    }
    const surface = toolSurfaceByName?.get(canonicalName);
    const handler = handlersBySurface?.get(surface)?.get(canonicalName) || null;
    if (!surface || !handler) continue;

    toolRoutes.set(toolName, {
      toolName,
      canonicalName,
      surface,
      handler
    });

    if (hasActiveFilter && !activeSurfaces.has(surface)) continue;
    toolDefs.push({
      name: toolName,
      description: String(spec?.description || ''),
      inputSchema: toJsonSchemaCompat(spec?.schema)
    });
  }

  return {
    toolDefs,
    toolRoutes
  };
};

export {
  buildToolCatalog,
  createLegacyToolAliases,
  parseBooleanEnv,
  resolveToolCandidates
};
