# AGENTS guidelines for LemmingsJS-MIDI `.agentInfo`

This folder stores design notes and metadata for Codex agents. The notes are searchable via a local TF‑IDF index.

-## Index & Searching
- The indexes live in `index-prose/` and `index-code/` at the repository root. They store TF‑IDF vectors for text chunks across the repo.
- Query them with `node tools/search.js "SEARCH TERM" --json | jq .` for machine-readable results. Omit `--json` for a human readable listing.
- Try using this often when referring to the code
- Do not regenerate or rebuild the indexes if they are missing
- After you use the tool commit the stats it generates as part of your next commit
- Both tools require **Node.js 18+** and rely on files present in the working tree.
