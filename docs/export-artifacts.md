# Prepared export delivery

`prepareExportArtifact` snapshots text or binary bytes into an immutable Blob
with a source reference, format version, media type, filename, size and expiry.
It retains one bounded source for repeated delivery; callers explicitly discard
it when replacing an export or retiring its owner. Files up to 8 MiB acquire a
SHA-256 digest when Web Crypto is available. Larger prepared files report
`omitted-over-budget` rather than hashing a second whole-file buffer.

An anchor delivery returns `delivery-requested` only after the click handler
returns. The browser does not report whether the user accepted the download or
whether the file was saved. Object URLs and temporary nodes are released after
each request, including failures. A failed request does not destroy the
prepared artifact.

`requestExportFileHandle` calls the feature-detected save picker before its
first await so that a user gesture can authorize it. The chosen handle can be
passed to `deliverArtifactToFileHandle`, which streams chunks through
`createWritable`, waits for write backpressure, and reports
`close-acknowledged` only after `close()` resolves. This is an API receipt,
not proof of disk durability or another application's successful read. Picker
cancellation, permission errors, quota errors, write errors, close errors,
timeouts and artifact expiry have distinct outcome fields. Cancellation and
artifact retirement abort owned writes, including a handle that opens late.
Each sink operation has a 30-second deadline inside a five-minute delivery
budget by default; an overdue stream is reported as failed with an attempted
abort, not as a completed save.

The workstation uses prepared artifact retry for project JSON and recorded
MIDI. Its **Save file** action calls the picker synchronously from the button
gesture, then streams the selected artifact. The compact export details show
the frozen source reference, format, digest state, size and last delivery
receipt. **Discard file** releases prepared bytes without changing the source
project. Streaming encoder integration, persistent staging,
workstation multi-stem orchestration and platform-specific picker qualification
remain separate work under #1046, #1162 and #1171.

The workstation exposes **Cancel delivery** while the File API write is active.
That aborts the write and leaves the prepared artifact available for another
attempt. **Discard file** cancels an active delivery and releases the artifact.

`prepareReplayableExportArtifact` accepts an immutable source reference and a
fresh async chunk iterator for each delivery attempt. Its file-handle sink
writes with backpressure and enforces a declared byte count and maximum without
building a whole-output Blob. Anchor delivery is explicitly unsupported for
this kind of artifact. Streaming digests are reported as omitted until an
incremental browser hash is available. `createExportDeliveryManifest` groups
independent artifacts and all attempts per file; it marks a multi-file export
complete only when each file's latest attempt has a close acknowledgement.
The workstation does not yet prepare its project and MIDI files through this
streaming path, and WAV/stem producers still need to adopt it.
