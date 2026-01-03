# LemmingsJS MCP Implementation Notes (Playwright + MCP SDK/Inspector + In‑Memory Resources)

This document is the “how to build it” companion to the interface spec. It focuses on practical implementation choices, recommended dependencies, and development workflow using the MCP SDK + Inspector.

---

## 1) Recommended architecture

### Processes
- **MCP server (Node/TS)**
  - Owns Playwright browser instances / pages
  - Implements MCP tools + resources
  - Hosts optional spectator website (HTTP + WS)
- **Game server**
  - `npm run start-https` (already in repo) serving `https://localhost:8080`

### Data flow
- Tools call into a per-session controller:
  - `controller.evalE2E(fn)` for harness operations
  - `controller.pressAction(name)` for keybindings
  - `controller.capture()` for screenshots (into resource store)
- Every tool call returns:
  - structured output + an `events` envelope (new events since last call)

---

## 2) Key dependencies to accelerate development

### MCP server SDK
Use the v1 SDK package (`@modelcontextprotocol/sdk`) for this project.

- This is the stable track and works with Codex CLI and Claude Code via stdio.
- LM Studio can use stdio or HTTP; prioritize stdio first, then add an optional
  HTTP wrapper if needed.
- The v2 split packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`)
  are still pre-alpha, so avoid them for now. Add a small adapter layer so a
  future migration is straightforward.

### Host compatibility notes
- **Codex CLI**: stdio MCP server is the default integration path.
- **Claude Code**: stdio MCP server is the expected integration path.
- **LM Studio**: accept stdio or HTTP; document both in the MCP server README.

### MCP Inspector
Use Inspector for rapid tool iteration and resource debugging.

Useful commands from official docs:
- UI mode:  
  `npx @modelcontextprotocol/inspector node build/index.js`
- CLI mode:  
  `npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list`  
  `npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/call --tool-name lemmings.state.get --tool-arg sessionId=...`

(See the official Inspector docs and GitHub readme for flags like `-e key=value`, custom ports, etc.)

### Browser automation
- `playwright` (already in repo via `@playwright/test`)
  - Use `chromium.launch()` for the MCP server rather than the test runner.
  - Reuse the existing HTTPS base URL + ignore cert errors.

### Spectator website
- `express` (or `fastify`) for HTTP
- `ws` for WebSocket
- (Optional) `sirv` or `serve-static` for static assets

### Utilities
- `zod` for tool arg validation (already required by MCP SDK patterns)
- `nanoid` or `uuid` for resource IDs and event IDs
- (Optional) `lru-cache` for quick resource-store implementation, or hand-roll a tiny LRU

---

## 3) Playwright integration details

### Launch settings (recommended defaults)
- Chromium
- `ignoreHTTPSErrors: true` (repo uses localhost certs)
- `--allow-insecure-localhost`
- Consider `headless:false` when debugging skill application and selection.

### Loading the game with harness
- Navigate to: `https://localhost:8080/?e2e=1`
- Wait for readiness:
  - `await page.waitForFunction(() => window.__E2E__?.getState?.().ready === true)`

### Calling harness methods
Use `page.evaluate` with small, stable calls:
- `page.evaluate(() => window.__E2E__.getState())`
- `page.evaluate((n) => window.__E2E__.step(n), count)`

**Avoid** passing large closures or game objects across the boundary.

### Focus management (important for keyboard shortcuts)
Before sending keys, ensure the game receives them:
- Click the game canvas once (or focus a known root element) on session start.
- If inputs become flaky, re-focus before each input burst.

---

## 4) Implementing direct lemming selection

### Preferred: extend the E2E harness
Add to `createE2EApi` in `js/app/e2eHarness.js`:

- `selectLemmingById(id)` → boolean

Implementation should:
- obtain manager
- `const lem = manager.getLemming(id)`
- validate `!lem.removed && !lem.disabled`
- call `manager.setSelectedLemming(lem)`

This keeps selection semantics consistent with the game.

### Server tool behavior
`lemmings.lemming.select` should:
1. read current state (optional)
2. call `__E2E__.selectLemmingById(id)`
3. if `confirm=true`, read state again and confirm `selectedIndex === id`

---

## 5) Skill application via keyboard shortcuts

### Mapping skills → keybinding actions
Use `keybindings.json` (repo root) as source of truth.
Example mapping:
- `builder` → `selectSkillBuilder`
- `basher` → `selectSkillBasher`
- ...
- apply → `applySkillToSelected`

### Implementation pattern (`lemmings.skill.apply`)
1. optionally pause (harness)
2. optionally select lemming by id
3. send action for `selectSkillX`
4. send action for `applySkillToSelected`
5. optionally `step(1)` to let it take effect
6. read state (optional) for verification

### Normalizing key chords for Playwright
The repo’s keybindings use tokens like `Ctrl+KeyC`. Playwright commonly uses `Control+KeyC`.
Normalize modifier aliases:
- `Ctrl` → `Control`
- `Cmd`/`Command` → `Meta`
- Keep `Shift`, `Alt` as-is

---

## 6) In-memory resource store (images + big JSON)

### What to store as resources
- Screenshots (png/jpeg/webp)
- Long state snapshots
- Sequence manifests (JSON)
- Debug artifacts

### Suggested interface
- `put({ mimeType, bytes, meta, ttlMs? }) -> { uri, sizeBytes, expiresAt? }`
- `get(uri) -> { mimeType, bytes, meta } | null`
- `evictIfNeeded()` LRU by bytes/items

### Practical defaults
- `maxBytes`: 256 MB (tune later)
- `ttlMs`: 10 minutes for frames
- `maxItems`: 5000 (prevents pathological event spam)

### MCP resource handlers
Implement:
- `resources/list` (optional; can return empty or just recent)
- `resources/read` (required for `lemmings://...` URIs)

---

## 7) Vision capture implementation

### Single capture
Use Playwright screenshots:
- Full page: `page.screenshot({ type: "png" })`
- Element: `locator.screenshot()`
- Cropped: `page.screenshot({ clip: { x,y,width,height } })`

For `gameCanvas` / `guiCanvas`:
- locate the element
- get bounding box
- if `rect` provided, compute clip = bbox + rect

Store bytes in resource store and return the resource URI.

### Sequence capture
For deterministic sequences:
- pause
- for i in frames:
  - capture
  - step(stepBy)

Return:
- list of frame resource URIs
- optional manifest JSON resource:
  - `{ sequenceId, frames:[{uri,tickIndex,clip,...}], createdAt }`

---

## 8) Watches (every X ticks / on change)

### Implementation approach
Because Playwright doesn’t “tick” the game for you, watches should be implemented as:
- A small loop (setInterval) that polls `getState()` at a safe cadence
- If you need tick-accurate watch triggers, run the game paused and advance via `step()`.

Watch types:
- `everyTicks`: triggered when `(tickIndex - lastTick) >= everyTicks`
- `onChange`: evaluate JSON pointer; trigger when value differs from last

Watch actions:
- emit summary event (lemmings + selected + any pointers)
- capture frame (throttled)

All watch triggers write into the session event queue.

---

## 9) Human spectator website (local)

### Minimal viable spectator
- Start an HTTP server on `localhost:{port}`
- Serve a page that:
  - connects to WS
  - shows latest frame (as `<img src="data:...">` OR fetches resource URI via a server endpoint)
  - shows event log (inputs, captures)

### Human interaction relay (optional, opt-in)
If `allowHumanInput=true`:
- Web UI captures keydown/mousedown/mousemove and sends over WS
- MCP server replays these into Playwright:
  - keyboard events → `page.keyboard.down/up/press`
  - mouse events → `page.mouse.move/click`

### “Next MCP response notifies agent” behavior
- Any human input should enqueue events with `source="human"`.
- Every MCP tool call should include an `events` envelope with:
  - new human events since last tool call
  - a condensed `humanSummary` (e.g. “Human pressed Space (pause) and ArrowRight x3”)

This works even when the host isn’t consuming streaming notifications.

---

## 10) Development workflow with MCP Inspector

### Why Inspector matters
Inspector gives you:
- a live tool runner UI
- schema visualization for inputs
- resource browsing (if you implement list/read)
- request history, and fast iteration

### Typical loop
1. Run game server: `npm run start-https`
2. Run MCP server (stdio): `npm run mcp` (your script)
3. Run Inspector:
   - UI mode: `npx @modelcontextprotocol/inspector node build/index.js`
   - CLI mode for quick tests:
     - `... --method tools/list`
     - `... --method tools/call --tool-name ...`

---

## 11) Suggested implementation order
1. MCP server skeleton + stdio transport
2. Session create/close + Playwright boot + wait ready
3. State read (`state.get`) + basic events envelope
4. Keybindings loader + `input.action`
5. Direct selection by ID (`lemming.select`) (plus harness method)
6. Skill apply
7. Vision capture to in-memory resources
8. Sequence capture + manifest
9. Event polling tool
10. Spectator UI + human input relay
11. Watches

---

## 12) Common pitfalls
- **Inputs not landing**: focus the canvas/root element before keyboard events.
- **Resource bloat**: enforce LRU eviction + TTL early.
- **Flaky timing**: prefer paused + `step()` for deterministic behavior.
- **Key chord mismatch**: normalize `Ctrl`→`Control`, etc.
