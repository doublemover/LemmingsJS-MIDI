# AGENTS guidelines for LemmingsJS-MIDI

This repository hosts a JavaScript/Node implementation of **Lemmings**. The following guidelines help the Codex agent work with the project.

This repository uses ESLint for code style.
Run `npm run format` before committing to automatically fix indentation,
quotes, and semicolons across the JavaScript codebase.

-## Index & Searching
- The indexes live in `index-prose/` and `index-code/` at the repository root. They store TF‑IDF vectors for text chunks across the repo.
- Query them with `node tools/search.js "SEARCH TERM" --json | jq .` for machine-readable results. Omit `--json` for a human readable listing.
- Try using this often when referring to the code
- Do not regenerate or rebuild the indexes if they are missing
- After you use the tool commit the stats it generates as part of your next commit
- `.searchMetrics` stores counters in compact JSON; do not reformat this file
- `npm test` automatically runs `npm run agent-update-searchmetrics` to merge metrics
- Both tools require **Node.js 18+** and rely on files present in the working tree.

## Environment
- Use **Node.js 18 or later**.
- You should have a cached version of the build dependencies
- Run `npm ci` if you do not

## Tests
- Run `npm test` to execute the Mocha test suite.

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

## Pull Requests
- Summarize major changes and reference relevant files or lines.
- Try pulling in master and making sure everything merges in without ruining your work before committing.
- If pulling in master is too complicated, undo it and let the user know

<!--
Additional suggestions for the agent or future maintainers:
- Don't forget to use the search tool 
- High performance and intelligent memory usage are top priorities; profile critical code paths and watch memory allocations.
- You can extend the tests in `test/` to cover more of the tools in `tools/`.
- The repository includes many sample assets; keeping them out of commits can reduce repo size.
- You are unable to commit binaries so do not try
- Try running `npm run list-sprites` to preview sprite names and counts.
- To export all sprite assets use `npm run export-all-sprites` or `export-all-packs`.
- Create and maintain a `.agentInfo/` directory at the repository root.
- Within `.agentInfo/`, store short notes about design decisions or TODOs using a tag-based system. Keep an index (e.g., `tags.json` or `index.md`) to search notes by tag.
- Do not use "..." at the end of summaries in your index
- Regularly review this index to locate relevant notes before starting new work.
- Try and generate as many additional tasks to handle things as you can to maximize your potential
- If you are unable to do something complicated, leave what you have but didn't work in comments with an explanation of what you were trying to do and why it didn't work
-->

