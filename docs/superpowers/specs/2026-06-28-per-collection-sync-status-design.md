# Per-collection status for interactive `tokwise sync`

Date: 2026-06-28

## Problem

The interactive picker flattens every selected collection into one `discovered`
array, so `runSyncPipeline` runs `mergeVideos` -> `runDownloads` ->
`runTranscription` -> `runClassification` over one combined `touched` set. The
user sees single combined lines (`Media: 18 downloaded...`, `transcribe 51/99`)
instead of status per collection.

## Decisions

- Scope: interactive `tw sync` picker only. The explicit `--collection` path
  stays one combined block (no behavior change).
- Phases: full pipeline per collection (merge + download + transcribe +
  classify), each under a collection header; index once at the end.
- Model: keep the existing two-phase flow (fetch all collections first,
  surfacing fetch failures up front), then process per collection group.

## Changes (`src/cli.ts`)

1. **Group type** -- add `interface SyncGroup { label: string; videos: TikTokVideo[] }`.
2. **`runDownloads`, `runTranscription`, `runClassification`** -- add an optional
   `label?: string` arg; the live progress label becomes `${base} \u00b7 ${label}`
   when present (via a small exported `progressLabel(base, label?)` helper).
   Their existing per-call summary lines then read per collection.
3. **`runSyncPipeline`** -- change signature to
   `runSyncPipeline(groups: SyncGroup[], options)`:
   - `const showPerGroup = groups.length > 1`.
   - Loop groups sequentially: print `c.heading(group.label)` header when
     `showPerGroup`; `mergeVideos(group.videos, { rebuild: options.rebuild && i === 0 })`;
     `touched = new Set(group.videos.map(v => v.id))`; run
     download/transcribe/classify with `label = showPerGroup ? group.label : undefined`.
   - Per-group synced line drops the archive-wide total; when `!showPerGroup`
     keep the current `(T total)` format for exact backward compatibility.
   - After the loop, `saveSearchIndex(videos)` once and print the `Indexed N
     videos...` line.
4. **Explicit-source path** -- call
   `runSyncPipeline([{ label: "sync", videos: discovered }], options)` (single
   group -> no header, unchanged output).
5. **`runInteractiveSync` fetch loop** -- build `groups: SyncGroup[]` instead of
   a flat `discovered`: on each successful `fetchCollection`, push
   `{ label: folder.name, videos }` (skip empty); keep the existing fetch-failure
   collection/report; if no videos at all, keep the `No videos found` guard; then
   `runSyncPipeline(groups, options)`.

## Display (after)

```
Career advice
  Synced 12 new, 30 updated, 0 unchanged
  Media: 30 downloaded, 12 already present (42 total).
  Transcripts: 42 transcribed (42 total).
  Classified 42 videos (42 total).

Cooking
  Synced 7 new, 0 updated, 0 unchanged
  Media: 7 downloaded (7 total).
  ...

Indexed 123 videos at ~/.tokwise/videos/search-index.json.
```

During each phase the live spinner reads `media \u00b7 Career advice 12/42 ...`.

## Edge cases

- Single collection selected -> `groups.length === 1` -> no header, compact
  output (same as today).
- A video in two selected collections appears in both blocks; the second
  collection's download reports it `already present`. Expected.
- `--rebuild` applies only to the first group (replace), later groups merge.
- Non-TTY: `createProgress` prints one line per item; the per-collection header
  still separates blocks.

## Testing

- Add coverage for the pure `progressLabel(base, label?)` helper (`media` vs
  `media \u00b7 Career advice`).
- Run full build and suite; confirm explicit-path output is unchanged.

## Out of scope

- The explicit `--collection` / `--liked` / `--user` / `--url` paths (stay
  combined).
- Changes to download/transcribe/classify internals or the progress renderer.
