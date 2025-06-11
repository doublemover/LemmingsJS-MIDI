# Style Loading Overview

This document summarises how the original Pascal source manages style data. Styles contain graphics, animations and level files. Each style lives in its own folder under `Consts.PathToStyles`.

## Directory layout

```
<Styles root>/
  <style>/
    MAIN.DAT        # sprites and animations
    VGAGR*.DAT      # terrain graphics
    GROUND*.DAT     # level metadata
    LEVEL*.DAT      # level files
    Style.config    # optional user overrides
```

`Prog.Base.pas` computes paths with helpers like `GetPathToStyle` and `GetPathToLemmings`. When a user style includes `Style.config`, fields such as `family`, `graphics`, `specialgraphics`, `maindat` and `mechanics` customize how assets are loaded.

## Factory creation

`Styles.Factory.pas` exposes a `TStyleFactory` with a small object pool:

```pascal
class var StylePool: TObjectDictionary<string, TStyle>;
class procedure Init; static;
class procedure Done; static;
class function CreateStyle(preventPooling: Boolean): TStyle; static;
```

`CreateStyle` reads `Consts.StyleDef` and instantiates `TDosOrigStyle`, `TDosOhNoStyle`, `TDosH94Style`, `TDosX91Style`, `TDosX92Style` or `TUserStyle`. Instances are cached unless `preventPooling` is `True`【F:https://raw.githubusercontent.com/ericlangedijk/Lemmix/master/src/Styles.Factory.pas†L13-L60】.

User styles derive from `TUserStyle` (defined in `Styles.User.pas`). The constructor stores mapping preferences read from `Style.config` so the level system knows which graphic sets and mechanics to use【F:https://raw.githubusercontent.com/ericlangedijk/Lemmix/master/src/Styles.User.pas†L20-L33】【F:https://raw.githubusercontent.com/ericlangedijk/Lemmix/master/src/Prog.Base.pas†L320-L372】.

## User overrides

`Prog.Base.pas` parses `Style.config` when discovering style folders. Options control family (`DOS` or `LEMMINI`), graphics mapping (orig, ohno or concat), special graphics mapping and mechanics. If `maindat=OHNO` the purple font is loaded from a different location. Unknown fields keep defaults【F:https://raw.githubusercontent.com/ericlangedijk/Lemmix/master/src/Prog.Base.pas†L324-L361】.

## Differences in the JavaScript port

The JavaScript version currently loads assets directly from `config.json`. Each entry specifies a style name, path and level order. `GameResources` fetches `MAIN.DAT` and level data from the configured path but there is no style factory or pooling yet. User styles and `Style.config` parsing are not implemented.
