#!/usr/bin/env node
import { Command, Option } from "commander";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { answerQuestion } from "./ask.js";
import { classifyOne } from "./classify.js";
import { clearAuth, findVideo, loadAuth, loadCookie, loadPreferences, loadVideos, mergeVideos, readTextInput, saveAuth, savePreferences, saveVideos } from "./store.js";
import { extractTikTokCookie, isChromiumBrowser, SUPPORTED_BROWSERS, type ChromiumBrowser } from "./browser-cookies.js";
import { commandsDir, dataDir, ensureDataDirs, libraryDir, searchIndexPath, toDisplayPath, videosJsonlPath } from "./paths.js";
import { compileWiki, exportMarkdown, lintWiki } from "./markdown.js";
import { downloadMedia } from "./media.js";
import { formatSearchResults, loadSearchIndex, saveSearchIndex, searchWithIndex } from "./search.js";
import { detectLoggedInUsername, fetchCollection, fetchLiked, fetchPlaylist, fetchSingleUrl, fetchUserPosts, fetchVideoSearch, videosFromImport, videosFromUrls } from "./tiktok.js";
import { transcribeVideo, type SttEngine } from "./transcribe.js";
import type { SearchFilters, TikTokSource, TikTokVideo } from "./types.js";
import { createCommand, createLibraryPage, deleteLibraryPage, listCommands, searchLibrary, showLibraryPage, updateLibraryPage, validateCommands } from "./library.js";
import { installSkill, skillContent, uninstallSkill } from "./skill.js";
import { barChart, box, c, kvList, setColorEnabled, truncate } from "./render.js";
import { createProgress } from "./progress.js";

const require = createRequire(import.meta.url);

function version(): string {
  try {
    return (require("../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function safe(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  };
}

function collect(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

function boolFromString(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Expected true or false.");
}

function engineOption(): Option {
  return new Option("--engine <engine>", "Analysis engine").choices(["regex", "ollama"]);
}

function resolveBrowserOption(value: unknown): ChromiumBrowser | undefined {
  if (value == null) return undefined;
  const name = String(value).toLowerCase();
  if (!isChromiumBrowser(name)) {
    throw new Error(`Unsupported browser "${value}". Choose one of: ${SUPPORTED_BROWSERS.join(", ")}.`);
  }
  return name;
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name("tokwise")
    .description("Local-first CLI for saved short-form videos, transcripts, search, and agent workflows.")
    .version(version())
    .option("--no-color", "Disable colored output")
    .showHelpAfterError();

  program.hook("preAction", (thisCommand) => {
    if (thisCommand.opts().color === false) setColorEnabled(false);
  });

  program
    .command("auth")
    .description("Manage a local browser cookie for private sources")
    .addCommand(
      new Command("set")
        .description("Save a browser cookie locally")
        .option("--cookie <cookie>", "Cookie string")
        .option("--stdin", "Read cookie from stdin")
        .option("--username <handle>", "TikTok @handle tied to this cookie")
        .action(
          safe(async (options) => {
            const cookie = options.stdin ? (await readTextInput("-")).trim() : options.cookie;
            if (!cookie) throw new Error("Pass --cookie or --stdin.");
            ensureDataDirs();
            const existing = await loadAuth();
            const username = options.username ?? (await detectLoggedInUsername(cookie)) ?? existing.username;
            await saveAuth({ ...existing, cookie, username, source: "manual", updatedAt: new Date().toISOString() });
            console.log(
              username
                ? `Saved browser cookie locally (username: @${username}).`
                : "Saved browser cookie locally. Run `tw auth set-username <handle>` to enable bare collection slugs.",
            );
          }),
        ),
    )
    .addCommand(
      new Command("from-browser")
        .description("Extract the TikTok cookie from a logged-in macOS Chromium browser")
        .option("--browser <name>", `Browser to read from (${SUPPORTED_BROWSERS.join(", ")}); auto-detected if omitted`)
        .option("--profile <name>", "Browser profile directory", "Default")
        .option("--username <handle>", "TikTok @handle tied to this cookie")
        .option("--print", "Print the cookie header instead of saving it")
        .action(
          safe(async (options) => {
            const browser = resolveBrowserOption(options.browser);
            const profile = String(options.profile);
            const extracted = await extractTikTokCookie({ browser, profile });
            if (!extracted.cookie.includes("sessionid=")) {
              console.warn("Warning: extracted cookie has no sessionid; the session may be incomplete or logged out.");
            }
            if (options.print) {
              console.log(extracted.cookie);
              return;
            }
            ensureDataDirs();
            const existing = await loadAuth();
            const username = options.username ?? (await detectLoggedInUsername(extracted.cookie)) ?? existing.username;
            await saveAuth({
              ...existing,
              cookie: extracted.cookie,
              username,
              source: "browser",
              browser: extracted.browser,
              profile: extracted.profile,
              updatedAt: new Date().toISOString(),
            });
            console.log(
              `Saved cookie from ${extracted.browser} (profile "${extracted.profile}")${username ? ` for @${username}` : ""}.`,
            );
          }),
        ),
    )
    .addCommand(
      new Command("refresh")
        .description("Re-extract the cookie using the browser and profile saved previously")
        .action(
          safe(async () => {
            const auth = await loadAuth();
            if (auth.source !== "browser" || !auth.browser) {
              throw new Error("No browser-extracted cookie to refresh. Run `tw auth from-browser` first.");
            }
            const browser = resolveBrowserOption(auth.browser);
            const profile = auth.profile ?? "Default";
            const extracted = await extractTikTokCookie({ browser, profile });
            if (!extracted.cookie.includes("sessionid=")) {
              console.warn("Warning: extracted cookie has no sessionid; the session may be incomplete or logged out.");
            }
            ensureDataDirs();
            const username = (await detectLoggedInUsername(extracted.cookie)) ?? auth.username;
            await saveAuth({
              ...auth,
              cookie: extracted.cookie,
              username,
              source: "browser",
              browser: extracted.browser,
              profile: extracted.profile,
              updatedAt: new Date().toISOString(),
            });
            console.log(
              `Refreshed cookie from ${extracted.browser} (profile "${extracted.profile}")${username ? ` for @${username}` : ""}.`,
            );
          }),
        ),
    )
    .addCommand(
      new Command("show").description("Show whether a cookie is saved").action(
        safe(async () => {
          const auth = await loadAuth();
          if (!auth.cookie) {
            console.log("No cookie saved.");
            return;
          }
          const source =
            auth.source === "browser"
              ? `browser (${auth.browser ?? "unknown"}/${auth.profile ?? "Default"})`
              : "manual";
          const username = auth.username ? `, username: @${auth.username}` : "";
          console.log(`Cookie saved (${auth.cookie.length} chars, source: ${source}${username}).`);
        }),
      ),
    )
    .addCommand(
      new Command("set-username")
        .description("Save the TikTok @handle tied to your cookie (enables bare collection slugs)")
        .argument("<handle>", "TikTok username, with or without a leading @")
        .action(
          safe(async (handle: string) => {
            const username = handle.trim().replace(/^@/, "");
            if (!username) throw new Error("Pass a TikTok handle.");
            ensureDataDirs();
            const existing = await loadAuth();
            await saveAuth({ ...existing, username, updatedAt: new Date().toISOString() });
            console.log(`Saved username @${username}.`);
          }),
        ),
    )
    .addCommand(
      new Command("clear").description("Remove saved browser cookie").action(
        safe(async () => {
          await clearAuth();
          console.log("Removed saved browser cookie.");
        }),
      ),
    );

  program
    .command("sync")
    .description("Sync short-form video sources into the local archive")
    .option("--collection <idOrUrl>", "Collection URL, @user/collection/slug, or bare slug/id", collect, [])
    .option("--playlist <idOrUrl>", "Playlist id or URL", collect, [])
    .option("--liked <username>", "Sync a user's liked videos; usually requires cookie", collect, [])
    .option("--user <username>", "Sync a user's posts", collect, [])
    .option("--search-video <query>", "Sync video search results", collect, [])
    .option("--url <url>", "Sync one source URL", collect, [])
    .option("--urls-file <path>", "Newline-delimited source URLs")
    .option("--input <path>", "Import JSON, JSONL, or raw API response")
    .option("--cookie <cookie>", "Browser cookie for API calls")
    .option("--cookie-file <path>", "Read browser cookie from file")
    .option("--proxy <url>", "Proxy passed to source API and yt-dlp")
    .option("--limit <n>", "Max items per source", parseNumber, 30)
    .option("--page <n>", "Start page", parseNumber, 1)
    .option("--pages <n>", "Max pages per paged source", parseNumber)
    .option("--rebuild", "Replace archive with this sync result", false)
    .option("--download", "Download media after syncing", false)
    .option("--audio", "When downloading, extract audio only", false)
    .option("--transcribe", "Transcribe after downloading or when audio/video already exists", false)
    .option("--classify", "Classify synced records after sync/transcription", false)
    .option("--yt-dlp <command>", "yt-dlp command path", "yt-dlp")
    .option("--yt-dlp-cookies <path>", "Netscape cookies file for yt-dlp")
    .option("--cookies-from-browser <browser>", "Forward to yt-dlp --cookies-from-browser")
    .option("--stt-engine <engine>", "whisper, whisper-cpp, or custom", "whisper")
    .option("--stt-command <command>", "STT command path or template")
    .option("--stt-model <model>", "STT model name/path")
    .option("--language <code>", "STT language code")
    .addOption(engineOption().default("regex"))
    .option("--model <model>", "Local model for Ollama classification")
    .option("--ollama-url <url>", "Ollama base URL", "http://localhost:11434")
    .action(
      safe(async (options) => {
        ensureDataDirs();
        const cookie = await loadCookie({ cookie: options.cookie, cookieFile: options.cookieFile });
        const auth = await loadAuth();
        const discovered: TikTokVideo[] = [];
        const fetchOptions = {
          cookie,
          username: auth.username,
          proxy: options.proxy as string | undefined,
          limit: Number(options.limit),
          page: Number(options.page),
          pages: options.pages == null ? undefined : Number(options.pages),
        };

        for (const value of options.collection as string[]) discovered.push(...(await fetchCollection(value, fetchOptions)));
        for (const value of options.playlist as string[]) discovered.push(...(await fetchPlaylist(value, fetchOptions)));
        for (const value of options.liked as string[]) discovered.push(...(await fetchLiked(value, fetchOptions)));
        for (const value of options.user as string[]) discovered.push(...(await fetchUserPosts(value, fetchOptions)));
        for (const value of options.searchVideo as string[]) discovered.push(...(await fetchVideoSearch(value, fetchOptions)));
        for (const value of options.url as string[]) discovered.push(await fetchSingleUrl(value, fetchOptions));

        if (options.urlsFile) {
          const urls = (await fs.readFile(String(options.urlsFile), "utf8"))
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          discovered.push(...videosFromUrls(urls));
        }

        if (options.input) {
          discovered.push(...(await readImport(String(options.input))));
        }

        if (discovered.length === 0) throw new Error("No source supplied. Try --collection, --url, --urls-file, or --input.");
        const sync = await mergeVideos(discovered, { rebuild: Boolean(options.rebuild) });
        console.log(`Synced ${sync.added} new, ${sync.updated} updated, ${sync.unchanged} unchanged (${sync.total} total).`);

        let videos = await loadVideos();
        const touched = new Set(sync.ids);
        if (options.download) {
          videos = await runDownloads(videos, touched, {
            ytDlp: options.ytDlp,
            proxy: options.proxy,
            cookiesFile: options.ytDlpCookies,
            cookiesFromBrowser: options.cookiesFromBrowser,
            audioOnly: Boolean(options.audio),
          });
        }
        if (options.transcribe) {
          videos = await runTranscription(videos, touched, {
            engine: options.sttEngine as SttEngine,
            command: options.sttCommand,
            model: options.sttModel,
            language: options.language,
          });
        }
        if (options.classify) {
          videos = await runClassification(videos, touched, {
            engine: options.engine,
            model: options.model,
            ollamaBaseUrl: options.ollamaUrl,
          });
        }
        const index = await saveSearchIndex(videos);
        console.log(`Indexed ${index.recordCount} videos at ${toDisplayPath(searchIndexPath())}.`);
      }),
    );

  program
    .command("fetch-media")
    .description("Download media for existing records with yt-dlp")
    .option("--audio", "Extract audio only", false)
    .option("--video", "Download video instead of audio", false)
    .option("--force", "Redownload existing media", false)
    .option("--limit <n>", "Max records", parseNumber)
    .option("--query <query>", "Only records matching a search query")
    .option("--yt-dlp <command>", "yt-dlp command path", "yt-dlp")
    .option("--yt-dlp-cookies <path>", "Netscape cookies file for yt-dlp")
    .option("--cookies-from-browser <browser>", "Forward to yt-dlp --cookies-from-browser")
    .option("--proxy <url>", "Proxy URL")
    .action(
      safe(async (options) => {
        const videos = await selectVideos(await loadVideos(), { query: options.query, limit: options.limit });
        const touched = new Set(videos.map((video) => video.id));
        const next = await runDownloads(await loadVideos(), touched, {
          ytDlp: options.ytDlp,
          proxy: options.proxy,
          cookiesFile: options.ytDlpCookies,
          cookiesFromBrowser: options.cookiesFromBrowser,
          audioOnly: !options.video,
          force: options.force,
        });
        await saveSearchIndex(next);
      }),
    );

  program
    .command("transcribe")
    .description("Transcribe downloaded audio/video")
    .option("--engine <engine>", "whisper, whisper-cpp, or custom", "whisper")
    .option("--command <command>", "STT command path or custom template")
    .option("--model <model>", "Model name/path")
    .option("--language <code>", "Language code")
    .option("--force", "Retranscribe existing transcripts", false)
    .option("--limit <n>", "Max records", parseNumber)
    .option("--query <query>", "Only records matching a search query")
    .action(
      safe(async (options) => {
        const videos = await selectVideos(await loadVideos(), { query: options.query, limit: options.limit });
        const touched = new Set(videos.map((video) => video.id));
        const next = await runTranscription(await loadVideos(), touched, {
          engine: options.engine as SttEngine,
          command: options.command,
          model: options.model,
          language: options.language,
          force: options.force,
        });
        await saveSearchIndex(next);
      }),
    );

  program
    .command("index")
    .description("Rebuild search index")
    .action(
      safe(async () => {
        const index = await saveSearchIndex(await loadVideos());
        console.log(`Indexed ${index.recordCount} videos.`);
      }),
    );

  program
    .command("search")
    .description("Full-text search across clip metadata and transcripts")
    .argument("<query>", "Search query")
    .option("--author <handle>", "Filter by author")
    .option("--after <date>", "Created after YYYY-MM-DD")
    .option("--before <date>", "Created before YYYY-MM-DD")
    .option("--category <name>", "Filter by category")
    .option("--domain <name>", "Filter by domain")
    .option("--collection <name>", "Filter by collection/source")
    .option("--has-transcript <true|false>", "Filter transcript presence", boolFromString)
    .option("--limit <n>", "Max results", parseNumber, 20)
    .option("--json", "JSON output", false)
    .action(
      safe(async (query, options) => {
        if (options.json) setColorEnabled(false);
        const { videos, index } = await requireIndex();
        const results = searchWithIndex(videos, index, { ...filtersFromOptions(options), query });
        console.log(formatSearchResults(results, { json: options.json }));
      }),
    );

  program
    .command("list")
    .description("List videos with filters")
    .option("--query <query>", "Search query")
    .option("--author <handle>", "Filter by author")
    .option("--after <date>", "Created after YYYY-MM-DD")
    .option("--before <date>", "Created before YYYY-MM-DD")
    .option("--category <name>", "Filter by category")
    .option("--domain <name>", "Filter by domain")
    .option("--collection <name>", "Filter by collection/source")
    .option("--source <source>", "collection, playlist, liked, user, search, url, import")
    .option("--has-transcript <true|false>", "Filter transcript presence", boolFromString)
    .option("--limit <n>", "Max results", parseNumber, 30)
    .option("--offset <n>", "Offset", parseNumber, 0)
    .option("--json", "JSON output", false)
    .action(
      safe(async (options) => {
        if (options.json) setColorEnabled(false);
        const { videos, index } = await requireIndex();
        const results = searchWithIndex(videos, index, filtersFromOptions(options));
        if (options.json) console.log(JSON.stringify(results.map((result) => result.video), null, 2));
        else console.log(formatList(results.map((result) => result.video)));
      }),
    );

  program
    .command("show")
    .description("Show one video")
    .argument("<idOrUrl>", "Video id, prefix, or URL")
    .option("--json", "JSON output", false)
    .action(
      safe(async (idOrUrl, options) => {
        if (options.json) setColorEnabled(false);
        const video = findVideo(await loadVideos(), idOrUrl);
        if (!video) throw new Error(`No video found for ${idOrUrl}.`);
        console.log(options.json ? JSON.stringify(video, null, 2) : formatVideo(video));
      }),
    );

  program
    .command("similar")
    .description("Find videos similar to one saved video")
    .argument("<idOrUrl>", "Video id, prefix, or URL")
    .option("--limit <n>", "Max results", parseNumber, 10)
    .action(
      safe(async (idOrUrl, options) => {
        const { videos, index } = await requireIndex();
        const video = findVideo(videos, idOrUrl);
        if (!video) throw new Error(`No video found for ${idOrUrl}.`);
        const query = [video.description, video.classification?.summary, video.transcript?.text?.slice(0, 1000), ...(video.classification?.topics ?? [])]
          .filter(Boolean)
          .join(" ");
        const results = searchWithIndex(videos, index, { query, limit: Number(options.limit) + 1 }).filter((result) => result.video.id !== video.id);
        console.log(formatSearchResults(results.slice(0, Number(options.limit))));
      }),
    );

  program
    .command("sample")
    .description("Show a random sample from a category")
    .argument("<category>", "Category")
    .option("--limit <n>", "Number to sample", parseNumber, 5)
    .action(
      safe(async (category, options) => {
        const videos = (await loadVideos()).filter((video) => video.classification?.category === category);
        const shuffled = [...videos].sort(() => Math.random() - 0.5).slice(0, Number(options.limit));
        console.log(formatList(shuffled));
      }),
    );

  program.command("stats").description("Show archive stats").action(safe(async () => console.log(formatStats(await loadVideos()))));
  program.command("viz").description("Show a terminal dashboard").action(safe(async () => console.log(formatViz(await loadVideos()))));
  program.command("categories").description("Show category distribution").action(safe(async () => console.log(formatCounts(await loadVideos(), (video) => video.classification?.category ?? "uncategorized"))));
  program.command("domains").description("Show domain distribution").action(safe(async () => console.log(formatCounts(await loadVideos(), (video) => video.classification?.domain ?? "general"))));
  program.command("collections").description("Show collection/source distribution").action(safe(async () => console.log(formatCounts(await loadVideos(), (video) => video.collection?.name ?? video.collection?.id ?? video.source))));

  program
    .command("classify")
    .description("Classify videos by category/domain/topics")
    .addOption(engineOption().default("regex"))
    .option("--regex", "Use regex rules", false)
    .option("--all", "Reclassify already-classified records", false)
    .option("--limit <n>", "Max records", parseNumber)
    .option("--model <model>", "Ollama model")
    .option("--ollama-url <url>", "Ollama base URL")
    .action(
      safe(async (options) => {
        const engine = options.regex ? "regex" : options.engine;
        const videos = await loadVideos();
        const eligible = videos
          .filter((video) => options.all || !video.classification?.category)
          .slice(0, options.limit == null ? undefined : Number(options.limit));
        const touched = new Set(eligible.map((video) => video.id));
        const next = await runClassification(videos, touched, {
          engine,
          model: options.model,
          ollamaBaseUrl: options.ollamaUrl,
        });
        await saveSearchIndex(next);
      }),
    );

  program
    .command("model")
    .description("View or change local model preferences")
    .option("--classify-engine <engine>", "regex or ollama")
    .option("--ask-engine <engine>", "extractive or ollama")
    .option("--model <model>", "Default local model")
    .option("--ollama-url <url>", "Ollama base URL")
    .action(
      safe(async (options) => {
        const prefs = await loadPreferences();
        const next = {
          ...prefs,
          classifyEngine: options.classifyEngine ?? prefs.classifyEngine,
          askEngine: options.askEngine ?? prefs.askEngine,
          model: options.model ?? prefs.model,
          ollamaBaseUrl: options.ollamaUrl ?? prefs.ollamaBaseUrl,
        };
        if (JSON.stringify(next) !== JSON.stringify(prefs)) await savePreferences(next);
        console.log(JSON.stringify(next, null, 2));
      }),
    );

  program
    .command("md")
    .description("Export videos as Markdown pages")
    .option("--changed", "Skip unchanged files", false)
    .action(
      safe(async (options) => {
        const result = await exportMarkdown(await loadVideos(), { changedOnly: options.changed });
        console.log(`Markdown export: ${result.written} written, ${result.skipped} skipped.`);
      }),
    );

  program
    .command("wiki")
    .description("Compile an interlinked local wiki")
    .action(
      safe(async () => {
        const result = await compileWiki(await loadVideos());
        console.log(`Wiki written: ${result.written} files under ${toDisplayPath(libraryDir())}.`);
      }),
    );

  program
    .command("ask")
    .description("Ask a question against local clip transcripts")
    .argument("<question>", "Question")
    .option("--engine <engine>", "extractive or ollama")
    .option("--model <model>", "Ollama model")
    .option("--ollama-url <url>", "Ollama base URL")
    .option("--limit <n>", "Evidence count", parseNumber, 8)
    .option("--save", "Save answer as a library page", false)
    .action(
      safe(async (question, options) => {
        const prefs = await loadPreferences();
        const { videos, index } = await requireIndex();
        const results = searchWithIndex(videos, index, { query: question, limit: Number(options.limit) });
        const answer = await answerQuestion(question, results, {
          engine: options.engine ?? prefs.askEngine ?? "extractive",
          model: options.model ?? prefs.model,
          ollamaBaseUrl: options.ollamaUrl ?? prefs.ollamaBaseUrl,
        });
        console.log(answer);
        if (options.save) {
          const file = path.join(libraryDir(), "answers", `${Date.now()}-${slug(question)}.md`);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, `# ${question}\n\n${answer}\n`, "utf8");
          console.log(`Saved: ${toDisplayPath(file)}`);
        }
      }),
    );

  program
    .command("lint")
    .description("Check generated wiki links")
    .option("--fix", "Create placeholder pages for missing links", false)
    .action(
      safe(async (options) => {
        const result = await lintWiki({ fix: options.fix });
        if (result.broken.length === 0) console.log("No broken wiki links.");
        else {
          console.log(result.broken.join("\n"));
          if (result.fixed) console.log(`Fixed ${result.fixed} missing pages.`);
        }
      }),
    );

  addLibraryCommands(program);
  addPortableCommandCommands(program);
  addSkillCommands(program);

  program.command("paths").description("Show data paths").option("--json", "JSON output", false).action(safe(async (options) => {
    if (options.json) setColorEnabled(false);
    const paths = { dataDir: dataDir(), videos: videosJsonlPath(), index: searchIndexPath(), library: libraryDir(), commands: commandsDir() };
    console.log(options.json ? JSON.stringify(paths, null, 2) : kvList(Object.entries(paths).map(([key, value]) => [key, c.muted(toDisplayPath(value) ?? "")])));
  }));
  program.command("path").description("Print data directory").action(() => console.log(dataDir()));
  program.command("status").description("Show archive status").option("--json", "JSON output", false).action(safe(async (options) => {
    if (options.json) setColorEnabled(false);
    const videos = await loadVideos();
    const status = {
      videos: videos.length,
      transcripts: videos.filter((video) => video.transcript?.text).length,
      classified: videos.filter((video) => video.classification?.category).length,
      dataDir: dataDir(),
      libraryDir: libraryDir(),
      indexExists: await fileExists(searchIndexPath()),
    };
    console.log(options.json ? JSON.stringify(status, null, 2) : formatStatus(status));
  }));

  return program;
}

async function runDownloads(videos: TikTokVideo[], touched: Set<string>, options: Parameters<typeof downloadMedia>[1]): Promise<TikTokVideo[]> {
  const next = [...videos];
  const total = next.filter((video) => touched.has(video.id)).length;
  const progress = createProgress({ total, label: "media" });
  let downloaded = 0;
  let present = 0;
  const failed: string[] = [];
  for (const [idx, video] of next.entries()) {
    if (!touched.has(video.id)) continue;
    try {
      const outcome = await downloadMedia(video, options);
      next[idx] = { ...video, media: outcome.media };
      if (outcome.changed) downloaded += 1;
      else present += 1;
      progress.tick(`${video.id} (${outcome.changed ? "downloaded" : "already present"})`);
    } catch (error) {
      failed.push(video.id);
      progress.fail(`${video.id} (failed: ${(error as Error).message})`);
    }
  }
  progress.done();
  await saveVideos(next);
  console.log(`Media: ${downloaded} downloaded, ${present} already present${failed.length ? `, ${failed.length} failed (${failed.join(", ")})` : ""} (${total} total).`);
  return next;
}

async function runTranscription(videos: TikTokVideo[], touched: Set<string>, options: Parameters<typeof transcribeVideo>[1]): Promise<TikTokVideo[]> {
  const next = [...videos];
  const total = next.filter((video) => touched.has(video.id)).length;
  const progress = createProgress({ total, label: "transcribe" });
  let transcribed = 0;
  let present = 0;
  const failed: string[] = [];
  for (const [idx, video] of next.entries()) {
    if (!touched.has(video.id)) continue;
    try {
      const outcome = await transcribeVideo(video, options);
      if (outcome.transcript) next[idx] = { ...video, transcript: outcome.transcript };
      if (outcome.changed) transcribed += 1;
      else present += 1;
      progress.tick(`${video.id} (${outcome.changed ? "transcribed" : "already present"})`);
    } catch (error) {
      failed.push(video.id);
      progress.fail(`${video.id} (failed: ${(error as Error).message})`);
    }
  }
  progress.done();
  await saveVideos(next);
  console.log(`Transcripts: ${transcribed} transcribed, ${present} already present${failed.length ? `, ${failed.length} failed (${failed.join(", ")})` : ""} (${total} total).`);
  return next;
}

async function runClassification(videos: TikTokVideo[], touched: Set<string>, options: { engine?: "regex" | "ollama"; model?: string; ollamaBaseUrl?: string }): Promise<TikTokVideo[]> {
  const next = [...videos];
  const total = next.filter((video) => touched.has(video.id)).length;
  const progress = createProgress({ total, label: "classify" });
  let classified = 0;
  const failed: string[] = [];
  for (const [idx, video] of next.entries()) {
    if (!touched.has(video.id)) continue;
    try {
      const classification = await classifyOne(video, options);
      next[idx] = { ...video, classification };
      classified += 1;
      progress.tick(video.id);
    } catch (error) {
      failed.push(video.id);
      progress.fail(`${video.id} (failed: ${(error as Error).message})`);
    }
  }
  progress.done();
  await saveVideos(next);
  console.log(`Classified ${classified} videos${failed.length ? `, ${failed.length} failed (${failed.join(", ")})` : ""} (${total} total).`);
  return next;
}

async function readImport(filePath: string): Promise<TikTokVideo[]> {
  const text = await readTextInput(filePath);
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return videosFromImport(JSON.parse(trimmed) as unknown);
  return trimmed
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => videosFromImport(JSON.parse(line) as unknown));
}

async function requireIndex() {
  const videos = await loadVideos();
  let index = await loadSearchIndex();
  if (!index) index = await saveSearchIndex(videos);
  return { videos, index };
}

async function selectVideos(videos: TikTokVideo[], options: { query?: string; limit?: number }): Promise<TikTokVideo[]> {
  if (!options.query) return videos.slice(0, options.limit == null ? undefined : Number(options.limit));
  const index = (await loadSearchIndex()) ?? (await saveSearchIndex(videos));
  return searchWithIndex(videos, index, { query: options.query, limit: options.limit ?? 50 }).map((result) => result.video);
}

function filtersFromOptions(options: Record<string, unknown>): SearchFilters {
  return {
    author: optionString(options.author),
    after: optionString(options.after),
    before: optionString(options.before),
    category: optionString(options.category),
    domain: optionString(options.domain),
    collection: optionString(options.collection),
    source: optionString(options.source) as TikTokSource | undefined,
    hasTranscript: typeof options.hasTranscript === "boolean" ? options.hasTranscript : undefined,
    limit: optionNumber(options.limit),
    offset: optionNumber(options.offset),
    query: optionString(options.query),
  };
}

function formatList(videos: TikTokVideo[]): string {
  if (videos.length === 0) return c.muted("No videos.");
  return videos
    .map((video) => {
      const author = video.author?.username ? c.accent(`@${video.author.username}`) : c.muted("unknown");
      const category = video.classification?.category ? ` ${c.warn(`[${video.classification.category}]`)}` : "";
      const transcript = video.transcript?.text ? ` ${c.success("transcript")}` : "";
      const desc = truncate((video.description ?? "").replace(/\s+/g, " "), 160);
      return [
        `${c.value(video.id)} ${author}${category}${transcript}`,
        `  ${desc}`,
        `  ${c.muted(video.canonicalUrl ?? video.url)}`,
      ].join("\n");
    })
    .join("\n\n");
}

function formatVideo(video: TikTokVideo): string {
  return [
    `${c.value(video.id)} ${video.author?.username ? c.accent(`@${video.author.username}`) : ""}`.trimEnd(),
    c.muted(video.canonicalUrl ?? video.url),
    "",
    video.description ?? "",
    "",
    kvList([
      ["Category", c.value(video.classification?.category ?? "uncategorized")],
      ["Domain", c.value(video.classification?.domain ?? "general")],
      ["Topics", (video.classification?.topics ?? []).join(", ") || c.muted("none")],
      ["Media", toDisplayPath(video.media?.audioPath ?? video.media?.videoPath) ?? c.muted("not downloaded")],
    ]),
    "",
    c.heading("Transcript"),
    video.transcript?.text ?? c.muted("No transcript yet."),
  ].join("\n");
}

function archiveSummaryLines(videos: TikTokVideo[]): string[] {
  const transcriptCount = videos.filter((video) => video.transcript?.text).length;
  const classifiedCount = videos.filter((video) => video.classification?.category).length;
  const dates = videos.flatMap((video) => (video.createdAt ? [video.createdAt] : [])).sort();
  const dot = c.muted("\u00b7");
  const counts =
    `${c.value(String(videos.length))} videos ${dot} ` +
    `${c.value(String(transcriptCount))} transcripts ${c.muted(`(${percent(transcriptCount, videos.length)})`)} ${dot} ` +
    `${c.value(String(classifiedCount))} classified ${c.muted(`(${percent(classifiedCount, videos.length)})`)}`;
  const range = dates.length
    ? `${c.label("Range")} ${formatDate(dates[0])} ${c.muted("\u2192")} ${formatDate(dates.at(-1))}`
    : `${c.label("Range")} ${c.muted("unknown")}`;
  return [counts, range];
}

function formatStats(videos: TikTokVideo[]): string {
  const authors = countBy(videos, (video) => video.author?.username ?? "unknown");
  return [
    box("Tokwise", archiveSummaryLines(videos)),
    "",
    c.heading("Top authors"),
    barChart([...authors.entries()], { limit: 10 }),
  ].join("\n");
}

function formatViz(videos: TikTokVideo[]): string {
  const authors = countBy(videos, (video) => video.author?.username ?? "unknown");
  const categories = countBy(videos, (video) => video.classification?.category ?? "uncategorized");
  const domains = countBy(videos, (video) => video.classification?.domain ?? "general");
  return [
    box("Tokwise", archiveSummaryLines(videos)),
    "",
    c.heading("Top authors"),
    barChart([...authors.entries()], { limit: 10 }),
    "",
    c.heading("Categories"),
    barChart([...categories.entries()], { limit: 12 }),
    "",
    c.heading("Domains"),
    barChart([...domains.entries()], { limit: 12 }),
  ].join("\n");
}

function formatCounts(videos: TikTokVideo[], keyFn: (video: TikTokVideo) => string): string {
  return barChart([...countBy(videos, keyFn).entries()], { limit: 50 });
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function countBy(videos: TikTokVideo[], keyFn: (video: TikTokVideo) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const video of videos) {
    const key = keyFn(video);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatStatus(status: { videos: number; transcripts: number; classified: number; dataDir: string; libraryDir: string; indexExists: boolean }): string {
  return kvList([
    ["Videos", c.value(String(status.videos))],
    ["Transcripts", c.value(String(status.transcripts))],
    ["Classified", c.value(String(status.classified))],
    ["Index", status.indexExists ? c.success("ready") : c.warn("missing")],
    ["Data", c.muted(toDisplayPath(status.dataDir) ?? "")],
    ["Library", c.muted(toDisplayPath(status.libraryDir) ?? "")],
  ]);
}

function addLibraryCommands(program: Command): void {
  const library = program.command("library").description("Search and manage local library pages");
  library.command("search").argument("<query>").option("--limit <n>", "Max results", parseNumber, 20).action(safe(async (query, options) => {
    const results = await searchLibrary(query, Number(options.limit));
    console.log(results.map((result) => `${result.path} (${result.score})\n  ${result.preview}`).join("\n\n") || "No matches.");
  }));
  library.command("show").argument("<path>").option("--json", "JSON output", false).action(safe(async (pagePath, options) => {
    const page = await showLibraryPage(pagePath);
    console.log(options.json ? JSON.stringify(page, null, 2) : page.body);
    if (!options.json) console.error(`sha256: ${page.sha256}`);
  }));
  library.command("create").argument("<path>").requiredOption("--stdin", "Read body from stdin").action(safe(async (pagePath) => {
    const file = await createLibraryPage(pagePath, "-");
    console.log(`Created ${toDisplayPath(file)}.`);
  }));
  library.command("update").argument("<path>").requiredOption("--stdin", "Read body from stdin").option("--expected-sha256 <hash>").action(safe(async (pagePath, options) => {
    const file = await updateLibraryPage(pagePath, "-", options.expectedSha256);
    console.log(`Updated ${toDisplayPath(file)}.`);
  }));
  library.command("delete").argument("<path>").action(safe(async (pagePath) => {
    const file = await deleteLibraryPage(pagePath);
    console.log(`Moved to ${toDisplayPath(file)}.`);
  }));
}

function addPortableCommandCommands(program: Command): void {
  const commands = program.command("commands").description("Manage portable command notes");
  commands.command("list").action(safe(async () => console.log((await listCommands()).join("\n") || "No commands.")));
  commands.command("new").argument("<name>").action(safe(async (name) => console.log(`Created ${toDisplayPath(await createCommand(name))}.`)));
  commands.command("validate").argument("[name]").action(safe(async (name) => {
    const result = await validateCommands(name);
    if (result.ok.length) console.log(`OK: ${result.ok.join(", ")}`);
    if (result.issues.length) {
      console.log(result.issues.join("\n"));
      process.exitCode = 1;
    }
  }));
}

function addSkillCommands(program: Command): void {
  const skill = program.command("skill").description("Install or show the agent skill");
  skill.command("show").action(() => console.log(skillContent()));
  skill.command("install").option("--target <target>", "codex, claude, or all", "all").action(safe(async (options) => {
    const files = await installSkill(options.target);
    console.log(files.map((file) => `Installed ${toDisplayPath(file)}`).join("\n"));
  }));
  skill.command("uninstall").option("--target <target>", "codex, claude, or all", "all").action(safe(async (options) => {
    const files = await uninstallSkill(options.target);
    console.log(files.map((file) => `Removed ${toDisplayPath(file)}`).join("\n"));
  }));
}

function optionString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function percent(part: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((part / total) * 100)}%`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "answer";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function showDashboard(): Promise<void> {
  ensureDataDirs();
  const videos = await loadVideos();
  console.log([
    box(`Tokwise CLI v${version()}`, archiveSummaryLines(videos)),
    "",
    formatStatus({
      videos: videos.length,
      transcripts: videos.filter((video) => video.transcript?.text).length,
      classified: videos.filter((video) => video.classification?.category).length,
      dataDir: dataDir(),
      libraryDir: libraryDir(),
      indexExists: await fileExists(searchIndexPath()),
    }),
    "",
    `${c.muted("Next")}    tokwise sync --collection <url> --download --audio --transcribe --classify`,
    `${c.muted("Explore")} tokwise search "life advice" ${c.muted("|")} tokwise viz ${c.muted("|")} tokwise wiki`,
  ].join("\n"));
}

export function isCliEntrypoint(importUrl = import.meta.url, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(importUrl)) === realpathSync(argvPath);
  } catch {
    return path.resolve(fileURLToPath(importUrl)) === path.resolve(argvPath);
  }
}

if (isCliEntrypoint()) {
  const program = buildCli();
  if (process.argv.length <= 2) {
    await showDashboard();
  } else {
    await program.parseAsync(process.argv);
  }
}
