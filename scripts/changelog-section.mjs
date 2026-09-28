// Prints one version's section of CHANGELOG.md (the release notes), e.g. node scripts/changelog-section.mjs 0.11.0
import { readFileSync } from 'node:fs'
const version = process.argv[2]
const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const start = text.search(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm'))
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
const rest = text.slice(start)
const next = rest.slice(3).search(/^## /m)
console.log((next < 0 ? rest : rest.slice(0, next + 3)).replace(/^## .*\n/, '').trim())
