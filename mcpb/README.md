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
- `mcp/server.js`, `mcp/spectator.html`
- `keybindings.json`

Surface builds create `dist/mcpb-game/`, `dist/mcpb-editor/`, or
`dist/mcpb-interact/` and use `mcpb/manifest.<surface>.json` plus
`mcpb/package.<surface>.json`.

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

Update `server.json` with the release URL and SHA-256 before publishing.
