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
- [x] M1 · [ ] M2 · [ ] M3 · [ ] M4 · [ ] M5

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
