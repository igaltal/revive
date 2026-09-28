/**
 * Without a Developer ID certificate, electron-builder signs nothing. This
 * gives the finished app one consistent ad hoc signature (no identity, no
 * hardened runtime, no timestamp), so it runs on the Mac that built it and
 * passes `codesign --verify`. It is not for distribution: Gatekeeper rejects
 * ad hoc apps downloaded from the internet. With a certificate this does nothing.
 */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

module.exports = async function adhocSign(context) {
  if (process.env.CSC_LINK || process.env.CSC_NAME) return
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // Only the finished universal app (the per-architecture halves are merged into it first).
  if (/-temp$/.test(context.appOutDir)) return
  console.log(`  • ad hoc signing (no certificate): ${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
