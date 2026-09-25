// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** Removes terminal colors and cursor codes. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/** Splits streamed output into complete lines, keeping the unfinished tail. */
export function splitLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split(/\r\n|\n|\r/)
  const rest = parts.pop() ?? ''
  return { lines: parts.filter((l) => l.trim().length > 0), rest }
}
