# MCP docs

This directory contains the MCP interface spec, implementation notes, and the Zod schema reference.

Files:
- `docs/mcp/lemmings-mcp-interface-spec-memresources.md`
- `docs/mcp/lemmings-mcp-implementation-notes-memresources.md`
- `docs/mcp/lemmings-mcp-zod-schema.ts`

## Server usage
- Start the game server: `npm run start-https` (serves `https://localhost:8080`).
- Start the MCP server: `npm run mcp` (stdio transport).
- Override defaults with environment variables:
  - `LEMMINGS_MCP_BASE_URL` (default `https://localhost:8080`)
  - `LEMMINGS_MCP_PATH` (default `/?e2e=1`)

## Host notes
- Codex CLI: configure a stdio MCP server that runs `node mcp/server.js`.
- Claude Code: configure a stdio MCP server that runs `node mcp/server.js`.
- LM Studio: use stdio with `node mcp/server.js` (HTTP transport is not wired up yet).

## Tool naming
- Tool names are exposed with dots replaced by underscores (for host validation).
  Example: `session.create` becomes `session_create` (full tool: `lemmings.session_create`).

## Smoke test checklist
- `session.create` returns a session id and `ready=true`.
- `state.get` returns a snapshot with `game.timer.tickIndex`.
- `input.action` with `togglePause` toggles `game.timer.running`.
- `lemming.summary` returns counts and selected lemming data.
- `vision.capture` returns a resource URI and `resources/read` can fetch it.
- `session.close` cleans up without errors.
