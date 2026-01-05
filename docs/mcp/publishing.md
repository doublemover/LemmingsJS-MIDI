# MCP publishing

This repo ships a stdio MCP server (`mcp/server.js`) and is prepared for MCPB
bundles plus GitHub registry publication. Streamable HTTP is not wired up yet.

## Bundle layout

The MCPB bundle uses the repo root as the runtime base:

- `mcp/server.js` (stdio server entry)
- `mcp/spectator.html` (optional spectator UI)
- `keybindings.json` (tool input mappings)

Use the MCPB bundle templates in `mcpb/` and build a staging bundle with:

```
node scripts/build-mcpb-bundle.js
```

This creates `dist/mcpb/` with the files and templates needed for `mcpb`.

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

```
cd dist/mcpb
npx @anthropic-ai/mcpb validate
npx @anthropic-ai/mcpb pack dist/lemmings-mcp.mcpb
```

## GitHub registry publish checklist

1. Create a GitHub release (tag `vX.Y.Z`) and upload the `.mcpb` asset.
2. Compute SHA-256 for the `.mcpb` file.
3. Update `mcpb/server.json` with the release URL and SHA-256.
4. Publish with the MCP registry tooling (manual for now).

See `mcpb/README.md` and `mcpb/server.json` for the exact fields and placeholders.
