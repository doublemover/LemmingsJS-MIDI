# Documentation Index

This directory is the source of truth for project documentation. Completed
roadmap phases live in git history; active roadmap work is in
[`roadmap.md`](roadmap.md).

## Canonical User And Developer Docs

These files describe current behavior and should be kept in sync with code:

- [`usage.md`](usage.md): local browser startup, editor entry point, E2E harness
  entry point.
- [`TESTING.md`](TESTING.md): unit/static/benchmark/Playwright test workflow.
- [`playwright-tests.md`](playwright-tests.md): Playwright server setup,
  disposable visual capture tooling, and probe usage.
- [`e2e-state.md`](e2e-state.md): `window.__E2E__` game/runtime harness API.
- [`e2e-editor-state.md`](e2e-editor-state.md): editor-specific E2E state.
- [`ci.md`](ci.md): current GitHub Actions gate order.
- [`release-readiness.md`](release-readiness.md): validated release checklist.
- [`config.md`](config.md): `config.json`, runtime profiles, and bench profiles.
- [`analytics.md`](analytics.md): local opt-in analytics controls.
- [`keybindings-design.md`](keybindings-design.md): keyboard binding format.
- [`gamepad-bindings.md`](gamepad-bindings.md): gamepad binding format.
- [`midi-ui.md`](midi-ui.md): current MIDI UI controls and persistence.
- [`midi-mapping.md`](midi-mapping.md): default MIDI mapping file reference.
- [`procgen.md`](procgen.md): current procgen runtime behavior and validation.
- [`performance-benchmarks.md`](performance-benchmarks.md): runtime benchmark
  modes and scripts.
- [`offline-tools.md`](offline-tools.md): Node asset and pack tooling.
- [`exporting-sprites.md`](exporting-sprites.md): quick export/patch workflow.
- [`levelpacks.md`](levelpacks.md): level pack folder layout.
- [`replays.md`](replays.md): replay command format.
- [`architecture-internals.md`](architecture-internals.md): renderer, history,
  MCP, and profile internals.

## Level Editor Docs

The level editor docs are canonical for the current classic-subset editor unless
the file explicitly says it is backlog:

- [`level-editor/workflows.md`](level-editor/workflows.md)
- [`level-editor/audit.md`](level-editor/audit.md)
- [`level-editor/classic-subset-contract.md`](level-editor/classic-subset-contract.md)
- [`level-editor/design-overview.md`](level-editor/design-overview.md)
- [`level-editor/data-model.md`](level-editor/data-model.md)
- [`level-editor/ui-and-tools.md`](level-editor/ui-and-tools.md)
- [`level-editor/ui-spec.md`](level-editor/ui-spec.md)
- [`level-editor/runtime-preview.md`](level-editor/runtime-preview.md)
- [`level-editor/history.md`](level-editor/history.md)
- [`level-editor/remaining.md`](level-editor/remaining.md): out-of-scope backlog.
- [`level-editor/neolemmix-expansion.md`](level-editor/neolemmix-expansion.md):
  NeoLemmix expansion backlog.

## MCP Docs

The current MCP entry points are:

- [`mcp/README.md`](mcp/README.md): server usage, surfaces, tool naming, smoke
  checklist.
- [`mcp/protocol-v2.md`](mcp/protocol-v2.md): current compact protocol defaults.
- [`mcp/editor-apply.md`](mcp/editor-apply.md): shipped `editor_apply` contract.
- [`mcp/call-examples.md`](mcp/call-examples.md): short-name call examples.
- [`mcp/publishing.md`](mcp/publishing.md): MCPB packaging and registry notes.
- [`mcp/protocol-mappings.json`](mcp/protocol-mappings.json): protocol mapping
  metadata consumed by code/tests.
- [`mcp/client-compatibility.json`](mcp/client-compatibility.json): host
  compatibility matrix.
- `mcp/config-examples/*`: checked client config snippets.

The `mcp/lemmings-mcp-*-memresources.*` files are retained as historical design
and schema reference notes. Prefer the current README/protocol docs for shipped
behavior.

## File Format And Asset References

These are reference material, not product roadmap docs:

- [`compression-format.md`](compression-format.md)
- [`level-file-format.md`](level-file-format.md)
- [`nl-file-format.md`](nl-file-format.md)
- [`nl-objects.md`](nl-objects.md)
- [`nl-skills.md`](nl-skills.md)
- [`nl-pack-toolkit.md`](nl-pack-toolkit.md)
- Every file under [`camanis/`](camanis/)
- [`reading-list/particle-handling.md`](reading-list/particle-handling.md)

## Historical Source Notes

These are useful implementation references, but they are not authoritative for
current JavaScript behavior:

- Every file under [`port-info/`](port-info/)
- [`webmidi-evaluation.md`](webmidi-evaluation.md)

## Test Status Reports

The repo no longer keeps stale broken/fixable/incoherent test reports. Current
test status is the command output from `npm test`, Playwright commands, and CI.
[`excluded-tests.md`](excluded-tests.md) is retained only to document deliberate
manual exclusions; it currently states that none are excluded.
