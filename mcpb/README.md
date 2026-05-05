# MCPB bundle prep

This folder contains the templates used to build an MCPB bundle for the Lemmings
MCP server.

## Build the staging bundle

From the repo root:

```
node scripts/build-mcpb-bundle.js
```

To build a surface-only bundle:

```
node scripts/build-mcpb-bundle.js --surface game
node scripts/build-mcpb-bundle.js --surface editor
node scripts/build-mcpb-bundle.js --surface interact
```

This creates `dist/mcpb/` with:

- `manifest.json`
- `server.json`
- `.mcpbignore`
- `package.json`
- the full `mcp/` server tree
- `keybindings.json`

Surface builds create `dist/mcpb-game/`, `dist/mcpb-editor/`, or
`dist/mcpb-interact/` and use surface-specific templates when available:

- `mcpb/manifest.<surface>.json`
- `mcpb/package.<surface>.json`
- `mcpb/server.<surface>.json`

Missing surface templates fall back to the generic template for that file.

## Install dependencies (no bundled browsers)

```
cd dist/mcpb
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install --omit=dev
```

## Validate/pack

```
npx @anthropic-ai/mcpb validate
npx @anthropic-ai/mcpb pack dist/lemmings-mcp.mcpb
```

Update `server.json` or `server.<surface>.json` with the release URL and
SHA-256 before publishing.
