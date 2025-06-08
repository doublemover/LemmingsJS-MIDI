# Excluded tests

Some automated tests are skipped by CI because they require heavy resources or manual steps. These cases are documented here so contributors know why they are not part of the regular `npm test` run.

- `test/tools/build_index.test.js` – builds the search index which downloads and processes large assets.
