#!/usr/bin/env bash
# tools/bootstrap-agent.sh
# Run this as the FIRST step in every Codex sandbox.

set -euo pipefail
CACHE_NAME="build-cache"

echo "🔎  Trying to download pre-built artefact..."
if command -v gh &>/dev/null; then
  # If the artefact is available for the current commit, pull it.
  gh run download --name "$CACHE_NAME" --dir . && echo "✅  Cache pulled."
else
  echo "⚠️  GitHub CLI not available; skipping cache download."
fi

# If node_modules is still missing, fall back to full install.
if [ ! -d node_modules ]; then
  echo "📦  node_modules not found; performing fresh install."
  npm ci
fi

# Optional build step (uncomment if you have "npm run build" locally)
# if [ ! -d dist ]; then npm run build; fi

# Ensure local semantic index exists – small & fast.
if [ ! -f embeddings.json ]; then
  echo "🧠  ⚠️ missing local embeddings."
fi

echo "✅  Bootstrap complete. Ready to code!"
