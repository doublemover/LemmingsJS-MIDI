# Contributing

Development uses ESLint to keep code consistent.

- Two-space indentation
- Single quotes for strings
- Semicolons required

Run `npm run lint` to check formatting. Run `npm run format` to automatically fix style.
Run `npm run depcheck` to check unused dependencies with Knip. Node.js 20.19+ (20.x) or 22.12+ is required by this toolchain.

## Before committing

- Add a changelog entry in `CHANGELOG.md` for any user-visible change.
- Run `npm run format` and `npm test` to ensure consistent style and passing tests.
- Run `npm run check-undefined` before committing.

Knip's `c8` script parser treats `report` as a nested executable. The configuration
excludes only that subcommand name from binary findings; dependency findings stay
enabled. See the [upstream c8 parser](https://knip.dev/reference/plugins/c8).
