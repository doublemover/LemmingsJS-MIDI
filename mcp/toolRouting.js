/**
 * Normalize a requested MCP tool name. Hard-cut MCP routing accepts only the
 * canonical underscore tool names exposed by list-tools.
 *
 * @param {unknown} rawName
 * @returns {string}
 */
const resolveToolName = (rawName) => rawName == null ? '' : String(rawName).trim();

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
  resolveToolName
};
