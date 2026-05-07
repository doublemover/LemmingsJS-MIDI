# MCP call examples (short tool names)

These examples use the short tool names (dots replaced with underscores) and the
compact `state.get` preset defaults.

Available tool sets by surface:
- `game`: `session_create`, `session_close`, `time_pause`, `time_resume`,
  `time_step`, `state_get`, `state_delta`, `lemming_summary`,
  `lemming_select`, `skill_apply`
- `editor`: `editor_apply`, `objects_list`, `objects_place`,
  `objects_update`, `objects_delete`
- `interact`: `input_action`, `input_keys`, `vision_capture`,
  `vision_captureSequence`, `watch_create`, `watch_cancel`, `events_poll`

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

## List editor objects with paging + revision delta

```json
{
  "sessionId": "<id>",
  "kind": "terrain",
  "page": 0,
  "pageSize": 50,
  "fields": "compact",
  "sinceRevision": 12
}
```

## Place, update, and delete editor objects via typed tools

```json
{
  "sessionId": "<id>",
  "objects": [
    {
      "kind": "terrain",
      "piece": 1,
      "x": 120,
      "y": 80
    }
  ],
  "options": {
    "returnState": "editor"
  }
}
```

```json
{
  "sessionId": "<id>",
  "updates": [
    {
      "ref": { "kind": "terrain", "uid": "t_123" },
      "set": { "X": 140, "Y": 88 }
    }
  ],
  "options": {
    "returnState": "editor"
  }
}
```

```json
{
  "sessionId": "<id>",
  "refs": [
    { "kind": "terrain", "uid": "t_123" }
  ]
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
