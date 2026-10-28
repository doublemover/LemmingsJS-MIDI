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

Compiled candidates remain `compiled-data-not-render-qualified`. The dock UI,
canonical library integration, same-take level-matched render/cue path and
reference-audio qualification are remaining integration work for #1112/#1204.
Schema validation and numerical diversity alone do not establish playable finite
audio, useful musical variation or a listening pass.
