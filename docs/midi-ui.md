# MIDI UI guide

The MIDI UI is split into left and right control panes. Enable MIDI before
editing mappings; the toggle state persists in localStorage.

## Left pane

- MIDI enabled: master toggle. Disabling detaches the router.
- Reset all: clears stored overrides and UI state back to defaults.
- I/O section: input, output, input channel, and MIDI reset.
- Base BPM: master sequencing tempo; current BPM reflects game speed.
- Global FX tab:
  - Intensity and Accent sliders adjust velocity and density scaling.
  - Positional Modifiers map X/Y to targets with optional operators and min/max
    ranges.
  - Global Repeat applies a beat window, max count, and scaling target.

## Right pane

- Events: configure each SFX event with note/degree/chord modes.
- Triggers: map trigger events with optional arpeggiators.
- ADSR: per-target envelope overrides for attack/decay/sustain/release.

## Persistence

UI state is stored in localStorage. Defaults come from `midi-mapping.json` and
apply only when no stored value exists or after Reset all.
