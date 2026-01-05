# MCP call examples (short tool names)

These examples use the short tool names (dots replaced with underscores) and the
compact `state.get` preset defaults.

## Create a session with minimal events

```json
{
  "headless": true,
  "events": { "mode": "minimal" }
}
```

## Get a compact snapshot with lemming summary

```json
{
  "sessionId": "<id>",
  "preset": "compact",
  "lemmings": { "mode": "summary", "topK": 8, "includeSelected": true }
}
```

## Get deltas since last state.get (no x/y churn)

```json
{
  "sessionId": "<id>",
  "lemmings": { "includeXY": "none" }
}
```

## Apply a skill with semantic verification

```json
{
  "sessionId": "<id>",
  "skill": "builder",
  "lemmingId": 12,
  "requireAvailable": true,
  "verify": true
}
```

## Apply editor ops (create terrain + export)

```json
{
  "sessionId": "<id>",
  "ops": [
    { "type": "level.new", "args": { "header": { "TITLE": "Demo", "STYLE": "dirt" } } },
    { "type": "entry.add", "args": { "kind": "terrain", "props": { "PIECE": 1, "X": 120, "Y": 80 } } },
    { "type": "level.export", "args": { "format": "nxlv", "filename": "demo.nxlv" } }
  ],
  "preview": { "refresh": true },
  "returnState": "editor"
}
```

## Debug: full state as a resource

```json
{
  "sessionId": "<id>",
  "preset": "debug",
  "lemmings": { "mode": "all", "max": 80 },
  "format": { "delivery": "resource", "pretty": true }
}
```
