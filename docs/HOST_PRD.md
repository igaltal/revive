# Revive Host: Product Requirements

Igal Tal Merom · Sep 27, 2026

> Saved from the text pasted into the M5 request. Line breaks, headings and tables were restored from a flattened paste; the wording is unchanged. The two diagrams live in the online PRD.

## Overview

Revive Host turns one always-on computer at home (a Mac mini to start) into a control room for every project built with AI agents, reachable from any computer and any phone. It is not a separate app: it is a mode of Revive in which the app serves other devices.

**The problem.** People who build with Claude Code and Codex pile up dozens of folders, and agent sessions live in a terminal on one machine. Close the machine and the session dies. From a phone there is no way to see what an agent is doing or approve its next step. Existing home server dashboards (Homepage, Homarr) show services, not projects and agents.

**The idea.** One home screen, beautiful enough that people leave it open: a live scene in the background, a clock, a single command bar for every agent, a card per project with live status, and the server's vitals. Behind it: a persistent terminal for every folder, with the AI of your choice, that keeps working when every device is closed.

**Why it wins.** Not a homelab dashboard and not another IDE. A control room for agents working on your behalf, that looks and feels like a consumer product. First design: [Revive Host, server screen](https://claude.ai/artifact/CW8sc6uqzw1G2joY7veEy4).

## Goals and success metrics

The goal: an agent session never dies because a computer closed, and every approval an agent is waiting on reaches you within seconds, on any device.

| Goal | Metric | Target |
| --- | --- | --- |
| Persistent sessions | Sessions that survive a client disconnect | 100% |
| Fast response to agents | Median time from approval request to answer | Under 3 minutes |
| Simple setup | Time from install on the Host to home screen on the phone | Under 10 minutes |
| Reliability | Host availability per month | 99.5% or higher |
| A screen people keep open | Users who keep the home screen open through a workday | 50% of active users |
| Revenue | Paying Revive users upgraded to Anywhere | 15% |

**Out of scope for v1.** Our own cloud relay; a Host on Windows or Linux; managing media and smart home services (Jellyfin, Home Assistant); several people sharing one Host; reselling model access. Users bring their own Claude or Codex subscription.

## Audience and scenarios

The primary user is an independent builder who works with agents every day, runs several projects at once, and has (or will buy) a computer that stays on. Revive's wider audience, creators who don't write code, comes later, once remote access needs no networking knowledge at all.

| User | What they have | What they want |
| --- | --- | --- |
| Independent builder | A Mac mini or an old MacBook, a Claude subscription | Agents that work overnight, control from the phone |
| Developer at a small company | A work computer and a home computer | Pick up a session from home exactly where it stopped |
| Non-technical creator (later) | One MacBook | A beautiful, simple screen with no server concepts |

**Key scenarios**

1. **Approve on the go.** Codex asks to run a database change. Tal gets a phone notification, sees what will change, and taps approve. The agent carries on.
2. **Continue from any computer.** A Claude session on trail-map starts on the MacBook in the morning. In the evening, from another computer, one tap on the card opens the same terminal at the same point.
3. **One command.** In the command bar: "open camp-site with Codex and run the tests". Revive opens the right session in the right folder.
4. **The morning after.** A night shift worked on revive. The home screen shows "3 changes from last night", and one tap opens a review with keep or undo for each change.
5. **A screen that stays open.** On a second monitor or a tablet, the home screen runs all day. When idle it becomes a screensaver, and when an agent needs you it wakes up.

## Screen experience

The screen is the product: it has to look rare from the first second and stay useful when someone looks at it all day.

**Home screen (desktop).** Top to bottom: a large clock and date, connection and security status, one command bar with an agent picker (Claude Code, Codex, local model), a row of cards with a colorful icon and live status for each project, and a bottom row with server vitals, agents and services, and uptime. The whole interface sits on frosted glass over a scene.

**Scenes.** The background is drawn in code, not loaded from a photo, so it stays sharp at any resolution and weighs very little.

- v1 scenes: dusk, night, dawn, day.
- They switch automatically with sunrise and sunset at the user's location, or stay locked on one.
- Subtle motion: water shimmer, twinkling stars, drifting clouds. Off when the system asks for reduced motion.
- Optional weather: rain or fog when it is actually happening outside.
- Personal background: the user uploads their own photo, and the interface adds blur and dimming automatically so text stays readable.
- Later: paid scene packs (seasons, cities, illustrated styles).

**Screensavers.** After a period of inactivity (default 5 minutes) the screen switches to screensaver mode:

| Mode | What you see | Best for |
| --- | --- | --- |
| Scene and clock | The scene full screen with a large clock | Second monitor, tablet on the desk |
| Agent activity | The scene, with a live line at the bottom showing what each agent is doing | A workday with agents in the background |
| Photos | Photos the user picked, changing slowly | Tablet in the living room |
| Dark | Nearly black, dimmed clock | Night, OLED screens |

When an agent is waiting for an answer, the screensaver wakes gently: a glow in the status color and one line saying who is waiting. On OLED screens the content shifts a few pixels every few minutes to prevent burn in.

**Phone.** Same scene, reversed priorities: the first thing is what is waiting for you, with a large approve button. Then active projects, server vitals and a bottom tab bar. Installed as a PWA with notifications.

**Accessibility and legibility.** The glass has a minimum opacity that guarantees 4.5:1 contrast over any scene. Full Hebrew and English, right to left and left to right, with direction isolation for English names inside Hebrew text.

## Requirements

P0 is what must work for Tal to use this every day. P1 makes it a product people can buy. P2 is planned now and built later.

**P0: core**

- **H1. Host mode.** The same Revive app, with a "share this computer" switch. The Host runs as a background service that restarts on its own after a reboot.
- **H2. Persistent sessions.** Every agent terminal runs inside a tmux session with a stable name (project and agent). A client disconnect never stops the agent, and reconnecting returns to the same point with full history.
- **H3. A terminal per folder.** From any project card: open a terminal with Claude Code, Codex, a local model or a plain shell, in that project's folder.
- **H4. Home screen.** Everything in the screen experience section, with live data from the Host.
- **H5. Approval queue.** When an agent stops and waits for approval, it shows first on the home screen and the phone, with a preview of what will change and approve or reject buttons.
- **H6. Server vitals.** CPU, memory, disk, temperature, uptime, Tailscale and Ollama status.
- **H7. Browser client.** The same UI runs in a browser, installs as a PWA on the phone, and connects to the Host over the private network.
- **H8. Device pairing.** A new device connects by scanning a QR code on the Host and gets its own token. A device list with one tap revoke.

**P1: a product to sell**

- **H9. Scenes and screensavers.** Four scenes, time based switching, four screensaver modes, personal background.
- **H10. Smart command bar.** A free text request ("open trail-map and run it") becomes an action: which project, which agent, which command. A local model does the routing when it can, to save tokens.
- **H11. Notifications.** Web Push to the phone for a waiting approval, a stuck or failed session, and a Host that went down.
- **H12. Onboarding.** A wizard that checks Claude Code and Codex are installed and signed in, that the computer won't sleep, and that remote access works.
- **H13. Health and backup.** A health check per service, a nightly backup of the projects folder and Revive settings, and an alert when a backup fails.

**P2: next**

- **H14. Paid scenes** and screensaver packs.
- **H15. More than one Host.** Several computers (a Mac mini at home, a work machine) on the same screen.
- **H16. Remote access without Tailscale.** Pairing that hides the network entirely, or our own relay.
- **H17. Host on Linux.**

## Technical architecture

Every device talks to one Host, and agent sessions live inside tmux on the Mac mini. The client is only a window: you can close it without stopping anything.

*[Diagram: Architecture: three kinds of clients, one Host, see the online PRD]*

The session manager is the heart of it: it launches every agent inside tmux in the project's folder, so a client disconnect never touches the agent.

| Component | Choice | Why |
| --- | --- | --- |
| Transport | One transport interface: IPC in local mode, WebSocket in Host mode | The same UI code in both modes, no rewrite |
| Sessions | node-pty attached to tmux, one stable name per project and agent | The agent keeps going when the client closes, and any device can reattach |
| Live updates | One event stream per device (status, vitals, approvals) | No polling, and the screen reacts instantly |
| Vitals | The systeminformation library on the Host | Works on macOS and Linux |
| Notifications | Web Push with a service worker | Works in an installed PWA, iPhone included |
| Always on | Revive as a login item, starting hidden in Host mode | Comes back on its own after a reboot or power cut |
| Exposure | Host listens on localhost only, exposed through tailscale serve | Real HTTPS, no open ports on the router |
| Local models | Ollama: qwen3 for command routing and summaries, bge-m3 for search | Saves tokens on background work |

## Building on the existing Revive codebase

Host is built inside the current Revive repo, not as a new project. The existing rule that the renderer never touches the filesystem or spawns processes, and goes through typed IPC for everything, is what makes this cheap: the seam already exists, it just needs a second transport.

| Area | Today in Revive | Change for Host |
| --- | --- | --- |
| `shared/` IPC contracts | Typed IPC between renderer and main | Become one `Transport` contract with two implementations: `IpcTransport` (today) and `WsTransport` (Host). Same contract tests run against both |
| `main/` services | Process runner, scanner, versions, manifest store behind `ipcMain` handlers | Handlers call a service layer; a WebSocket server in the same main process calls the same services. No duplicated logic |
| Host process | Electron app with a window | Host mode = the same Electron app starting hidden at login, with the WebSocket server on. Keeps `safeStorage`, simple-git and node-pty working as they are |
| Runner and terminals | node-pty spawns `claude`, `codex` or a shell directly | node-pty attaches to a named tmux session (`revive-<project>-<agent>`), created if missing. xterm.js streams over the transport |
| Manifest | `.revive/manifest.json` with status, run commands, port | Feeds the project cards and live status on the home screen as is |
| Versions | Shadow git under `.revive/git` | Powers "changes from last night" review with keep or undo |
| Preview | Electron `WebContentsView` | On remote clients: the dev server URL exposed through `tailscale serve` and opened in the client browser |
| Renderer | React, TypeScript, Tailwind, Revive editorial theme | A second Vite build target served by the Host as a PWA. New Home screen with scenes and glass tokens added to the theme |
| i18n | i18next, `en` and `he` catalogs | Every new string lands in both catalogs; logical CSS properties only |
| Tests | Vitest units, one Playwright smoke test | Transport parity tests, a tmux reattach test, a Playwright test of the web client against a local Host |

**Build order after M5.** M6: the transport seam, with no visible change to the app. M7: Host mode, WebSocket server, QR pairing and device tokens. M8: tmux backed sessions and reattach from any client. M9: Home screen, scenes and the PWA build. Each milestone ships with the local app still working exactly as before.

## Security and privacy

Whoever reaches the Host effectively gets a full terminal on the computer, so security is a P0 requirement, not an add on.

- **No port open to the internet.** The Host listens on localhost only and is reachable only through the private network.
- **A token per device.** Created at QR pairing, stored in the device keychain, revocable instantly from the device list.
- **Approval for sensitive actions.** Deleting files outside the project folder, deploying, or changing a database needs explicit approval, even when the request came from the phone.
- **Secrets stay put.** Revive never copies .env files or sends them to a client. The client sees variable names only.
- **Action log.** Every command sent from every device is recorded with the device name and time.
- **Nothing leaves the house.** No server of ours in the middle in v1. The license check is the only outbound call, and it carries no content.
- **The computer itself.** The wizard explains the FileVault trade off: with encryption on, after a power cut the Host won't come back until someone types the password at the machine.

## Distribution, licensing and pricing

Revive ships as a signed macOS download, and Host is a paid tier on top of the core. Users bring their own Claude or Codex subscription; Revive does not sell model access.

| Tier | Includes | Price |
| --- | --- | --- |
| Revive | Local mode on one computer, home screen, base scenes | [price] |
| Revive Anywhere | Host mode, unlimited clients, phone, notifications, all scenes and screensavers | [price] |
| Scene packs (P2) | Extra scenes and screensavers | [price per pack] |

- **Signing.** Apple notarization through the Apple Developer Program, otherwise macOS shows a warning and people don't install.
- **Payments and licensing.** Lemon Squeezy or Paddle as Merchant of Record: VAT in every country, invoices and license keys, without Tal handling it as an Israeli sole proprietor.
- **Updates.** electron-updater, tied to the license.
- **Trial.** 14 days of full Anywhere, then back to local mode with no data lost.
- **Landing page.** The hero is the home screen with a live scene, because that is what sells the product in the first second.

## Phases

Nobody pays for Host before Tal has used it every day for a full month without losing a session. Each phase opens only when the gate before it is passed.

*[Diagram: Roadmap: four phases, three gates, see the online PRD]*

The highlighted phase is next: Host mode on the Mac mini, P0 requirements only.

## Risks and open questions

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Remote terminal access | One breach gives full control of the customer's computer | Per device tokens, localhost only, action log, security review before beta |
| Tailscale as a requirement | Non-technical users drop off during setup | A two minute guide now, pairing that hides the network in P2 |
| Agent CLI changes | A Claude Code or Codex update changes output or behavior | Revive runs the real CLI instead of imitating it; automated tests against new versions |
| Subscription usage limits | Agents running for hours can hit a limit | Show limit status on the home screen, stop cleanly and resume |
| The computer doesn't come back | FileVault, sleep, OS updates | Setup wizard, health checks, phone alert when the Host stops responding |
| Heavy scenes | Background motion heats older machines and drains batteries | Drawn in code, low frame rate, paused when the window is hidden |

**Open questions**

- [ ] Prices for both tiers, and whether Anywhere is a subscription or a one time purchase.
- [ ] Does v1 support Tailscale only, or also home network access with no extra install.
- [ ] Weather for scenes: from an external source (needs an outbound call) or manual.
- [ ] Does Revive's night shift belong to Anywhere or to the base tier.
- [ ] Naming: Revive Host, Revive Anywhere, or something else for this mode.
