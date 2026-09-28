# Revive: Phase 1 build plan

Status: **approved 2026-09-25.** M1 done; see Progress at the bottom.

Sources: the build prompt (source of truth for scope),
`Revive PRD v2 The No Code Home for Everything You Build with AI.pdf` (there is no `docs/PRD.md`), and `docs/HOST_PRD.md` (Revive Host, from M5 on).

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

## 2. IPC contracts (superseded in M6 by `src/shared/contract.ts`; the table below is the original plan)

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
- [x] M1 · [x] M2 · [x] M3 · [x] M4 · [x] M5 · [x] M6 (Host build order: transport seam) · [x] M7 (Host mode, pairing, devices, action log)

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

### M5: done (2026-09-28)

**Host PRD.** It wasn't on disk, so I saved your pasted text as `docs/HOST_PRD.md`. The paste arrived as one line: I restored the headings, lists and tables; the wording is unchanged, and the two diagrams stay in the online PRD. What it changed in M5:
- Session identity is `{projectId, kind}`, which maps 1:1 to the future tmux name `revive-<project>-<kind>`.
- Version operations are generic service calls on a version id, so "changes from last night, keep or undo" can use them.
- Version events go on the one stream.
- Destructive actions need explicit confirmation.

**Changes from the M4 report**
1. **A fourth session kind, `run`.** `SESSION_KINDS = run | shell | claude | codex`. The field is now `kind` (it was `agent`). Install and dev commands run in `<projectId>:run`; `shell` is for interactive terminals only. `sessionId()` and `parseSessionId()` turn the identity into a string and back (`my-app:run`).
2. **Split event history.**
   - The replay buffer (`runtime:since {seq}`) keeps only numbered **state** events: `process.started`, `port.detected`, `status.changed`, `process.exited`, `shot.captured`, `manifest.changed`, `version.saved`, `version.restored`, `trash.emptied`. A compile-time check fails if a new state event isn't listed.
   - `process.output` is broadcast live without a number. It carries `offset` (bytes) and lives in a **per-session buffer** of the last 256 KB, with offsets that never go back, even across restarts.
   - It's fetched with `sessions:output {sessionId, fromOffset}` → `{data, fromOffset, nextOffset, truncated}`. Whole chunks are dropped from the front, so a character is never split.
   - The readable log under Technical details is derived from the same buffer (stored once).
   - **The test you asked for:** a real dev server writes 10,000 lines (about 700 KB). A client that connects afterwards gets every status change from the replay (`starting → … → running → stopping → stopped`) and no output events. From the session buffer it gets the last 256 KB, ending with the real "Local: http://…" line, with `truncated: true`. With M4's single 2,000-event history, those status changes would have been pushed out.
3. **Native preview vs overlays: one hook, `useOverlay(open)`.**
   - When the first overlay opens, main pictures the live view (`capturePage`), saves it as the project's latest picture (`shot.captured`), and hides the view. The overlay draws only after that, so it never flickers under the native view.
   - The preview's spot shows that picture meanwhile. When the last overlay closes, the view comes back at its current spot.
   - Main ignores `preview:show` while covered, and a hide while it's still picturing, so no ordering race can leave it visible or blank.
   - `Dialog` is the one modal and uses the hook.
   - `tests/overlay-preview.test.ts` fails if any renderer file with a dialog, menu, listbox, sheet, `aria-modal` or `popover` doesn't call `useOverlay`.

**M5**
- **`main/services/versions/VersionService`** (plain TypeScript; the IPC handlers pass input straight through):
  - Calls: `list`, `save`, `preview`, `restore`, `undo`, `trash`, `emptyTrash`.
  - **Input is checked with zod inside the service** (`VersionInput`, and `EmptyTrashInput = {confirm: true}` only), so any transport gets the same checks. Bad input rejects; it never throws synchronously.
  - One operation at a time. Refused with `busy` while a scan reads the folder, and a scan waits for any restore in progress.
- **Going back:**
  1. Compare "now" with the target and **stop the `run` session of every running project whose files will change**.
  2. **Save the folder as it is now** (kind `restore`, `restoredFrom` = the target). Going back to it is the undo.
  3. Diff the two Revive snapshots with `git diff-tree`, then write back changed or deleted files and **move files made since into `.revive/trash/`** (never deleted).
  4. Mark the touched projects `unknown` ("checked and working" no longer holds for that code).
  5. Emit `version.saved`, `manifest.changed` and `version.restored {how, versionId, undoVersionId, changedFiles, stoppedProjects}`.
  - Because both sides are Revive snapshots, `.env` files, dependencies, big files and ignored files can't appear in a restore: they're left exactly as they are.
  - Repositories that appeared after the target version are left alone.
  - Inside the user's own repo, HEAD, branch, index file (hashed) and `git status` are unchanged (tested).
- **Undo** = going back to the version saved just before (kind `undo`). Undoing an undo works the same way.
- **"Start it again"**: the result comes from the stream, so a restore made later from the phone shows the same way. It names what was stopped, with a Start button each.
- **History screen:**
  - Saved versions newest first, each with a plain title and time ("Before reading the folder", "Before going back to the version from Sep 27, 2026, 9:00", "Saved by you", "Before undoing a go back").
  - "Go back to this version" on each, and "Save a version now".
  - The go-back confirmation first shows what would change ("1 file will go back the way it was. 1 file made since then will move to Revive's trash. First, Revive will stop: Sunrise Bakery."), with paths under Technical details.
  - After a go back: Undo, and "Sunrise Bakery was running before. Start it again?".
  - **Revive's trash**: items and size, "Empty the trash" behind a confirmation ("2 files will be deleted for good. This can't be undone." Keep them / Empty the trash).
  - "Keys are never included in saved versions."
- **Project page:** "Go back to an earlier version" opens the saved-versions list over the live preview, which is where the overlay hook matters. The post-restore notice shows here too.
- **Found while checking:**
  - **The Hebrew trash line** used a plural verb with "one file" (קובץ אחד הועברו); the verb now sits inside each plural branch.
  - **Two test races:** a component test clicked a card before the live run list arrived. The runner tests' waits allowed 15 s, but Vitest's default per-test limit was 5 s; that file now allows 20 s.

**Tests.** 158 unit and component tests (was 142), plus 4 Electron smoke tests. The full suite ran clean 13 times in a row after the fixes.
- **Versions** (real git, temp folders): go back puts files back, moves new ones to the trash, leaves `.env` and `node_modules` alone, stops only the affected running project, marks it `unknown`, and puts the undo point and the restore on the stream. Undo brings everything back. Also: the user-repo invariants; bad input rejected; `busy` during a scan; `not_found`; the trash emptied only with `{confirm: true}`.
- **Sessions:** output buffer (byte cap, offsets, Hebrew text not split), replay excludes output, session ids, the 10,000-line late client.
- **Renderer:** History titles, go back only after the preview, Undo, "start it again", the busy sentence, trash confirmation. The overlay test proves the dialog doesn't draw until main confirms the preview is hidden, the picture stands in, no `preview:show` happens while covered, and the preview comes back on close.
- **e2e (built app):** read the folder → start the bakery → change a file and add one (as an agent would) → open the versions list over the live preview (the native view is hidden and the picture stands in, then restored) → go back → the file is back, the new one is in the trash, the bakery was stopped → "Start" brings it back → History titles → Undo brings the change back → empty the trash → gone. No renderer errors.

**Notes for you**
- **Versions are the whole folder,** every project in it (as planned: one shadow repo plus the nested user repos). Going back from a project page therefore also changes other projects' files if they changed since. The confirmation lists the count, the paths and anything that will stop.
- **The first picture a dialog shows can be seconds old:** the latest picture updates only when the capture finishes, and the dialog waits for that (at most 400 ms).
- **For the Host PRD's action log:** version and runner calls don't carry "who did this" yet. M7 can add a device or actor field to the service inputs without changing their shape otherwise.
- `npm run test:live` wasn't rerun: nothing in the scan or turn-limit path changed in M5.

*Try it:* `REVIVE_TEST_AGENT=$PWD/fixtures/sample-folder.manifest.json REVIVE_USER_DATA=$(mktemp -d) npm run dev` with a copy of `fixtures/sample-folder`. Read the folder, start Sunrise Bakery, edit `bakery-site/index.html` in an editor, then "Go back to an earlier version" on its page; try Undo and the trash in History. Checks: `npm run typecheck && npm run lint && npm test && npm run test:e2e`.

### M6: done (2026-09-28), the transport seam

No visible change to the desktop app: the same screens and flows, and all e2e tests pass unchanged. Built to `docs/HOST_PRD.md`, "Technical architecture" and "Building on the existing Revive codebase": one Transport contract with an IPC and a WebSocket implementation, the same contract tests against both, localhost only.

**First, the fix from the M5 report: going back from a project page is for that project only** (commit `99ab96a`).
- `versions:preview` and `versions:restore` take an optional `projectId`. A file belongs to the deepest project whose folder holds it, so a nested project keeps its own files.
- Only that project is stopped if it's running; other running projects are left alone.
- The undo point records the scope (`scope` on the version), so Undo keeps it, including from History.
- The dialog says which scope applies: "Only Sunrise Bakery goes back. The other projects in the folder stay exactly as they are." or "The whole folder goes back, with every project in it." History still restores the whole folder.
- Tests:
  - Two projects change; a project-scoped go back reverts one and leaves the other **byte for byte identical**, and it isn't stopped.
  - Undo keeps the scope.
  - A nested project's files stay out of its parent's go back.
  - An unknown project is refused.

**1. One contract registry: `src/shared/contract.ts`**
- **Methods:** every method (37) with a **zod input and output schema** and `remote: true/false`.
- **Server streams:** `settings:changed`, `prereq:task`, `scan:progress`, `scan:done`, `guard:changed`, `runtime:event` (state events, numbered) and `session:output` (`{sessionId, offset, data, truncated?}`).
- **Client streams:** `session:input` and `session:resize`.
- **Type safety:** each schema is checked at compile time against the TypeScript type it describes (a drifting field fails the typecheck; I tried it). `contract-names.ts` holds the same names without zod for the sandboxed preload, and a compile-time check keeps the two lists identical.
- **Generated IPC:** `main/contract/ipc.ts` registers one `ipcMain.handle` per registry method and one `ipcMain.on` per client stream, and forwards every server stream to the window.
  - Every call goes through `dispatch()`: the method must be in the registry and allowed on this transport, and the input must match its schema. Outside packaged builds, outputs are checked too.
  - `main/contract/handlers.ts` is a mapped type over the registry, so a missing or extra handler is a compile error; each handler is one service call. `main/app/core.ts` builds the core without Electron, and native-only pieces sit behind a `Platform` interface.
- **`tests/contract-registry.test.ts`:**
  - IPC registers exactly the registry (no more, no fewer).
  - A source scan **fails if any `ipcMain.handle/on/once` or `webContents.send` exists outside `contract/ipc.ts`**.
  - Unknown methods, bad input, local-only methods over the network, and outputs outside the contract are all refused.
- **Same error codes on both transports.** Over IPC, Electron keeps only an error's message, so results travel in an `{ok, v | e:{code, message}}` envelope, and both transports throw the same `RemoteError` with the same codes (`bad_input`, `not_available`, `unknown_method`, `failed`).

**2. `Transport` interface (`src/shared/transport.ts`)**
- The API: `invoke(method, input)`, `subscribe(stream, handler)`, `subscribe('session:output', handler, {sessionId, fromOffset})`, `writeSession`, `resizeSession`, `assetUrl(path)`, `capabilities()`, `onConnection()`, plus `pathForFile` (desktop only).
- **`BaseTransport` holds the resume logic once, for both transports:**
  - State events are applied once and in order, by sequence number.
  - Live events that arrive while catching up are held, so none is lost or reordered.
  - Session output is applied once, with no gaps, by byte offset. Any gap is marked `truncated`.
- **`capabilities()`** comes from the registry: a capability is on only if its transport may call all the methods it needs. `nativePreview`, `folderPicker`, `dropFolder`, `openInBrowser`, `installTools`, `openHelp`.
- **The renderer hides what a client can't do** instead of checking for Electron:
  - the live preview (shows the latest picture and "It's running on the computer that runs Revive"), Reload and Open in browser;
  - the folder dialog and drop zone (recent folders stay);
  - install, sign in and help buttons ("Do this on the computer that runs Revive.");
  - the overlay hook doesn't call `preview:cover` at all.
  - Tested by rendering the whole app with a remote client's capabilities (`remote-ui.test.tsx`).

**3. `IpcTransport`**
- The preload is now a generic bridge that accepts only registry names. `IpcTransport` (`renderer/transport/ipc-transport.ts`) extends `BaseTransport`.
- Screens import only `transport` (typed as `Transport`) from `@/transport`. The boundary lint rule now also fails if a screen imports a transport implementation. The old `shared/ipc.ts` and `main/ipc/register.ts` are gone.
- `installTransport()` lets a non-desktop client plug in another implementation later (M9).

**4. `WsTransport` and the dev WebSocket server (`REVIVE_DEV_WS=1`, off by default, no UI)**
- **Access:**
  - Binds **127.0.0.1** only (tested: not reachable on the LAN address). Port random, or `REVIVE_DEV_WS_PORT`.
  - **A random token per start** (32 bytes, base64url), printed **once** to stderr: `[revive] dev WebSocket: ws://127.0.0.1:<port>/ws token=…`. It travels as a second WebSocket subprotocol, since browsers can't set headers; timing-safe compare.
  - **Origin:** requests without an Origin header (programs that aren't browsers) are allowed, and still need the token. Otherwise only the server's own origin (`http://127.0.0.1:<port>` / `http://localhost:<port>`, where a future web client will be served) is allowed. `https://evil.example`, `null` (file pages) and even `http://localhost:5173` are refused with 403.
  - **The Host header** must be 127.0.0.1 or localhost at the right port, which blocks DNS rebinding.
- **Session output as binary frames with backpressure:**
  - A frame is `[u32 header length][header {session, offset, truncated?}][UTF-8]`. Each client asks per session with its offset (`watch`); the server sends what's buffered first, then live.
  - When a client's unsent data passes 512 KB, the server simply stops sending it output; it never waits. The pty and other clients carry on. Every 50 ms the server checks, and once there's room it catches the client up from the session buffer, marking a gap if the buffer no longer had it.
  - A client more than 16 MB behind on state events is disconnected and resumes on its own.
- **Pictures over HTTP** on the same server: `/shots/<id>.png`, with the token as a query parameter (for `<img>`) or a Bearer header, the same Host and Origin checks, and only from `.revive/shots`. `WsTransport.assetUrl()` builds that URL.
- **`WsTransport`** (Node 22+ or a browser):
  - Reconnects with backoff (250 ms to 5 s).
  - Resumes with `runtime:since` from its last sequence number, and re-watches each session from its byte offset.
  - Calls that were sent before a drop fail with `disconnected` (they may or may not have run); calls still waiting to be sent go out after reconnecting instead of failing.

**5. Parity tests (`main/contract/parity.test.ts`):** the same suite on both transports, against the real core (real runner and sessions, versions, and the scan pipeline with the offline agent). IPC runs through the generated registration with Electron's `ipcMain` stood in and `structuredClone` on every message; WebSocket runs against a real server in process. 7 tests × 2 transports:
- choose a folder and read it (progress, the saved version on the stream, the manifest);
- start and stop a run session (every status, `process.exited`, output on the session stream, the log);
- keystrokes into a session (`writeSession`, `resizeSession`);
- a project-scoped version restore (file back, `version.restored` with `projectId`, the scoped undo point);
- input checks with the same error codes;
- a service error (unknown project) comes back as `failed` on both;
- **reconnect in the middle of a noisy dev server** (20,000 lines, about 1.2 MB): the connection drops repeatedly (WS) or events are lost (IPC) while the server keeps printing and reaches "running". The client still ends with **every status change, in order, exactly as the server made them**. Its output has no repeats and marks any gap, ends at exactly the server's buffer end, and contains the real tail.
- Plus `ws-server.test.ts`:
  - localhost only; token required; wrong origin and rebinding refused; pictures only with the token;
  - local-only methods refused;
  - **backpressure:** a client that stops reading its socket while a dev server prints about 4 MB doesn't slow the dev server or the other client (which gets every status and the full tail). When it reads again it catches up, with the dropped part marked.
- Plus e2e on the built app: without the flag nothing is printed; with it the token is printed exactly once, a WebSocket client in the test reads the same settings the window changed, `folder:pick` is refused remotely, and a wrong token can't connect.

**Unsupported for a WebSocket client, and why**
| Feature | Methods | Why |
|---|---|---|
| Live preview (and Reload) | `preview:show/hide/cover/uncover/reload` | It's a native view inside the desktop window. A remote client can't see it, and the dev server listens on the host's localhost. Remote preview needs the URL exposed with `tailscale serve` (M7+). Remote clients see the latest picture instead. |
| Open in browser | `preview:openInBrowser` | It would open a browser on the host computer, not on the client. |
| Folder dialog | `folder:pick` | It's the host's native dialog. Remote clients can pick from recent folders; `folder:choose` with a path works but has no UI. |
| Drop a folder | (bridge only) | Needs a real file path from the desktop drag and drop. |
| Install Claude Code, sign in | `prereq:installClaude`, `prereq:signIn` | They run the installer and open the sign-in page on the host; the user has to confirm and act there. The check itself (`prereq:check`) works remotely. |
| Help pages | `shell:openHelp` | Opens a browser on the host. |

Everything else is available remotely, including reading the folder, start/stop, logs, session input, versions and the trash (still behind `{confirm: true}`).

**Notes for you**
- **Only the runtime stream and session output resume after a reconnect.** `scan:progress/done`, `settings:changed`, `guard:changed` and `prereq:task` are live only. A client should refresh on `onConnection('open')`; the desktop renderer never disconnects, so nothing changes today. M9's web client will need it.
- **Pictures over the dev server use a token in the URL** (needed for `<img>`). That's fine for localhost development; M7's per-device tokens should use a cookie or short-lived signed URLs instead.
- **The app's own renderer can't use the dev WebSocket:** its origin (`file://`, or the Vite dev server) is refused, as asked ("not the app's own" means the server's own origin). The desktop renderer uses IPC, so that's by design.
- **Output checking** runs in tests and unpackaged builds only. In the packaged app, inputs are still validated.
- **New dependency:** `ws` 8.22 (the server; Node's built-in WebSocket is the client).

*Try it:* `REVIVE_DEV_WS=1 npm run dev`, then copy the URL and token it prints and, from another terminal (Node's built-in WebSocket, raw wire format):
`node -e "const [u,t]=process.argv.slice(1); const ws=new WebSocket(u,['revive.v1','revive.token.'+t]); ws.onopen=()=>ws.send(JSON.stringify({t:'call',id:1,m:'runner:list'})); ws.onmessage=(e)=>{console.log(e.data); ws.close()}" <url> <token>`
(checked against the built app). Checks: `npm run typecheck && npm run lint && npm test && npm run test:e2e`.

### M7: done (2026-09-28): Host mode, pairing, device tokens, action log

Built to `docs/HOST_PRD.md` H1, H7, H8 and "Security and privacy". The remote client is Revive itself on another computer. The dev flag and its startup token from M6 are gone.

**Architecture choice: the client's `WsTransport` runs in the client's main process, not in its page.**
- The device token never enters the renderer. Only main can use safeStorage anyway, and the page's CSP and network lockdown stay exactly as they were.
- The page keeps talking IPC to its own main, which forwards core calls to the Host (`app/router.ts`).
- Methods now carry two flags:
  - **`app`**: sharing, pairing, devices and the client connection. These are always answered by this computer, never forwarded and never callable remotely; a test checks that none is remote.
  - **`mutates`**: written to the action log.
- In client mode the window gets a remote client's capabilities from `client:status`, so the unsupported features hide themselves.
- The language and detail level stay this computer's own; every other setting is the Host's.
- Pictures (`revive://local/shots/…`) are fetched from the Host by main, with the token.
- Switching between local and client mode reloads the window, so nothing from one side lingers on the other.

**1. Host mode**
- **Settings → Share this computer** (a switch).
  - When on, the Host server starts on **127.0.0.1 only**, on the same port as last time, so `tailscale serve` and paired devices keep working after a restart. If that port is taken, it picks another.
  - Sharing comes back on by itself at the next start (`host.json`).
- **The window can close while sharing:** Revive stays in the **menu bar** (Open Revive, Pause sharing, Quit Revive).
- **"Start Revive when you log in"** uses `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`. Started with `--hidden` while sharing, it shows no window, only the menu bar icon.
- **`powerSaveBlocker('prevent-app-suspension')`** is held while sharing. If `pmset` says the Mac sleeps after N minutes, a plain warning explains that closing the lid still sleeps it. On this Mac: `sleep 1`.
- **Tailscale:**
  - Detected via `tailscale status --json`, or the app's bundled CLI.
  - If present: "Make it reachable", then a confirmation showing the exact `tailscale serve --bg <port>`, then only that command runs, then the https address (`https://<machine>.<tailnet>.ts.net`) is shown.
  - If absent: "To reach this Mac from your other computers, install Tailscale, a free private network." plus a link.
  - The tailnet name becomes an allowed Host header and Origin for the server. Never 0.0.0.0.

**2. Pairing** (`services/host/pairing.ts`, `devices.ts`)
- **Pair a device** shows a **six-digit code** and a **QR code of the pairing link** (`<address>/pair?code=…`), with a countdown.
- **Codes:** single use, and they expire after **5 minutes**. **5 wrong tries lock pairing for 10 minutes.** Guesses count even when no code is showing, and the lock also throws the current code away.
- **The client** POSTs the code and its name to `/pair`, then polls `/pair/<id>`.
- **Approval:** the Host shows **"Allow <device name> to connect?"** over any screen. **Nothing is created until Allow:** before that, not even `devices.json` exists (checked in e2e). Unanswered requests expire after 5 minutes.
- **Tokens:** on Allow, the Host issues a 32-byte token, handed to the device **once**, on its next poll. **The Host stores only its sha256 hash**, compared in constant time. The client stores it **only with safeStorage**; without a keychain it refuses to pair rather than store it in plain text.
- **Found and fixed:** the pairing dialog stayed open with a used-up code after a device paired, hiding the "Allow?" question in the two-computer test. It now closes as soon as its code is used, and each "Pair a device" starts a fresh dialog.

**3. Client mode**
- **Where to connect:** at first launch, "Connect to another computer instead" (under the computer check); later, in **Settings → Connect to another computer**. You enter the address (e.g. `studio-mac.tailnet.ts.net`, or `http://127.0.0.1:port`), the code, and this computer's name.
- **Waiting:** "Waiting for <Host> to allow this computer…". Every failure gets one plain sentence: wrong code, locked, expired, not allowed, unreachable, no keychain.
- **Sidebar pill:** the Host's name, "Connected" or "Reconnecting…".
- **When the Host can't be reached** at startup: "Connecting to <Host>…", with "Work on this computer".
- **After a revoke:** "<Host> no longer allows this computer", also with a way back.
- **Reconnecting:** by itself, with backoff (up to 5 s):
  - A **heartbeat** (10 s from the client, and a 15 s ping from the server) catches connections that look open after sleep or a network change.
  - **`powerMonitor` resume and unlock** reconnect immediately.
  - After a reconnect, the page resumes through its own IPC transport: `runtime:since` from its last sequence number, and `sessions:output` from each session's offset.
- **Revoked while away:** a refused reconnect asks `/whoami`. On 401 it stops for good (state `rejected`) instead of retrying forever. Calls on a revoked connection now **fail at once** instead of waiting forever; this was found by the revoke test.
- **The preview** shows **"Preview runs on <Host>. Its address there:"** with the dev server address as text. Pictures come through the Host.

**4. Devices and the action log**
- **Settings → Devices:** name, "Connected now" or "Last seen …", and **Remove** (after a confirmation).
- **Revoke** marks the device revoked and closes its live connections at once, with close code 4401 and a hard stop 200 ms later. Its token is refused from then on, at connect, over HTTP, and on `/whoami`.
- **The action log:** every `mutates` method, from any device or this window (`local`), is appended as one JSON line to `userData/action-log.jsonl` with `{at, deviceId, deviceName, method, summary}`. The file is only ever appended to, with mode 600.
  - **Summaries keep only a short list of plain fields** (projectId, versionId, sessionId, kind, path, address, deviceName, confirm/on/allow…). Strings are masked and cut to 120 characters. Everything else is listed **by name only** (e.g. `settings:set` → `fields: scanModel`), so file contents, terminal input, pairing codes and secret values can't be written.
  - Calls forwarded to a Host are logged there, under the device that sent them, not on the client.
- **Settings → Activity** shows the latest 20 entries in plain words ("Travel laptop · started · bakery-site").
- **New for this:** `sessions:open` / `sessions:close` / `sessions:list`. An interactive terminal (a login shell, `claude` or `codex`) in a project's folder, one per project and kind, that any number of devices can watch and type into. **There's no terminal screen yet** (xterm.js is M8); these are contract methods, so "opened a terminal" is a real, logged action.

**5. Tests.** 211 unit and component tests (was 186), plus 6 Electron e2e tests.
- **Pairing** (fake clock): codes expire after 5 minutes, work once, 5 wrong tries lock for 10 minutes even for the right code, guesses count with no code shown, nothing is issued before approval, the token is handed out once and only its hash is stored, denied or unanswered requests never become devices, revoked tokens stop working.
- **Host server:** 127.0.0.1 only (not reachable on the LAN address); a device token is required; **the Origin check still rejects browser pages** (evil origins, `null`, the Vite dev server), including for `/pair`; DNS rebinding is refused; the tailnet name and its https origin are accepted; pictures need a token; Host controls are refused remotely.
- **A revoked device is disconnected in under a second** (measured), and its token is refused everywhere after.
- **Two clients on the same session** both see the output, and input typed on either reaches it.
- **Host restart:** the real `ClientService` pairs (the Host allows it), the server stops, a new one starts on the same port with the same devices, and a new `ClientService` with the same userData reconnects **without pairing**, gets Host events, and comes back by itself after a drop.
- **The log** records the device for a restore, a run start and a terminal open. With a secret planted in `.env`, typed into the terminal, and set as a setting value, **the log file never contains it**.
- **HostService** (stand-in platform and stand-in `tailscale` CLI): sharing on 127.0.0.1, keeping awake, persisted and restored on the same port, **exactly `tailscale serve --bg <port>`** and the resulting https address, "missing" with nothing run, pairing needs sharing.
- **Renderer:** the switch, the sleep warning, the address, the pairing dialog (code and QR, closes once used, fresh on the next open), the tailscale confirmation showing the exact command, "Allow?" from any screen, devices with confirm-before-remove, activity by device; the client's connect form, waiting and error sentences, the pill (connected / reconnecting), "Preview runs on …", no Host controls in client mode, the connecting and rejected screens.

**How client mode was tested across two machines: simulated on one Mac.** I have one machine, so the e2e test "Host and client" runs **two separate instances of the built app**, each with its own userData (its own settings, devices, client file and log), on the same Mac. The client connects to the Host's real server at `http://127.0.0.1:<port>`, as a second computer would through `tailscale serve`. Everything goes through the real UI:
1. the Host reads the folder and turns on sharing; a browser-origin pairing attempt is refused;
2. the code is read off the Host's screen and typed into the client's first-launch "Connect to another computer";
3. "Allow?" appears on the Host (no device file before it) and is clicked;
4. the client shows the Host's two projects and the pill; the token is stored encrypted on the client and never appears on the Host;
5. starting a project from the client runs it on the Host, with "Preview runs on <Host>", the address, and the Host's picture;
6. the Host's activity shows "Travel laptop · started · bakery-site";
7. the Host app quits and relaunches: the client goes to "Reconnecting…" and back to "Connected" by itself, on the same port;
8. Remove on the Host: the client shows "no longer allows this computer" within 3 s, and "Work on this computer" takes it back to local mode.
- **What this doesn't cover:**
  - **Real Tailscale HTTPS between two computers.** Tailscale is installed and signed in here, but I didn't run `tailscale serve`, because it changes your tailnet's configuration. The command is tested against a stand-in CLI. It's worth one real run, on your word.
  - **Both instances share this Mac's keychain entry** ("Electron Safe Storage"). On two Macs each has its own.
  - **Real sleep and wake, a Wi-Fi change, and the menu bar icon, clicked by hand.** The heartbeat, `powerMonitor` and tray code aren't exercised by a test.
  - **Start at login.** The test doesn't toggle it, because that would change this Mac's real login items; it's covered through a stand-in.

**Notes for you**
- **Terminal input isn't logged keystroke by keystroke.** Opening and closing a terminal are logged (with device, project and kind); what's typed isn't. A command log would mean recording terminal input, which can contain secrets. I'd rather decide that together.
- **The menu bar icon file** is loaded from `resources/`. There's no packaging setup yet (no electron-builder), so whoever adds packaging needs to include `resources/trayTemplate*.png`.
- **Pairing codes are rate limited globally, not per device**, because everything arrives through `tailscale serve` from 127.0.0.1. A flood of wrong guesses locks pairing for everyone for 10 minutes, which is the safe way round.
- **New dependency:** `qrcode` (QR as SVG, made in main and shown as an image).

*Try it on two Macs:* on the Host, Settings → Share this computer → Make it reachable (confirm the `tailscale serve` command) → Pair a device. On the other Mac, first launch → "Connect to another computer instead" (or Settings), with the https address and the code; then Allow on the Host. On one Mac: `REVIVE_USER_DATA=$(mktemp -d) npm run dev` twice, and connect the second to `http://127.0.0.1:<port>` (the port is under Technical details in the sharing section). Checks: `npm run typecheck && npm run lint && npm test && npm run test:e2e`.
