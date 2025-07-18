# AGENTS guidelines for LemmingsJS-MIDI

This repository hosts a JavaScript/Node implementation of **Lemmings**. The following guidelines help the Codex agent work with the project.

This repository uses ESLint for code style.
Run `npm run format` before committing to automatically fix indentation,
quotes, and semicolons across the JavaScript codebase.
Run `source .bash_aliases` from the repository root at the start of each
session to activate the custom `grep` and `gitgrep` aliases used
throughout these instructions.
Choose a short agent name for your session and pass it with `--name=YOURNAME`
to any repo scripts that support a name flag.

-## Index & Searching
- The indexes live in `index-prose/` and `index-code/` at the repository root. They store TF‑IDF vectors for text chunks across the repo. Do not access them directly!
- Query them with `search "SEARCH TERM" --json | jq .` for machine-readable results. Omit `--json` for a human readable listing.
- Key flags include:
  - `--json`, `--human`, `--stats`
  - `--context N`, `--ann`
  - filters: `--type`, `--author`, `--call`, `--import`, `--lint`, `--churn`, `--signature`, `--param`, `--uses`, `--calls`
  - result count with `-n`/`--top`
  - search metrics are saved under `.repoMetrics`
- Try using this often when referring to the code
- Do not regenerate or rebuild the indexes if they are missing
- After you use the tool commit the stats it generates as part of your next commit
 - `.repoMetrics/metrics.json` stores counters in compact JSON; do not reformat this file
 - `npm test` automatically runs `npm run agent-update-searchmetrics` to merge metrics
 - Run `npm run agent-precommit` to update metrics and history and stage the results
 - `.repoMetrics/metrics.json` stores counters in compact JSON and
  `.repoMetrics/searchHistory` logs search queries. Do not reformat these files
- `npm test` automatically runs `npm run agent-update-searchmetrics` to merge metrics
 - Both tools require **Node.js 20+** and rely on files present in the working tree.
 - Ignore `.repoMetrics/` when using command line tools to search git diffs or the repository.

## Environment
 - Use **Node.js 20 or later**.
- You should have a cached version of the build dependencies
- Run `npm ci` if you do not

## Tests
- Run `npm test [category...]` to execute the Mocha test suite. Categories are optional.
- Run `npm run coverage` to view test coverage. When adding tests, inspect coverage for the files you changed and suggest tasks to cover missing parts.

## Development
- `npm start` launches `http-server` for local testing.
  - You can't actually play the game so this might have limited use
- `npm run lint` checks source files with ESLint.
- JavaScript code uses **two-space indentation** (see `js/BitReader.js` for examples).
- The `js/` directory runs in the browser, so avoid Node-only modules like `fs`, `path`, or `process` in that code.

### Level packs
Level packs follow the NeoLemmix folder layout described in
[docs/levelpacks.md](docs/levelpacks.md), which lists the expected
`levels/`, `music/`, `styles/` and other directories.
The [NeoLemmix Pack Toolkit](docs/nl-pack-toolkit.md) explains how
these folders are structured and bundled.

## Third-party Code
External libraries live in folders such as `js/vendor/` or other vendor
directories. Do **not** modify these files, and do not run formatting
tools on them.

## Commit policy
- Keep commit messages concise.
- Run `npm test` and ensure all tests pass before committing.
- Documentation-only updates (README or docs changes) should not be listed in
  `CHANGELOG.md`.

## Pull Requests
- Summarize major changes and reference relevant files or lines.
- Try pulling in master and making sure everything merges in without ruining your work before committing.

<!--
Additional suggestions for the agent or future maintainers:
- Don't forget to use the search tool 
- High performance and intelligent memory usage are top priorities; profile critical code paths and watch memory allocations.
- You are unable to commit binaries so do not try
- Create and maintain a `.agentInfo/` directory at the repository root.
- Within `.agentInfo/`, store short notes about design decisions or TODOs using a tag-based system. Keep an index (e.g., `tags.json` or `index.md`) to search notes by tag.
- Regularly review this index to locate relevant notes before starting new work.
- If you are unable to do something complicated, leave what you have but didn't work in comments with an explanation of what you were trying to do and why it didn't work
-->

