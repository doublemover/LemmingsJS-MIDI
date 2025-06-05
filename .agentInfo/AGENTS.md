# AGENTS guidelines for LemmingsJS-MIDI `.agentInfo`

This folder stores design notes and metadata for Codex agents. The notes are searchable via a local TF‑IDF index.

## Index & Searching
- The index lives in `embeddings.json` at the repository root. It contains TF‑IDF vectors for text chunks across the repo.
- Query the index with `node tools/search.js "SEARCH TERM" --json | jq .` for machine-readable results. Omit `--json` for a human readable listing.
- Rebuild or update the index after editing documentation or notes:
  - `npm run index` — runs `node tools/build_index.js --root . --out embeddings.json`.
- If `embeddings.json` is missing or out of date, mention it to the user and regenerate it with the command above.
- Both tools require **Node.js 18+** and rely on files present in the working tree.
