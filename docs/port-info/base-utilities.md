# Base utilities overview

This document summarizes helper modules from the Pascal **Lemmix**
codebase and notes how their responsibilities map to the JavaScript
implementation.  Source files reviewed:

- `Base.Utils.pas`
- `Base.Bitmaps.pas`
- `Base.Types.pas`
- `Base.Strings.pas`

## Key data structures and helper routines

### `Base.Utils.pas`

`Base.Utils` gathers small utility types and procedures. Notable
structures include:

- **`TIdle`** – manages `Application.OnIdle` callbacks with optional
  activate/deactivate hooks.
- **`TempCursor`** – RAII helper that temporarily changes the mouse
  cursor (usually to an hourglass).
- **`THelpString`** – builds tab‑separated help text and can split the
  result back into key/value arrays.
- **`TTicker`** – simple timer record used for periodic updates.
- **`TDisplayInfo`** – stores monitor DPI, bounds and provides
  `CalcTextExtent` helpers.
- **`TFastObjectList<T>`** – typed object list with a custom enumerator
  for fast `for in` loops.
- **`TStringArrayHelper`** – adds `IndexOf`, `Contains` and sorting
  methods to `TArray<string>`.

Other routines deal with file paths (`ForceDir`, `ReplaceFileExt`),
string manipulation (`LeadZeroStr`, `ThousandStr`, `SpaceCamelCase`),
user interaction (`SelectFileDlg`, `Dlg`) and system startup
(`InitializeLemmix`, `FinalizeLemmix`).

### `Base.Bitmaps.pas`

Graphics helpers built on top of Graphics32.

- **`TColor32Helper`** – convenience getters/setters for RGBA components
  and conversions to HSL or greyscale.
- **`TBitmap32Helper`** – converts bitmaps to and from PNG/WIC formats,
  replaces colors or alpha channels and performs simple frame rectangle
  calculations.
- **`TBitmapFont`** – supports irregular character widths by keeping a
  frame list and drawing each character bitmap individually.

### `Base.Types.pas`

Contains many enums and sets used across the program. Examples include
`TStyleDef`, `TGameOption`, `TSoundOption` and helpers that convert
them to strings or provide default value sets. The file also defines
`TGameResultsRec` and several screen/option enumerations used by other
modules.

### `Base.Strings.pas`

Holds the `TGlobalTexts` class which loads/saves localised strings. It
also defines program text constants such as menu labels, credits and
various screen messages.

## Usage patterns in Pascal

These units centralize low‑level helpers. Other modules `uses` them to
access typed collections, string routines, colour conversions and
configuration enums. `InitializeLemmix` ensures only one instance runs
at a time and prepares global variables like `CurrentDisplay` for DPI
scaling.

## JavaScript equivalents

The JavaScript port implements similar functionality through dedicated
modules:

- `BinaryReader.js` and `BitReader.js` provide buffered file reading and
  bit‑level decompression.
- `ViewPoint.js` exposes clamping helpers for viewport coordinates.
- `Stage.js` handles scaling and display information for the canvas
  instead of `TDisplayInfo`.
- Utility functions (e.g. `clamp` logic in `Stage` and array helpers in
  many files) replace the Pascal helpers as needed.
- Graphics manipulation uses the browser canvas and WebGL wrappers
  rather than `TBitmap32Helper`.

While the exact class structure differs, the port retains a similar
separation between utility code and high‑level game logic.
