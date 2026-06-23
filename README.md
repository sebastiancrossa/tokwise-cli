# Tokwise

Local-first command line tooling for turning saved short-form videos into a searchable, transcript-centered knowledge base.

Tokwise syncs clips into local files, builds a search index, downloads media, transcribes audio, classifies themes, exports Markdown, compiles a wiki, answers questions against local evidence, and installs an agent skill.

## Install

```bash
npm install
npm run build
npm link
```

Main command:

```bash
tokwise status
```

Short alias:

```bash
tw status
```

Requires Node.js 20+. Media download requires `yt-dlp` on PATH. Transcription requires either OpenAI Whisper CLI, whisper.cpp, or a custom command.

## Quick Start

```bash
# Optional: save a browser cookie for private collections or liked videos.
tokwise auth set --cookie "YOUR_COOKIE"

# Sync a collection, download audio, transcribe, classify, and index.
tokwise sync --collection "https://www.tiktok.com/@user/collection/name-123" \
  --limit 200 \
  --download --audio \
  --transcribe --stt-engine whisper --stt-model base \
  --classify

# Search and explore.
tokwise search "how to choose a career"
tokwise similar <video-id>
tokwise categories
tokwise stats
tokwise md
tokwise wiki
tokwise ask "What patterns show up in my saved advice videos?" --engine ollama --model llama3.1
```

Every `tokwise` command can also be run with `tw`.

## Core Commands

```bash
tokwise sync                  Sync URLs, collections, playlists, liked videos, or imports
tokwise fetch-media           Download video/audio with yt-dlp for existing records
tokwise transcribe            Run Whisper, whisper.cpp, or a custom STT command
tokwise index                 Rebuild the BM25 search index
tokwise search <query>        Full-text search across descriptions and transcripts
tokwise list                  Filter by author, date, category, domain, collection, transcript state
tokwise show <id>             Show one video in detail
tokwise similar <id>          Find transcript-similar videos
tokwise stats                 Counts, date range, top authors, transcript coverage
tokwise viz                   Terminal dashboard with simple bars
tokwise categories            Category distribution
tokwise domains               Domain distribution
tokwise collections           Collection/source distribution
tokwise classify              Regex or local Ollama classification
tokwise model                 View or change default local model preferences
tokwise md                    Export one Markdown file per video
tokwise wiki                  Compile an interlinked local wiki
tokwise ask <question>        Ask against top local matches, optionally via Ollama
tokwise lint                  Check generated wiki links
tokwise library ...           Manage local Markdown library pages
tokwise commands ...          Manage reusable local command notes
tokwise skill ...             Install/show/uninstall an agent skill
tokwise paths/status/path     Show local data locations and health
```

## Data Layout

By default data lives under `~/.tokwise/`.

```text
~/.tokwise/
  videos/
    videos.jsonl          # one normalized video record per line
    search-index.json     # local BM25 index
    auth.json             # optional browser cookie, chmod 600
    media/                # yt-dlp video files
    audio/                # yt-dlp extracted audio files
    transcripts/          # .json and .txt STT outputs
  library/
    index.md              # generated wiki entry point
    videos/*.md           # one markdown page per video
    categories/*.md
    domains/*.md
  commands/
    *.md                  # portable command notes for agents
```

Override locations with:

```bash
export TOKWISE_DATA_DIR=/path/to/data
export TOKWISE_LIBRARY_DIR=/path/to/library
export TOKWISE_COMMANDS_DIR=/path/to/commands
```

Legacy `TT_*` environment variables and `~/.tiktoktheory` are still read so existing local archives keep working after the rename.

## Sources

```bash
tokwise sync --collection <collection-id-or-url>
tokwise sync --playlist <playlist-id-or-url>
tokwise sync --liked <username>
tokwise sync --user <username>
tokwise sync --search-video "life advice"
tokwise sync --url "https://www.tiktok.com/@user/video/123"
tokwise sync --urls-file urls.txt
tokwise sync --input export.jsonl
```

Private collections usually require a fresh browser cookie copied from a logged-in session. Cookies are stored locally only when you run `tokwise auth set`.

## Transcription

Whisper CLI:

```bash
tokwise transcribe --engine whisper --model base --language en
```

whisper.cpp:

```bash
tokwise transcribe --engine whisper-cpp --command whisper-cli --model /path/to/ggml-base.en.bin
```

Custom command:

```bash
tokwise transcribe --engine custom \
  --command 'my-stt --input "{input}" --output "{output}" --language "{language}"'
```

The custom command should write JSON, plain text, or print the transcript to stdout.
