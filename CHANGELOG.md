# Changelog

What changed in each version of Revive, in plain words. Versions follow
[semantic versioning](https://semver.org): the last number for fixes, the
middle one for new things, the first one for changes that need you to do
something. Versions with `-beta.N` go to people on the beta channel first.

## 0.11.0

The first version you can download and install like any other Mac app.

- **One download for every Mac.** Revive comes as a disk image that works on Apple silicon and Intel Macs, running macOS 11 or later.
- **Nothing else to install for sessions that keep running.** Revive now brings its own tmux, so Claude Code, Codex and your terminals keep running when you close Revive, without Homebrew. If you already have tmux, Revive still uses its own.
- **A proper install.** The disk image opens to a window with the Revive icon and your Applications folder: drag one onto the other. If you open Revive from somewhere else, it offers to move itself to Applications.
- **Updates on their own.** Revive checks for new versions now and then, downloads them in the background, and installs them the next time you quit. A small note tells you when an update is ready; nothing interrupts you, and a computer that's sharing and running agents is never restarted by an update.
- **Beta channel.** Beta versions go to people using a beta version; everyone else gets stable versions only.
- **Fixed:** opening the same terminal on a second device could type stray characters (like `1;2c0;276;0c`) into it.

## 0.10.0

- The new look: Scenic (frosted glass over a live landscape) and Paper (the warm, plain look), a Home screen with your projects, the computer's health and a command bar, a Customize screen, and screensavers.

## 0.9.0

- Revive in the browser and on your phone, installable as an app, paired with a code and allowed on the sharing computer.

## 0.8.0

- Sessions that keep running after Revive closes, and a terminal for every project.

## 0.7.0

- Share this computer with your other devices over Tailscale, with pairing, a device list and an activity log.

## 0.1.0 – 0.6.0

- The first versions: choosing a folder, reading your projects with Claude Code, starting them with a live preview, saved versions you can go back to, in Hebrew and English.
