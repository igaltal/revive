/**
 * After electron-builder: sign, notarize and staple the disk image, so it
 * opens without a Gatekeeper warning even before the app inside is checked.
 * (electron-builder already notarized and stapled the app itself.)
 *
 * Runs only when signing and notarizing variables are set; otherwise it says
 * so and does nothing. Any failure throws, and the build fails with it.
 */
const { execFileSync } = require('node:child_process')

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

module.exports = async function notarizeDmg(result) {
  const env = process.env
  const identity = env.CSC_NAME || (env.CSC_LINK ? 'Developer ID Application' : null)
  const notarizing = Boolean(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)
  const dmgs = result.artifactPaths.filter((p) => p.endsWith('.dmg'))
  if (!identity || !notarizing) {
    console.log('  • disk image: not signed or notarized (no Developer ID or App Store Connect key in the environment)')
    return []
  }
  for (const dmg of dmgs) {
    console.log(`  • signing ${dmg}`)
    run('codesign', ['--force', '--timestamp', '--sign', identity, dmg])
    console.log(`  • notarizing ${dmg} (waits for Apple)`)
    const out = run('xcrun', ['notarytool', 'submit', dmg, '--key', env.APPLE_API_KEY, '--key-id', env.APPLE_API_KEY_ID, '--issuer', env.APPLE_API_ISSUER, '--wait', '--output-format', 'json'])
    const status = JSON.parse(out).status
    if (status !== 'Accepted') throw new Error(`Notarization of ${dmg} ended with "${status}". See: xcrun notarytool log <id> --key ... for why.`)
    run('xcrun', ['stapler', 'staple', dmg])
    run('xcrun', ['stapler', 'validate', dmg])
    // Gatekeeper's own verdict, as a downloaded file would get it.
    run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-v', dmg])
    console.log(`  • ${dmg}: signed, notarized, stapled`)
  }
  return []
}
