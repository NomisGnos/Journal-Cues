# Journal Cues

Journal Cues records small scene routines and lets you play them from a journal link or from the module window.

It stores cues on the active scene in:

```text
flags.journal-cues.cues
```

Use a link like this in a journal entry:

```text
@Cue[cue-id]{Visible text}
```

Open the cue window from the token controls route icon, or from the console:

```js
game.modules.get("journal-cues").api.open()
```

## What It Does

- Records Foundry actions while the GM is recording.
- Replays those actions later in order.
- Saves a recorded-start snapshot so a cue can reset before it plays.
- Lets cues be started from journal text.
- Lets multiple different cues run at the same time.
- Runs consecutive token movement actions together when there is no explicit delay.

This is meant for table beats like doors opening, tokens moving, lights changing, a sound cue playing, an image popping up, or a short scene reset.

## Recording

1. Click `Create New Cue`.
2. Select the cue.
3. Click `Start Recording`.
4. Do the scene actions in Foundry.
5. Click `Stop Recording`.

Captured action types include:

- Tokens
- Walls and doors
- Tiles
- Ambient lights
- Ambient sounds
- Regions
- Actors
- Playlists and playlist sounds
- Macros
- Roll tables
- Canvas pings
- Chat messages and token chat bubbles
- D&D5e activity use
- Ginzzzu portraits when available

## Playback

By default, playback restores the recorded starting state first. Change the cue setting to `Current placement` if you want token movement to happen relative to where tokens are now.

Each cue has a default delay. Individual actions can override it from the action list or in the JSON.

Looping is available per cue. A loop limit of `0` means repeat until stopped.

Different cues can run at the same time. The same cue will not start twice at once. Stop only stops that cue.

## Token Movement

Recorded token movement uses the recorded destination by default. It does not calculate a new route unless you set:

```json
{
  "autoPath": true
}
```

Consecutive `moveToken` actions run together when:

- the action has no `waitBefore`
- the action has no `waitAfter`
- the action does not set `"parallel": false`
- the actions do not target the same token

Use this when you want several tokens to move at once. Add `"parallel": false` or an explicit delay when you need one movement to finish before the next one starts.

## Useful JSON Examples

Move the selected token:

```json
{
  "type": "moveToken",
  "token": "selected",
  "to": { "x": 2400, "y": 1800 },
  "duration": 500
}
```

Move through waypoints:

```json
{
  "type": "moveToken",
  "token": "selected",
  "waypoints": [
    { "x": 1600, "y": 1200 },
    { "x": 2200, "y": 1200 },
    { "x": 2400, "y": 1800 }
  ],
  "autoDoors": true,
  "closeDoors": true
}
```

Open a tagged door:

```json
{
  "type": "door",
  "walls": "tag:inn-front-door",
  "state": "open"
}
```

Play a playlist sound:

```json
{
  "type": "playlist",
  "playlistUuid": "Playlist.abc123",
  "playlistSoundId": "def456",
  "command": "play"
}
```

Play a one-shot audio file:

```json
{
  "type": "audio",
  "src": "worlds/my-world/assets/door-creak.ogg",
  "volume": 0.8,
  "scope": "all"
}
```

## Known Limits

- Playback is GM-authoritative. A GM client needs to be active for normal use.
- Concurrent cues can conflict if they change the same token, door, light, sound, or actor at the same time. Last update wins.
- Stop is checked between actions and during module waits. Foundry-controlled animations may finish their current step before stopping.
- Advanced JSON is powerful, but it is not validated beyond what playback code can resolve.

## Support

Please visit my Patreon and drop me a goodberry:

```text
https://www.patreon.com/cw/nomisDM
```

## Patch Notes

### 2026-06-12

- Fixed playlist sound recording so a click on one sound inside a playlist records that exact sound instead of the first changed embedded sound Foundry reports.
- Playlist actions now store `playlistUuid`, `playlistSoundId`, and `playlistSoundUuid` when available.
- Playlist playback now resolves the sound through its parent playlist first, then falls back to UUID/id lookup.
- Added concurrent playback sessions. Multiple different cues can run at the same time.
- Prevented duplicate playback of the same cue while it is already running.
- Stop now targets the requested cue instead of one global playback state.
- Consecutive `moveToken` actions run in parallel when there are no explicit waits and `parallel` is not set to `false`.
- Multi-token movement now moves the resolved tokens in parallel.
- Recording suppression is reference-counted so overlapping playback sessions do not accidentally record their own updates.

### Current Storage And API

- Scene flag storage: `flags.journal-cues.cues`
- Public API: `game.modules.get("journal-cues").api`
- Useful API methods: `open`, `play`, `stop`, `restoreRecordedStart`, `startRecording`, `stopRecording`, `cancelRecording`, `getCues`, `upsertCue`, `deleteCue`
