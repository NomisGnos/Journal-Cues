# Changelog

## 2026-06-12

- Fixed playlist sound recording so a click on one sound inside a playlist records that exact sound instead of the first changed embedded sound Foundry reports.
- Playlist actions now store `playlistUuid`, `playlistSoundId`, and `playlistSoundUuid` when available.
- Playlist playback now resolves the sound through its parent playlist first, then falls back to UUID/id lookup.
- Added concurrent playback sessions. Multiple different cues can run at the same time.
- Prevented duplicate playback of the same cue while it is already running.
- Stop now targets the requested cue instead of one global playback state.
- Consecutive `moveToken` actions run in parallel when there are no explicit waits and `parallel` is not set to `false`.
- Multi-token movement now moves the resolved tokens in parallel.
- Recording suppression is reference-counted so overlapping playback sessions do not accidentally record their own updates.

## Current Storage And API

- Scene flag storage: `flags.journal-cues.cues`
- Public API: `game.modules.get("journal-cues").api`
- Useful API methods: `open`, `play`, `stop`, `restoreRecordedStart`, `startRecording`, `stopRecording`, `cancelRecording`, `getCues`, `upsertCue`, `deleteCue`
