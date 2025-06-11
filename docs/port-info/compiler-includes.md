# Compiler and Resource Includes

This note summarizes two include files from the original [Lemmix repository](https://github.com/ericlangedijk/Lemmix):
`lem_directives.inc` and `lem_resources.inc`. The directives file controls Delphi
compile settings while the resources file lists the `.RES` bundles linked into
the executable. The JavaScript port loads the same assets directly from the
repository.

## lem_directives.inc

The file is divided into numbered sections:

1. **Program info** – defines `beta` so beta builds append the word "beta" to the
   executable name.
2. **Executable size** – enables `{$weaklinkrtti on}` and restricts RTTI to
   keep the binary small.
3. **Compiler directives** – required options for the project:
   - `{$pointermath on}`
   - `{$rangechecks off}`
   - `{$overflowchecks off}`
   - `{$scopedenums on}`
4. **Release / debug options** – toggles optimization and debug info. Debug builds
   can define `fastdebug` for optimized debugging or `paranoid` for heavy
   assertions.
5. **Debug logging** – when `debug` is defined the build can enable optional
   logging flags such as `log_transitions` and `log_assignments`.

These directives have no direct equivalent in the Node port. Instead debug
behaviour is controlled by environment variables and command line flags while the
runtime is optimized by default.

## lem_resources.inc

This include lists every resource bundle compiled into the Delphi executable:

- `Assets.RES` – fonts and UI sprites
- `Misc.RES` – additional data tables
- `Cursors.RES` – mouse cursors
- `Particles.RES` – explosion and effect sprites
- `Sounds.RES` – sound effects
- `Custom.RES` – placeholder for user resources
- `orig.RES`, `ohno.RES`, `h94.RES`, `x91.RES`, `x92.RES` – style graphics from
  the original games and holiday packs
- `orig_music.RES`, `ohno_music.RES`, `h94_music.RES` – music tracks for those
  packs

In this repository the contents of these RES files live in folders such as
`lemmings/`, `lemmings_ohNo/`, `xmas91/`, `xmas92/`, `holiday93/` and
`holiday94/`. The JS code loads them through `NodeFileProvider` rather than via
Delphi resource sections.
