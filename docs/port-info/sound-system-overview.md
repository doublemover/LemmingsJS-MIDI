# Sound system overview

This note summarizes how sound handling was ported from the Lemmix project,
based on Pascal sources. It explains initialization, key classes, sound effect
constants, and behaviour for overlapping sounds.

## Library initialization and WinAPI fallback

`SoundLibrary.Init` checks the BASS version and initializes the audio subsystem.
If initialization fails or the library cannot be used, sound playback falls back
to Windows API `PlaySound` calls for effects. BASS is used when available, and
allows features like overlapping sound effects and volume control for music and
sound.

## Class responsibilities

- **`TSound`**
  - Loads a sound resource using `TData.CreatePointer`.
  - Creates a handle via `SoundLibrary.CreateSoundHandle`.
  - Provides `Play` and `SetVolume` methods that delegate to `SoundLibrary`.

- **`TMusic`**
  - Loads a MOD or MP3 track.
  - Creates a stream handle with `SoundLibrary.CreateMusicHandle`.
  - Supports `Play`, `Stop`, and volume changes.

- **`TSoundMgr`**
  - Maintains lists of `TSound` and `TMusic` objects.
  - Offers methods to add sounds, play them by index, and adjust volumes.

## Sound effect constants and custom files

`SoundData.Create` initializes integer constants like `SFX_BUILDER_WARNING` to
`-1`. `SoundData.Init` then loads each effect either from default resources or
from a custom folder. When `useCustom` is true, `.mp3` or `.wav` files present
in the custom directory override the defaults.

## Overlapping sounds and music volume

`PlaySound` checks if a sound is already playing. If so and it has been playing
for at least 0.1 seconds, a temporary stream with `BASS_STREAM_AUTOFREE` is
created so multiple copies can overlap. Music volume is adjusted via
`BASS_ChannelSetAttribute` and constrained to the 0.0–1.0 range.

