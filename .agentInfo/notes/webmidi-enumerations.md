tags: webmidi, enumerations, doc

`js/webmidi.js` exposes numerous enums via the `Enumerations` class:
- `ANY_EVENT` – symbol for listeners that react to all events.
- `CHANNEL_MESSAGES` – map of channel message types such as `noteon`, `noteoff`, `controlchange` and more.
- `CHANNEL_MODE_MESSAGES` – numbers for channel mode commands like `allsoundoff` and `omnimodeon`.
- `CONTROL_CHANGE_MESSAGES` – array describing every control change number with its name and description.
- `CHANNEL_NUMBERS` – array of the 16 valid MIDI channels.
- `REGISTERED_PARAMETERS` – table of RPN identifiers.
- `SYSTEM_MESSAGES` – constants for system common and real-time messages.
- `CHANNEL_EVENTS` – array of all event names that `Input` can emit.
Deprecated aliases (`MIDI_CHANNEL_MESSAGES`, `MIDI_CONTROL_CHANGE_MESSAGES`, etc.) are kept for backward compatibility.
