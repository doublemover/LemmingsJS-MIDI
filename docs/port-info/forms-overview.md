# Forms and Screen Lifecycle

The original Delphi version uses a stack of **forms** to manage menus and game screens. Each form represents a full-screen window with its own event handlers. The JavaScript port mirrors this behaviour with DOM elements and modules that expose the same callbacks.

## Opening a screen

`TApp.FormBegin` pushes a form onto `fFormStack` and stores it in `fCurrentForm`. The form then calls `OpenScreen` to create bitmaps and register keyboard/mouse listeners. Some screens preload assets or initialize global state during this phase.

## Event flow

Once open, the screen receives `Form_KeyDown`, `Form_KeyUp` and `Form_KeyPress` events for keyboard input along with mouse events like `Img_MouseDown` and `Img_MouseMove`. `Application_Idle` polls timers each tick to drive game updates. This is described in more detail in [gamescreen-player.md](gamescreen-player.md).

## Closing a screen

Before a form closes, `BeforeCloseScreen` in [game-screen-base.md](game-screen-base.md) can delay for `fCloseDelay` milliseconds and perform a fade-out. `TApp.FormEnd` then pops the stack so the previous form becomes active again. Interrupts iterate over the stack backwards to close every form cleanly.

## Replicating the original behaviour

The port keeps the same stack-based model and method names to ease comparison with the Pascal code. JavaScript classes implement the same sequence of calls so menu navigation and in-game transitions match the original.

Related documents:
- [TApp lifecycle overview](TApp-overview.md)
- [GameScreen.Base port notes](game-screen-base.md)
- [Lemmix Configuration Summary](lemix-config.md)
- [Lemmix GameScreen.Player overview](gamescreen-player.md)
