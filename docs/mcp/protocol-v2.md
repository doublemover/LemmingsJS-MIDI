# MCP protocol v2 (token-lean)

This document captures the next MCP iteration focused on compact defaults and
incremental updates. It is intended to be used alongside the interface spec and
implementation notes in this folder.

## Defaults

- Responses are compact (no pretty JSON) unless `format.pretty=true`.
- `state.get` defaults to the compact preset.
- Events are minimal by default (`events.mode=minimal`), and tool
  responses include only non-agent events with trimmed fields.
- Tool names are short (dots mapped to underscores by hosts), and only the
  short underscore forms are accepted.

## Protocol mappings

- `protocol.skillNames` is returned on `session.create`.
- `protocol.lemmingDeltaFields` is returned on `session.create`.
- The mappings are stored in `docs/mcp/protocol-mappings.json`.

## state.get (compact preset)

- Returns only the essential game sections: timer, victory, level, skills,
  lemmingManager, and lemming summary (when requested).
- Lemming output defaults to `summary` mode when no explicit lemmings mode is
  provided.

## state.delta

- New tool for returning filtered history deltas.
- Defaults to changes since the last `state.get` tick.
- Supports filtering lemming fields and excluding x/y motion churn.

## Events

- `session.create.events.mode` controls event verbosity.
- `minimal` includes only non-agent events with compact fields.
- `none` suppresses event envelopes entirely; clients can poll explicitly.

## Skill application verification

- `skill.apply` can be configured to require availability and verify with
  skill-specific fields rather than full object diffs.
- Skill counts clamp non-finite values (e.g., Infinity) to JSON-safe values.
