# Journal Cues

[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v13--v14-orange?style=for-the-badge)](https://foundryvtt.com/)
[![Version](https://img.shields.io/badge/version-0.2.2-blue?style=for-the-badge)](module.json)
[![Manifest](https://img.shields.io/badge/manifest-install-2f6f73?style=for-the-badge)](https://raw.githubusercontent.com/NomisGnos/Journal-Cues/main/module.json)
[![Changelog](https://img.shields.io/badge/changelog-CHANGELOG.md-555?style=for-the-badge)](CHANGELOG.md)
[![Patreon](https://img.shields.io/badge/Patreon-drop%20a%20goodberry-F96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/nomisDM)

Journal Cues lets a GM record scene actions and play them back later from a simple cue list or from a journal entry.

It is built for practical table moments: moving tokens, opening doors, changing lights, playing sounds, showing images, sending pings, or resetting a scene beat before the players see it again.

## Installation

Install this module from Foundry's **Add-on Modules** screen using the manifest URL:

```text
https://github.com/NomisGnos/Journal-Cues/releases/latest/download/module.json
```

Or install it manually:

1. Download the release zip.
2. Extract the module folder into your Foundry `Data/modules` folder.
3. Make sure the folder name matches the module id.
4. Restart Foundry if it was already running.
5. Enable the module inside your world from **Manage Modules**.

## Opening The Cue Window

Open Journal Cues from the route icon in the token controls.

The window has two main parts:

- the cue list on the left
- the selected cue editor on the right

The cue list is where you create, select, play, stop, restore, copy, and delete cues.

The editor is where you rename a cue, change playback settings, review captured actions, adjust delays, and save edits.

## Creating A Cue

1. Click `Create New Cue`.
2. Enter a cue name.
3. Select the cue in the list.
4. Click the record button.
5. Perform the Foundry actions you want to capture.
6. Click stop recording.

The recorded actions appear in the action list as they are captured.

## Playing A Cue

Click the play button next to a cue.

While a cue is playing, its play button becomes a stop button. Stopping a cue pauses that cue so the next play can continue from the next action.

Different cues can run at the same time. This is useful when one cue is handling sound or lighting while another cue moves tokens. The same cue will not start twice at once.

## Restore

Restore returns the cue's recorded scene pieces to their saved starting state.

Use this when you want to reset a setup before replaying it. For example, you might restore token positions, door states, lights, or other captured scene documents before running the cue again.

## Cue Settings

Each cue has a few playback settings in the editor:

- `Default Delay`: the delay after actions that do not set their own delay
- `Playback Origin`: whether movement uses the recorded start or current placement
- `Loop`: whether the cue repeats
- `Loop Limit`: how many times to repeat; `0` means repeat until stopped

The action list also lets you adjust the delay after each captured action.

## Token Movement

Recorded token movement normally replays the recorded destination.

If several token movement actions are next to each other and have no delay, Journal Cues runs them together so the scene feels less mechanical.

If you need one movement to finish before the next starts, add a delay between those actions in the action list.

## Journal Links

Use `Copy Journal Link` on a cue, then paste the link into a journal entry.

When clicked, that journal link plays the cue.

This is useful for session notes, room descriptions, boxed text, encounter reminders, and scene scripts.

## What Recording Can Capture

Journal Cues can capture common Foundry actions, including:

- tokens
- doors and walls
- tiles
- ambient lights
- ambient sounds
- regions
- actors
- playlists and playlist sounds
- macros
- roll tables
- canvas pings
- chat messages and token chat bubbles
- D&D5e activity use
- Ginzzzu portraits when available

## Advanced Editing

The cue editor includes an `Actions JSON` section for troubleshooting and manual edits.

Most users should not need it. Use the normal cue list, settings, action delays, and recording controls first.

## Known Limits

- Playback is GM-controlled. A GM client needs to be active for normal use.
- Concurrent cues can conflict if they change the same token, door, light, sound, or actor at the same time. Last update wins.
- Stop is checked between actions and during module-controlled waits. A Foundry animation may finish its current step before stopping.
- Some captured actions depend on the modules or systems that created them.

## Support

Please visit my Patreon and drop me a goodberry:

```text
https://www.patreon.com/cw/nomisDM
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes and maintenance history.
