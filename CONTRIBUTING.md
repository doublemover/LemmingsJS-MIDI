# Contributing

Development uses ESLint to keep code consistent.

- Two-space indentation
- Single quotes for strings
- Semicolons required

Run `npm run lint` to check formatting. Run `npm run format` to automatically fix style.
Run `npm run depcheck` to list unused dependencies.

## Before committing

- Add a changelog entry in `CHANGELOG.md` for any user-visible change.
- Run `npm run format` and `npm test` to ensure consistent style and passing tests.
- Run `npm run check-undefined` before committing.
- Run `npm run agent-precommit` to update search metrics and history and stage them.
