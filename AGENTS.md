# AGENTS guidelines for LemmingsJS-MIDI

This repository hosts a JavaScript/Node implementation of **Lemmings**. The following guidelines help the Codex agent work with the project.

This repository uses ESLint for code style.
Run `npm run format` before committing to automatically fix indentation,
quotes, and semicolons across the JavaScript codebase.

## Environment
- Use **Node.js 16 or later**.
- Run `npm install` before running any tests or scripts.

## Tests
- Run `npm test` to execute the Mocha test suite.
- Tests rely on the custom loader `js/LogHandler.js`.

## Development
- `npm start` launches `http-server` for local testing.
- `npm run lint` checks source files with ESLint.
- JavaScript code uses **two-space indentation** (see `js/BitReader.js` for examples).
- The `js/` directory runs in the browser, so avoid Node-only modules like `fs`, `path`, or `process` in that code.
### WebMIDI
- Browsers only enable WebMIDI on HTTPS or localhost.
- Running `WebMidi.enable()` prompts the user to allow MIDI device access.
- See `.agentInfo/notes/webmidi.md` for details.
- The call in `index.html` lines 22-24 is commented out; enable it for MIDI tests.


## Commit policy
- Keep commit messages concise.
- Run `npm test` and ensure all tests pass before committing.

## Pull Requests
- Summarize major changes and reference relevant files or lines.

<!--
Additional suggestions for the agent or future maintainers:
- High performance and intelligent memory usage are top priorities; profile critical code paths and watch memory allocations.
- You can extend the tests in `test/` to cover more of the tools in `tools/`.
- When publishing to GitHub Pages, `npm start` may be replaced by a dedicated build step.
- The repository includes many sample assets; keeping them out of commits can reduce repo size.
- If Node 18+ is required in the future, update these guidelines accordingly.
- Try running `npm run list-sprites` to preview sprite names and counts.
- To export all sprite assets use `npm run export-all-sprites` or `export-all-packs`.
- Create and maintain a `.agentInfo/` directory at the repository root.
- Within `.agentInfo/`, store short notes about design decisions or TODOs using a tag-based system. Keep an index (e.g., `tags.json` or `index.md`) to search notes by tag.
- Regularly review this index to locate relevant notes before starting new work.
- Getting the dos file compression working is very important
- Take your time and do your best work. Write comprehensive comments. 
- Try and generate as many additional tasks to handle things as you can to maximize your potential
-->

