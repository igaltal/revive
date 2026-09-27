# Revive: Phase 1 build plan

Status: **approved 2026-09-25.** M1 done; see Progress at the bottom.

Sources: the build prompt (source of truth for scope) and
`Revive PRD v2 The No Code Home for Everything You Build with AI.pdf` (there is no `docs/PRD.md`).

---

## 1. Folder structure

The repo root is `Revive/`. The PRD PDF stays where it is and is added to `.gitignore`, unless you want it committed under `docs/`.

electron-vite needs a preload script, so the layout is `src/main`, `src/preload`, `src/renderer` and `src/shared`. This is the prompt's `main/ renderer/ shared/` plus a preload folder.

```
Revive/
├─ PLAN.md
├─ package.json  electron.vite.config.ts  tsconfig*.json  tailwind.config.ts
├─ eslint.config.js            # includes the "no physical direction" rule (see §6)
├─ resources/                  # app icon
├─ e2e/smoke.spec.ts           # Playwright + _electron
├─ fixtures/sample-folder/     # 2 tiny projects (static html, vite) for tests and e2e
└─ src/
   ├─ shared/
   │  ├─ manifest.ts           # zod schema, Manifest/Project/Status types, JSON-schema export
   │  ├─ settings.ts           # Settings type and defaults
   │  ├─ ipc.ts                # typed IPC contract (the single source for channels)
   │  └─ redact.ts             # secret masking (pure, unit tested)
   ├─ main/
   │  ├─ index.ts              # app lifecycle, window, quit → kill children
   │  ├─ ipc/                  # one handler file per domain, all typed from shared/ipc.ts
   │  ├─ settings-store.ts     # JSON in userData (+ safeStorage wrapper for future secrets)
   │  ├─ prereq.ts             # claude / git / node / codex detection
   │  ├─ manifest-store.ts     # read (zod-validated), write, merge, user_locked enforcement
   │  ├─ scanner/
   │  │  ├─ agent-adapter.ts   # AgentAdapter interface (scan now; fix/change later)
   │  │  ├─ claude-adapter.ts  # spawns `claude -p`, parses stream-json
   │  │  ├─ fs-fingerprint.ts  # before/after tree fingerprint for the diff guard
   │  │  └─ scan.ts            # orchestration: snapshot → scan → diff → validate
   │  ├─ prompts/scan.md       # the scan prompt, verbatim
   │  ├─ runner/
   │  │  ├─ process-runner.ts  # node-pty lifecycle, registry, kill-all
   │  │  ├─ port-detect.ts     # parse output + probe
   │  │  ├─ health.ts          # HTTP health check
   │  │  └─ install-detect.ts  # node_modules / .venv presence per stack
   │  ├─ preview/              # WebContentsView manager, device widths, screenshots
   │  ├─ versions/             # simple-git: shadow repo vs refs/revive/, snapshot, restore
   │  └─ extensions/           # stubs: error-classifier, key-store, golive, chat, night-shift
   ├─ preload/index.ts         # contextBridge exposing window.revive (typed)
   └─ renderer/
      ├─ main.tsx  App.tsx  router.tsx
      ├─ i18n/{index.ts, en.json, he.json, Bdi.tsx, LtrBlock.tsx}
      ├─ theme/{tokens.css, fonts.css}   # fonts from @fontsource/*, bundled
      ├─ components/  # Sidebar, LanguageSwitch, StatusPill, Button, ProjectCard,
      │               # TechnicalDetails, DirIcon, PreviewFrame, ...
      └─ screens/     # Onboarding, Scan, Projects, ProjectPage, History, Settings
```

## 2. IPC contracts (`src/shared/ipc.ts`)

The renderer only ever calls `window.revive.invoke(channel, args)` and `window.revive.on(event, cb)`. Both are typed from one map. Main validates every payload with zod, and all paths are resolved and checked against the active folder.

### Requests (renderer → main, `ipcRenderer.invoke`)
| Channel | Args | Returns |
|---|---|---|
| `settings:get` | – | `Settings` |
| `settings:set` | `Partial<Settings>` | `Settings` |
| `prereq:check` | – | `PrereqReport` `{claude:{installed,version,signedIn:'yes'\|'no'\|'unknown'}, git, node, codex}` |
| `folder:pick` | – | `string \| null` (native dialog) |
| `folder:open` | `{path}` | `FolderState` `{path, hasManifest, isGitRepo, manifest?}` |
| `manifest:get` | `{folder}` | `Manifest \| null` (validated) |
| `scan:start` | `{folder}` | `{scanId}` |
| `scan:cancel` | `{scanId}` | `void` |
| `runner:start` | `{folder, projectId}` | `void` (progress arrives as events) |
| `runner:stop` | `{projectId}` | `void` |
| `runner:list` | – | `RunState[]` |
| `runner:logs` | `{projectId}` | `string` (already redacted) |
| `preview:attach` | `{projectId, bounds, device:'desktop'\|'phone'}` | `void` |
| `preview:bounds` | `{bounds}` | `void` |
| `preview:detach` | – | `void` |
| `preview:openInBrowser` | `{projectId}` | `void` (only `http://localhost:*` / `127.0.0.1`) |
| `shots:url` | `{folder, projectId}` | `string \| null` (`revive-shot://` custom protocol, path-locked to `.revive/shots`) |
| `versions:list` | `{folder}` | `Version[]` `{id, title:{en,he}, kind, createdAt, restoredFrom?}` |
| `versions:restore` | `{folder, versionId}` | `{undoVersionId}` |
| `shell:openHelp` | `{topic:'install-claude'\|'sign-in'}` | `void` (allowlisted URLs only) |

### Events (main → renderer, `webContents.send`)
| Event | Payload |
|---|---|
| `scan:progress` | `{scanId, filesRead, projectsFound, lastFile?, phase:'saving'\|'reading'\|'checking'\|'done'}` |
| `scan:done` | `{scanId, ok:true, manifest}` or `{scanId, ok:false, error:{code:'claude_missing'\|'auth'\|'modified_outside'\|'invalid_manifest'\|'cancelled'\|'unknown', changedPaths?, detail?}}` |
| `runner:state` | `{projectId, phase:'installing'\|'starting'\|'running'\|'checking'\|'verified'\|'stopped'\|'broken', url?, port?, reason?}` |
| `runner:log` | `{projectId, chunk}` (redacted) |
| `manifest:changed` / `versions:changed` | `{folder}` |

### Extension points (typed now, not implemented)
`AgentAdapter` (`scan` implemented; `fix` and `change` declared), `ErrorClassifier`, `KeyStore` (safeStorage-backed), `GoLiveAdapter`, and a sidebar/route registry with feature flags. The channels `fix:*`, `keys:*`, `golive:*`, `chat:*` and `nightshift:*` are reserved in the contract as comments.

## 3. Key technical decisions

- **Scan flags.** These come from `claude --help` on this machine (v2.1.282), not from memory:
  ```
  claude -p "<scan.md>" --output-format stream-json --verbose
    --restricted                          # removes Bash/code tools, confines file tools to cwd
    --tools "Read,Glob,Grep,Write,Edit"   # only these tools exist
    --allowedTools "Read" "Glob" "Grep" "Write(./.revive/**)" "Edit(./.revive/**)"
    --permission-mode dontAsk --permission-prompts none   # anything not allowed is denied, never prompts
    --strict-mcp-config --no-session-persistence
  ```
  cwd is the chosen folder. In M3 I'll check the exact `Write(path)` rule syntax against the permissions docs and prove it with a test: a scan told to write outside `.revive/` must be denied. If the path rule doesn't hold, I'll stop and tell you. The diff guard runs either way.
- **Diff guard.** Before the scan I fingerprint the tree (path, size, mtime, and a hash for small files, excluding `.revive/`). After the scan I compare. Changed tracked files are restored from the pre-scan version. New files outside `.revive/` are **moved** to `.revive/quarantine/<scan-time>/`, never deleted, and listed in the error. Any processes Revive started are stopped before the scan so they can't cause false alarms.
- **Status ownership.** Revive, not Claude, owns `status` and `run.verified_at`. After a scan, Revive keeps the previous status and `verified_at` if `run.install`/`run.dev` didn't change. Otherwise it resets them to `unknown`. `running` is never written to disk; it's layered on at runtime. Revive also re-applies `user_locked` fields after the scan in code, so it doesn't rely on Claude alone to respect them.
- **Schema file.** Before each scan, Revive writes `.revive/schema.json`, generated from the zod schema so the two can't drift.
- **Manifest is validated on every read.** An invalid file gives a plain "we couldn't read the project list" state plus a "Scan again" action, never a crash.
- **Runner.** Uses node-pty. Start runs install if `node_modules` (or `.venv` for Python) is missing, then dev. The port comes from output (`localhost:NNNN` and similar), then from the manifest port, then by probing common ports. Health check: HTTP GET until a status below 500, 60 s timeout. On success: status `verified`, set `verified_at`, write the manifest, and capture the screenshot. On exit or timeout: `broken`, with the redacted log under Technical details. Quitting kills each pty's process group.
- **Preview.** Uses a `WebContentsView` in its own session partition, without node, sandboxed, and allowed to navigate only to localhost. The renderer reports the placeholder element's bounds, and main positions the view over it. Phone width is 390 px, centered. Screenshots use `capturePage()` and go to `.revive/shots/<id>.png`.
- **Secrets.** `redact()` masks known token shapes (sk-, ghp_, AKIA, JWTs, long high-entropy strings) and `KEY=value` lines. It also masks the exact values found in each project's `.env*` files. Main reads those values only to redact them; they never leave main. All runner output shown in the UI goes through `redact()`.
- **Network.** The renderer has a CSP of `default-src 'self'`, with no remote fonts or scripts. Main makes no network calls except localhost health checks. Package installs and Claude Code's own API traffic are the only outbound traffic. The user's app in the preview can do whatever it normally does.
- **RTL.** The root `<html dir lang>` is set from the settings. A custom ESLint rule and a unit test fail on `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right/rounded-l*/border-l*` etc. `<Bdi>` and `<LtrBlock>` components handle bidi. `<DirIcon>` mirrors chevrons and arrows in RTL; play and undo icons are plain.
- **i18n.** i18next with `i18next-icu`. A Vitest test checks that `en.json` and `he.json` have identical key sets and identical ICU argument names per key. It runs in `npm run build` (via `prebuild`), so parity gaps fail the build.

## 4. Milestones

Each milestone ends with typecheck, lint, tests, a PLAN.md update, a commit, and a stop for your review.

**M1: Shell, theme, i18n, RTL, sidebar, Settings.** electron-vite scaffold, security defaults (contextIsolation, sandbox, CSP), Tailwind tokens, bundled fonts, i18next + ICU with both catalogs, the parity test, the lint rule, the sidebar with the Hebrew | English switch, and the Settings screen (interface language, Claude answers in, Simple/Advanced). Settings persist. Switching language keeps screen state (a test types into a field, switches language, and checks the value survives).
*Try it:* `npm run dev`, switch languages, and watch the layout flip.

**M2: Folder picker, onboarding, prerequisites.** First run: language choice, then a prerequisite check (Claude Code installed and signed in, git, node), then the folder picker (native dialog and drag and drop), then recent folders. Missing Claude Code shows install steps (command in an LTR block plus a button that opens the official page). Not signed in shows sign-in steps.

**M3: Scan, manifest, gallery.** zod schema and schema.json, the Claude adapter, streamed progress (files read, projects found), the version-before-scan hook (the full versions module lands in M5; M3 uses its snapshot core early), the diff guard with restore and quarantine, all error states (missing, auth, modified outside, invalid), and the 4-column gallery with placeholder pictures and status pills.

**M4: Runner, preview, screenshots, status.** Start/Stop, install detection, port detection, health check, the preview with desktop/phone widths, the screenshot on the card, status transitions, kill-all on quit, and redacted logs under Technical details. The project page shows the description, preview, and collapsed technical details.

**M5: Versions and History.** Shadow repo vs `refs/revive/`, a snapshot before every scan and restore, restore that can itself be undone, and a History screen with plain titles and times. Then the Playwright smoke test: launch → onboarding → pick fixture → (stubbed) scan → gallery → start the static project → preview visible.

## 5. Tests (Vitest unless noted)
Catalog parity plus ICU arguments; the no-physical-direction lint rule; manifest schema (valid, invalid, extra fields); the merge and `user_locked` enforcement; status carry-over; redaction; port detection from real dev-server output samples (Vite, Next, CRA, Flask, http-server); the fingerprint diff; versions against temp dirs (shadow repo, existing repo where the branches and HEAD are unchanged, restore then undo); runner kill-all. There is one Playwright e2e test, where the scan is replaced by a fake adapter so it runs offline and costs nothing.

## 6. Decisions (answers from 2026-09-25)

1. **Hebrew vocabulary.** Approved as written in `he.json` `vocab.*` (2026-09-25): הפעל, עצור, עובד עכשיו, נבדק ועובד, צריך תיקון, עוד לא נבדק, מפתחות וחיבורים, להעלות לאוויר, האתר החי, גרסה שמורה, חזור לגרסה הזו, פרטים טכניים, פתח, בדוק אם זה עובד, הפרויקטים שלי, הגדרות, היסטוריה. All other Hebrew copy is written natively in the same plain tone.
2. **Broken cards.** "Check if it works" as a retry, plus a rule-based `ErrorExplainer` interface (no agent) that gives one plain sentence for known causes: missing env key, port busy, dependencies not installed, command not found. Anything else shows "Something went wrong" and Technical details with the log. The agent-based Fix it plugs into the same interface later.
3. **Nested repos.** Snapshots for projects with their own repo go under `refs/revive/` inside each repo, using a separate `GIT_INDEX_FILE` plus `commit-tree`/`update-ref`. The user's branches, HEAD, index and stash are never touched. The shadow repo covers everything else and excludes nested repo folders.
4. **Restore.** Files a restore would delete are moved to `.revive/trash/<timestamp>/`. Only the user can empty the trash, from History, with a confirmation.
5. **What a version includes.** Respects `.gitignore` and also skips `node_modules`, `build`, `dist`, `.revive/` and files over 50 MB. Restore never deletes or overwrites ignored or untracked files outside the snapshot, so `.env` files stay exactly as they are. History says: "Keys are never included in saved versions."
6. **Installing Claude Code.** A short explanation and two buttons. "Install for me" runs the official install command after an explicit confirmation (the exact command is shown under Technical details). "Open the official page" is the fallback. The prerequisite check re-runs automatically after install.
7. **Gallery.** 4 columns at 1280 px and above, 3 at 960 px, 2 below that. The minimum window width is 960 px (set in M1).
8. **Scan cost.** A Settings option picks the scan model (`--model`), defaulting to `haiku`. This CLI (2.1.282) has `--max-budget-usd`, which I'll use. `claude --help` does **not** list a turn-limit flag, so in M3 I'll check the docs for `--max-turns` and use it only if it's confirmed. Each scan also has a hard 10-minute timeout. If the JSON result reports cost, it's shown in plain words after the scan.

---

## Progress
- [x] M1 · [x] M2 · [x] M3 · [x] M4 · [ ] M5

### M1: done (2026-09-25)
- **Stack.** Electron 44, electron-vite 5, Vite 7, React 19, TypeScript 6.0, Tailwind 4, i18next 26 + i18next-icu, zod 4, Vitest 5, Playwright. I chose TS 6.0 and Vite 7 on purpose: typescript-eslint doesn't support TS 7 yet, and electron-vite 5 doesn't support Vite 8.
- **Shell.** Window minimum is 960×640. contextIsolation, sandbox and no node integration. The main window can't navigate or open popups, can't request network access outside its own files (plus the dev server in dev), and has all permission requests denied. CSP is `default-src 'self'`. Assets are never inlined as `data:` URIs (`assetsInlineLimit: 0`), so bundled fonts load under that CSP.
- **Typed IPC.** `src/shared/ipc.ts` holds the contract. The preload rejects unknown channels. The renderer has a lint ban on `node:*`, `fs`, `electron`, `node-pty` and `simple-git` imports.
- **Settings.** Stored as JSON in userData and zod-validated on load and write. A corrupt file falls back to defaults. `REVIVE_USER_DATA` points tests at a throwaway folder. `secret-store.ts` wraps safeStorage as the extension point for keys (unused in Phase 1).
- **i18n.** `en.json`/`he.json` with ICU. `tests/i18n-parity.test.ts` fails on missing keys, empty strings, invalid ICU or mismatched arguments. `npm run build` runs typecheck and tests first.
- **RTL.** `<html dir lang>` is set in place with no remount. `eslint-rules/physical-direction.js` fails lint on left/right classes, and `tests/rtl-logical.test.ts` scans classNames and CSS. In Hebrew, `tx()` wraps Latin runs and numbers in `<bdi>`. `<LtrBlock>` renders commands and paths as `dir="ltr"` blocks. Chevrons and arrows mirror; play and undo don't.
- **Screens.** First-run language choice (each card is written in its own language), the sidebar with עברית | English, and Settings: interface language, Claude answers in, detail level, and the scan model (Haiku by default). Technical details are collapsed in Simple and open in Advanced. My projects and History are placeholders until M3 and M5.
- **Tests.** 17 unit and component tests, plus the Electron smoke test (first run → Hebrew → English → relaunch keeps English).
- **Environment note.** The Electron binary download from GitHub kept getting cut off, so I installed it from `npmmirror.com`. The installer verifies it against Electron's bundled checksums.

*Try it:* `cd Revive && npm run dev`. With a fresh settings folder you get the language choice first. For a clean first run, use `REVIVE_USER_DATA=$(mktemp -d) npm run dev`. Checks: `npm run typecheck && npm run lint && npm test && npm run test:e2e`.

### M2: done (2026-09-25)
- **Flow.** Language → "Let's check your computer" (step 1 of 2) → "Which folder holds your projects?" (step 2 of 2) → My projects. Full-screen steps have the עברית | English switch in the top bar. On later launches the app goes straight to My projects. "Choose another folder" lists recent folders, marking any that no longer exist.
- **Prerequisite check** (`src/main/prereq.ts`). Checks Claude Code (version plus `claude auth status --json`, reading **only** `loggedIn`; email and org are dropped), git, Node.js (recommended, not required) and Codex (optional). Continue needs Claude Code installed and signed in, plus git. On a Mac without developer tools, `/usr/bin/git` is a stub that pops up Apple's installer, so `xcode-select -p` is checked first and the stub is never run.
- **PATH.** Apps opened from Finder don't get the shell's PATH, so it's read once from the login shell (`$SHELL -ilc`), in parallel with window creation, with `~/.local/bin` and Homebrew as fallbacks.
- **Install Claude Code.** An explanation, then "Install for me" or "Open the official page". "Install for me" opens a confirmation panel that shows the exact command under Technical details. Only confirming runs it. The command is a constant in `src/shared/prereq.ts`, `curl -fsSL https://claude.ai/install.sh | bash` (checked against code.claude.com/docs/en/setup), and nothing from the renderer can change it. Output streams masked. The check re-runs automatically when it ends.
- **Sign in.** "Sign in" runs `claude auth login` in a node-pty terminal, which opens the browser. The sign-in status is polled every 2 s (5-minute cap). If it fails, the app says so in one sentence and shows `claude` as a Terminal fallback in an LTR block. The check re-runs automatically.
- **Folder.** Native picker or drag and drop (`webUtils.getPathForFile` in preload). Main resolves symlinks and refuses missing folders, files, unreadable folders, and folders that are too broad (`/`, home, `/Users`, system folders, `~/Library`), each with one plain sentence.
- **Safety promises** on the folder step are worded to be true: Revive only reads, it has no servers, and Claude reads code through the user's own account. I didn't use the PRD's "your code stays on your computer": Claude Code sends code it reads to Anthropic, so that line wouldn't be true.
- **Masking.** `src/shared/redact.ts` handles token shapes, secret-named assignments, auth headers, URL passwords, long random strings (git hashes kept), and exact values from `.env` files (used from M4). All task output shown in the UI goes through it.
- **Quit** kills any install or sign-in process Revive started.
- **node-pty** is added now (needed for sign-in). `postinstall` runs `electron-rebuild -f -w node-pty`.
- **Fixture.** `fixtures/sample-folder/` (static bakery site, Vite habit counter, a loose `notes.txt`). e2e tests copy it to a temp folder.
- **Found while checking screenshots.** `transition-transform` animated the RTL mirroring of the chevrons (a visible flip on language switch). Only rotation animates now, and a test bans transform transitions in the renderer.
- **Tests.** 46 unit and component tests. These include "the installer never runs before the user confirms" and "Node missing still lets you continue". The Electron smoke test covers: first run in Hebrew, the real prerequisite check on this machine, the language switch in the top bar keeping the step, folder pick, relaunch straight to My projects, and the recent folder listed.

**Carry into M3:** the scan must also **deny reading `.env*` files** (a permission deny rule), so key values never reach Claude. That's in addition to the write restriction to `.revive/`.

*Try it:* `REVIVE_USER_DATA=$(mktemp -d) npm run dev`. Pick a language, watch the check, try drag and drop with a folder (try your home folder to see the "too big" message), then relaunch without the env var to reach your real settings.

### M3: done (2026-09-26)
- **Scan flags, checked against the docs and a real run.** The docs changed two things in the plan:
  - `Write(path)` rules are **never consulted**; `Edit(path)` governs Write. Revive allows exactly `Edit(.revive/manifest.json)`, so Claude can write that one file and nothing else, not even the shadow repo.
  - Read deny rules apply to the **folder** Grep searches, not to each file, so a folder-wide Grep could surface `.env` lines. **Grep is left out.** Claude has Read, Glob, Write and Edit only, and still finds keys by reading source.
  - Also: `--restricted` (no Bash or code tools, the folder's own `.claude` settings ignored), `dontAsk` + `--permission-prompts none`, `--strict-mcp-config`, `--no-session-persistence`, `--model <setting>`, `--max-turns 200` (documented, just hidden from `--help`), `--max-budget-usd 3`, and a hard 10-minute timeout.
  - Deny list: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, SSH keys, `.npmrc`, `.pypirc`, `.netrc`, credential/service-account JSON, `.git/`, `.revive/git/`.
  - Probe run: reading `.env` → denied; writing outside `.revive/` → denied; writing inside → allowed; the planted secret never appeared in the output.
- **Scan pipeline** (`src/main/scanner/scan.ts`):
  1. Write `schema.json` (generated from zod), back up the manifest, **save a version**.
  2. Fingerprint the folder.
  3. Run Claude, streaming progress.
  4. Fingerprint again. If anything outside `.revive/` changed: put changed/deleted files back from the version, **move** new files to `.revive/quarantine/<time>/`, list anything that couldn't be put back (e.g. ignored files), set the manifest aside, and show the error.
  5. Validate. If invalid, keep the previous manifest and save the bad one as `manifest.rejected.json`.
  6. Merge.
- **Merge rules** (`mergeAfterScan`): `user_locked` fields keep the user's value. `status`/`verified_at` carry over only while the install and dev commands are unchanged, so a scan can never mark a project as working. `running` is never stored. `scanned_at` is the real time (Claude invented one in the real run). Every string is masked for secrets. Unknown fields (such as a key's value) are dropped by zod.
- **Versions core arrived early** (needed for "save a version before every scan"):
  - Shadow repo for folders without git.
  - `refs/revive/versions/<id>` + `refs/revive/latest` inside each user repo, built with a private `GIT_INDEX_FILE` + `commit-tree` + `update-ref`.
  - Nested repos get their own part.
  - `.revive/.gitignore` keeps Revive out of the user's `git status`.
  - Exclusions: `.env*`, `node_modules`, `build`, `dist`, `.venv`, `.revive`, files over 50 MB.
  - `restoreFiles` uses a throwaway index plus `checkout-index`, and never touches files outside the version.
  - `moveAside` handles quarantine and trash.
  - A test proves the user's HEAD, branches, index file (hashed), stash and `git status` are byte-for-byte unchanged.
  - simple-git runs with a minimal env and an explicit `allowEnvironment` list.
  - M5 adds the History screen, full restore, undo and emptying the trash.
- **Gallery.** 2 columns below 960 px, 3 from 960 px, 4 from 1280 px (window width). Each card shows a picture placeholder, name, description in the interface language, a status word + color, and one action (Open / Start / Check if it works; broken → Check if it works). Until M4 the action opens the project page.
- **Screen states.** Also: "not read yet" with a "Read my folder" button, a loose-files sentence, one Technical details box (folder path, loose files), "Read the folder again", and the last-read date in the locale's format.
- **Scan screen.** Full screen with the language switch, a "Reading only" badge, and the phase in plain words (saving a version → Claude is reading → checking nothing else changed). It shows files read and projects found (appearing as found), recent files in an LTR block, limits under Technical details, and a Stop button. It survives a language switch.
- **Errors.** One plain sentence and one action each: version failed, Claude missing / signed out (→ check my computer / sign in), changed outside (details in LTR blocks), unreadable result, limit, timeout, stopped, unknown (masked log). Cost is shown as "Claude reported this reading as about $0.05 of usage" (Claude's own `total_cost_usd`).
- **Project page (basic).** Name, status, picture placeholder, "What it is", "Keys and connections" by purpose (names only under Technical details), and Technical details with folder, stack, commands, port, key names and notes. M4 adds the live preview and Start/Stop.
- **Offline test agent.** `REVIVE_TEST_AGENT=<manifest>` swaps Claude for a fake in **unpackaged** builds only, so e2e runs offline at no cost.
- **Real run on the fixture** (Haiku): 45 s, $0.05. Nothing outside `.revive/` changed (hash-compared), the planted `.env` secret wasn't in the manifest, both projects and the loose file were found, and `VITE_WEATHER_KEY` was found from source.
- **Tests.** 83 unit and component tests, plus 2 Electron smoke tests (onboarding, then a full scan with the offline agent, including "nothing outside `.revive` changed" and a relaunch).

**Notes for you**
- **Hebrew descriptions from Haiku are understandable but stiff.** It wrote "חנות אופה" where a native speaker would write "מאפייה". Switching the scan model to Sonnet in Settings will likely read more natively; I haven't changed your scan prompt.
- **Progress shows "0 files read" for the first few seconds.** Claude reports each step when that step finishes, and its first step is usually a folder-wide listing.

*Try it:* `npm run dev` (with your folder chosen), then "Read my folder". This runs a real scan on your account with the model from Settings. For an offline dry run: `REVIVE_TEST_AGENT=$PWD/fixtures/sample-folder.manifest.json REVIVE_USER_DATA=$(mktemp -d) npm run dev` and pick a copy of `fixtures/sample-folder`.


### M4: done (2026-09-28)

**Follow-ups from M3**
- **Scan split.** Indexing still uses the model from Settings (Haiku by default). Then one short call to **Sonnet** writes only `description.en` and `description.he`:
  - `--tools ""`, so it has no tools at all. It sees only what indexing found (name, stack, the draft sentence, notes, key purposes), never the files.
  - `--json-schema` for a checked shape, and zod validates it again.
  - Revive writes the two fields itself. Locked descriptions are skipped, and an empty sentence never replaces an existing one.
  - If the call fails, the indexing sentences stay.
  - The scan shows the **total** cost. Technical details list each step with its model and cost.
  - Real run on the fixture: 52 s. Index $0.051 + descriptions $0.0075 = **$0.059**. The Hebrew now reads natively ("אתר אינטרנט למאפייה שכונתית…"). The planted `.env` secret didn't appear.
- **First moments of a scan.** Until the first file arrives, the counter says "Reading your folder…" with a moving bar instead of "0 files read".
- **Turn limit, proven.**
  - The check: three files, each naming the next with a random name, so reading ahead in parallel is impossible. The run uses `--max-turns 1`. An honest CLI stops after the first read with `error_max_turns`.
  - **Claude Code 2.1.283 passes:** only `start.txt` was read, `error_max_turns`, about $0.01.
  - `npm run test:live` runs the check against the installed CLI (kept out of `npm test`, since it spends money).
  - **At startup** Revive runs the same check once per Claude Code version and caches the verdict in userData. It's skipped while signed out.
  - If the limit isn't enforced (or the flag is unknown), a **full-screen block** says so, with "How to update" and "Check again". Every scan is refused with its own error, and main logs to stderr.
  - A scan whose check couldn't finish (offline) is refused rather than trusted.

**Architecture for a future remote client**
- **`main/services/`** holds the logic as plain TypeScript. No Electron imports in `runner/`, `sessions/session-hub.ts`, `runtime-bus.ts` or `workspace.ts`.
  - `ipc/register.ts` handlers are one line each: validate with zod, call a service.
  - `Workspace` owns "the current folder" and resolves project ids to folders (symlinks can't lead outside).
- **One event stream** (`shared/runtime.ts`): `process.started`, `process.output`, `port.detected`, `status.changed`, `process.exited`, plus `shot.captured` and `manifest.changed`.
  - Every event has a sequence number. `runtime:since {seq}` replays what a late client missed (last 2000 events).
  - IPC carries it on one channel, `runtime:event`, and the renderer subscribes once (`state/runtime.tsx`).
  - Scan events are unchanged.
- **Sessions** have a stable identity: `{projectId, agent: 'shell' | 'claude' | 'codex'}`.
  - They're created through `SessionBackend`. M4 ships `ptyBackend` (node-pty), which kills the whole process group.
  - `SessionHub` masks output a line at a time, so a secret split across chunks is still caught. It also masks the displayed command (see below), strips spinner frames from the log, and keeps the last 400 lines.
  - No pid ever reaches a client.
  - The runner's install and dev commands run in the project's `shell` session. Claude and Codex terminals get their own sessions later.
  - A second backend (`child-backend.ts`, plain child processes) runs the runner tests, because node-pty is built for Electron's ABI. It also shows the interface really is swappable. No tmux yet.
- **Renderer transport.** `src/renderer/transport/` is the only module that touches `window.revive`; everything else imports `transport`.
  - A new lint rule, `boundary/renderer-boundary`, fails on any Electron import in `renderer/`, and on `ipcRenderer` or `window.revive` outside the transport module.
  - `tests/renderer-boundary.test.ts` proves the rule fires and that the whole renderer is clean.
- **Pictures via protocol.** They're saved to `.revive/shots/<id>.png` and handed out as origin-relative paths (`/shots/<id>.png?v=<mtime>`).
  - The desktop transport resolves them to `revive://local/…`, served by `protocol.handle`. Only ids in the current manifest resolve, and only inside `.revive/shots/`.
  - The same request resolver (`resolveAssetRequest`) can back an HTTP route later.
  - CSP: `img-src 'self' data: revive:`.
- **The manifest always gets the facts.** After a successful start: `status: verified`, `verified_at`, `run.url`, `run.port`. After a failed one: `status: broken`. "Running" is still never stored.
  - These writes are serialized per folder.
  - Run facts are written even when those fields are in `user_locked`, since locks only bind scans.

**Runner**
- **Start:**
  1. Install if the parts are missing (`node_modules`, or `.venv`/`venv` for Python). A failure that points at missing parts forces an install next time.
  2. Run the dev command in the user's shell, with `BROWSER=none` and Electron/Revive env vars removed.
  3. **Plain HTML projects with no start command** are served by Revive's own tiny file server. It's a separate build entry, run as its own process by Electron in Node mode, on 127.0.0.1 only, and it never serves dotfiles (`.env`), parent folders or symlinks out.
- **Port:**
  - First from the output, colour codes stripped. Tested on real output from Vite, Next, CRA, Flask, http-server, Django, Express, Astro and Uvicorn. "Network" addresses on other machines are ignored.
  - After 12 s with no port printed, Revive looks for the manifest's port or a common dev port that wasn't open before the start.
- **Health check:** GET the page (localhost only) until the status is below 500. Starting has 90 s in total.
- **Statuses:** installing → starting → checking → running; stopping → stopped; broken. Also "stopped on its own" when a running server exits.
- **One-sentence causes** (rule-based `ErrorExplainer`): missing key (by its plain purpose, never its name), port busy, parts not downloaded, a tool not installed (npm, python…), install failed, no start command, didn't open in time, unknown.
- **Stops everything** before a scan, when the folder changes, and on quit. Quit waits up to 5 s for every process group, then leaves.

**Preview and pictures**
- **Preview:** a `WebContentsView` in its own session partition (sandboxed, no node, all permissions denied).
  - Navigation is limited to localhost. Other links open in the browser; the app itself can still load anything it needs.
  - The renderer reports the frame's on-screen box, clipped to the scrolling area. Main lays the view over it.
  - Computer or Phone (390 px, centered), Reload, Open in browser (localhost only).
  - It closes by itself when the project stops.
- **Pictures:** captured offscreen at 1280×800 after every successful start, whether or not the preview is open. Cards and the project page show them. I checked a real capture of the bakery page.

**UI**
- **Card:** the one button starts the project and opens its page ("Start" / "Check if it works"), or just opens it while it's running or busy. The status pill shows progress words: "Getting things ready", "Starting", "Checking that it opens" (Hebrew: מכינים את מה שצריך, מפעילים, בודקים שזה נפתח).
- **Project page:** Start/Stop, the progress sentence, the live preview, the one-sentence cause with "Check if it works", the description, keys. Technical details add the address and the masked log.
- **Found while checking:** screens kept the previous scroll position, so the project page opened with its preview half off-screen. Every screen now opens at the top.

**Tests.** 142 unit and component tests (was 83), plus 3 Electron smoke tests, plus the live turn-limit test.
- New unit tests: port detection on real outputs, the cause rules, the static server's path lock, picture path locking, hub masking across chunks, bus replay, serialized manifest writes, description merge and locks, the description call's flags and parsing, the probe's verdicts and the guard's cache.
- Runner tests use real processes: start → port → health → recorded → picture; install only when needed; `.env` values masked in output **and in the command line**; port busy; no start command; plain page; port found by probing; timeout; stopped on its own; stop all.
- New e2e test on the built app:
  - "Check if it works" on the plain-HTML project → running.
  - The native view shows `http://127.0.0.1:<port>/` with the page's title; Phone gives 390 px.
  - The manifest has `verified` with URL and port, and the picture file exists.
  - Stop removes the view and closes the port.
  - The card picture loads through `revive://`.
  - Start again, quit, and the port is closed.
  - Any renderer error fails the test.
- **Also checked by hand:** the Vite fixture with a real `npm install` (64 packages) and real Vite 7 output → running on 5199, shown in the preview, recorded in the manifest.

**Notes for you**
- **The Host PRD isn't on this machine** (searched `Documents`, `Downloads`, Spotlight). I built to the concrete requirements in your message. If the Host PRD names an event, field or session kind differently, those names live in `src/shared/runtime.ts` and `src/shared/assets.ts`.
- **A real finding in testing:** a command like `API_TOKEN=… npm run dev` would have shown the key in the status, the start event and the log's `$` line; only output was masked before. The command is now masked with the `.env` values too.
- **Startup check cost.** The first launch after each Claude Code update spends about $0.01 on the turn-limit check. Signed out, it spends nothing.
- **The preview is a native view,** so nothing in the page can draw over it. Today nothing needs to. If a later milestone adds a menu or dialog over the preview, the view has to be hidden while it's open.
- **Not verified live:** "Open in browser" (it would open your browser during tests; the URL check is unit-level), and how the preview looks while the page scrolls under it (the clipping math is simple, but I didn't watch it).

*Try it:* `npm run dev`, open a project, press Start / Check if it works. Offline dry run: `REVIVE_TEST_AGENT=$PWD/fixtures/sample-folder.manifest.json REVIVE_USER_DATA=$(mktemp -d) npm run dev` with a copy of `fixtures/sample-folder`; "Sunrise Bakery" starts with no network, "Habit counter" runs `npm install` first. Checks: `npm run typecheck && npm run lint && npm test && npm run test:e2e`, and `npm run test:live` (about $0.01).
