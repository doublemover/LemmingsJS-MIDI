# Architecture Overview

This page ties together the various notes about the Pascal source used for **Lemmix**. Each section below points to a more detailed document.

## High level flow

`TApp` is the root of the application. It loads configuration, allocates core managers and pushes screens on a form stack. The player eventually reaches the game loop handled by `GameScreen.Player`, which updates lemmings, reacts to input and records replays. Sound playback is handled through the sound system, while the renderer draws terrain and objects. The level data structures originate from `Level.Base.pas` and the toolbar reads graphics from the current style.

## Module relationships

- [`TApp` lifecycle](TApp-overview.md) – explains how the main application object creates and disposes managers like the renderer, sound manager and level container.
- [`Lemmix Configuration`](lemix-config.md) – describes `TConfig`, loaded by `TApp` at startup.
- [`GameScreen.Base` port notes](game-screen-base.md) – common functionality for all game screens such as image stretching and fade transitions.
- [`GameScreen.Player` overview](gamescreen-player.md) – details the gameplay loop, timers and input handling.
- [`Lemmix renderer notes`](lemmix-renderer.md) – covers how `Game.Rendering.pas` draws terrain and objects.
- [`Level.Base.pas` overview](level-base-overview.md) – documents the level records and drawing flags referenced by the renderer and game logic.
- [`Skill panel toolbar`](skill-panel-toolbar.md) – explains how the toolbar loads sprites and draws the minimap.
- [`Lemmix action enumeration`](lemmix-actions.md) – lists all possible lemming states used across `Game.pas` and the skill assignment routines.
- [`Lemmix lemming fields`](lemmix-lemming-fields.md) – provides an overview of the `TLemming` structure manipulated by the transition and assignment code.
- [`Lemmix transition and turnaround`](lemmix-transition.md) – describes how lemmings switch actions and directions.
- [`Skill assignment logic`](skill-assignments.md) – shows the checks performed before applying a skill.
- [`Lemmix game menu reference`](lemmix-game-menu-port.md) – covers the menu bitmaps and keyboard commands.
- [`Lemmix game logger`](lemmix-game-logger.md) – documents the debug logging class used when compiling the Pascal project in debug mode.
- [`Sound system overview`](sound-system-overview.md) – explains audio initialization and playback.

## Subsystem summary

| Subsystem | Key Modules | Notes |
|-----------|-------------|------|
| Application | `TApp`, `TConfig` | Loads config and manages forms |
| Rendering | `Game.Rendering`, `GameScreen.Base` | Draws terrain, objects and screens |
| Gameplay | `GameScreen.Player`, `TLemming` | Handles updates, input and replays |
| Level Data | `Level.Base`, `TLevel` | Structures for terrain and objects |
| Toolbar | `TSkillPanelToolbar` | Skill buttons and minimap |
| Audio | `TSoundMgr`, `TMusic`, `VoiceMgr` | Sound effects and music |
| Utilities | `TGameLogger` | Optional debug logging |

Together these modules form the basis of the Pascal code that inspired this JavaScript port.
