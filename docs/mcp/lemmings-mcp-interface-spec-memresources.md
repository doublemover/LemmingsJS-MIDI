# LemmingsJS MCP Interface Spec (Playwright + Keyboard-First + In‑Memory Resources)

This document defines a **practical MCP (Model Context Protocol) interface** for an agent to (1) control the LemmingsJS-MIDI game reliably using **existing keyboard shortcuts**, (2) **select a specific lemming by ID** and apply a skill, (3) query **structured state** (individual + aggregate lemming summaries), and (4) request **images** of the full game or subregions **on demand**, **every X ticks**, **as a sequence**, or **when a value changes**.

It assumes the game is launched with the existing **E2E harness** enabled (`?e2e=1`), exposing `window.__E2E__` for state snapshots and deterministic time control.

---

## 1) Design goals

### Primary goals
- **Deterministic agent control**
  - Use the E2E harness for time control (pause/resume/step/seek) and state reads.
  - Use **existing keyboard shortcuts** to perform all in-game actions.
- **Direct lemming targeting**
  - Select a lemming by `id` (not “nearest to cursor”) and apply a skill.
- **High-signal state access**
  - Fast, structured summaries for agent reasoning.
  - Optional full per-lemming details when needed.
- **Vision when it helps**
  - Capture images via Playwright (`page.screenshot()` / element screenshots).
  - Support: whole view, cropped rect, “every X ticks”, “when value changes”, and short sequences.
- **Human spectator mode**
  - A local website shows the game evolving (frame snapshots) while the agent plays.
  - The human can interact (keyboard/mouse). The next MCP response (when not streaming)
    includes a **summary of human-driven changes** since the last agent call.

### Non-goals (v1)
- Re-implementing game logic in the server.
- Perfect “semantic vision” (e.g., object detection). Images are provided; interpretation is up to the agent.
- Lossless long-term video storage. (We provide in-memory frames + optional export hooks.)

### Target MCP hosts
- Codex CLI (stdio)
- Claude Code (stdio)
- LM Studio (stdio or HTTP; document both)

---

## 2) Key assumptions from the current codebase

### E2E harness (already present)
When the game is loaded with `?e2e=1`, `window.__E2E__` exposes:
- `getState()` → JSON-safe snapshot
- `pause()`, `resume()`, `step(count)`, `seek(tickIndex)`
- `setSpeed(factor)`, `toggleReverse()`, `startReverse()`, `stopReverse()`
- `getBuffer(name)` → heavy buffers (mask, minimap, etc.)

### Keyboard shortcuts (already present)
`keybindings.json` maps action names (e.g. `selectSkillBuilder`) to key chords.
The MCP server must load this mapping and provide:
- A way to run a named action (`input.action`)
- A way to run arbitrary key events (`input.keys`)

### Missing piece we add: select lemming by ID
The agent needs a direct selection primitive, independent of cursor position.

**Minimum required game-side addition (recommended):**
Add to `window.__E2E__`:

- `selectLemmingById(id: number): boolean`

Implementation should:
- Resolve `const manager = view?.game?.getLemmingManager?.()`
- Resolve `const lem = manager?.getLemming(id)`
- If exists + not removed/disabled: call `manager.setSelectedLemming(lem)` and return `true`, else return `false`.

This is intentionally tiny and uses the game’s own selection method (`setSelectedLemming`), not a raw assignment.

> If you truly cannot change game code, you can still implement selection by `page.evaluate` and directly calling `lemmings.game.lemmingManager.setSelectedLemming(...)`, but wiring it into `__E2E__` is cleaner and more stable.

---

## 3) Sessions, ticks, and determinism

### Session model
An MCP “session” represents:
- One Playwright browser context + page running the game
- A resource store (in-memory) for screenshots / large JSON blobs
- An event queue (human + agent + system) for diffs and notifications

All tools take a `sessionId`.

### Tick model
- `tickIndex` is the authoritative simulation time unit (from `__E2E__.getState().game.timer.tickIndex`).
- Deterministic sequences should:
  - `pause()`
  - apply inputs
  - `step(n)` as needed
  - take snapshots / screenshots
  - optionally `resume()`

---

## 4) Resources: memory-backed by default

### Why resources
Screenshots and large state dumps are too big/noisy to inline in tool results.

### Policy (default)
- **Images**: returned as **resource URIs** (`lemmings://...`) stored in an in-memory resource store.
- **State**: returned inline by default, but can be returned as a resource when large.
- **Sequences**: frames returned as resource URIs; optionally also return a manifest JSON resource listing all frames.

### Resource URI format
Recommended URI scheme:

- `lemmings://sessions/{sessionId}/resources/{resourceId}`

The MCP server must implement `resources/read` for these URIs.

### Resource lifecycle
- In-memory store has:
  - `maxBytes` budget (LRU eviction)
  - optional per-item TTL
  - optional `maxItems`
- Tool responses include `expiresAt` when applicable so the agent can read/copy promptly.

---

## 5) Eventing and “human changed something” summaries

### Event queue
Each session maintains a ring buffer of events:
- `source`: `agent` | `human` | `system`
- `type`: `input` | `state-change` | `watch-trigger` | `capture` | `error`
- `tickIndex` (if known)
- `summary` + optional structured `data`
- optional `resourceUris`

### Non-streaming requirement
If the MCP host is not consuming streaming notifications, then:

**Every tool response SHOULD include an `events` envelope** with:
- new events since the last tool call in that session
- a condensed `humanSummary` if any human inputs occurred

Additionally, the agent can call `events.poll` for explicit polling.

---

## 6) Tool names and responsibilities

### High-level tool groups
Note: the MCP server exposes tool names with dots replaced by underscores
(`session.create` → `session_create`) to satisfy host naming constraints. The
canonical names below are dotted; use underscores when calling (full tool:
`lemmings.session_create`).

### High-level tool groups
- **Session**: `session.*`
- **Time**: `time.*`
- **State**: `state.*`, `lemming.*`
- **Input**: `input.*`, `skill.*`
- **Vision**: `vision.*`
- **Events / Watches**: `events.*`, `watch.*`

---

## 7) Tool specifications

Below, every tool defines:
- Inputs (structured args)
- Outputs (structured result; images/state may be resources)
- Default behavior
- Failure modes

### 7.1 `session.create`
Create a new session and launch the game page.

**Inputs**
- `baseUrl` (optional): default `https://localhost:8080`
- `path` (optional): default `/?e2e=1`
- `headless` (optional): default `true` (set `false` for visible debugging)
- `viewport` (optional): `{ width, height, deviceScaleFactor? }`
- `enableSpectator` (optional): default `false`
- `spectator` (optional): `{ port?, allowHumanInput?, openBrowser? }`
- `resources` (optional): `{ maxBytes?, ttlMs?, maxItems? }`
- `events` (optional): `{ maxEvents? }`

**Outputs**
- `sessionId`
- `gameUrl` (resolved full URL)
- `spectatorUrl` (if enabled)
- `keybindings` summary: `{ version, actions: string[] }`
- `warnings` (if any)

**Notes**
- Must wait until `__E2E__.getState().ready === true` before returning.

---

### 7.2 `session.close`
Close page/context and delete session resources/events.

**Inputs**
- `sessionId`

**Outputs**
- `{ ok: boolean }`

---

### 7.3 `time.pause` / `time.resume`
Deterministic time control (calls `__E2E__.pause()` / `resume()`).

**Inputs**
- `sessionId`

**Outputs**
- `{ ok: boolean, tickIndex?: number }`

---

### 7.4 `time.step`
Step the simulation forward (or backward if negative) by N ticks.

**Inputs**
- `sessionId`
- `count` (integer, can be negative)
- `ensurePaused` (optional, default `true`)

**Outputs**
- `{ ok: boolean, tickIndexBefore, tickIndexAfter }`

**Failure modes**
- returns `{ ok:false }` if harness is missing/not ready.

---

### 7.5 `state.get`
Return structured state snapshot (from `__E2E__.getState()`), optionally filtered.

**Inputs**
- `sessionId`
- `include` (optional object):
  - `view?: boolean`
  - `stage?: boolean`
  - `game?: boolean` (default `true`)
  - `editor?: boolean`
  - `midi?: boolean`
- `lemmings` (optional):
  - `mode`: `"none" | "summary" | "all" | "ids"`
  - `ids?: number[]` (if mode = `ids`)
  - `max?: number` (cap returned lemmings for `all`)
- `format` (optional):
  - `delivery`: `"inline" | "resource"` (default `"inline"`)
  - `pretty`: boolean (default `false`)

**Outputs**
- If `delivery="inline"`:
  - `{ snapshot: <object>, sizeBytesEstimate }`
- If `delivery="resource"`:
  - `{ resourceUri, mimeType:"application/json", sizeBytes, expiresAt? }`

**Notes**
- Even in `inline`, the server may omit huge fields unless explicitly requested.
- This tool should include an `events` envelope by default.

---

### 7.6 `lemming.summary`
Agent-friendly lemming summary computed from `getState().game.lemmings`.

**Inputs**
- `sessionId`
- `filter` (optional):
  - `activeOnly?: boolean` (default true)
  - `inViewOnly?: boolean` (default false)
  - `rectWorld?: { x, y, w, h }` (optional; uses `stage.viewRect` coordinates)
- `topK` (optional): include a small sample of lemmings (default `10`)
- `includeSelected` (optional, default `true`)

**Outputs**
- Counts:
  - `tickIndex`
  - `selectedLemmingId`
  - `totalCount`, `activeCount`, `removedCount`, `disabledCount`
- Histograms:
  - `byActionType` (record)
  - `byState` (record)
- Ability tallies:
  - `climbers`, `floaters`, `countingDown`, `exploded`
- Samples:
  - `selected` (full lemming object if selected + exists)
  - `top` (array of lemmings, best-effort meaningfully chosen)
- `events` envelope

---

### 7.7 `lemming.select`
Directly select a specific lemming by ID.

**Inputs**
- `sessionId`
- `lemmingId` (number)
- `alsoCenterView` (optional, default `false`)  
  If true, the server may pan the view so the selected lemming is visible (best-effort).
- `confirm` (optional, default `true`)  
  If true, re-read state and confirm `selectedIndex === lemmingId`.

**Outputs**
- `{ ok, lemmingId, selectedNow?: number, reason?: string, events }`

**Failure modes**
- `ok=false` with `reason="not_found" | "removed" | "disabled" | "harness_unavailable"`.

---

### 7.8 `skill.apply`
Apply a skill to a selected lemming using keyboard shortcuts.

**Inputs**
- `sessionId`
- `skill`: `"climber"|"floater"|"bomber"|"blocker"|"builder"|"basher"|"miner"|"digger"`
- `lemmingId` (optional)
  - If provided, the server must select it first (via `lemming.select`).
- `ensurePaused` (optional, default `true`)
- `verify` (optional, default `true`)
  - If true, server reads state before/after and reports whether the lemming’s state/flags changed.

**Default behavior**
1. `pause()` if requested
2. If `lemmingId` provided → select it
3. Press the keybinding for `selectSkillX`
4. Press the keybinding for `applySkillToSelected`
5. Optionally `step(1)` (configurable) to let the command apply
6. Return a compact verification summary

**Outputs**
- `{ ok, skill, lemmingIdAppliedTo, tickIndexBefore, tickIndexAfter, verification?, events }`

---

### 7.9 `input.action`
Execute a named action from `keybindings.json` (e.g., `nuke`, `releaseRateUpMax`).

**Inputs**
- `sessionId`
- `action` (string; must exist in loaded keybindings)
- `repeat` (optional, default `1`)

**Outputs**
- `{ ok, action, repeat, events }`

---

### 7.10 `input.keys`
Low-level key event injection (for chords and “hold shift” behaviors like panBoost).

**Inputs (two supported shapes)**

**A) Simple presses**
- `sessionId`
- `keys`: string[] (e.g. `["Shift+KeyT", "KeyK"]`)
- `repeat` (optional, default `1`)

**B) Explicit key events**
- `sessionId`
- `events`: array of:
  - `{ type:"down"|"up"|"press", key:string }`
  - Example: `[{type:"down", key:"Shift"}, {type:"press", key:"ArrowLeft"}, {type:"up", key:"Shift"}]`

**Outputs**
- `{ ok, eventsInjected, events }`

---

### 7.11 `vision.capture`
Capture a screenshot of the full view or a subsection.

**Inputs**
- `sessionId`
- `target`:
  - `"page"` (default)
  - `"gameCanvas"`
  - `"guiCanvas"`
  - `"rect"`
- `rect` (optional):
  - For `"page"`/`"rect"`: rect is in page CSS pixels
  - For `"gameCanvas"`/`"guiCanvas"`: rect is relative to element top-left (CSS pixels)
  - Shape: `{ x, y, width, height }`
- `format` (optional): `"png"|"jpeg"|"webp"` (default `"png"`)
- `delivery` (optional): `"resource"|"inline"` (default `"resource"`)
- `tag` (optional): string (stored in resource metadata)

**Outputs**
- If `delivery="resource"`:
  - `{ frame: { resourceUri, mimeType, width, height, clip?, tickIndex?, tag?, expiresAt? }, events }`
- If `delivery="inline"`:
  - `{ frame: { mimeType, dataBase64, width, height, clip?, tickIndex?, tag? }, events }`

---

### 7.12 `vision.captureSequence`
Capture multiple frames across time, either by stepping or by sampling.

**Inputs**
- `sessionId`
- `mode`: `"step"` | `"sample"`
  - `"step"`: the server calls `time.step(stepBy)` between frames
  - `"sample"`: the server sleeps real time between frames (less deterministic; use only when needed)
- `frames`: number
- `stepBy` (optional, default `1`, used for mode=`step`)
- `everyMs` (optional, used for mode=`sample`)
- `capture`: same capture options as `vision.capture`
- `returnManifest` (optional, default `true`): store a manifest JSON as a resource

**Outputs**
- `{ sequenceId, frames: FrameDescriptor[], manifestResourceUri?, events }`

---

### 7.13 `watch.create`
Create a watch that emits events when:
- every `everyTicks`, OR
- when a JSON pointer value changes

Watches are processed server-side (polling `getState()`), and generate events in the session event queue.

**Inputs**
- `sessionId`
- `watch`:
  - `type`: `"everyTicks" | "onChange"`
  - If `"everyTicks"`: `{ everyTicks:number }`
  - If `"onChange"`: `{ jsonPointer:string }` (e.g. `/game/victory/outCount`)
- `actions`: array of:
  - `{ type:"emitSummary", include?:{ lemmingsSummary?:boolean, statePointers?:string[] } }`
  - `{ type:"capture", capture:<vision.capture args>, throttleTicks?:number }`
- `enabled` (optional, default `true`)

**Outputs**
- `{ watchId, ok, events }`

---

### 7.14 `watch.cancel`
Cancel a watch.

**Inputs**
- `sessionId`
- `watchId`

**Outputs**
- `{ ok }`

---

### 7.15 `events.poll`
Explicitly poll for events since a cursor.

**Inputs**
- `sessionId`
- `after` (optional): cursor string; if omitted, returns recent events

**Outputs**
- `{ cursor, events:[...], humanSummary? }`

---

## 8) Output conventions

### 8.1 All tool results
Every tool result should include (when non-empty):
- `events`: `{ cursor, events:[...], humanSummary? }`

This satisfies the “human can interact and the next response tells the agent” requirement even when the host does not support streaming.

### 8.2 Errors
Tool errors should be expressed as structured `ok=false` responses wherever possible, reserving MCP protocol errors for truly exceptional conditions (session missing, browser crashed, etc.).

---

## 9) Security and safety constraints
- The MCP server controls a local browser; do not expose it broadly without auth.
- The spectator UI should default to localhost-only binding.
- Human input relay must be opt-in (`allowHumanInput`).

---

## 10) Minimal implementation checklist (what to build first)
1. **Session + Playwright boot**
   - launch, goto `/?e2e=1`, wait for `ready`
2. **State read**
   - `state.get`
3. **Input actions**
   - load `keybindings.json`
   - `input.action`
4. **Direct selection**
   - add `__E2E__.selectLemmingById`
   - `lemming.select`
5. **Skill apply**
   - `skill.apply` = select skill + apply key
6. **Vision**
   - `vision.capture` (resource by default)
7. **Event envelope + spectator UI**
   - event queue
   - simple webpage showing latest frame
   - record human inputs + summarize on next tool call
