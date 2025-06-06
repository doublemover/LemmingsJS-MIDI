# AGENTS guidelines for LemmingsJS-MIDI `.agentInfo`

This folder stores design notes and metadata for Codex agents. The notes are searchable via a local TF‑IDF index.

## Index & Searching
- TF‑IDF indexes are stored in the `index-prose/` and `index-code/` directories.
- Query the index with `node tools/search.js "SEARCH TERM" --json | jq .` for machine-readable results. Omit `--json` for a human readable listing.
- Rebuild or update the indexes after editing documentation or notes:
  - `npm run index` — runs `node tools/build_index.js`.
- If those directories are missing or out of date, regenerate them with the command above.
- Both tools require **Node.js 18+** and rely on files present in the working tree.
