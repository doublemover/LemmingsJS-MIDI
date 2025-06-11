# Lemmix Voice Manager Overview

This document captures the analysis of `src/Prog.Voice.pas` from the [Lemmix repository](https://github.com/ericlangedijk/Lemmix). It explains how the voice manager initializes speech synthesis, queues messages, and how options control spoken output.

## Initialization

The `TVoiceMgr` class attempts to create a Windows SAPI `ISpeechVoice` instance using `CoSpVoice.Create`. The constructor sets `fInstalled` to `True` then tries to allocate a window handle for timer messages. If either the `CoSpVoice` allocation or the window creation fails, `fInstalled` is cleared and `fVoice` is set to `nil`, effectively disabling voice support.

## Queueing and Timed Speech

`Cue` stores text in `fCurrentString` and starts a 500 ms timer. Any previous timer is cleared so only the latest text will be spoken. `WndProc` receives the timer message, stops the timer, and calls `TimedSpeak`. `TimedSpeak` forwards the queued text to `fVoice.Speak` with the `SVSFPurgeBeforeSpeak` flag so new speech interrupts any ongoing speech.

## Speaking API

`Speak` first checks `Installed` and `Enabled`. If a voice is available and speaking is enabled, it speaks immediately or queues the text depending on parameters. Overloaded versions allow speaking predefined messages by `TVoiceOption`, retrieving them from `gt.VoiceStrings`. `ForcedSpeak` temporarily enables voice output and ensures the relevant option is in the enabled set before calling `Speak`. After speaking, it restores the previous settings.

## Options and Flags

The voice manager tracks whether speech synthesis is installed (`Installed`) and whether speaking is currently allowed (`Enabled`). Calls to `Speak` and `ForcedSpeak` respect these flags so the game can disable spoken feedback when appropriate. Option sets determine which predefined messages are active.

## Voice Options

`Base.Types.pas` defines `TVoiceOption`, listing the spoken message categories:

```
BinLevelSaved, BinLevelSavingOff, BinLevelSavingOn, Cheater,
CurrentSection, CurrentStyle, GameSaved, ReplayFail,
SoundFX, StartReplay, VoiceDisable, VoiceEnable
```

`TVoiceOptions` is a set of these values. When constructing `TVoiceMgr` the
caller passes both the desired options and an `Enabled` flag. `Speak` only
voices a predefined message when its option is present in this set.

Actual speech synthesis relies on the generated COM wrapper
`SpeechLib_TLB.pas`, which exposes `ISpeechVoice` and the `CoSpVoice` class
instantiated by `TVoiceMgr`.


