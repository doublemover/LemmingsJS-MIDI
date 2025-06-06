# AGENTS guidelines for LemmingsJS-MIDI `.agentInfo`

This folder stores design notes and metadata for Codex agents. The notes are searchable via a local TF‑IDF index.

-## Index & Searching
- The indexes live in `index-prose/` and `index-code/` at the repository root. They store TF‑IDF vectors for text chunks across the repo.
- Query them with `node tools/search.js "SEARCH TERM" --json | jq .` for machine-readable results. Omit `--json` for a human readable listing.
- Rebuild or update the indexes after editing documentation or notes:
  - `npm run index` — runs `node tools/build_index.js`.
- If these directories are missing or out of date, mention it to the user and regenerate them with the command above.
- Both tools require **Node.js 18+** and rely on files present in the working tree.
