# Journal Cues

Journal Cues stores replayable scene cues on the active scene under `flags.journal-cues.cues`.

Use journal links like:

```text
@Cue[cue-id]{Visible sentence in the journal}
```

Open the cue list from the token controls route icon, or from the console/API:

```js
game.modules.get("journal-cues").api.open()
```

## Recording

Use **Create New Cue** to create an empty cue. Select a cue and use **Start Recording** in the editor footer to append actions. While recording, Play and Restore are disabled until the GM clicks Stop Recording or Cancel.

Recording captures common Foundry document changes:

- Tokens
- Walls and door states
- Tiles
- Ambient lights
- Ambient sounds
- Regions
- Actors
- Playlists and playlist sounds
- Macros
- Roll tables
- Canvas pings
- Chat messages, including in-character token chat bubbles
- D&D5e activity uses through `dnd5e.preUseActivity`

Each cue keeps a recorded-start snapshot. Play defaults to restoring the recorded start before replaying.

Recorded token movement uses the recorded destination by default, so playback does not invent a new route around walls. Set `autoPath: true` in Actions JSON only when you intentionally want Journal Cues to calculate a path. Recorded D&D5e activity and macro uses also store selected tokens and token targets from the moment of use.

Each cue has a default delay between actions, and each action can override that delay from the action list. The world-level default is available in Foundry's module settings and defaults to 100ms.

Enable **Loop** on a cue to replay it repeatedly. A Loop Limit of `0` repeats until stopped.

During playback the cue's Play button becomes Stop. Stop pauses the cue between actions or during module-controlled waits, and the next Play resumes from the next queued action. The action list highlights the currently running action while the Journal Cues window is open. Hovering an action previews supported canvas targets such as movement, camera, pings, and linked documents. The raw Actions JSON is collapsed by default because it is mainly for debugging and manual editing.

## Useful Action Examples

Move the selected token to a location, using pathfinding and doors:

```json
{
  "type": "moveToken",
  "token": "selected",
  "to": { "x": 2400, "y": 1800 },
  "autoPath": true,
  "autoDoors": true,
  "closeDoors": true,
  "duration": 500
}
```

Move through explicit waypoints:

```json
{
  "type": "moveToken",
  "token": "selected",
  "waypoints": [
    { "x": 1600, "y": 1200 },
    { "x": 2200, "y": 1200 },
    { "x": 2400, "y": 1800 }
  ],
  "autoPath": true,
  "autoDoors": true,
  "closeDoors": true
}
```

Open every tagged door:

```json
{
  "type": "door",
  "walls": "tag:inn-front-door",
  "state": "open"
}
```

Hide tagged tiles:

```json
{
  "type": "visibility",
  "documentName": "Tile",
  "target": "tag:hidden-room",
  "hidden": true
}
```

Pan and zoom the canvas for everyone:

```json
{
  "type": "camera",
  "to": { "x": 2400, "y": 1800 },
  "scale": 1.25,
  "duration": 700,
  "scope": "all"
}
```

Ping the canvas:

```json
{
  "type": "ping",
  "x": 2400,
  "y": 1800,
  "style": "pulse"
}
```

Show an image popout:

```json
{
  "type": "image",
  "src": "worlds/my-world/assets/portrait.webp",
  "title": "Arik",
  "scope": "all"
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

Use a D&D5e activity:

```json
{
  "type": "useDnd5eActivity",
  "activityUuid": "Actor.abc.Item.def.Activity.ghi"
}
```

Use a Ginzzzu portrait when that module is active, or fall back to an image:

```json
{
  "type": "portrait",
  "actor": "Actor.BvCAttT8LgKPCvtO",
  "shown": true,
  "image": "worlds/my-world/assets/arik.webp",
  "scope": "all"
}
```
