import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Values from the project's .env files, read only so they can be masked in
 * output. They never leave the main process.
 */
export async function readEnvSecrets(dir: string): Promise<{ values: string[]; names: Set<string> }> {
  const values: string[] = []
  const names = new Set<string>()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return { values, names }
  }
  for (const name of entries.filter((n) => n === '.env' || n.startsWith('.env.'))) {
    let text: string
    try {
      text = await readFile(join(dir, name), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!m) continue
      const value = m[2]!.trim().replace(/^(['"])(.*)\1$/, '$2')
      if (value) {
        names.add(m[1]!)
        values.push(value)
      }
    }
  }
  return { values, names }
}
