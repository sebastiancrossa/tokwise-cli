# Interactive `tokwise sync` Bookmark Picker

Date: 2026-06-28

## Goal

Make onboarding a single command. Running bare `tokwise sync` (with no source
flags) auto-discovers the logged-in user's TikTok bookmarks (named
**Collections** plus the flat **Favorites** bucket), shows an interactive
multi-select, optionally prompts for the download/transcribe/classify pipeline,
then runs the existing sync pipeline against whatever the user picks.

The same discovery is fully scriptable through `--list`, `--json`, and `--all`
so agents and CI never need to hand-build collection URLs.

## Confirmed decisions

- **Pickable rows:** named Collections + the flat Favorites bucket. Liked videos
  stay on the existing `--liked` flag and do not appear in the picker.
- **Picker library:** `@clack/prompts` (the first interactive dependency),
  isolated in a single module so it never leaks into the rest of the codebase.
- **Entry point:** bare `tokwise sync` with no source flags. This path currently
  throws `"No source supplied"`, so repurposing it is backward compatible.
  Existing pipeline flags (`--download`, `--audio`, `--transcribe`,
  `--classify`, etc.) still apply to the picked folders.
- **Programmatic surface:** `--list` (optionally with `--json`) prints discovered
  folders as data; `--all` syncs every folder without prompting. When bare
  `tokwise sync` runs without a TTY it prints the folder list plus a hint and
  exits 0 -- it never hangs and never auto-syncs.
- **Pipeline prompt:** when no pipeline flags are passed in a TTY, a second
  multiselect (Download / Transcribe / Classify) is shown, defaulting to all
  three but pre-checking only the boxes whose tools are installed
  (`yt-dlp` for download, a Whisper engine for transcribe). Explicit flags
  override the prompt entirely.

## Architecture

```
tokwise sync (no source flags)
  -> resolve cookie + secUid (auth)
  -> fetchBookmarkFolders() -> BookmarkFolder[]
  -> select folders:
       TTY, no flags     -> @clack/prompts multiselect
       --all             -> all folders
       --list / --json   -> print and exit
       no TTY, no flags  -> print + hint, exit 0
  -> (TTY, no pipeline flags) @clack/prompts pipeline multiselect
  -> fetchCollection() per chosen folder -> TikTokVideo[]
  -> runSyncPipeline(): merge -> download? -> transcribe? -> classify? -> index
```

### Components

- **`src/tiktok.ts`** -- discovery functions:
  - `fetchBookmarkFolders(options)` hand-rolls
    `GET https://www.tiktok.com/api/user/collection_list/?secUid=...`, mirroring
    the existing `fetchCollectionWithCookie` (same browser headers + cookie),
    paging until `hasMore` is false, and normalizes entries into
    `BookmarkFolder[]`.
  - `resolveSecUid(cookie, username, proxy?)` reads `secUid` from the logged-in
    homepage rehydration scope, falling back to the `/@username` profile page.
  - The rehydration parser is generalized so both `uniqueId` (existing) and
    `secUid` (new) are read from the same `__UNIVERSAL_DATA_FOR_REHYDRATION__`
    blob.
  - Item fetching for a chosen folder reuses the existing `fetchCollection()`;
    no change to item fetching.
- **`src/types.ts`** -- add `BookmarkFolder`:
  `{ id, name, url?, itemCount?, cover?, kind: "collection" | "favorites" }`.
- **`src/interactive.ts`** (new) -- the only module that imports
  `@clack/prompts`. Holds all `isTTY` handling and the non-TTY fallback, and
  orchestrates discover -> folder pick -> pipeline pick -> chosen result.
- **`src/engines.ts`** (new) -- lightweight `yt-dlp` / Whisper availability
  detection used to pre-check the pipeline prompt boxes.
- **`src/cli.ts`** -- in the `sync` action, route the no-source case to the
  interactive orchestrator; add `--list`, `--json`, `--all`; extract the
  post-fetch block (merge -> download -> transcribe -> classify -> index) into a
  shared `runSyncPipeline(discovered, options)` so both code paths behave
  identically.
- **`src/store.ts`** -- extend `SavedAuth` with an optional `secUid`, cached
  after first resolution to avoid re-fetching.
- **`package.json`** -- add `@clack/prompts`.
- **`README.md`** -- document the new flow.

## Favorites handling

On modern TikTok, the flat Favorites bucket is surfaced as a default entry in
`collection_list` and carries its own collection id, so it is fetched through
the same `collection/item_list` path as any named collection. The design
therefore treats `kind` as a cosmetic label: a folder whose name matches
Favorites is tagged `kind: "favorites"`, but both kinds fetch identically via
`fetchCollection(id)`. If a deployment of TikTok does not include Favorites in
`collection_list`, the picker simply shows Collections and Favorites is deferred
-- no unverified second endpoint is introduced.

## Non-interactive / programmatic behavior

- `tokwise sync --list` -> human-readable folder list.
- `tokwise sync --list --json` -> machine-readable array (id, name, itemCount,
  url, kind).
- `tokwise sync --all [pipeline flags]` -> sync every folder, no prompt.
- `tokwise sync --collection <id>` -> unchanged precise selector; ids come from
  `--list`.
- Bare `tokwise sync` with no TTY -> prints the discovered list + a hint,
  exits 0.

## Risks / assumptions

1. **Favorites bucket** is the one real unknown (see above). Mitigation: both
   kinds fetch through the verified collection item_list path; Favorites is
   best-effort labeled and degrades gracefully.
2. **`secUid` resolution** parses TikTok rehydration HTML -- the same
   brittle-but-working technique already used for username detection. Failure
   yields a clear actionable message rather than a crash.
3. **`@clack/prompts`** only runs behind an `isTTY` guard; non-TTY always uses
   the print / `--all` / `--collection` paths.

## Out of scope

- Picking individual videos within a folder.
- Changes to existing item fetching or to download/transcribe/classify
  internals.
- Listing Liked videos in the picker.
