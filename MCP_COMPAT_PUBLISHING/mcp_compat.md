*README “MCP client compatibility” section**, plus **example config files** for each host and a **GitHub Actions conformance workflow stub**.


## README section text (copy/paste)

````md
## MCP client compatibility (Codex, Claude, VS Code, and more)

This repo ships an MCP server at `mcp/server.js`.

- **Current transport:** `stdio` (local child-process MCP server)
- **Browser target:** your running game instance (default `https://localhost:8080/?e2e=1`)

If you want to keep LLM tooling compatible across clients, the simplest rule is:

- **Provide a solid stdio server** (works everywhere)
- **Optionally add Streamable HTTP** later for “remote MCP” clients and for conformance testing

### Quick start

1. Start the game server (HTTPS is recommended):

   ```bash
   npm run start-https
````

2. Start the MCP server (stdio):

   ```bash
   npm run mcp
   ```

3. Override defaults (optional):

   * `LEMMINGS_MCP_BASE_URL` (default `https://localhost:8080`)
   * `LEMMINGS_MCP_PATH` (default `/?e2e=1`)

---

## Codex (OpenAI)

Codex supports MCP servers over **stdio** and **Streamable HTTP**. Use stdio for this repo today.

### Option A: add via the Codex CLI

```bash
# Basic
codex mcp add lemmings -- node /absolute/path/to/LemmingsJS-MIDI/mcp/server.js

# With env overrides
codex mcp add lemmings \
  --env LEMMINGS_MCP_BASE_URL=https://localhost:8080 \
  --env LEMMINGS_MCP_PATH=/?e2e=1 \
  -- node /absolute/path/to/LemmingsJS-MIDI/mcp/server.js
```

### Option B: edit `~/.codex/config.toml`

See `docs/mcp/config-examples/codex-cli.toml`.

---

## Claude Desktop

Claude Desktop runs MCP servers configured in `claude_desktop_config.json` under the `mcpServers` key, using `command` + `args` (stdio).

**Config file locations:**

* macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
* Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Example:

```json
{
  "mcpServers": {
    "lemmings": {
      "command": "node",
      "args": ["/absolute/path/to/LemmingsJS-MIDI/mcp/server.js"],
      "env": {
        "LEMMINGS_MCP_BASE_URL": "https://localhost:8080",
        "LEMMINGS_MCP_PATH": "/?e2e=1"
      }
    }
  }
}
```

If you want “one-click install” for Claude Desktop, consider packaging a Desktop Extension (`.mcpb`).

---

## Claude Code

See `docs/mcp/config-examples/claude-code.json`.

Tip: Claude Code supports project-scoped MCP configs in `.mcp.json` and can expand environment variables inside the config.

---

## VS Code (Copilot Chat)

VS Code MCP servers are configured in `.vscode/mcp.json` (workspace) or in your user profile `mcp.json`.

### Minimal stdio config (`.vscode/mcp.json`)

```json
{
  "servers": {
    "lemmings": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/mcp/server.js"],
      "env": {
        "LEMMINGS_MCP_BASE_URL": "https://localhost:8080",
        "LEMMINGS_MCP_PATH": "/?e2e=1"
      }
    }
  }
}
```

Tip: VS Code supports `envFile` and interactive `inputs` so you don’t hardcode secrets.

Tip: VS Code can browse and install MCP servers from the GitHub MCP registry; consider publishing there if you want easy discovery.

---

## mcp-remote (bridge for “remote MCP” servers)

If a client only supports **stdio** but you need to connect to a **remote** MCP server (HTTP/SSE/Streamable HTTP + OAuth), use `mcp-remote`.

Example (Claude Desktop / any stdio-only client):

```json
{
  "mcpServers": {
    "remote-example": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "https://remote.mcp.server/sse",
        "--header",
        "Authorization:Bearer ${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer <token>"
      }
    }
  }
}
```

**Gotcha (Windows / some clients):** spaces inside a `--header` value can get mangled. Use `Authorization:Bearer ${AUTH_HEADER}` (no space) and put the space inside the env var instead.

---

## CI: conformance testing (requires Streamable HTTP)

The official MCP conformance suite can test a running MCP server by URL:

```bash
npx @modelcontextprotocol/conformance server --url http://localhost:3000/mcp
```

This repo currently focuses on stdio; once you add a Streamable HTTP endpoint, you can run conformance tests in CI.

```

## One extra practical recommendation

If your goal is “it works in whatever client someone tries next week,” prioritize these two things:

1. **Keep stdio working perfectly** (it’s the universal lowest-common-denominator).
2. **Add a Streamable HTTP endpoint when you can**, because (a) more clients are moving toward remote MCP support, and (b) the official conformance runner targets a server URL. 
::contentReference[oaicite:7]{index=7}
```


---

An `.mcpb` (MCP Bundle) is basically a **zip archive** that contains:

* a **`manifest.json`** (required), and
* your **local MCP server implementation + everything it needs to run** (often `server/` + `node_modules/`, plus any assets). ([anthropic.com][1])

Below is the practical “do this” process, with the gotchas that usually bite people.

---

## 1) Pick your bundle layout (Node / Python / binary)

A common Node layout looks like: ([anthropic.com][1])

```text
my-extension.mcpb (zip)
├── manifest.json
├── server/
│   └── index.js
├── node_modules/          # bundled dependencies
├── package.json           # optional, but commonly included
├── icon.png               # optional
└── assets/                # optional
```

Key point: **the bundle must include all runtime dependencies** (for Node that means bundling `node_modules`). ([GitHub][2])

---

## 2) Install the MCPB CLI

You can use it globally or via `npx`:

```bash
npm install -g @anthropic-ai/mcpb
# or just use:
npx @anthropic-ai/mcpb --help
```

The official workflow is:

* `mcpb init` → generates `manifest.json`
* `mcpb pack` → validates + produces `.mcpb` ([anthropic.com][1])

---

## 3) Prepare your server folder so it’s truly “bundleable”

### Node bundles: install production deps only

From the MCPB repo guidance:

* run `npm install --production` (or equivalent) to produce `node_modules`
* bundle the entire `node_modules` directory ([GitHub][2])

I’d typically do:

```bash
npm ci --omit=dev
# or npm install --production (older style)
```

### Gotchas

* **Native addons** (`node-gyp`, `.node` binaries) can break cross‑platform bundles unless you ship per‑platform builds.
* **Playwright/Puppeteer** can make bundles enormous (because browsers download). If you’re using Playwright in your MCP server, explicitly decide whether you are:

  * bundling browsers into the `.mcpb`, or
  * relying on a system browser / separate install step (less “one-click” friendly).

---

## 4) Create `manifest.json` (use the current field names + version)

### Important: the spec evolved

Older examples used fields like `mcpb_version`. The **current spec** (as of last updated 2025‑12‑02) uses:

* `"manifest_version": "0.3"` (or newer if you’re targeting it) ([GitHub][3])

### Minimal Node manifest example (good starting point)

```jsonc
{
  "manifest_version": "0.3",
  "name": "lemmings-mcp",
  "version": "1.0.0",
  "description": "Control LemmingsJS via MCP tools",
  "author": { "name": "Your Name" },
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"]
    }
  }
}
```

This matches the spec’s required shape and the recommended `${__dirname}` substitution for portable paths. ([GitHub][3])

### Why `${__dirname}` matters

If you use relative paths in `args`, things often break depending on where the host unpacks/runs the bundle. The spec explicitly supports `${__dirname}` (bundle install directory). ([GitHub][3])

---

## 5) Add `user_config` for anything the user needs to set (API keys, paths, etc.)

If your server needs input, declare it so the host can render UI and (for sensitive values) store them securely. ([anthropic.com][1])

Example (directories + optional token):

```jsonc
{
  "user_config": {
    "allowed_directories": {
      "type": "directory",
      "title": "Allowed Directories",
      "description": "Directories the server can access",
      "multiple": true,
      "required": true,
      "default": ["${HOME}/Desktop"]
    },
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "Token for optional online features",
      "sensitive": true,
      "required": false
    }
  },
  "server": {
    "mcp_config": {
      "env": {
        "ALLOWED_DIRECTORIES": "${user_config.allowed_directories}",
        "API_KEY": "${user_config.api_key}"
      }
    }
  }
}
```

Notes:

* `sensitive: true` causes the host to treat it like a secret. ([anthropic.com][1])
* If `multiple: true` is used in `args`, values expand to multiple arguments. ([GitHub][3])

---

## 6) Use platform overrides when needed

If Windows needs different commands/env than macOS/Linux, use `platform_overrides` under `mcp_config`. ([GitHub][3])

```jsonc
{
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"],
      "platform_overrides": {
        "win32": {
          "command": "node.exe",
          "env": { "TEMP_DIR": "${TEMP}" }
        },
        "darwin": {
          "env": { "TEMP_DIR": "${TMPDIR}" }
        }
      }
    }
  }
}
```

---

## 7) Pack it into a `.mcpb`

From inside your bundle folder:

```bash
# create manifest interactively
npx @anthropic-ai/mcpb init

# optional speed-run for a minimal manifest
npx @anthropic-ai/mcpb init --yes

# validate + build the .mcpb archive
npx @anthropic-ai/mcpb pack
```

`pack` validates and produces the archive. ([anthropic.com][1])

### Optional: run explicit validation

The MCPB toolchain has a `validate` command (not strictly required if you’re already packing, but helpful in CI). ([GitHub][4])

---

## 8) (Strongly recommended) Add an ignore file to keep the bundle small

The spec mentions `.mcpbignore` (at least explicitly in the UV example), and in practice you want to exclude:

* `.git/`
* tests
* docs
* TS sources if you ship `dist/`
* huge caches (`.cache/`, Playwright downloads, etc.) ([GitHub][3])

Example `.mcpbignore`:

```gitignore
.git/
.github/
.vscode/
**/*.map
**/*.log
test/
tests/
docs/
README.md
```

(Adapt to your project.)

---

## 9) Install & test in Claude Desktop (or any MCPB-capable host)

Claude Desktop flow is:

* open/drag the `.mcpb` into Settings → Extensions
* review prompt and click Install ([anthropic.com][1])

If it fails:

* check extension logs
* run your server entrypoint manually with the same command/args you put in `mcp_config`
* verify every referenced file exists relative to `${__dirname}`

---

## 10) Common “why doesn’t my bundle run?” checklist

* **Wrong manifest version field name** (e.g., using `mcpb_version` when your tooling expects `manifest_version`). The spec calls it `manifest_version`. ([GitHub][3])
* **Paths not portable** → always use `${__dirname}` for entrypoint/asset paths. ([GitHub][3])
* **Forgot to bundle `node_modules`** (or installed only dev deps and packed without prod deps). ([GitHub][2])
* **Server exits immediately** → usually unhandled exception, missing file, missing env var, or it’s not using stdio transport correctly.
* **Cross-platform assumptions** (path separators, `.exe`, env var names) → use `platform_overrides` and `${pathSeparator}` / `${/}` if needed. ([GitHub][3])
* **Huge dependency footprints** (Playwright/browser downloads) → decide how you’re shipping that.

---

[1]: https://www.anthropic.com/engineering/desktop-extensions "Claude Desktop Extensions: One-click MCP server installation for Claude Desktop \ Anthropic"
[2]: https://github.com/modelcontextprotocol/mcpb "GitHub - modelcontextprotocol/mcpb: Desktop Extensions: One-click local MCP server installation in desktop apps"
[3]: https://raw.githubusercontent.com/anthropics/dxt/refs/heads/main/MANIFEST.md "raw.githubusercontent.com"
[4]: https://github.com/anthropics/mcpb/releases "Releases · modelcontextprotocol/mcpb · GitHub"

