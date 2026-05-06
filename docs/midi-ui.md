# MIDI UI Guide

The current MIDI UI is a two-pane configuration surface layered over the game.
Enable MIDI before editing mappings; the toggle state persists in localStorage.

## Left pane

- MIDI enabled: master toggle. Disabling detaches the router.
- Reset all: clears stored mapping state and UI state back to defaults.
- I/O section: input, output, input channel, and MIDI reset.
- Base BPM: master sequencing tempo; current BPM reflects game speed.
- MIDI Debug: shows the last MIDI input and output message.
- Global FX tab:
  - Intensity and Accent sliders adjust velocity and density scaling.
  - Positional Modifiers map X/Y to targets with optional operators and min/max
    ranges.
  - Global Repeat applies a beat window, max count, and scaling target.

## Right pane

- Events: configure each SFX event with note/degree/chord modes.
  - Expressive controls: keyboard-style note picker with octave shift,
    arp presets + step pattern editor, and per-entry Preview audition button.
- Triggers: map trigger events with optional arpeggiators.
- ADSR: per-target envelope overrides for attack/decay/sustain/release.

## Feature flags

- `?mau=true|false` (`midiAudition`): enable/disable preview audition controls.

## Persistence

UI state is stored in localStorage. Defaults come from `midi-mapping.json` and
apply only when no stored value exists or after Reset all.

- `lemmings.midi.intent` stores versioned `MidiIntent` state.
- `lemmings.midi.overrides` is a compatibility mirror of the active overrides
  used by current migration tests and older local data.

## Visual and E2E coverage

- `npm run capture:e2e:midi` captures the current MIDI controls under
  `temp/e2e-captures/`.
- `e2e/midi-ui.spec.js` covers the deterministic UI automation path using
  mocked WebMIDI where needed.
