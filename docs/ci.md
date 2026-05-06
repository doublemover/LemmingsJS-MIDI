# Continuous Integration

GitHub Actions runs on pushes and pull requests targeting `master`.

Workflow source: [`.github/workflows/test.yml`](../.github/workflows/test.yml).
The job installs Node 20, installs Playwright Chromium, runs the static/unit
gates, starts the local HTTPS server for browser-backed checks, and uploads
coverage.

Current gate order:

1. `npm ci`
2. `npm audit --audit-level=moderate`
3. `npx playwright install --with-deps chromium`
4. `npm run format`
5. `git diff --check` against changed lines
6. `git diff --exit-code`
7. `npm run check-undefined`
8. `npm run lint`
9. `npm run typecheck:critical`
10. `npm run release-readiness`
11. `npm run depcheck`
12. `npm run check-mcp-clients`
13. `npm run test-bench-unit`
14. `npm test`
15. generate temporary localhost HTTPS certs
16. start `npm run start-https`
17. `npm run test-mcp-smoke`
18. `npm run bench-smoke`
19. stop the HTTPS server
20. `npm run coverage`

All generated certs, server logs, coverage, and browser artifacts are CI-local
or ignored unless explicitly uploaded as artifacts.
