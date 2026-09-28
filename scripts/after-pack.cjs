/**
 * Before anything is signed: remove extended attributes (Finder info,
 * quarantine and provenance marks picked up on the way), which codesign
 * refuses as "detritus".
 */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  console.log(`  • clearing extended attributes: ${context.appOutDir}`)
  execFileSync('xattr', ['-cr', join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)])
}
