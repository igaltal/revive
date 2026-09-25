import { spawn } from 'node:child_process'
import * as pty from 'node-pty'
import { CLAUDE_INSTALL_COMMAND, type TaskUpdate } from '@shared/prereq'
import { redact } from '@shared/redact'
import { splitLines, stripAnsi } from '@shared/ansi'
import { exec } from './exec'
import { claudeSignedIn } from './prereq'

type Emit = (update: TaskUpdate) => void

const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const POLL_MS = 2000

let busy: TaskUpdate['task'] | null = null
const children = new Set<{ kill: () => void }>()

function lineEmitter(task: TaskUpdate['task'], emit: Emit) {
  let rest = ''
  return {
    push(chunk: string) {
      const split = splitLines(rest, stripAnsi(chunk))
      rest = split.rest
      for (const line of split.lines) emit({ task, phase: 'running', line: redact(line) })
    },
    flush() {
      if (rest.trim()) emit({ task, phase: 'running', line: redact(rest) })
      rest = ''
    }
  }
}

/** Runs Anthropic's official installer. The command is a constant; nothing comes from the renderer. */
export function installClaude(emit: Emit): void {
  if (busy) return
  busy = 'install-claude'
  const out = lineEmitter('install-claude', emit)
  emit({ task: 'install-claude', phase: 'running', line: `$ ${CLAUDE_INSTALL_COMMAND}` })
  const child = spawn('/bin/bash', ['-c', CLAUDE_INSTALL_COMMAND], { env: process.env })
  const handle = { kill: () => child.kill('SIGTERM') }
  children.add(handle)
  child.stdout.on('data', (d: Buffer) => out.push(d.toString()))
  child.stderr.on('data', (d: Buffer) => out.push(d.toString()))
  const finish = (ok: boolean) => {
    children.delete(handle)
    out.flush()
    busy = null
    emit({ task: 'install-claude', phase: ok ? 'done' : 'failed' })
  }
  child.on('error', () => finish(false))
  child.on('close', (code) => finish(code === 0))
}

/**
 * Starts `claude auth login`, which opens the sign-in page in the browser.
 * It needs a terminal, so it runs in a pseudo-terminal. We poll the sign-in
 * status and finish as soon as it says yes.
 */
export function signIn(emit: Emit): void {
  if (busy) return
  busy = 'sign-in'
  const out = lineEmitter('sign-in', emit)
  let term: pty.IPty
  try {
    term = pty.spawn('claude', ['auth', 'login'], {
      name: 'xterm-color',
      cols: 100,
      rows: 30,
      cwd: process.env['HOME'],
      env: process.env as Record<string, string>
    })
  } catch {
    busy = null
    emit({ task: 'sign-in', phase: 'failed' })
    return
  }
  const handle = { kill: () => term.kill() }
  children.add(handle)
  term.onData((d) => out.push(d))

  let finished = false
  const started = Date.now()
  const finish = (ok: boolean) => {
    if (finished) return
    finished = true
    clearInterval(timer)
    out.flush()
    children.delete(handle)
    try {
      term.kill()
    } catch {
      // already gone
    }
    busy = null
    emit({ task: 'sign-in', phase: ok ? 'done' : 'failed' })
  }
  const timer = setInterval(() => {
    void claudeSignedIn(exec).then((state) => {
      if (state === 'yes') finish(true)
      else if (Date.now() - started > SIGN_IN_TIMEOUT_MS) finish(false)
    })
  }, POLL_MS)
  term.onExit(() => {
    void claudeSignedIn(exec).then((state) => finish(state === 'yes'))
  })
}

/** Called on quit: nothing Revive started outlives it. */
export function killAllTasks(): void {
  for (const c of children) {
    try {
      c.kill()
    } catch {
      // ignore
    }
  }
  children.clear()
  busy = null
}
