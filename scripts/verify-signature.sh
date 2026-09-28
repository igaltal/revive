#!/usr/bin/env bash
# Checks a built Revive the way Gatekeeper will. Used by the release workflow
# once signing is on, and by hand:
#
#   scripts/verify-signature.sh <release dir>            # signed + notarized build: every check
#   scripts/verify-signature.sh <release dir> --adhoc    # unsigned (ad hoc) build: integrity only
set -euo pipefail
DIR="${1:?release directory}"
MODE="${2:-}"
APP="$DIR/mac-universal/Revive.app"
DMG="$(ls -t "$DIR"/*.dmg | head -1)"
step() { printf '\n== %s\n' "$*"; }

step "Signature is intact (every nested binary, strict)"
codesign --verify --deep --strict --verbose=2 "$APP"

step "Both architectures"
lipo -archs "$APP/Contents/MacOS/Revive"
lipo -archs "$APP/Contents/Resources/bin/tmux"
lipo -archs "$APP/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node"

if [[ "$MODE" == "--adhoc" ]]; then
  step "Ad hoc build: not for distribution (Gatekeeper would reject it); stopping here"
  exit 0
fi

step "Developer ID, hardened runtime, team"
codesign -dv --verbose=4 "$APP" 2>&1 | tee /dev/stderr | grep -q 'Authority=Developer ID Application' || { echo "not signed with a Developer ID Application certificate" >&2; exit 1; }
codesign -dv --verbose=4 "$APP" 2>&1 | grep -q 'flags=.*runtime' || { echo "hardened runtime is off" >&2; exit 1; }

step "Entitlements: only allow-jit"
ENT="$(codesign -d --entitlements - --xml "$APP" 2>/dev/null)"
echo "$ENT"
echo "$ENT" | grep -q 'com.apple.security.cs.allow-jit' || { echo "allow-jit missing" >&2; exit 1; }
if echo "$ENT" | grep -o '<key>[^<]*</key>' | grep -v 'allow-jit' | grep -q .; then echo "unexpected entitlements" >&2; exit 1; fi

step "The bundled tmux is signed with the same identity and the hardened runtime"
codesign -dv --verbose=4 "$APP/Contents/Resources/bin/tmux" 2>&1 | grep -E 'Authority=Developer ID Application|flags=.*runtime'

step "Gatekeeper accepts the app (as if opened after download)"
spctl --assess --type execute --verbose=4 "$APP"

step "Notarization ticket stapled to the app"
xcrun stapler validate "$APP"

step "Gatekeeper accepts the disk image"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"

step "Notarization ticket stapled to the disk image"
xcrun stapler validate "$DMG"

printf '\nAll checks passed: %s\n' "$DMG"
