# Authored patch neighborhoods

`js/midi/content/PatchNeighborhood.js` generates bounded recipe data for the
authored profiles in `AuthoredPatchNeighborhoods.js`. It uses the existing typed
sound compiler and exact engine descriptor. It creates no audio nodes and has no
world, transport, route or actor dependency. The initial profiles are proposals
awaiting listening review.

Each batch admits one to eight slots; the variation session requests four.
SHA-256 of canonical parent, neighborhood version, signed 32-bit seed, locks and
coordinates supplies independent per-slot, per-axis offsets. Batch size does not
change an earlier slot. Amount scales both requested coordinates and a bounded
quarter-axis offset. The two named axes correlate continuous parameters in their
declared units; discrete structure, mappings and engine artifacts remain pinned.

FM contours preserve their parent's rising, falling or flat direction. Parameter
and macro-target locks retain their original explicit values, including omitted
defaults. A conflicting constraint rejects that slot; there is no retry loop or
implicit unlocking. Engine-domain clamps retain requested and effective values,
including a clamp that leaves the effective value unchanged. Compiler refusals
remain named outcomes. A duplicate-like flag compares parameter data within the
batch; it measures neither sound quality nor perceived similarity and removes
no candidate.

`createResolvedPatchRecipeSource` lowers the complete resolved parent through
allowlisted component templates. A fork has a distinct content-derived ID, one
pinned realization and an immutable origin. Sample maps, seed layers, assets,
macros, bindings, voice policy and existing rights data survive. The Circuit
profile accepts an individual single-zone sample voice; a compound kit requires
its own explicit owner. Alternate realization profiles are not regenerated.

Compiler revision `typed-recipes-v14` binds validated neighborhood provenance
inside the pack hash. Older v12/v13 compilation behavior remains available. A
saved fork reopens from its complete definition and exact engine/asset hashes;
loading does not invoke the generator or resolve a changed catalog label.

`PatchVariationSession` fences work by the caller's complete document, lane,
parent and immutable take identity. Four stable generation slots and four exact
pins have a bounded retained-data budget. At most two generation operations and
four explicit actions may remain pending. Canceled/reversed completions cannot
replace current slots. A changed source retains old pins for inspection and
refuses their application. Unresolved cue retirement blocks further admission
and retains the affected owner.

Compare, Keep and Apply are explicit integration callbacks. The session never
auditions on focus, selection, pinning or generation. Compare requires a take and
an owned cue lease; Apply additionally requires Keep and an admission receipt
from that comparison owner. Callbacks must honor the supplied signal and
`isCurrent` predicate at their canonical publication/transaction boundary.

`PatchVariationOwner` connects the session to the existing worker compiler,
archive/reader/registry, causal take renderer, PRELISTEN owner and prepared lane
transaction. Factory parents have an explicitly budgeted complete-definition
lease; installed parents load by their exact pack hash. A changed factory
catalog cannot silently substitute for an unavailable pinned parent.

The VARIATIONS page occupies the existing scoped dock. Two authored knobs and
their exact-entry controls edit a local draft. Generate submits four slots.
Seed/locks/version/outcomes and exact selected provenance remain in an advanced
foldout. Numbered keyboard navigation never auditions. Pins survive later
batches and parent changes as inspectable exact references.

Keep stores a reference-only immutable definition through the canonical archive
and verified reader. It can save an unqualified candidate for later inspection.
Apply also requires the comparison owner's exact admission and the existing
lane transaction's final source check. A successful Apply creates the expected
new document revision and stops the cue; sound Undo uses the existing history.

Compare prepares the selected lane of the same immutable captured physical
phrase twice, from source time zero through at most eight seconds, with an exact
crop and the pinned parent/candidate definitions. Missing/held initial state,
coverage, assets, silence or budget remain explicit refusals. The measured crop
RMS values select attenuation-only gains with a maximum resulting peak of0.8.
Those gains reach the real native PCM cue envelope without rewriting saved
samples. A/B are discrete choices and share the existing explicit monitor route,
foreground ownership, stop, source fencing and eight-millisecond edge fades.
The comparison retains both actual PCM hashes and level receipts.

The advanced revision editor changes an explicit user name or unlocked macro
defaults only. It creates a separate content-derived branch at the next numeric
revision through compiler `typed-recipes-v15`; it never reruns the neighborhood.
The pack binds the complete immediate parent reference, original neighborhood,
and exact previous/new values. Validation reconstructs the expected definition
and rejects hidden changes to parameters, mappings, bindings, assets or policy.
Existing v12/v13/v14 content remains supported. Repeated edits retain bounded
immediate-parent provenance rather than recursively embedding older packs.

Editing a pinned candidate retains that pin and its exact prepared comparison.
The child starts without Keep or audition admission. Explicit Keep and a fresh
same-take comparison are required before Apply. Draft edits, Create revision and
late completions cannot select a new playing sound. A/B choices fence superseded
asynchronous work; the preview strip reports actual cue playback, including its
natural completion, separately from the last accepted comparison side.

Compiled candidates remain `compiled-data-not-render-qualified` until the real
reference path succeeds. This is a new local realization of captured intents;
historic receiver timbre and acoustic output are not recreated. The broader
sparse/dense finite-audio corpus, graft-specific parent replacement journey,
musical-relatedness listening review and actual assistive-technology
qualification remain open for #1112/#1204. Schema validation and numerical
diversity alone establish no listening result.
