# MCP docs

This directory contains the MCP interface spec, implementation notes, and the Zod schema reference.

Files:
- `docs/mcp/lemmings-mcp-interface-spec-memresources.md`
- `docs/mcp/lemmings-mcp-implementation-notes-memresources.md`
- `docs/mcp/lemmings-mcp-zod-schema.ts`
- `docs/mcp/protocol-v2.md`
- `docs/mcp/editor-apply.md`
- `docs/mcp/protocol-mappings.json`
- `docs/mcp/call-examples.md`
- `docs/mcp/publishing.md`

## Server usage
- Start the game server: `npm run start-https` (serves `https://localhost:8080`).
- Start the MCP server: `npm run mcp` (stdio transport).
- Override defaults with environment variables:
  - `LEMMINGS_MCP_BASE_URL` (default `https://localhost:8080`)
  - `LEMMINGS_MCP_PATH` (default `/?e2e=1`)
  - `LEMMINGS_MCP_SURFACES` (optional CSV of enabled tool surfaces:
    `game,editor,interact`; default enables all)

## Host notes
- Codex CLI: configure a stdio MCP server that runs `node mcp/server.js`.
- Claude Code: configure a stdio MCP server that runs `node mcp/server.js`.
- LM Studio: use stdio with `node mcp/server.js` (HTTP transport is not wired up yet).
- Claude Desktop: configure a stdio MCP server that runs `node mcp/server.js`.
- VS Code: configure a stdio MCP server that runs `node mcp/server.js`.

## Client compatibility tracking
- Matrix: `docs/mcp/client-compatibility.json`
- Examples: `docs/mcp/config-examples/`
- Check: `npm run check-mcp-clients`

## Publishing
- MCPB templates: `mcpb/`
- Publishing steps: `docs/mcp/publishing.md`

## Tool naming
- Tool names are exposed with dots replaced by underscores (for host validation).
  Example: `state.get` becomes `state_get` (full tool: `lemmings.state_get`).
- Short underscore tool names are the only supported call names.
- MCP calls use the shipped underscore tool names exactly.

## Tool surfaces
- `game`: `session.*`, `time.*`, `state.*`, `lemming.*`, `skill.*`
- `editor`: `editor.apply`, `objects.list`, `objects.place`,
  `objects.update`, `objects.delete`
- `interact`: `input.*`, `vision.*`, `watch.*`, `events.*`
- Surface gating is controlled via `LEMMINGS_MCP_SURFACES`.

## Defaults (protocol v2)
- `state.get` defaults to the compact preset.
- Events default to `minimal` (only non-agent, trimmed fields).
- `session.create.protocol` includes versioning and hard-cut tool naming metadata.

## Smoke test checklist
- `session.create` returns a session id and `ready=true`.
- `state.get` returns a snapshot with `game.timer.tickIndex`.
- `state.delta` returns at least one delta (or an empty array when no changes).
- `input.action` with `togglePause` toggles `game.timer.running`.
- `lemming.summary` returns counts and selected lemming data.
- `vision.capture` returns a resource URI and `resources/read` can fetch it.
- `session.close` cleans up without errors.
