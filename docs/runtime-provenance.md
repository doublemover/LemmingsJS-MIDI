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
