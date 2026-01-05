# Publish an MCPB-backed server to the Official MCP Registry (and GitHub MCP Registry)

This is a *template* checklist you can adapt.

## 1) Build your `.mcpb` bundle

```bash
# from your bundle root (contains manifest.json)
mcpb init         # once
mcpb pack dist/your-server.mcpb
```

## 2) Upload the `.mcpb` to GitHub Releases

Create a release tag like `v1.0.0` and upload `your-server.mcpb` as a release asset.

## 3) Compute SHA-256

```bash
shasum -a 256 dist/your-server.mcpb
# or:
openssl dgst -sha256 dist/your-server.mcpb
```

## 4) Create / update `server.json`

Use the official schema and the `mcpb` package type. Example:

```jsonc
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.YOUR_GITHUB_USERNAME/your-server",
  "description": "A short description",
  "version": "1.0.0",
  "repository": { "url": "https://github.com/YOUR_GITHUB_USERNAME/your-repo", "source": "github" },
  "packages": [
    {
      "registryType": "mcpb",
      "identifier": "https://github.com/YOUR_GITHUB_USERNAME/your-repo/releases/download/v1.0.0/your-server.mcpb",
      "fileSha256": "PUT_SHA256_HERE",
      "transport": { "type": "stdio" }
    }
  ]
}
```

## 5) Publish

Install `mcp-publisher`, login, then publish:

```bash
mcp-publisher init           # creates server.json (optional if you already have it)
mcp-publisher login github
mcp-publisher publish
```

Verify it shows up:

```bash
curl "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.YOUR_GITHUB_USERNAME/your-server"
```

## Notes

- Publishing to the official MCP registry is what makes servers discoverable in other registries/subregistries that mirror it.
- Some ecosystems have additional “curation” layers (e.g., being *featured* in a UI) even after you publish.
