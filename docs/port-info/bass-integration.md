# BASS integration notes

This document summarizes `src/bass.pas` from [Lemmix](https://github.com/ericlangedijk/Lemmix) and how the JavaScript port handles BASS.

## Pascal wrapper overview

The Pascal unit defines constants and function signatures from the BASS library. Key routines include:

- `BASS_GetVersion` – returns the DLL version.
- `BASS_Init(device, freq, flags, win, clsid)` – opens an audio device.
- `BASS_Free` – releases the device and all resources.
- `BASS_StreamCreateFile` – loads a file as a stream handle.
- `BASS_ChannelPlay` / `BASS_ChannelStop` – start and stop playback.

`bass.pas` exposes these functions so Lemmix can call the native DLL directly.

## JavaScript wrapper status

The current code base only provides stub methods (`playMusic`, `stopMusic`, `playSound`, `stopSound`) in `GameView`. They do not call BASS or any audio API yet. A direct wrapper similar to `bass.pas` has not been implemented.

## Function mapping

| Pascal function | JavaScript equivalent |
|-----------------|----------------------|
| `BASS_Init` | *(not implemented)* |
| `BASS_Free` | *(not implemented)* |
| `BASS_StreamCreateFile` | future WebAudio/BASS wrapper |
| `BASS_ChannelPlay` | `playSound` / `playMusic` stubs |
| `BASS_ChannelStop` | `stopSound` / `stopMusic` stubs |

Initialization in Pascal occurs explicitly via `BASS_Init`, while the JavaScript stubs currently do nothing. They will eventually initialize WebAudio or a BASS binding when implemented.

For additional information on sound handling, see [sound-system-overview.md](sound-system-overview.md).
