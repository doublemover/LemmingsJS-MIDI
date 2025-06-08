tags: search, doc

`tools/search.js` provides a command line interface for querying the repository indexes.
Use the `search` alias or run `node tools/search.js` directly with a phrase.
Results are ranked from `index-prose` and `index-code` and can be shown in JSON or human form.

Supported flags:
- `--json` – print structured JSON
- `--human` – pretty text output
- `--stats` – show index stats
- `--ann` – include approximate nearest neighbors
- `--context`, `-c` – number of context lines
- `--type`, `-t` – filter by chunk type
- `--top`, `-n` – limit results
- `--author` – restrict by last author
- `--call` – filter functions that call or are called
- `--import` – filter by imported module
- `--calls` – require calls to function
- `--uses` – filter by identifier usage
- `--signature` – match documentation signature text
- `--param` – match parameter names
- `--headline` – only return chunks with a headline
- `--lint` – only return chunks that have lint issues
- `--churn` – filter by churn value
- `--matched` – show which tokens matched

Every search updates `.repoMetrics/metrics.json`, `.repoMetrics/searchHistory` and `.repoMetrics/noResultQueries`.
