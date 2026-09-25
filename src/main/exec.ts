import { execFile } from 'node:child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export type Exec = (file: string, args: string[], opts?: { timeoutMs?: number }) => Promise<ExecResult>

/** Runs a program without a shell. Never throws; a missing program returns code 127. */
export const exec: Exec = (file, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: opts.timeoutMs ?? 10_000, env: process.env, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null
      const code = !err ? 0 : err.code === 'ENOENT' ? 127 : typeof err.code === 'number' ? err.code : 1
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
