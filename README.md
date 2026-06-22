# TikTok Theory CLI

Local-first command line tooling for turning saved TikTok videos into a searchable, transcript-centered knowledge base.

It borrows the useful shape of Field Theory CLI: sync into local files, build an index, search/list/show records, classify them, export Markdown, compile a wiki, ask questions against local context, and install an agent skill. The TikTok-specific pipeline adds collection/playlist ingestion, `yt-dlp` downloads, and pluggable STT transcription.

## Install

```bash
npm install
npm run build
npm link
```

Requires Node.js 20+. Media download requires `yt-dlp` on PATH. Transcription requires either OpenAI Whisper CLI, whisper.cpp, or a custom command.

## Quick Start

```bash
# Optional: save a TikTok browser cookie for private collections or liked videos.
tt auth set --cookie "YOUR_TIKTOK_COOKIE"

# Sync a collection, download audio, transcribe, classify, and index.
tt sync --collection "https://www.tiktok.com/@user/collection/name-123" \
  --limit 200 \
  --download --audio \
  --transcribe --stt-engine whisper --stt-model base \
  --classify

# Search and explore.
tt search "how to choose a career"
tt similar <video-id>
tt categories
tt stats
tt md
tt wiki
tt ask "What patterns show up in my saved advice videos?" --engine ollama --model llama3.1
```

## Core Commands

```bash
tt sync                  Sync TikTok URLs, collections, playlists, liked videos, or imports
tt fetch-media           Download video/audio with yt-dlp for existing records
tt transcribe            Run Whisper, whisper.cpp, or a custom STT command
tt index                 Rebuild the BM25 search index
tt search <query>        Full-text search across descriptions and transcripts
tt list                  Filter by author, date, category, domain, collection, transcript state
tt show <id>             Show one video in detail
tt similar <id>          Find transcript-similar videos
tt stats                 Counts, date range, top authors, transcript coverage
tt viz                   Terminal dashboard with simple bars
tt categories            Category distribution
tt domains               Domain distribution
tt collections           Collection/source distribution
tt classify              Regex or local Ollama classification
tt model                 View or change default local model preferences
tt md                    Export one Markdown file per video
tt wiki                  Compile an interlinked local wiki
tt ask <question>        Ask against top local matches, optionally via Ollama
tt lint                  Check generated wiki links
tt library ...           Manage local Markdown library pages
tt commands ...          Manage reusable local command notes
tt skill ...             Install/show/uninstall an agent skill
tt paths/status/path     Show local data locations and health
```

## Data Layout

By default data lives under `~/.tiktoktheory/`.

```text
~/.tiktoktheory/
  videos/
    videos.jsonl          # one normalized TikTok record per line
    search-index.json     # local BM25 index
    auth.json             # optional TikTok cookie, chmod 600
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
export TT_DATA_DIR=/path/to/data
export TT_LIBRARY_DIR=/path/to/library
export TT_COMMANDS_DIR=/path/to/commands
```

## TikTok Sources

```bash
tt sync --collection <collection-id-or-url>
tt sync --playlist <playlist-id-or-url>
tt sync --liked <username>
tt sync --user <username>
tt sync --search-video "life advice"
tt sync --url "https://www.tiktok.com/@user/video/123"
tt sync --urls-file urls.txt
tt sync --input export.jsonl
```

Private collections usually require a fresh TikTok cookie copied from a logged-in browser session. Cookies are stored locally only when you run `tt auth set`.

## Transcription

Whisper CLI:

```bash
tt transcribe --engine whisper --model base --language en
```

whisper.cpp:

```bash
tt transcribe --engine whisper-cpp --command whisper-cli --model /path/to/ggml-base.en.bin
```

Custom command:

```bash
tt transcribe --engine custom \
  --command 'my-stt --input "{input}" --output "{output}" --language "{language}"'
```

The custom command should write JSON, plain text, or print the transcript to stdout.
