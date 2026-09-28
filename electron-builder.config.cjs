/**
 * How Revive.app and its disk image are built (electron-builder).
 *
 * Everything that differs between "unsigned, on this Mac" and "signed,
 * notarized, published" comes from environment variables, so switching
 * signing on is configuration only (see PLAN.md, M11):
 *
 *   Signing       CSC_LINK (base64 .p12 or a path) + CSC_KEY_PASSWORD, or CSC_NAME
 *                 (a Developer ID Application identity in the keychain).
 *   Notarizing    APPLE_API_KEY (path to the App Store Connect .p8 key),
 *                 APPLE_API_KEY_ID, APPLE_API_ISSUER.
 *   Update feed   REVIVE_UPDATE_URL (a generic feed, e.g. a public Cloudflare R2 bucket)
 *                 or REVIVE_GITHUB_REPO=owner/name (GitHub Releases).
 *
 * Without signing variables the app gets an ad hoc signature (runs on this
 * Mac, not for distribution). Without notarizing variables nothing is notarized; a
 * build that has them fails if notarization fails.
 */
const env = process.env
const { version } = require('./package.json')
// 1.2.0-beta.3 goes to the beta channel (and a GitHub pre-release); 1.2.0 to stable, which beta users get too.
const prerelease = version.includes('-')
const signing = Boolean(env.CSC_LINK || env.CSC_NAME)
const notarizing = Boolean(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)
if (notarizing && !signing) throw new Error('Notarizing needs a Developer ID certificate: set CSC_LINK or CSC_NAME too.')

function publish() {
  if (env.REVIVE_UPDATE_URL) return [{ provider: 'generic', url: env.REVIVE_UPDATE_URL, channel: 'latest' }]
  if (env.REVIVE_GITHUB_REPO) {
    const [owner, repo] = env.REVIVE_GITHUB_REPO.split('/')
    return [{ provider: 'github', owner, repo, releaseType: prerelease ? 'prerelease' : 'release' }]
  }
  return null
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.revive.mac',
  productName: 'Revive',
  copyright: 'Copyright © 2026 Igal Tal Merom',
  // REVIVE_RELEASE_DIR: build outside a folder synced by iCloud Drive (its File Provider keeps adding
  // Finder metadata that codesign refuses). CI uses the default.
  directories: { output: env.REVIVE_RELEASE_DIR || 'release', buildResources: 'build' },
  files: [
    'out/**',
    'package.json',
    '!**/*.map',
    // node-pty: keep its JavaScript, the module rebuilt for each architecture (build/Release) and the
    // macOS prebuilds it falls back to; leave out sources, Windows binaries and a stale local build.
    '!node_modules/node-pty/{bin,deps,src,third_party,scripts,node-addon-api,typings}/**',
    '!node_modules/node-pty/prebuilds/win32-*/**',
    '!node_modules/node-pty/build/Release/{obj.target,.deps}/**',
    '!node_modules/node-pty/build/{node_gyp_bins,Makefile,*.mk,config.gypi,binding.Makefile,gyp-mac-tool}'
  ],
  // tmux.conf, the menu bar icons and the bundled tmux live next to the app, not inside app.asar.
  extraResources: [
    { from: 'resources/tmux.conf', to: 'tmux.conf' },
    { from: 'resources/trayTemplate.png', to: 'trayTemplate.png' },
    { from: 'resources/trayTemplate@2x.png', to: 'trayTemplate@2x.png' },
    { from: 'resources/bin/tmux', to: 'bin/tmux' }
  ],
  asar: true,
  // node-pty's native module and its spawn-helper must be real files on disk.
  asarUnpack: ['node_modules/node-pty/**'],
  npmRebuild: true,
  generateUpdatesFilesForAllChannels: true,
  publish: publish(),
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }],
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.icns',
    minimumSystemVersion: '11.0',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // Without a certificate electron-builder signs nothing; scripts/adhoc-sign.cjs then gives the app
    // an ad hoc signature so it runs on this Mac (not for distribution).
    identity: signing ? env.CSC_NAME || undefined : null,
    notarize: notarizing,
    // The same file in both builds, already right: the universal tmux, and node-pty's per-architecture prebuilds.
    x64ArchFiles: 'Contents/Resources/{bin/tmux,app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-*/*}',
    extendInfo: { LSApplicationCategoryType: 'public.app-category.developer-tools' }
  },
  dmg: {
    title: 'Revive ${version}',
    icon: 'build/icon.icns',
    background: 'build/background.tiff',
    window: { width: 660, height: 420 },
    iconSize: 128,
    contents: [
      { x: 180, y: 212, type: 'file' },
      { x: 480, y: 212, type: 'link', path: '/Applications' }
    ],
    sign: false,
    writeUpdateInfo: false
  },
  // The disk image itself: signed, notarized and stapled too when signing is on (scripts/notarize-dmg.mjs).
  afterPack: './scripts/after-pack.cjs',
  afterSign: './scripts/adhoc-sign.cjs',
  afterAllArtifactBuild: './scripts/notarize-dmg.cjs'
}
