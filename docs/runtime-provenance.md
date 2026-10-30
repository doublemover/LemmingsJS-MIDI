# Runtime dependency provenance

`npm run provenance:check` verifies the checked-in manifest in
[`provenance/runtime-artifacts.json`](../provenance/runtime-artifacts.json). It
hashes every file under `js/vendor/` and `assets/icons/lucide/`, the service
worker, and the inline timing worker source. Changed bytes, additions, removals,
missing license notices, and unlisted JavaScript worker constructors fail the
gate. The Node CI job runs this before the broader test suite.

`npm run --silent provenance:sbom` emits one CycloneDX 1.5 JSON document to stdout. It
starts with `npm sbom --sbom-format=cyclonedx --package-lock-only`, then adds
the checked-in bundles as hashed components. Development-only schema files are
marked excluded and are not root dependencies. The CI job archives that output
as `runtime-sbom`. It is checked against locally pinned CycloneDX 1.5, SPDX,
and JSF schemas from [specification revision ad83dae](https://github.com/CycloneDX/specification/tree/ad83dae28b236b8760286399da4daba77592de86/schema).
Their Apache 2.0 license is copied beside the schemas. Timestamp and random
serial fields are removed, so the same lockfile, manifest, files and npm
version produce stable bytes. CI records `GITHUB_SHA` as source revision; local
output says `local-unpinned`. A separate SHA-256 of the package manifest,
lockfile and provenance manifest identifies the checked inputs. The component
hash is a SHA-256 over sorted path names and raw file contents; it is a
repository content identity, not an assertion that an upstream release matches
those bytes.

The manifest records the current backend selections: vendored WebMidi.js for
browser MIDI 1 byte output, first-party Web Audio preview, and no selected
native UMP or optional audio bank. Candidate libraries in #975 and #977 are
not represented as shipped dependencies. The npm section includes development
dependencies, while each additional file component identifies its own runtime,
precache, generated, source or development classification.

The current upstream evidence is deliberately limited:

- [WEBMIDI.js](https://github.com/djipco/webmidi) identifies Apache 2.0;
  the checked-in header declares v3.1.12. Its exact upstream distribution
  artifact has not been reproduced and compared byte for byte.
- [jQuery's 1.11.1 release](https://blog.jquery.com/2014/05/01/jquery-1-11-1-and-2-1-1-released/)
  and [license](https://jquery.com/license/) identify the release and MIT
  notice. This repository currently only precaches the checked-in file; it is
  not a loaded entry script in the three HTML pages.
- The local HQX README names [wasmboy-rs](https://github.com/CryZe/wasmboy-rs)
  v0.1.2 and has an Apache 2.0 notice. The generation inputs, tool version,
  and exact upstream artifact hash for the JavaScript wrapper and embedded
  WASM bytes are not yet verified.
- The [Lucide icon source](https://github.com/lucide-icons/lucide) and local
  `LICENSE` provide the ISC notice and additional MIT attribution for derived
  icons. The recorded snapshot date lacks an immutable upstream commit.
- The repository has no top-level license declaration. The two first-party
  worker components therefore use `NOASSERTION` in the manifest.

To update a component, first record its immutable upstream commit or release,
source artifact digest, full license/notice, local patch set, build recipe and
tool versions. Regenerate the checked-in file outside `js/vendor/` and compare
bytes before replacing it. Then update the manifest hash, run the provenance
gate, affected behavior and browser tests, and retain the previous version for
rollback. WebMidi updates also require the MIDI routing and output contract
tests; an updated WebMidi.js does not establish MIDI 2 support.

The CI workflow pins checkout, setup-node and upload-artifact to reviewed
commit IDs with their release tags in comments. To update one, resolve the new
official action tag to a commit, review its release notes and changes, then
replace the commit and comment together.

## Browser generation inventory

`scripts/BrowserRuntimeClosure.js` inventories the game, editor, instrument and
survey HTML entry routes,
their executable dependency closure, stylesheet resources and the tracked
bundled asset/pack profile. It shares the parser-based module collector used by
MCP packaging, including literal dynamic imports and URL resources. Unresolved,
computed or escaping module references fail inventory admission. Source files
are hashed as data; the collector never evaluates application modules or report
text. Required CSS imports and local URL resources must exist.

The inventory separates executable and asset digests and records a combined
closure digest. Its qualification is explicitly artifact-inventory-only until a
generated immutable entry actually executes. It is input to generation staging,
not proof that the current tab ran those fetched bytes or that offline install
completed. Added synthetic closure fixtures remain unexecuted during the
frontloaded implementation pass.

`npm run build:browser -- --name=rook` stages that inventory under
`dist/browser/<buildId>/`. The build ID binds normalized source/asset hashes and
the build recipe. A single generated data slot gives the executing module its
build identity without a circular self-hash; the manifest separately records
the actual generated carrier bytes and its normalization template. Every copy
is rehashed during staging. Generations are published only after the reusable
provenance verifier admits the source inventory,
including reviewed vendor hashes, notices and parser-discovered worker owners.
The verifier's bytes are included in new build recipes. Older three-file build
recipes remain readable for pinned generations.
Existing content-addressed generations are never
overwritten, and a conflicting byte is an error. Artifact metadata excludes
timestamps. The builder reports offline installation and entry execution as
not yet performed; staging alone does not grant either claim.

The source checkout's `ActiveExecutionIdentity.js` has no build authority.
Generated identity is accepted only from its matching immutable URL namespace
and a distinct runtime realm, with the actual state schema and selected
capability profile. Report-supplied data cannot set the executing identity.
The generation installer and exact survey replay consume this authority.
Runtime qualification fixtures remain deferred.

The unbuilt service-worker shell now distinguishes its three HTML routes and
uses exact precached script/style responses on network failure. Resource
revision/search identity is not ignored. Missing routes cannot substitute the
game shell at an instrument URL. Its status explicitly remains an unqualified
shell with `offlineReady: false`; it does not advertise the complete generated
runtime inventory as installed. Registration exposes a separate unqualified
installation state. Deterministic fallback fixtures are added but unexecuted.

The generated manifest has one shared browser/Node verifier. It recomputes the
complete normalized inventory and build recipe, checks all required routes and
file/byte bounds, and verifies that the generated identity carrier is exactly
the bound template plus derived build data. Installer consumers must obtain
`templateVerified: true` before publication; checking only the normalized slot
would otherwise hide a changed executable carrier. Template bytes are shipped
as bounded data alongside the generation and checked on repeat staging.

The generated output root contains installer entry pages and a module service
worker. Serve `dist/browser/` as the application root (HTTPS, or loopback HTTP).
The entry waits for a matching complete generation before navigating to its
immutable HTML route. Installation streams and hashes every declared file with
two bounded copy producers, then writes its completion marker last. Failed
candidates cannot replace a previous generation. Restart recovery rechecks all
required bytes; registration alone never means offline readiness. Known build
namespaces reject undeclared resources and wrong revision queries.

Cache accounting and deletion are scoped to the application path, with a
512 MiB default admission bound. Active client generation URLs retain their
previous package during updates. Built tabs retain their executing generation
when the controller changes; the app does not automatically reload a running
performance. This installation path does not enable cross-origin isolation or
claim that a decoder, worklet or audio context was successfully initialized.
Deterministic interruption, restart, exact-route and retention fixtures are
added but remain unexecuted during the frontloaded development pass.

Exact survey replay requires an installed matching generation and starts a
fresh dedicated module worker at an application-owned URL. The controller
rechecks the requested package; the worker separately compares every executable
inventory entry and selected asset hash with its trusted generated manifest.
Its realm ID must differ from the host. A copied build label with three fake
source files cannot substitute for the complete executable closure. Imported
report source remains non-executable data; no report selects a module URL.

The survey offers exact replay separately from a current-runtime comparison.
Current-runtime comparisons verify the saved physical assets and explicitly
leave historical code integrity unchecked. They do not request old JavaScript
from a newer deployment, and matching results remain execution-unbound. The
lower-level artifact verifier retains its complete source-and-assets default;
exact replay always requires that complete policy. Version-one generations with
the original three entry routes remain verifiable by newer installers. Route
claims must agree exactly with the known entry files in the bound inventory.
Legacy Node source receipts remain execution-unbound. Exact receipts separate
artifact integrity, actual execution identity and observed replay consistency.
One replay worker and one pending command are admitted per application realm,
with shared resource reservation before allocation, source/body limits,
preparation/command/lifetime deadlines and immediate cancellation. A controller
change retires the in-flight replay. Failed worker termination retains its
reservation and prevents admitting a replacement with unknown ownership.
Browser fixtures cover initial offline startup, incomplete updates, retained
old clients, isolated replay and forged source inventories; they are unexecuted.

Replay worker startup now goes through `BackgroundWorkerAdmission`, the shared
non-realtime admission boundary. It bounds active workers, queued job count,
retained queued input and aggregate estimated memory before granting execution.
Priority aging gives older background work a chance to run. Resource leases
remain charged until the caller acknowledges retirement; cancellation callbacks
cannot manufacture a completed release. Import parsing and export encoding now
consume the same boundary through registered pure job kernels. Recovery
checksums and binary asset hashes now use it as well. Binary hashing stays on
native WebCrypto, avoiding a worker copy solely for a digest. Recovery has a
cooperative fallback and cannot relabel a capacity failure as corrupt data.
Pure content jobs coalesce by a versioned digest and resource-budget scope,
with independent cancellation and publication leases for each consumer. Ground
decoding copies verified sources only after admission, checks compressed-part,
image-plane, frame and decoded-byte bounds, and fingerprints the result inside
the worker. The no-worker path admits only small bounded decodes. Image/palette
metadata is frozen; shared typed pixels remain owned read-only asset data and
are never transferred from a performing world. Each terrain instance retains
separate mutable descriptors, PRNG, edits and hazard state.

Active and candidate asset managers share the decoded result and its reservation.
Retiring either releases only its consumer lease; the last release retires the
result. Theme and display managers transfer their leases into the committed
runtime, with independent cleanup on failed preparation and runtime retirement.
Warm same-content worlds reuse decode and fingerprint results while a consumer
still owns that content. No persistent unreferenced decoded cache is retained.
These paths and their added real-source fixtures remain unexecuted.

Collection preparation keeps actual producer promises separate from canceled
consumer waits. Failure aborts siblings, independently retires all registered
resources and reconciles late acquisitions within a bounded cleanup deadline.
Failures retain a retirement receipt and a late-reconciliation promise; an
expired deadline records unknown ownership instead of a successful release.
