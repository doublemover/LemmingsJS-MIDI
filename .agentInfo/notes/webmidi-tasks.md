<<<<<<< tmp_merge/ours_.agentInfo_notes_webmidi-tasks.md
=======
# WebMIDI follow-up tasks

tags: webmidi-todo

Several TODOs remain in `js/webmidi.js`.

1. **Investigate `sendMasterTuning()`** – Line 3597 mentions allowing a MSB/LSB pair. Check how master tuning is encoded via Registered Parameter Number 0x0003 and support passing an array similar to `sendPitchBendRange()`. See the [RPN table](https://www.midi.org/specifications/midi-reference-tables/registered-parameter-numbers).
2. **Standardize MSB/LSB handling** – `sendPitchBend()` and `sendPitchBendRange()` (around lines 3759‑3833) parse MSB and LSB values differently. Normalize argument formats. GitHub [issue #442](https://github.com/djipco/webmidi/issues/442) provides context on MSB/LSB processing.
3. **Evaluate `Output.clear()` support** – Lines 4552‑4565 warn that `Output.clear()` is not widely implemented. Follow [issue #52](https://github.com/djipco/webmidi/issues/52) for browser support and consider using `sendChannelMode('allnotesoff')` as a fallback as recommended in the spec.

4. **Review `going-further/performance.md`** – The WebMIDI docs include a performance guide with tips on message batching, per-channel calls and other optimizations. Review these suggestions and profile our usage for improvement opportunities.
5. **Summarize `going-further/sysex.md`** – Gather best practices on system-exclusive messages including permission prompts and manufacturer IDs. Distill the key points for quick reference.
6. **Check TypeScript definitions** – The docs mention `.d.ts` files providing typed WebMIDI APIs. Inspect these definitions for hints on optional parameters and method overloads.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_webmidi-tasks.md
