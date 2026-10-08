# Lemmings branch reconciliation — 2026-10-07

Verified master: `7366e5f97bb20df73ff0c575768d1c5f8d46def0`. Inventoried all **159** remote heads and **891** owner-authored PRs plus the open Dependabot PR #959. Historical patch equivalence is checked independently of commit IDs; several old remote heads have rewritten ancestry but identical trees to merged PR heads.

## October 8 MIDI integration

The owner approved reconciliation and a normal push to [draft PR #964](https://github.com/doublemover/LemmingsJS-MIDI/pull/964)'s source branch, `optimize/procgen-runtime-20261007`. The fetched target was `c8e4f375b4242554cdbc5a7a9e786d9ef48a35f6`; the MIDI tip was `7d9aef99f2791fb1025aa589b8d18774ed2a1e63`. Their shared base is `d163d2a2862bd51e6592794e7d2bcea09c41e756`, with 31 target-only and eight MIDI-only commits. Integration uses an isolated worktree and a two-parent merge, retaining both histories. The PR base remains master; no main merge or retarget is authorized.

Five textual conflicts were resolved deliberately: markup, character/MIDI styles, the MIDI workbench and changelog. The result keeps the incoming compact titlebar, one direct Panic, three file-menu operations, composite color drawers and runtime clock/rate work, together with the MIDI loudness, clips, conditions/layers, gap recording, skill footer and compositor note/layout display. Game range, keyboard and HUD controls share one speed-detent owner; the older UI module remains a compatible re-export. Native range navigation and text editing stay local while game shortcuts still route. Existing casino/art content was not changed by the integration.

Local validation covers the actual overlapping surfaces: 292 focused regression tests, 45 scheduler/rate tests, four wall-clock MIDI continuity tests and 46 HUD/minimap/palette regressions; formatting, lint, critical types and undefined-call checks passed. Native Edge desktop/mobile fixture interaction checks cover clip dragging/Undo, layered actual WebAudio dispatch, gap recording/Undo, persistent layouts, skill cards, titlebar/menu and horizontal overflow. A real classic level also boots with no page errors, Help/speed work from a focused range, canvas clicks release range focus and Panic works. This is not physical-device, listening or final owner visual acceptance. The repository serves browser modules directly and has no separate application build command.

The owner's historical stash remains `8083a3027fee27fb7a1cbac778e254626feafdfd`, and the original MIDI worktree remains intact. The older branch/PR inventory below is historical evidence, not the destination for this integration.

## Current publication

- [#960](https://github.com/doublemover/LemmingsJS-MIDI/pull/960): consolidated workbench, editor fixes, recovered character art and dependency refresh; draft. Head `97128aff` passed existing Node CI, coverage and dependency review. Its registry audit found **0 vulnerabilities**. Newer art/terrain source changes still need their final consolidated pass.
- [#959](https://github.com/doublemover/LemmingsJS-MIDI/pull/959): stale fast-uri 3.1.2 update, superseded by 3.1.8 in #960. Left open; no merge/close action taken.
- `editor-audit` (`56fb1498`): async MCP fix, all-level export and Xmas counts were selectively ported to #960. Old generated audit evidence and sample levels remain recoverable on the original branch. Its unsupported-transform tests are historical, not current acceptance.
- `tickstep-reverse` has the exact source tree of [merged #894](https://github.com/doublemover/LemmingsJS-MIDI/pull/894), despite differing commit ancestry. It is not missing sequencer work.
- Local-only sequencer `15fad599` and dependency `a3b607f` were not present in remote refs, fetch-by-SHA or saved Library recoveries. Their historical acceptance is not reused. Dependency remediation and workbench implementation were rebuilt from verified source; unknown unique bytes from those local checkpoints cannot honestly be claimed preserved. No local computer task was opened.

## Classification counts

- historical closed or unsubmitted alternative retained: 34
- contained in master: 42
- open PR: 1
- same tree as closed merged PR: 45
- patch-equivalent to master: 16
- merged PR source-equivalent, historical metadata differs: 13
- historical merged variant retained: 4
- open PR, superseded dependency fix in #960: 1
- recent editor work selectively integrated in #960; audit assets retained: 1
- historical compatibility experiment retained; not integrated: 1
- historical integration line; RGBA capability now in master: 1

## Full remote inventory

| Branch | Tip | Behind / ahead master | Finding | PR history |
|---|---|---:|---|---|
| `0and4w-codex/adjust-updateviewpoint-to-clamp-zoom-and-stabilize-cursor` | `fa55766f` | 1011 / 1 | historical closed or unsubmitted alternative retained | [451](https://github.com/doublemover/LemmingsJS-MIDI/pull/451) (closed) |
| `0xjpgc-codex/fix-syntaxerror-in-actionblockersystem.js` | `256b0452` | 1106 / 27 | historical closed or unsubmitted alternative retained | [95](https://github.com/doublemover/LemmingsJS-MIDI/pull/95) (closed) |
| `127mgd-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `1ox1qm-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `3f1l77-codex/rename-variable-info-to-sourceinfo` | `ec5664ff` | 881 / 0 | contained in master | None found |
| `3zn9gq-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `4abpwd-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `50l398-codex/update-zoom-function-for-stage-canvas` | `a7b9b741` | 1106 / 59 | historical closed or unsubmitted alternative retained | [53](https://github.com/doublemover/LemmingsJS-MIDI/pull/53) (closed) |
| `6a2eer-codex/rename-variable-info-to-sourceinfo` | `ec5664ff` | 881 / 0 | contained in master | None found |
| `7i5blz-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `8gxx4i-codex/fix-merge-metrics-action-error` | `6e35282b` | 882 / 0 | contained in master | None found |
| `9wsm05-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `anao2d-codex/fix-merge-metrics-action-error` | `6e35282b` | 882 / 0 | contained in master | None found |
| `armnm5-codex/add-unit-tests-for-binaryreader-and-bitreader` | `949c2f97` | 1108 / 6 | historical closed or unsubmitted alternative retained | [17](https://github.com/doublemover/LemmingsJS-MIDI/pull/17) (closed) |
| `atvosa-codex/update-references-to-.searchmetrics-and-move-directory` | `907b98c1` | 825 / 0 | contained in master | None found |
| `aurora-touchpoint-atlas` | `729b3af2` | 15 / 0 | contained in master | [896](https://github.com/doublemover/LemmingsJS-MIDI/pull/896) (merged) |
| `azajr5-codex/rename-variable-info-to-sourceinfo` | `ec5664ff` | 881 / 0 | contained in master | None found |
| `bqmrxh-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `btvav6-codex/review-and-update-changelog-and-readme` | `3c40f9fa` | 1104 / 111 | historical closed or unsubmitted alternative retained | [360](https://github.com/doublemover/LemmingsJS-MIDI/pull/360) (closed) |
| `cloud/live-instrument-20261007` | `97128aff` | 0 / 3 | open PR | [960](https://github.com/doublemover/LemmingsJS-MIDI/pull/960) (open) |
| `codex/add-benchmark-mode-with-configurable-entrances` | `b20c50f9` | 930 / 1 | same tree as closed merged PR | [513](https://github.com/doublemover/LemmingsJS-MIDI/pull/513) (merged) |
| `codex/add-canvasviewportsize-and-worlddatasize-getters` | `c62d7e55` | 882 / 2 | same tree as closed merged PR | [543](https://github.com/doublemover/LemmingsJS-MIDI/pull/543) (merged) |
| `codex/add-getters/setters-for-viewport-size` | `34be6b88` | 880 / 2 | same tree as closed merged PR | [544](https://github.com/doublemover/LemmingsJS-MIDI/pull/544) (merged) |
| `codex/add-keyboard-shortcuts-tests` | `a2a1001f` | 984 / 1 | historical closed or unsubmitted alternative retained | [470](https://github.com/doublemover/LemmingsJS-MIDI/pull/470) (closed) |
| `codex/add-level-loader-test-and-stubs` | `45bd22bb` | 1106 / 73 | historical closed or unsubmitted alternative retained | [216](https://github.com/doublemover/LemmingsJS-MIDI/pull/216) (closed) |
| `codex/add-npm-test-section-with-node-18-ci` | `502ca795` | 1105 / 8 | historical closed or unsubmitted alternative retained | [212](https://github.com/doublemover/LemmingsJS-MIDI/pull/212) (closed) |
| `codex/add-scalehqx-function-and-support` | `95e3c281` | 1038 / 1 | patch-equivalent to master | [414](https://github.com/doublemover/LemmingsJS-MIDI/pull/414) (merged) |
| `codex/add-test-case-for-userinputmanager` | `4c73ecc0` | 1095 / 1 | same tree as closed merged PR | [377](https://github.com/doublemover/LemmingsJS-MIDI/pull/377) (merged) |
| `codex/add-test-for-listsprites-script` | `d6a29834` | 658 / 2 | merged PR source-equivalent, historical metadata differs | [760](https://github.com/doublemover/LemmingsJS-MIDI/pull/760) (merged), [381](https://github.com/doublemover/LemmingsJS-MIDI/pull/381) (merged) |
| `codex/add-test-for-processhtmlfile-with-rewritepaths-and-inline` | `f8e4c6fc` | 644 / 4 | merged PR source-equivalent, historical metadata differs | [763](https://github.com/doublemover/LemmingsJS-MIDI/pull/763) (merged) |
| `codex/add-tests-for-archivedir-implementation` | `1a48a9c6` | 658 / 1 | same tree as closed merged PR | [761](https://github.com/doublemover/LemmingsJS-MIDI/pull/761) (merged) |
| `codex/add-tests-for-branches-at-lines-84-86` | `e1520160` | 562 / 3 | merged PR source-equivalent, historical metadata differs | [845](https://github.com/doublemover/LemmingsJS-MIDI/pull/845) (merged) |
| `codex/add-tests-for-gametimer-behavior` | `594fc521` | 1104 / 42 | same tree as closed merged PR | [279](https://github.com/doublemover/LemmingsJS-MIDI/pull/279) (merged) |
| `codex/add-tests-for-keyboard-shortcuts` | `28e32778` | 854 / 2 | same tree as closed merged PR | [571](https://github.com/doublemover/LemmingsJS-MIDI/pull/571) (merged) |
| `codex/add-tests-for-step-and-gap-handling` | `259fe8ad` | 626 / 3 | merged PR source-equivalent, historical metadata differs | [784](https://github.com/doublemover/LemmingsJS-MIDI/pull/784) (merged) |
| `codex/add-unit-tests-for-binaryreader-and-bitreader` | `aba23841` | 1108 / 6 | historical closed or unsubmitted alternative retained | [13](https://github.com/doublemover/LemmingsJS-MIDI/pull/13) (closed) |
| `codex/analyze-tvoicemgr-initialization-and-procedures` | `97a06bb6` | 537 / 1 | patch-equivalent to master | [873](https://github.com/doublemover/LemmingsJS-MIDI/pull/873) (merged) |
| `codex/augment-test-yml-with-actions` | `c940782c` | 1012 / 2 | same tree as closed merged PR | [429](https://github.com/doublemover/LemmingsJS-MIDI/pull/429) (merged) |
| `codex/build-test-for-filecontainer-unpacking` | `cfcd6163` | 1108 / 5 | historical closed or unsubmitted alternative retained | None found |
| `codex/confirm-presence-of-.bash_aliases-in-repo` | `69489f03` | 817 / 1 | historical merged variant retained | [604](https://github.com/doublemover/LemmingsJS-MIDI/pull/604) (closed), [603](https://github.com/doublemover/LemmingsJS-MIDI/pull/603) (merged) |
| `codex/convert-and-summarize-lemmings-save-file-format` | `c1cbb0dc` | 912 / 2 | same tree as closed merged PR | [514](https://github.com/doublemover/LemmingsJS-MIDI/pull/514) (merged) |
| `codex/cover-keyboard-event-paths-for-specific-lines` | `20dcd52c` | 642 / 2 | historical merged variant retained | [796](https://github.com/doublemover/LemmingsJS-MIDI/pull/796) (merged) |
| `codex/cover-lemming-spawning-and-removal` | `d29de6d4` | 642 / 2 | same tree as closed merged PR | [809](https://github.com/doublemover/LemmingsJS-MIDI/pull/809) (merged) |
| `codex/cover-lines-51-54-to-test-state-changes` | `7a0d1747` | 642 / 2 | merged PR source-equivalent, historical metadata differs | [777](https://github.com/doublemover/LemmingsJS-MIDI/pull/777) (merged) |
| `codex/cover-position-calculation-and-buffer-rendering` | `14a4ebd9` | 570 / 3 | merged PR source-equivalent, historical metadata differs | [840](https://github.com/doublemover/LemmingsJS-MIDI/pull/840) (merged) |
| `codex/create-.agentinfo-directory-with-index.md-and-example-note` | `21a055cd` | 1106 / 43 | same tree as closed merged PR | [113](https://github.com/doublemover/LemmingsJS-MIDI/pull/113) (closed), [103](https://github.com/doublemover/LemmingsJS-MIDI/pull/103) (merged) |
| `codex/create-agentinfo-documents-for-game-view` | `67593e0a` | 1106 / 4 | same tree as closed merged PR | [139](https://github.com/doublemover/LemmingsJS-MIDI/pull/139) (closed), [138](https://github.com/doublemover/LemmingsJS-MIDI/pull/138) (merged) |
| `codex/create-agentupdateusagecounts.js-and-update-npm-scripts` | `f66deab4` | 811 / 3 | historical closed or unsubmitted alternative retained | [609](https://github.com/doublemover/LemmingsJS-MIDI/pull/609) (closed) |
| `codex/create-animation-function-with-palette-swap` | `36c758e4` | 1107 / 12 | same tree as closed merged PR | [37](https://github.com/doublemover/LemmingsJS-MIDI/pull/37) (merged) |
| `codex/create-game-gui.md-note-for-gamegui.js` | `2fb4f0a5` | 1106 / 76 | same tree as closed merged PR | [123](https://github.com/doublemover/LemmingsJS-MIDI/pull/123) (merged) |
| `codex/create-integration-tests-for-upscale-functions` | `643bf726` | 563 / 3 | merged PR source-equivalent, historical metadata differs | [846](https://github.com/doublemover/LemmingsJS-MIDI/pull/846) (merged) |
| `codex/create-naming-cleanup-note-in-docs` | `c3ff42d0` | 902 / 2 | same tree as closed merged PR | [525](https://github.com/doublemover/LemmingsJS-MIDI/pull/525) (merged) |
| `codex/create-replay-documentation-and-update-readme` | `e8e71956` | 669 / 3 | same tree as closed merged PR | [744](https://github.com/doublemover/LemmingsJS-MIDI/pull/744) (merged) |
| `codex/create-search-history-workflow` | `309f981d` | 1010 / 1 | patch-equivalent to master | [432](https://github.com/doublemover/LemmingsJS-MIDI/pull/432) (merged) |
| `codex/create-test-categories-note-and-update-index` | `51d42058` | 847 / 1 | patch-equivalent to master | [588](https://github.com/doublemover/LemmingsJS-MIDI/pull/588) (merged) |
| `codex/create-test-for-crosshair-transparency` | `6686b285` | 943 / 2 | same tree as closed merged PR | [490](https://github.com/doublemover/LemmingsJS-MIDI/pull/490) (merged) |
| `codex/create-tests-for-canvas-utilities` | `85f8e8fe` | 984 / 1 | patch-equivalent to master | [463](https://github.com/doublemover/LemmingsJS-MIDI/pull/463) (merged) |
| `codex/describe-tpurplefont-and-tgamebasescreen-in-src/gamescreen.b` | `8c1c7b33` | 592 / 1 | same tree as closed merged PR | [865](https://github.com/doublemover/LemmingsJS-MIDI/pull/865) (merged) |
| `codex/document-replay-storage-and-hashing` | `00a29386` | 532 / 1 | patch-equivalent to master | [877](https://github.com/doublemover/LemmingsJS-MIDI/pull/877) (merged) |
| `codex/document-tlemmingaction-enumeration-values` | `150d9b04` | 592 / 1 | patch-equivalent to master | [857](https://github.com/doublemover/LemmingsJS-MIDI/pull/857) (merged) |
| `codex/enhance-test-for-l2ssspritedecoder` | `68028e7a` | 744 / 3 | historical merged variant retained | [666](https://github.com/doublemover/LemmingsJS-MIDI/pull/666) (merged) |
| `codex/ensure-triggerlemaction-sets-hasparachute-once` | `d4f4c7f2` | 786 / 2 | same tree as closed merged PR | [629](https://github.com/doublemover/LemmingsJS-MIDI/pull/629) (merged) |
| `codex/enumerate-tgamemenubitmap-values-and-sound-options` | `539b5db4` | 592 / 1 | patch-equivalent to master | [868](https://github.com/doublemover/LemmingsJS-MIDI/pull/868) (merged) |
| `codex/exercise-serialization-logic` | `a82915cd` | 595 / 2 | same tree as closed merged PR | [843](https://github.com/doublemover/LemmingsJS-MIDI/pull/843) (merged) |
| `codex/expand-tests-for-nodefileprovider` | `5f880288` | 860 / 1 | patch-equivalent to master | [576](https://github.com/doublemover/LemmingsJS-MIDI/pull/576) (merged) |
| `codex/extend-gametimer-test-and-add-assertions` | `66279a07` | 723 / 1 | patch-equivalent to master | [699](https://github.com/doublemover/LemmingsJS-MIDI/pull/699) (merged) |
| `codex/extend-or-split-test-for-action-systems` | `81f13660` | 830 / 1 | patch-equivalent to master | [593](https://github.com/doublemover/LemmingsJS-MIDI/pull/593) (merged) |
| `codex/extend-test/gameview.test.js-with-stub-for-stage.updatestage` | `8179d621` | 866 / 2 | same tree as closed merged PR | [559](https://github.com/doublemover/LemmingsJS-MIDI/pull/559) (merged) |
| `codex/fetch-and-convert-lemmings_vgaspecx-documentation` | `56acef67` | 914 / 2 | same tree as closed merged PR | [511](https://github.com/doublemover/LemmingsJS-MIDI/pull/511) (merged) |
| `codex/fix-and-update-gametimer-tests` | `d66d2499` | 742 / 1 | patch-equivalent to master | [676](https://github.com/doublemover/LemmingsJS-MIDI/pull/676) (merged) |
| `codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `codex/fix-auto-merging-search-metrics-workflow` | `7ca31fb1` | 813 / 0 | contained in master | None found |
| `codex/fix-fetch-error-in-list-sprites-command` | `8b79f508` | 1104 / 82 | same tree as closed merged PR | [319](https://github.com/doublemover/LemmingsJS-MIDI/pull/319) (merged) |
| `codex/fix-lemming-selection-functionality-and-add-debug-display` | `0a1bf908` | 1106 / 29 | historical closed or unsubmitted alternative retained | [38](https://github.com/doublemover/LemmingsJS-MIDI/pull/38) (closed) |
| `codex/fix-merge-metrics-action-error` | `6e35282b` | 882 / 0 | contained in master | None found |
| `codex/fix-statsync-reference-error-in-agent-update-searchmetrics` | `074d848f` | 930 / 1 | patch-equivalent to master | [512](https://github.com/doublemover/LemmingsJS-MIDI/pull/512) (closed), [508](https://github.com/doublemover/LemmingsJS-MIDI/pull/508) (merged) |
| `codex/fix-syntaxerror-in-actionblockersystem.js` | `ff855fb6` | 1106 / 30 | historical closed or unsubmitted alternative retained | [80](https://github.com/doublemover/LemmingsJS-MIDI/pull/80) (closed) |
| `codex/fix-viewport-adjustment-in-zoom-test` | `494d2b4f` | 740 / 3 | same tree as closed merged PR | [673](https://github.com/doublemover/LemmingsJS-MIDI/pull/673) (merged) |
| `codex/handle-output-directory-and-errors` | `5a06ebd6` | 584 / 4 | merged PR source-equivalent, historical metadata differs | [824](https://github.com/doublemover/LemmingsJS-MIDI/pull/824) (merged) |
| `codex/implement-lemming-selection-features` | `62876f85` | 1106 / 55 | same tree as closed merged PR | [109](https://github.com/doublemover/LemmingsJS-MIDI/pull/109) (merged) |
| `codex/implement-noresultqueries-logging-and-workflow` | `e6dbeefc` | 864 / 0 | contained in master | None found |
| `codex/increase-max-scale-and-improve-panning` | `6f541ffe` | 1104 / 74 | same tree as closed merged PR | [313](https://github.com/doublemover/LemmingsJS-MIDI/pull/313) (merged) |
| `codex/introduce-applyviewport-helper-in-stage.js` | `2bf83b1b` | 778 / 1 | historical closed or unsubmitted alternative retained | [641](https://github.com/doublemover/LemmingsJS-MIDI/pull/641) (closed) |
| `codex/investigate-viewpoint-logic-and-improve-test` | `f6cc79ee` | 778 / 1 | historical closed or unsubmitted alternative retained | [671](https://github.com/doublemover/LemmingsJS-MIDI/pull/671) (closed) |
| `codex/modify-anim_list-for-resource-metadata` | `de6f08a0` | 592 / 1 | same tree as closed merged PR | [851](https://github.com/doublemover/LemmingsJS-MIDI/pull/851) (merged) |
| `codex/modify-handleonzoom-to-check-display` | `b96c3333` | 1106 / 57 | same tree as closed merged PR | [116](https://github.com/doublemover/LemmingsJS-MIDI/pull/116) (merged) |
| `codex/refactor-stageimageproperties-and-update-tests` | `d18c0655` | 737 / 3 | same tree as closed merged PR | [677](https://github.com/doublemover/LemmingsJS-MIDI/pull/677) (merged) |
| `codex/remove-element-object-from-test` | `1ba5d6d6` | 1092 / 2 | same tree as closed merged PR | [373](https://github.com/doublemover/LemmingsJS-MIDI/pull/373) (merged) |
| `codex/remove-usage-count-related-code` | `733c7d60` | 786 / 0 | contained in master | None found |
| `codex/rename--data--to--buffer--in-loadbinary` | `89406ee1` | 881 / 1 | patch-equivalent to master | [550](https://github.com/doublemover/LemmingsJS-MIDI/pull/550) (merged) |
| `codex/rename-variable-info-to-sourceinfo` | `ec5664ff` | 881 / 0 | contained in master | None found |
| `codex/replicate-center-preserving-math-for-wheel-zoom` | `8703a5bd` | 778 / 1 | historical closed or unsubmitted alternative retained | [642](https://github.com/doublemover/LemmingsJS-MIDI/pull/642) (closed) |
| `codex/replicate-center-preserving-zoom-math-and-add-tests` | `8f415688` | 737 / 1 | historical closed or unsubmitted alternative retained | [679](https://github.com/doublemover/LemmingsJS-MIDI/pull/679) (closed) |
| `codex/review-and-test-timer-initialization` | `5eb999b6` | 911 / 1 | same tree as closed merged PR | [528](https://github.com/doublemover/LemmingsJS-MIDI/pull/528) (merged) |
| `codex/review-and-update-changelog-and-readme` | `e1c5d9e3` | 1104 / 111 | historical closed or unsubmitted alternative retained | None found |
| `codex/review-pascal-port-for-missing-animations-or-behaviors` | `93de9736` | 1107 / 3 | historical closed or unsubmitted alternative retained | [45](https://github.com/doublemover/LemmingsJS-MIDI/pull/45) (closed) |
| `codex/review-src/game.rendering.pas-methods-and-functions` | `baa3e185` | 592 / 1 | same tree as closed merged PR | [861](https://github.com/doublemover/LemmingsJS-MIDI/pull/861) (merged) |
| `codex/summarize-state-changes-in-action-handlers` | `5ecd45c3` | 592 / 1 | historical closed or unsubmitted alternative retained | [872](https://github.com/doublemover/LemmingsJS-MIDI/pull/872) (closed) |
| `codex/test-burn/exit-logic-at-lines-24-25` | `1393e4ce` | 631 / 3 | merged PR source-equivalent, historical metadata differs | [779](https://github.com/doublemover/LemmingsJS-MIDI/pull/779) (merged) |
| `codex/test-checksum-validation` | `44624599` | 569 / 3 | merged PR source-equivalent, historical metadata differs | [832](https://github.com/doublemover/LemmingsJS-MIDI/pull/832) (merged) |
| `codex/update-bench-mode-entrance-timing-and-speed-handling` | `c0f9ec23` | 668 / 3 | historical closed or unsubmitted alternative retained | [748](https://github.com/doublemover/LemmingsJS-MIDI/pull/748) (closed) |
| `codex/update-bench-series-mode-logic` | `acea95ab` | 823 / 0 | contained in master | None found |
| `codex/update-benchstart-to-choose-valid-spawn-locations` | `2155d37e` | 878 / 1 | historical closed or unsubmitted alternative retained | [556](https://github.com/doublemover/LemmingsJS-MIDI/pull/556) (closed) |
| `codex/update-changelog.md-with-recent-commits` | `0c951486` | 697 / 3 | merged PR source-equivalent, historical metadata differs | [719](https://github.com/doublemover/LemmingsJS-MIDI/pull/719) (merged) |
| `codex/update-ci.md-with-npm-check-undefined-step` | `f61c90a6` | 1102 / 115 | same tree as closed merged PR | [352](https://github.com/doublemover/LemmingsJS-MIDI/pull/352) (merged) |
| `codex/update-cursor-size-to-16x16` | `5a0facee` | 1104 / 37 | historical merged variant retained | [298](https://github.com/doublemover/LemmingsJS-MIDI/pull/298) (closed), [290](https://github.com/doublemover/LemmingsJS-MIDI/pull/290) (merged), [269](https://github.com/doublemover/LemmingsJS-MIDI/pull/269) (merged) |
| `codex/update-death-dots-handling-in-lemming-manager` | `eb16699d` | 1108 / 26 | historical closed or unsubmitted alternative retained | [24](https://github.com/doublemover/LemmingsJS-MIDI/pull/24) (closed) |
| `codex/update-display-dimensions-after-canvas-resize` | `3d71bd5e` | 1024 / 1 | patch-equivalent to master | [420](https://github.com/doublemover/LemmingsJS-MIDI/pull/420) (merged) |
| `codex/update-gamegui-to-call-updatestagesize` | `2837fac7` | 778 / 3 | historical closed or unsubmitted alternative retained | [636](https://github.com/doublemover/LemmingsJS-MIDI/pull/636) (closed) |
| `codex/update-image-decoding-logic` | `68c3d5fa` | 592 / 1 | same tree as closed merged PR | [850](https://github.com/doublemover/LemmingsJS-MIDI/pull/850) (merged) |
| `codex/update-input-to-support-multi-touch-zoom-and-scroll` | `c7f57e5c` | 1108 / 15 | historical closed or unsubmitted alternative retained | [25](https://github.com/doublemover/LemmingsJS-MIDI/pull/25) (closed) |
| `codex/update-lemmings-level-file-format-documentation` | `1a0526b0` | 913 / 2 | same tree as closed merged PR | [510](https://github.com/doublemover/LemmingsJS-MIDI/pull/510) (merged) |
| `codex/update-level-display-width` | `2b6d7286` | 1104 / 40 | same tree as closed merged PR | [276](https://github.com/doublemover/LemmingsJS-MIDI/pull/276) (merged) |
| `codex/update-merge-agentinfo-index-with-bulletpoints` | `baf255e9` | 882 / 2 | historical closed or unsubmitted alternative retained | [542](https://github.com/doublemover/LemmingsJS-MIDI/pull/542) (closed) |
| `codex/update-merge-scripts-to-handle-empty-objects` | `a436c27c` | 557 / 2 | historical closed or unsubmitted alternative retained | [875](https://github.com/doublemover/LemmingsJS-MIDI/pull/875) (closed) |
| `codex/update-processimage-for-rgba-handling` | `a8d4c04f` | 592 / 1 | same tree as closed merged PR | [854](https://github.com/doublemover/LemmingsJS-MIDI/pull/854) (merged) |
| `codex/update-readme.md-play-locally-section` | `9d7565b1` | 1106 / 7 | same tree as closed merged PR | [55](https://github.com/doublemover/LemmingsJS-MIDI/pull/55) (merged) |
| `codex/update-references-to-.searchmetrics-and-move-directory` | `907b98c1` | 825 / 0 | contained in master | None found |
| `codex/update-replay-documentation-and-notes` | `238f554e` | 903 / 2 | same tree as closed merged PR | [523](https://github.com/doublemover/LemmingsJS-MIDI/pull/523) (merged) |
| `codex/update-search.js-to-exclude-index-results` | `c6b94660` | 796 / 3 | merged PR source-equivalent, historical metadata differs | [622](https://github.com/doublemover/LemmingsJS-MIDI/pull/622) (merged) |
| `codex/update-sprite-loading-and-frame-packing` | `1ec1ac71` | 1104 / 95 | same tree as closed merged PR | [331](https://github.com/doublemover/LemmingsJS-MIDI/pull/331) (merged) |
| `codex/update-stage-size-calculations-and-tests` | `946447b1` | 1104 / 93 | historical closed or unsubmitted alternative retained | [334](https://github.com/doublemover/LemmingsJS-MIDI/pull/334) (closed) |
| `codex/update-tests-for-lemmingmanager` | `63376e36` | 712 / 3 | same tree as closed merged PR | [703](https://github.com/doublemover/LemmingsJS-MIDI/pull/703) (merged) |
| `codex/update-write-logic-to-resolve-on-finish-event` | `42c64db6` | 1104 / 85 | same tree as closed merged PR | [327](https://github.com/doublemover/LemmingsJS-MIDI/pull/327) (merged) |
| `codex/update-zoom-function-for-stage-canvas` | `639c074c` | 1107 / 18 | historical closed or unsubmitted alternative retained | [49](https://github.com/doublemover/LemmingsJS-MIDI/pull/49) (closed) |
| `codex/update-zoom-function-to-scale-evenly` | `464b261d` | 1108 / 14 | historical closed or unsubmitted alternative retained | [26](https://github.com/doublemover/LemmingsJS-MIDI/pull/26) (closed) |
| `codex/write-tests-for-argument-parsing` | `dc7ab13a` | 585 / 3 | same tree as closed merged PR | [823](https://github.com/doublemover/LemmingsJS-MIDI/pull/823) (merged) |
| `codex/write-tests-for-byte-parsing` | `0e990ee5` | 595 / 2 | same tree as closed merged PR | [844](https://github.com/doublemover/LemmingsJS-MIDI/pull/844) (merged) |
| `codex/write-tests-for-game-logic` | `39bd4f9c` | 984 / 1 | patch-equivalent to master | [465](https://github.com/doublemover/LemmingsJS-MIDI/pull/465) (merged) |
| `cwq8rd-codex/fix-merge-metrics-action-error` | `6e35282b` | 882 / 0 | contained in master | None found |
| `d4v6vc-codex/rename-variable-info-to-sourceinfo` | `ec5664ff` | 881 / 0 | contained in master | None found |
| `dependabot/npm_and_yarn/npm_and_yarn-053c9c4054` | `e3fd2822` | 10 / 1 | open PR, superseded dependency fix in #960 | [#959](https://github.com/doublemover/LemmingsJS-MIDI/pull/959) |
| `editor-audit` | `56fb1498` | 1 / 2 | recent editor work selectively integrated in #960; audit assets retained | None found |
| `ew45p2-codex/update-references-to-.searchmetrics-and-move-directory` | `907b98c1` | 825 / 0 | contained in master | None found |
| `glitchflags` | `aeb5a977` | 561 / 1 | historical compatibility experiment retained; not integrated | None found |
| `gojq2y-codex/update-bench-series-mode-logic` | `a78b69df` | 818 / 14 | historical closed or unsubmitted alternative retained | [601](https://github.com/doublemover/LemmingsJS-MIDI/pull/601) (closed) |
| `gs89q5-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `hapq14-codex/update-bench-series-mode-logic` | `7223343c` | 817 / 6 | merged PR source-equivalent, historical metadata differs | [602](https://github.com/doublemover/LemmingsJS-MIDI/pull/602) (merged) |
| `hires32` | `27b10330` | 592 / 15 | historical integration line; RGBA capability now in master | None found |
| `im8a1x-codex/fix-syntaxerror-in-actionblockersystem.js` | `7a9e25bd` | 1106 / 27 | historical closed or unsubmitted alternative retained | [84](https://github.com/doublemover/LemmingsJS-MIDI/pull/84) (closed) |
| `lsxsxy-codex/fix-merge-metrics-action-error` | `6e35282b` | 882 / 0 | contained in master | None found |
| `master` | `7366e5f9` | 0 / 0 | contained in master | None found |
| `mf47cy-codex/update-references-to-.searchmetrics-and-move-directory` | `907b98c1` | 825 / 0 | contained in master | None found |
| `ofjl87-codex/update-references-to-.searchmetrics-and-move-directory` | `907b98c1` | 825 / 0 | contained in master | None found |
| `p3y1or-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `portinfodump` | `0a3bda56` | 512 / 0 | contained in master | None found |
| `rcrfb9-codex/add-unit-tests-for-binaryreader-and-bitreader` | `7f0ce188` | 1108 / 6 | historical closed or unsubmitted alternative retained | [29](https://github.com/doublemover/LemmingsJS-MIDI/pull/29) (closed) |
| `refactor` | `18523e18` | 1140 / 0 | contained in master | [7](https://github.com/doublemover/LemmingsJS-MIDI/pull/7) (merged) |
| `rmh4kl-codex/fix-merge-metrics-action-error` | `6e35282b` | 882 / 0 | contained in master | None found |
| `rycx2x-codex/fix-merge-metrics-action-error` | `6e35282b` | 882 / 0 | contained in master | None found |
| `s40thi-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `t5wdhn-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `tickstep-reverse` | `ebe42903` | 489 / 23 | same tree as closed merged PR | [#894](https://github.com/doublemover/LemmingsJS-MIDI/pull/894) (merged, exact tree) |
| `udsdce-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `uerepw-codex/fix-merge-metrics-action-error` | `6e35282b` | 882 / 0 | contained in master | None found |
| `vcq2z0-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `wiwqa7-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `ww6wct-codex/fix-auto-merge-action-error` | `a829d271` | 929 / 0 | contained in master | None found |
| `ylck4b-codex/fix-syntaxerror-in-actionblockersystem.js` | `4daa35ef` | 1106 / 30 | historical closed or unsubmitted alternative retained | [82](https://github.com/doublemover/LemmingsJS-MIDI/pull/82) (closed) |

No old branch was deleted, reset, force-pushed or indiscriminately merged. Historical closed alternatives are retained, not represented as newly tested work. Remaining implementation priorities stay in `docs/roadmap.md`.


## Parked sequencer functionality reconciliation

The original local commit is unavailable. The following behaviors were checked
against the current source instead of treating the missing commit as missing
functionality:

- Routing/import validation: `MidiProject.js` rejects unknown kind/version,
  malformed collections, duplicate track IDs, and dangling track/clip routes.
  Portable templates remove device identifiers. Project and voice-gate tests
  cover these cases; rejected imports do not call the UI project commit path.
- Shared MPE allocation: default and explicitly named routes to the same output
  now normalize to one channel namespace, across tracks. Changing sound mappings
  alone no longer reinitializes the entire MPE device.
- Program selection: tracks preserve an optional zero-based program (0–127),
  including program 0, through project export/import and mapping. The selected
  program is sent at the actual external note onset; blank leaves it unchanged.
- Cancellation and stolen voices: scheduler-owned future onsets and releases
  stay cancellable until due. Stealing removes the prior gate; it cannot later
  stop or bend-reset the replacement. Panic cancels pending onsets even without
  native `clear()`. Repeated MIDI 1.0 pitches explicitly transfer gate ownership
  to the latest retrigger on that output/channel.
- Evidence: `test/midi/midi-scheduler-voice-gates.test.js`, the scheduler suites,
  project tests, phrase-retarget tests and preview-isolation regressions. These
  are new source-level repairs and verification, not recovered historical tests.

The canceled local dependency line is functionally superseded by the current
locked graph and verified 0-vulnerability CI audit. Unknown differences from its
unavailable exact source are still unknown. Physical MIDI timing and listening
acceptance remain open, including host-timer jitter in cancellable dispatch.
