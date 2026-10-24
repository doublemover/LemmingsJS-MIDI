# MCP publishing

This repo ships a stdio MCP server (`mcp/server.js`) and is prepared for MCPB
bundles plus GitHub registry publication. Streamable HTTP is not wired up yet.

## Bundle layout

The MCPB bundle uses the repo root as the runtime base:

- `mcp/` (stdio server entry, tools, spectator UI, and support modules)
- the complete relative executable closure under `js/` (including solver/game dependencies)
- `keybindings.json` (tool input mappings)
- `manifest.json`, `package.json`, `server.json`, `.mcpbignore`
- `runtime-closure.json` (source/resource paths, SHA-256, sizes and dependency versions)

The builder parses static imports, exports, literal dynamic imports and relative
URL assets using the repository's TypeScript parser. Missing imports, computed
module imports, escaping paths and undeclared package dependencies fail staging.
Relative layout is preserved. Runtime package versions come from the repository
manifest; the parser itself remains a build dependency outside the artifact.

Use the MCPB bundle templates in `mcpb/` and build a staging bundle with:

```
node scripts/build-mcpb-bundle.js
```

This creates `dist/mcpb/` with the files and templates needed for `mcpb`.

Surface bundles are also available:

```
node scripts/build-mcpb-bundle.js --surface game
node scripts/build-mcpb-bundle.js --surface editor
node scripts/build-mcpb-bundle.js --surface interact
```

These output to `dist/mcpb-game/`, `dist/mcpb-editor/`, and
`dist/mcpb-interact/` using the surface templates when present:

- `mcpb/manifest.<surface>.json`
- `mcpb/package.<surface>.json`
- `mcpb/server.<surface>.json`

If a surface-specific template is missing, the build falls back to the generic
template for that file. The current repo ships surface-specific metadata for all
three public surfaces.

## Dependencies

The MCP server depends on `@modelcontextprotocol/sdk`, `@playwright/test`, `ws`,
`zod`. For MCPB, install production deps inside `dist/mcpb` and skip browser
downloads when you want to rely on the user's Chrome:

```
cd dist/mcpb
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install --omit=dev
```

## Build/validate the MCPB

`npm run mcpb:qualify` stages every advertised surface, copies each outside the
checkout, installs only its declared production dependencies, and performs a
bounded stdio initialization/tools-list handshake. The all-surfaces package also
executes a solver route request. Child processes have no `NODE_PATH` or
`NODE_OPTIONS`, so checkout dependencies cannot hide missing packaged sources.
This qualification needs npm registry access; it does not start a browser or
qualify browser session workflows. Source closure inspection is a static check,
separate from this runtime qualification. Runtime execution is deferred during
the current backlog implementation pass.

```
cd dist/mcpb
npx @anthropic-ai/mcpb validate
npx @anthropic-ai/mcpb pack dist/lemmings-mcp.mcpb
```

## GitHub registry publish checklist

1. Create a GitHub release (tag `vX.Y.Z`) and upload the `.mcpb` asset.
2. Compute SHA-256 for the `.mcpb` file.
3. Update `mcpb/server.json` or the matching `mcpb/server.<surface>.json` with
   the release URL and SHA-256.
4. Publish with the MCP registry tooling (manual for now).

See `mcpb/README.md` and the relevant `mcpb/server*.json` file for the exact
fields and placeholders.
